// src/monitor/label-probe.ts
// Watchlist label probe state (label-cutover spec req 1): last-seen
// (label, source) sets per watched address in the append-only canonical
// logs/label-baseline.jsonl — last line per (network, address) wins, torn
// lines cost themselves only (parseJsonlLines). The baseline is the DIFF
// base, never the correctness dependency: hit dedup by source_ref in
// logs/watchlist-hits.jsonl is what prevents re-alerts, so a deleted or
// stale baseline can only re-bootstrap silently, never fire a duplicate.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import type { MonitorStore } from './store.js'
// Type-only import: watchlist-run.ts imports labelHits from here at runtime,
// so this edge must stay erased to keep the module graph acyclic (same
// pattern as probe.ts).
import type { WatchlistHit } from './watchlist-run.js'
import type { WatchedAddress } from './watchlist.js'

// The topology label overlay carries no per-label provenance (labels is a
// flat string array on :Address), so the pair's source is this constant.
// The (label, source) pair shape is kept so a future label_sources overlay
// surface slots in without changing source_ref or the alert contract.
export const LABEL_SOURCE = 'topology'

export interface LabelPair {
  label: string
  source: string
}

export interface LabelBaselineRecord {
  network: string
  address: string
  pairs: LabelPair[]
  run_timestamp: number
}

export function pairKey(label: string, source: string): string {
  return `${label}|${source}`
}

export async function readLabelBaseline(workspaceRoot: string): Promise<Map<string, LabelPair[]>> {
  const { labelBaselineLog } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(labelBaselineLog, 'utf8')
  } catch {
    // Missing log = nothing bootstrapped yet (normal on a fresh workspace).
    return new Map()
  }
  const baseline = new Map<string, LabelPair[]>()
  for (const r of parseJsonlLines<LabelBaselineRecord>(raw, labelBaselineLog).records) {
    if (typeof r.network === 'string' && typeof r.address === 'string' && Array.isArray(r.pairs)) {
      baseline.set(
        `${r.network}:${r.address}`,
        r.pairs.filter((p) => typeof p?.label === 'string' && typeof p?.source === 'string'),
      )
    }
  }
  return baseline
}

export async function appendLabelBaseline(workspaceRoot: string, record: LabelBaselineRecord): Promise<void> {
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.logsDir, { recursive: true })
  await appendFile(p.labelBaselineLog, JSON.stringify(record satisfies LabelBaselineRecord) + '\n', 'utf8')
}

// Same allow-list stance as probe.ts / watchlist-run.ts: refuse rather than
// escape — hand-escaping Cypher string literals is how injections happen.
const SAFE_ADDRESS = /^[A-Za-z0-9]{1,128}$/

/** ONE query per network over all watched addresses (spec req 1-2). Reads
 *  the topology label overlay — the only queryable label surface (the facts
 *  AddressLabel view is retired). Address membership in the IN list scopes
 *  the shared-graph networks exactly like the dust and activity probes.
 *  LIMIT bounds a pathological fan-out; source_ref dedup absorbs truncation. */
export function labelQuery(addresses: string[]): string {
  const unsafe = addresses.filter((a) => !SAFE_ADDRESS.test(a.startsWith('0x') ? a.slice(2) : a))
  if (unsafe.length > 0) {
    throw new Error(
      `watchlist contains ${unsafe.length} address(es) that are not valid chain addresses: ${unsafe.slice(0, 3).map((a) => JSON.stringify(a)).join(', ')}`,
    )
  }
  const list = addresses.map((a) => `'${a}'`).join(',')
  // labels(a) AS families (label-governance Plan 3 D2) rides the SAME row as
  // a.labels — one query, no extra round trip. It is the graphsync overlay
  // taxonomy (PascalCase node labels: Scam/Mixer/Bridge/Victim/Exchange/
  // Poisoned/Propagated/Attributed, plus Address on every node and layer-2
  // knowledge labels like Neuron/Subnet) — see extractFamilies for the
  // vocabulary filter and severityForFamilies for the D2 mapping.
  return `USE topology MATCH (a:Address)
 WHERE a.address IN [${list}] AND a.labels IS NOT NULL
 RETURN a.address AS address, a.labels AS labels, labels(a) AS families
 LIMIT 500`
}

