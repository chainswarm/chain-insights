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
