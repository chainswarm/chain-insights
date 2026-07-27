// The watchlist pass: scope the signal the loop already produced to the
// operator's own addresses. Two of the three triggers are local joins and cost
// nothing remote; only the dust probe calls out, and it batches per network.
// Address risk is deliberately NOT a trigger — it is a downstream product, not
// a monitoring input.
import { appendFile, mkdir } from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { monitorPaths } from './paths.js'
import type { AlertEvent } from './alerts.js'
import type { MonitorConfig } from './config.js'
import type { MonitorStore } from './store.js'
import { loadWatchlist, type WatchedAddress } from './watchlist.js'

export interface WatchlistHit {
  address: string
  network: string
  trigger: 'finding' | 'movement' | 'dust'
  source_ref: string
  detail?: string
}

// Watched (network, address) pairs as a two-column VALUES list, so the join
// happens inside DuckDB rather than as N round trips.
function watchedPairs(watched: WatchedAddress[]): { sql: string; params: unknown[] } {
  const rows = watched.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')
  return { sql: rows, params: watched.flatMap((w) => [w.network, w.address]) }
}

export async function findingHits(
  store: MonitorStore,
  watched: WatchedAddress[],
  _runTimestamp: number,
): Promise<WatchlistHit[]> {
  if (watched.length === 0) return []
  const { sql, params } = watchedPairs(watched)
  // NOT EXISTS against watchlist_hits is the dedupe: a finding doc already
  // reported for this address never re-alerts, however often the loop runs.
  const rows = await store.all(
    `SELECT DISTINCT fa.address AS address, fa.network AS network, fa.doc_path AS source_ref
       FROM finding_addresses fa
       JOIN (VALUES ${sql}) AS w(network, address)
         ON w.address = fa.address AND w.network = fa.network
      WHERE NOT EXISTS (
        SELECT 1 FROM watchlist_hits h
         WHERE h.trigger = 'finding' AND h.address = fa.address
           AND h.network = fa.network AND h.source_ref = fa.doc_path)
      ORDER BY fa.doc_path`,
    params,
  )
  return rows.map((r) => ({
    address: String(r.address),
    network: String(r.network),
    trigger: 'finding' as const,
    source_ref: String(r.source_ref),
    detail: undefined,
  }))
}

export async function movementHits(
  store: MonitorStore,
  watched: WatchedAddress[],
  _runTimestamp: number,
): Promise<WatchlistHit[]> {
  if (watched.length === 0) return []
  const { sql, params } = watchedPairs(watched)
  // case_movements carries no network column; the owning case does.
  const rows = await store.all(
    `SELECT DISTINCT cm.address AS address, c.network AS network,
            cm.case_id AS source_ref, cm.movement AS detail
       FROM case_movements cm
       JOIN cases c ON c.case_id = cm.case_id
       JOIN (VALUES ${sql}) AS w(network, address)
         ON w.address = cm.address AND w.network = c.network
      WHERE NOT EXISTS (
        SELECT 1 FROM watchlist_hits h
         WHERE h.trigger = 'movement' AND h.address = cm.address
           AND h.network = c.network AND h.source_ref = cm.case_id
           AND h.detail IS NOT DISTINCT FROM cm.movement)
      ORDER BY cm.case_id`,
    params,
  )
  return rows.map((r) => ({
    address: String(r.address),
    network: String(r.network),
    trigger: 'movement' as const,
    source_ref: String(r.source_ref),
    detail: r.detail === null || r.detail === undefined ? undefined : String(r.detail),
  }))
}

// One graph_query_batch per distinct network — graph_query_batch takes a
// single `network` argument, so this is the tightest possible grouping. Cost
// is flat in address count.
//
// FLOWS_TO property names verified against the live topology graph: the edge
// exposes `amount_usd_sum`, `last_tx_id`, and `last_seen_timestamp` (epoch ms).
// There is no `last_transfer_ms`.
// Chain addresses are alphanumeric (SS58 base58, or H160 as 0x-prefixed hex).
// Anything else cannot be a real address, so the query builder REFUSES it
// rather than trying to escape it. Escaping a Cypher string literal by hand is
// how injections happen: the obvious `replace(/'/g, "\\'")` leaves backslash
// unescaped, so an address ending in `\` escapes the closing quote and breaks
// out of the literal. An allow-list has no such failure mode.
const SAFE_ADDRESS = /^[A-Za-z0-9]{1,128}$/

function dustQuery(addresses: string[], dustMaxUsd: number, sinceTimestamp: number): string {
  const unsafe = addresses.filter((a) => !SAFE_ADDRESS.test(a.startsWith('0x') ? a.slice(2) : a))
  if (unsafe.length > 0) {
    throw new Error(`watchlist contains ${unsafe.length} address(es) that are not valid chain addresses: ${unsafe.slice(0, 3).map((a) => JSON.stringify(a)).join(', ')}`)
  }
  const list = addresses.map((a) => `'${a}'`).join(',')
  return `USE topology MATCH (src:Address)-[t:FLOWS_TO]->(dst:Address)
 WHERE dst.address IN [${list}] AND t.amount_usd_sum <= ${dustMaxUsd} AND t.last_seen_timestamp >= ${sinceTimestamp}
 RETURN dst.address AS address, src.address AS from_address,
        t.amount_usd_sum AS amount_usd, t.last_tx_id AS tx_ref
 LIMIT 500`
}

