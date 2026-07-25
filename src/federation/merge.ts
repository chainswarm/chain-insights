/**
 * Client-side merge for federated topology results.
 *
 * graphrag-mcp pushes the caller's query verbatim to every covering shard and
 * returns the rows tagged with `__shard`, merging nothing (SPEC-2026-07-26-
 * FED-THIN-FANOUT). Merge semantics are a client concern: whether "hub" means
 * max-over-shards or sum-over-shards is a detection decision the server cannot
 * make. This module is the reference implementation.
 *
 * Pure: no network, no config, no mutation of the caller's rows.
 */

export type ShardRow = Record<string, unknown> & { __shard?: string }

export interface MergeOptions {
  orderBy?: { key: string; desc?: boolean }
  limit?: number
  edgeKey?: (edge: Record<string, unknown>) => string | null
}

export interface MergedResult {
  rows: Array<Record<string, unknown>>
  perShard: Record<string, Record<string, unknown>>
  ordering: 'exact' | 'approximate' | 'unordered'
}

const SHARD_KEY = '__shard'

/** Edge properties that are additive per-shard partials: disjoint shard
 *  windows mean summing them reconstructs the exact lifetime value. */
const ADDITIVE_EDGE_PROPS = ['amount_usd_sum', 'tx_count']
const MIN_EDGE_PROPS = ['first_seen_timestamp']
const MAX_EDGE_PROPS = ['last_seen_timestamp']

function isEdgeObject(value: unknown): value is { type: string; properties: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.type === 'string' && typeof candidate.properties === 'object' && candidate.properties !== null
}

/** Identity of a row for dedup/merge purposes. Edge rows key on the edge's
 *  endpoints; plain rows key on their non-shard content. */
function rowKey(row: ShardRow): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(row)) {
    if (key === SHARD_KEY) continue
    if (isEdgeObject(value)) {
      const props = value.properties
      parts.push(`${key} edge ${String(props.from_address)} ${String(props.to_address)}`)
      continue
    }
    parts.push(`${key} ${JSON.stringify(value)}`)
  }
  return parts.join('')
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function combineEdge(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const prop of ADDITIVE_EDGE_PROPS) {
    const a = numeric(into[prop])
    const b = numeric(from[prop])
    if (a !== null || b !== null) into[prop] = (a ?? 0) + (b ?? 0)
  }
  for (const prop of MIN_EDGE_PROPS) {
    const a = numeric(into[prop])
    const b = numeric(from[prop])
    if (a !== null && b !== null) into[prop] = Math.min(a, b)
    else if (into[prop] === undefined || into[prop] === null) into[prop] = from[prop]
  }
  for (const prop of MAX_EDGE_PROPS) {
    const a = numeric(into[prop])
    const b = numeric(from[prop])
    if (a !== null && b !== null) into[prop] = Math.max(a, b)
    else if (into[prop] === undefined || into[prop] === null) into[prop] = from[prop]
  }
  for (const [key, value] of Object.entries(from)) {
    if (ADDITIVE_EDGE_PROPS.includes(key) || MIN_EDGE_PROPS.includes(key) || MAX_EDGE_PROPS.includes(key)) continue
    if (into[key] === undefined || into[key] === null) into[key] = value
  }
}

export function mergeShardRows(rows: ShardRow[], opts: MergeOptions = {}): MergedResult {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = rowKey(row)
    const existing = byKey.get(key)
    if (!existing) {
      // Deep copy so the caller's rows are never mutated.
      const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown>
      delete copy[SHARD_KEY]
      byKey.set(key, copy)
      continue
    }
    for (const [field, value] of Object.entries(row)) {
      if (field === SHARD_KEY) continue
      if (isEdgeObject(value) && isEdgeObject(existing[field])) {
        combineEdge((existing[field] as { properties: Record<string, unknown> }).properties, value.properties)
      }
    }
  }
  return { rows: [...byKey.values()], perShard: {}, ordering: 'unordered' }
}