/** Thin fan-out federation returns PER-SHARD rows: the same address may
 *  appear once per shard, some shards with null labels. The client — never
 *  the backend — merges by UNION per address (labels is shard-invariant,
 *  so union == the value; union also tolerates a lagging shard). */
export function mergeLabelRows(rows: Array<Record<string, unknown>>): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>()
  for (const row of rows) {
    const address = row.address
    const labels = row.labels
    if (typeof address !== 'string' || address.length === 0) continue
    if (!Array.isArray(labels)) continue
    const set = merged.get(address) ?? new Set<string>()
    for (const l of labels) {
      const label = String(l)
      if (label.length > 0) set.add(label)
    }
    merged.set(address, set)
  }
  return merged
}

/** Per-shard merge of the families(a) column — same UNION semantics as
 *  mergeLabelRows (labels(a) is shard-invariant so union == the value, and
 *  tolerates a lagging shard). RAW node-label set, not yet filtered to the
 *  overlay vocabulary: callers run extractFamilies on the result before
 *  mapping severity. */
export function mergeFamilyRows(rows: Array<Record<string, unknown>>): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>()
  for (const row of rows) {
    const address = row.address
    const families = row.families
    if (typeof address !== 'string' || address.length === 0) continue
    if (!Array.isArray(families)) continue
    const set = merged.get(address) ?? new Set<string>()
    for (const f of families) {
      const family = String(f)
      if (family.length > 0) set.add(family)
    }
    merged.set(address, set)
  }
  return merged
}

// The overlay-family vocabulary the monitor understands (label-governance
// Plan 3 D2). labels(a) returns EVERY node label on the address — Address
// (stamped on every node) and layer-2 knowledge labels (Neuron, Subnet, ...)
// included — so extractFamilies filters down to exactly this set before any
// severity mapping happens. A new family (e.g. a future overlay addition)
// must be added HERE and to ALERT_FAMILIES below, or it silently falls back
// to the conservative "no families extracted" branch.
export const OVERLAY_FAMILIES = ['Scam', 'Mixer', 'Bridge', 'Victim', 'Exchange', 'Poisoned', 'Propagated', 'Attributed'] as const
const OVERLAY_FAMILY_SET: ReadonlySet<string> = new Set(OVERLAY_FAMILIES)

/** Filters a raw labels(a) node-label list down to the overlay vocabulary.
 *  Defensive against untrusted backend shapes, same stance as mergeLabelRows/
 *  mergeFamilyRows: a non-array input (including null/undefined) yields an
 *  empty set rather than throwing. */
export function extractFamilies(rawFamilies: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(rawFamilies)) return out
  for (const f of rawFamilies) {
    const family = String(f)
    if (OVERLAY_FAMILY_SET.has(family)) out.add(family)
  }
  return out
}

// Verdict families (D2): transport, holding, and mixing findings that alert
// on their own. Attributed alone, and Victim/Exchange alone, are
// informational context — see severityForFamilies.
const ALERT_FAMILIES: ReadonlySet<string> = new Set(['Scam', 'Mixer', 'Bridge', 'Poisoned', 'Propagated'])

/** D2 family -> severity mapping. Any verdict family present (Scam, Mixer,
 *  Bridge, Poisoned, Propagated) is 'alert'. Only Attributed and/or Victim/
 *  Exchange present is 'context'. NO families extracted at all — the
 *  address's node-label overlay carries nothing (labels-text-only) — maps
 *  to 'alert': today's behavior, conservative until the overlay backfills. */
export function severityForFamilies(families: ReadonlySet<string>): 'alert' | 'context' {
  if (families.size === 0) return 'alert'
  for (const family of families) if (ALERT_FAMILIES.has(family)) return 'alert'
  return 'context'
}

