// src/monitor/probe.ts
// Victim lane activity probe state (spec req 5): per-network $since cursors
// in the append-only canonical logs/probe-cursors.jsonl — last line per
// network wins, torn lines cost themselves only (parseJsonlLines). The
// cursor is a COST optimization, never a correctness dependency: hit dedup
// by source_ref in logs/watchlist-hits.jsonl is what prevents re-alerts, so
// a deleted or stale cursor file can never fire a duplicate alert.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { listCases } from './cases.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import type { MonitorStore } from './store.js'
import { readSnapshots } from './tracker.js'
// Type-only import: watchlist-run.ts imports activityHits from here at
// runtime, so this edge must stay erased to keep the module graph acyclic.
import type { WatchlistHit } from './watchlist-run.js'
import type { WatchedAddress } from './watchlist.js'

export interface ProbeCursorRecord {
  network: string
  since_timestamp: number
  run_timestamp: number
}

export async function readProbeCursors(workspaceRoot: string): Promise<Map<string, number>> {
  const { probeCursorsLog } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(probeCursorsLog, 'utf8')
  } catch {
    // Missing log = no cursors yet (normal on a fresh workspace).
    return new Map()
  }
  const cursors = new Map<string, number>()
  for (const r of parseJsonlLines<ProbeCursorRecord>(raw, probeCursorsLog).records) {
    if (typeof r.network === 'string' && typeof r.since_timestamp === 'number') {
      cursors.set(r.network, r.since_timestamp)
    }
  }
  return cursors
}

export async function appendProbeCursor(
  workspaceRoot: string,
  network: string,
  sinceTimestamp: number,
  runTimestamp: number,
): Promise<void> {
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.logsDir, { recursive: true })
  await appendFile(
    p.probeCursorsLog,
    JSON.stringify({ network, since_timestamp: sinceTimestamp, run_timestamp: runTimestamp } satisfies ProbeCursorRecord) + '\n',
    'utf8',
  )
}

/** First-probe cursor for a network without a cursor line: the EARLIEST
 *  first-trace timestamp among that network's cases (spec req 5 — pre-
 *  monitoring history never fires). With no traced case yet, monitoring
 *  starts NOW. Closed cases count too: their managed entries stay watched. */
export async function initialProbeCursor(
  workspaceRoot: string,
  network: string,
  runTimestamp: number,
): Promise<number> {
  let earliest: number | undefined
  for (const c of await listCases(workspaceRoot)) {
    if (c.network !== network) continue
    const first = (await readSnapshots(workspaceRoot, c.case_id))[0]?.run_timestamp
    if (first !== undefined && (earliest === undefined || first < earliest)) earliest = first
  }
  return earliest ?? runTimestamp
}

// Same allow-list stance as watchlist-run.ts dustQuery: refuse rather than
// escape — hand-escaping Cypher string literals is how injections happen.
const SAFE_ADDRESS = /^[A-Za-z0-9]{1,128}$/

/** ONE query per network over all watched addresses (spec req 4). Strict
 *  `>` on the cursor: rows AT the cursor were already seen. LIMIT bounds a
 *  pathological fan-out; the source_ref dedup absorbs any truncation. */
export function activityQuery(addresses: string[], sinceTimestamp: number): string {
  const unsafe = addresses.filter((a) => !SAFE_ADDRESS.test(a.startsWith('0x') ? a.slice(2) : a))
  if (unsafe.length > 0) {
    throw new Error(
      `watchlist contains ${unsafe.length} address(es) that are not valid chain addresses: ${unsafe.slice(0, 3).map((a) => JSON.stringify(a)).join(', ')}`,
    )
  }
  const list = addresses.map((a) => `'${a}'`).join(',')
  return `USE topology MATCH (a:Address)
 WHERE a.address IN [${list}] AND a.last_activity_timestamp > ${sinceTimestamp}
 RETURN a.address AS address, a.last_activity_timestamp AS last_activity_timestamp
 LIMIT 500`
}

/** Thin fan-out federation returns PER-SHARD rows: the same address may
 *  appear once per shard, some shards with null timestamps. The client —
 *  never the backend — merges by address taking MAX(last_activity_timestamp)
 *  and ignoring nulls (spec req 4 + assumption). */
export function mergeActivityRows(rows: Array<Record<string, unknown>>): Map<string, number> {
  const merged = new Map<string, number>()
  for (const row of rows) {
    const address = row.address
    const ts = row.last_activity_timestamp
    if (typeof address !== 'string' || address.length === 0) continue
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    const prev = merged.get(address)
    if (prev === undefined || ts > prev) merged.set(address, ts)
  }
  return merged
}

/** The probe pass: one graph_query_batch per distinct network over every
 *  watched address. Degrades per network like dustHits — a dead backend
 *  yields error text, never a thrown pass. */
export async function activityHits(
  client: Client,
  store: MonitorStore,
  workspaceRoot: string,
  watched: WatchedAddress[],
  runTimestamp: number,
): Promise<{ hits: WatchlistHit[]; calls: number; error?: string }> {
  if (watched.length === 0) return { hits: [], calls: 0 }
  const byNetwork = new Map<string, string[]>()
  for (const w of watched) {
    const list = byNetwork.get(w.network) ?? []
    list.push(w.address)
    byNetwork.set(w.network, list)
  }
  const cursors = await readProbeCursors(workspaceRoot)
  const seenInBatch = new Set<string>()
  const hits: WatchlistHit[] = []
  let calls = 0
  let error: string | undefined
  for (const [network, addresses] of byNetwork) {
    const since = cursors.get(network) ?? (await initialProbeCursor(workspaceRoot, network, runTimestamp))
    try {
      calls += 1
      const result = (await client.callTool({
        name: 'graph_query_batch',
        arguments: { network, queries: [{ id: 'activity', query: activityQuery(addresses, since) }] },
      })) as { structuredContent?: { facts?: { queries?: Array<{ id: string; results?: Array<Record<string, unknown>> }> } } }
      const rows = result.structuredContent?.facts?.queries?.find((q) => q.id === 'activity')?.results ?? []
      let advanced = since
      for (const [address, lastActivity] of mergeActivityRows(rows)) {
        if (lastActivity > advanced) advanced = lastActivity
        const sourceRef = `${address}|${lastActivity}`
        const key = `${network}|${address}|${sourceRef}`
        if (seenInBatch.has(key)) continue
        const already = await store.all(
          `SELECT 1 FROM watchlist_hits
            WHERE trigger = 'activity' AND address = $1 AND network = $2 AND source_ref = $3 LIMIT 1`,
          [address, network, sourceRef],
        )
        if (already.length > 0) continue
        seenInBatch.add(key)
        hits.push({ address, network, trigger: 'activity', source_ref: sourceRef, detail: `last_activity_timestamp=${lastActivity}` })
      }
      // Advance (or persist the initial) cursor only when there is
      // something new to record — the log stays quiet on quiet passes.
      if (advanced !== since || !cursors.has(network)) {
        await appendProbeCursor(workspaceRoot, network, advanced, runTimestamp)
      }
    } catch (err) {
      error = error ? `${error}; ${(err as Error).message}` : (err as Error).message
    }
  }
  return { hits, calls, error }
}
