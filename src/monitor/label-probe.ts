// src/monitor/label-probe.ts
// Watchlist label probe state (label-cutover spec req 1): last-seen
// (label, source) sets per watched address in the append-only canonical
// logs/label-baseline.jsonl — last line per (network, address) wins, torn
// lines cost themselves only (parseJsonlLines). The baseline is the DIFF
// base, never the correctness dependency: hit dedup by source_ref in
// logs/watchlist-hits.jsonl is what prevents re-alerts, so a deleted or
// stale baseline can only re-bootstrap silently, never fire a duplicate.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'

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
  return `USE topology MATCH (a:Address)
 WHERE a.address IN [${list}] AND a.labels IS NOT NULL
 RETURN a.address AS address, a.labels AS labels
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