/** The label probe pass: one graph_query_batch per distinct network over
 *  every watched address, diffed against the canonical baseline. Degrades
 *  per network like dustHits/activityHits — a dead backend yields error
 *  text, never a thrown pass, and NEVER seeds a baseline from a failed
 *  read (an error-minted empty set would fake-diff every pre-existing
 *  label on the next healthy pass). */
export async function labelHits(
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
  const baseline = await readLabelBaseline(workspaceRoot)
  const seenInBatch = new Set<string>()
  const hits: WatchlistHit[] = []
  let calls = 0
  let error: string | undefined
  for (const [network, addresses] of byNetwork) {
    let merged: Map<string, Set<string>>
    let families: Map<string, Set<string>>
    try {
      calls += 1
      const result = (await client.callTool({
        name: 'graph_query_batch',
        arguments: { network, queries: [{ id: 'labels', query: labelQuery(addresses) }] },
      })) as { structuredContent?: { facts?: { queries?: Array<{ id: string; results?: Array<Record<string, unknown>> }> } } }
      const rows = result.structuredContent?.facts?.queries?.find((q) => q.id === 'labels')?.results ?? []
      merged = mergeLabelRows(rows)
      // families(a) rides the same rows as labels(a) — one query, one extra
      // merge pass. Severity (D2) is derived from this, never from the
      // free-text label, so the v2->v3 label-text rename cannot move it.
      families = mergeFamilyRows(rows)
    } catch (err) {
      error = error ? `${error}; ${(err as Error).message}` : (err as Error).message
      continue
    }
    for (const address of addresses) {
      const currentPairs: LabelPair[] = [...(merged.get(address) ?? [])]
        .sort()
        .map((label) => ({ label, source: LABEL_SOURCE }))
      const severity = severityForFamilies(extractFamilies([...(families.get(address) ?? [])]))
      const key = `${network}:${address}`
      const seenPairs = baseline.get(key)
      if (seenPairs === undefined) {
        // SILENT bootstrap (spec assumption): pre-existing labels are state,
        // not events. Seeding an EMPTY set matters just as much — it is what
        // makes a later first label a diff instead of another bootstrap.
        await appendLabelBaseline(workspaceRoot, { network, address, pairs: currentPairs, run_timestamp: runTimestamp })
        continue
      }
      const seenKeys = new Set(seenPairs.map((p) => pairKey(p.label, p.source)))
      const fresh = currentPairs.filter((p) => !seenKeys.has(pairKey(p.label, p.source)))
      const newHits: LabelPair[] = []
      for (const pair of fresh) {
        const sourceRef = `${address}|${pair.label}|${pair.source}`
        const batchKey = `${network}|${sourceRef}`
        if (seenInBatch.has(batchKey)) continue
        const already = await store.all(
          `SELECT 1 FROM watchlist_hits
            WHERE trigger = 'label' AND address = $1 AND network = $2 AND source_ref = $3 LIMIT 1`,
          [address, network, sourceRef],
        )
        if (already.length > 0) {
          newHits.push(pair) // known to the hits log but missing from the baseline: repair the baseline, alert nothing
          continue
        }
        seenInBatch.add(batchKey)
        hits.push({
          address,
          network,
          trigger: 'label',
          source_ref: sourceRef,
          label: pair.label,
          source: pair.source,
          detail: `label=${pair.label} source=${pair.source}`,
          severity,
        })
        newHits.push(pair)
      }
      // Baseline is MONOTONE (append the union): a label that disappears and
      // reappears must not re-alert — removal is not an event. Quiet
      // addresses append nothing, so the log stays quiet on quiet passes.
      if (newHits.length > 0) {
        await appendLabelBaseline(workspaceRoot, { network, address, pairs: [...seenPairs, ...newHits], run_timestamp: runTimestamp })
      }
    }
  }
  return { hits, calls, error }
}