export async function dustHits(
  client: Client,
  store: MonitorStore,
  watched: WatchedAddress[],
  opts: { dustMaxUsd: number; dustLookbackSeconds: number },
  runTimestamp: number,
): Promise<{ hits: WatchlistHit[]; calls: number; error?: string }> {
  if (watched.length === 0) return { hits: [], calls: 0 }
  const byNetwork = new Map<string, string[]>()
  for (const w of watched) {
    const list = byNetwork.get(w.network) ?? []
    list.push(w.address)
    byNetwork.set(w.network, list)
  }
  const sinceTimestamp = runTimestamp - opts.dustLookbackSeconds * 1000
  // In-batch dedup by hit key (R6): a backend response repeating the same row
  // must yield one hit, whatever the store already knows.
  const seenInBatch = new Set<string>()
  const hits: WatchlistHit[] = []
  let calls = 0
  let error: string | undefined
  for (const [network, addresses] of byNetwork) {
    try {
      calls += 1
      const result = (await client.callTool({
        name: 'graph_query_batch',
        arguments: { network, queries: [{ id: 'dust', query: dustQuery(addresses, opts.dustMaxUsd, sinceTimestamp) }] },
      })) as {
        structuredContent?: {
          facts?: { queries?: Array<{ id: string; results?: Array<Record<string, unknown>> }> }
        }
      }
      const rows = result.structuredContent?.facts?.queries?.find((q) => q.id === 'dust')?.results ?? []
      for (const row of rows) {
        const sourceRef = String(row.tx_ref ?? `${row.from_address}->${row.address}`)
        const key = `${network}|${String(row.address)}|${sourceRef}`
        if (seenInBatch.has(key)) continue
        const already = await store.all(
          `SELECT 1 FROM watchlist_hits
            WHERE trigger = 'dust' AND address = $1 AND network = $2 AND source_ref = $3 LIMIT 1`,
          [String(row.address), network, sourceRef],
        )
        if (already.length > 0) continue
        seenInBatch.add(key)
        hits.push({
          address: String(row.address),
          network,
          trigger: 'dust',
          source_ref: sourceRef,
          detail: `from ${String(row.from_address)}, ${String(row.amount_usd)} USD`,
        })
      }
    } catch (err) {
      // Degrade, never block: the two free triggers must still report.
      error = error ? `${error}; ${(err as Error).message}` : (err as Error).message
    }
  }
  return { hits, calls, error }
}

const ALERT_TYPE = {
  finding: 'watchlist_finding',
  movement: 'watchlist_movement',
  dust: 'watchlist_dust',
} as const

export async function runWatchlistPass(
  client: Client,
  workspaceRoot: string,
  store: MonitorStore,
  config: MonitorConfig,
  runTimestamp: number,
): Promise<{
  hits: WatchlistHit[]
  alerts: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[]
  calls: number
  error?: string
}> {
  const watched = await loadWatchlist(workspaceRoot)
  if (watched.length === 0 || config.watchlist?.enabled === false) return { hits: [], alerts: [], calls: 0 }
  const hits: WatchlistHit[] = [
    ...(await findingHits(store, watched, runTimestamp)),
    ...(await movementHits(store, watched, runTimestamp)),
  ]
  const dust = await dustHits(
    client,
    store,
    watched,
    {
      dustMaxUsd: config.watchlist?.dustMaxUsd ?? 1.0,
      dustLookbackSeconds: config.watchlist?.dustLookbackSeconds ?? 86400,
    },
    runTimestamp,
  )
  hits.push(...dust.hits)
  // Canonical-first (durability spec req 1): the JSONL is the source of truth
  // for dedup; the DuckDB rows are a replay index rebuilt from it.
  if (hits.length > 0) {
    const p = monitorPaths(workspaceRoot)
    await mkdir(p.logsDir, { recursive: true })
    await appendFile(
      p.watchlistHitsLog,
      hits.map((h) => JSON.stringify({ run_timestamp: runTimestamp, ...h })).join('\n') + '\n',
      'utf8',
    )
  }
  for (const hit of hits) {
    await store.run('INSERT INTO watchlist_hits VALUES ($1,$2,$3,$4,$5,$6)', [
      runTimestamp,
      hit.address,
      hit.network,
      hit.trigger,
      hit.source_ref,
      hit.detail ?? null,
    ])
  }
  const alerts = hits.map((hit) => ({
    type: ALERT_TYPE[hit.trigger],
    network: hit.network,
    address: hit.address,
    run_timestamp: runTimestamp,
    doc_path: hit.trigger === 'finding' ? hit.source_ref : undefined,
    case_id: hit.trigger === 'movement' ? hit.source_ref : undefined,
  }))
  return { hits, alerts, calls: dust.calls, error: dust.error }
}
