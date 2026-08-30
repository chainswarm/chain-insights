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
  /** Columns the caller asserts are non-mergeable aggregates. They are lifted
   *  out of the rows into `perShard` so no consumer can sum them by accident
   *  (SPEC A7). The merge cannot infer these — naming them is the assertion.
   *  A shard may return more than one row for the same aggregate column when
   *  the query groups by another column (e.g. `RETURN counterparty,
   *  sum(...) AS usd`) — `perShard[shard]` holds one entry per such row, so
   *  two differently-grouped rows from the same shard can never collide. */
  aggregateKeys?: string[]
  /** Whether the sort key survives merging. `invariant` keys (address, labels)
   *  give an exact global order; `merge-affected` keys (sums) do not, because a
   *  pair ranked 4th in every shard can be 1st once merged (SPEC D3). */
  orderKeyClass?: 'invariant' | 'merge-affected'
}

export interface MergedResult {
  rows: Array<Record<string, unknown>>
  /** One entry per aggregate row a shard returned (see `aggregateKeys`),
   *  carrying that row's grouping columns alongside its aggregate columns.
   *  An array, not a shard-keyed object, so a second group from the same
   *  shard is appended rather than overwriting the first. */
  perShard: Record<string, Array<Record<string, unknown>>>
  ordering: 'exact' | 'approximate' | 'unordered'
}

const SHARD_KEY = '__shard'

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isEdgeObject(
  value: unknown
): value is { type: string; properties: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.properties === 'object' &&
    candidate.properties !== null
  )
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

/**
 * Combines every shard's contribution to the SAME logical edge (same
 * from_address/to_address, the identity `rowKey` groups on) into one
 * lifetime edge. `constituents` is every contributing shard's `.properties`
 * object, in first-seen order.
 *
 * This is a single N-way fold over all constituents at once, not a pairwise
 * fold of an accumulator, so every per-property rule below reads each
 * shard's raw values directly.
 *
 * Per-property rules (SPEC-2026-07-26-FED-THIN-FANOUT, mirrored from the
 * retired server-side merge in the retired internal federation merger
 * which solved the same problem before the merge moved client-side):
 *
 * - `amount_usd_sum`, `tx_count`: additive per-shard partials — summed.
 * - `first_seen_timestamp`: MIN across shards. `first_tx_id` is NOT
 *   shard-invariant — it identifies the transaction AT first_seen_timestamp
 *   — so it must come from the SAME constituent that produced the min, not
 *   whichever shard happened to merge first.
 * - `last_seen_timestamp`: MAX across shards, with `last_tx_id` from the
 *   constituent that produced the max (mirror of `first_tx_id`).
 * - `avg_tx_size_usd`: an average is not carryable across shards — it is
 *   recomputed from the merged totals (`amount_usd_sum / tx_count`, guarded
 *   against division by zero) so it stays consistent with the summed totals
 *   instead of leaking one shard's partial average.
 * - `price_coverage_ratio`: a tx-count-weighted mean,
 *   Σ(ratio·tx_count)/Σtx_count. The ratio's own denominator IS tx_count
 *   (priced tx / total tx), so weighting by tx_count and dividing by the
 *   summed tx_count reconstructs the exact lifetime ratio rather than
 *   averaging shard ratios naively (which would over-weight a low-volume
 *   shard's ratio as much as a high-volume one).
 * - `dominant_asset` / `asset_usd_totals`: retired from the FLOWS_TO edge
 *   contract (operator ruling 2026-07-28) — address-level asset features are
 *   computed on demand, not carried as edge payload, so there is no merge
 *   rule. A stale shard still returning them falls through to the
 *   first-seen-wins fallback below.
 * - `bucket_start_timestamp` / `bucket_end_timestamp`: each describes ONE shard's own
 *   coverage window. The merged edge's window is the outer span of every
 *   contributing shard's window: `[MIN start, MAX end]`.
 * - `from_address`, `to_address`, `from_address_lookalike`,
 *   `to_address_lookalike`: identity — `rowKey` already grouped these
 *   constituents by from_address+to_address, so these are equal on every
 *   constituent by construction (address-derived lookalike flags do not
 *   vary per shard). The first-seen value carries through untouched.
 * - Any other property is outside the frozen FLOWS_TO contract this module
 *   knows about; it keeps the first-seen constituent's value (unchanged
 *   "first non-null wins" fallback).
 */
function combineEdge(constituents: Array<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // First-non-null-wins baseline for identity fields and any unlisted
  // property. Every property below this point is then explicitly
  // recomputed/overridden with its correct merge rule.
  for (const props of constituents) {
    for (const [key, value] of Object.entries(props)) {
      if (out[key] === undefined || out[key] === null) out[key] = value
    }
  }

  let amountSum = 0
  let txSum = 0
  let minFirst: number | null = null
  let firstTxId: unknown
  let maxLast: number | null = null
  let lastTxId: unknown
  let minBucketStart: number | null = null
  let maxBucketEnd: number | null = null
  let weightedRatioNum = 0
  let anyRatio = false

  for (const p of constituents) {
    const amount = numeric(p.amount_usd_sum) ?? 0
    const tx = numeric(p.tx_count) ?? 0
    amountSum += amount
    txSum += tx

    const first = numeric(p.first_seen_timestamp)
    if (first !== null && (minFirst === null || first < minFirst)) {
      minFirst = first
      firstTxId = p.first_tx_id
    }
    const last = numeric(p.last_seen_timestamp)
    if (last !== null && (maxLast === null || last > maxLast)) {
      maxLast = last
      lastTxId = p.last_tx_id
    }
    const bucketStart = numeric(p.bucket_start_timestamp)
    if (bucketStart !== null && (minBucketStart === null || bucketStart < minBucketStart)) {
      minBucketStart = bucketStart
    }
    const bucketEnd = numeric(p.bucket_end_timestamp)
    if (bucketEnd !== null && (maxBucketEnd === null || bucketEnd > maxBucketEnd)) {
      maxBucketEnd = bucketEnd
    }
    const ratio = numeric(p.price_coverage_ratio)
    if (ratio !== null) {
      weightedRatioNum += ratio * tx
      anyRatio = true
    }
  }

  out.amount_usd_sum = amountSum
  out.tx_count = txSum
  if (minFirst !== null) {
    out.first_seen_timestamp = minFirst
    if (firstTxId !== undefined) out.first_tx_id = firstTxId
  }
  if (maxLast !== null) {
    out.last_seen_timestamp = maxLast
    if (lastTxId !== undefined) out.last_tx_id = lastTxId
  }
  if (minBucketStart !== null) out.bucket_start_timestamp = minBucketStart
  if (maxBucketEnd !== null) out.bucket_end_timestamp = maxBucketEnd
  // Recomputed, never carried: an average from one shard is simply a wrong
  // number once other shards contribute.
  out.avg_tx_size_usd = txSum > 0 ? amountSum / txSum : 0
  if (anyRatio) out.price_coverage_ratio = txSum > 0 ? weightedRatioNum / txSum : 0

  return out
}

export function mergeShardRows(rows: ShardRow[], opts: MergeOptions = {}): MergedResult {
  const aggregateKeys = opts.aggregateKeys ?? []
  const perShard: Record<string, Array<Record<string, unknown>>> = {}
  const mergeable: ShardRow[] = []
  for (const row of rows) {
    const shard = typeof row[SHARD_KEY] === 'string' ? (row[SHARD_KEY] as string) : ''
    const remainder: ShardRow = {}
    const aggregateEntry: Record<string, unknown> = {}
    let liftedAny = false
    for (const [key, value] of Object.entries(row)) {
      if (aggregateKeys.includes(key)) {
        aggregateEntry[key] = value
        liftedAny = true
        continue
      }
      remainder[key] = value
    }
    if (liftedAny && shard !== '') {
      // The grouping columns are whatever non-aggregate, non-__shard keys
      // this row carries (e.g. a GROUP BY alias). Pushing a new entry per
      // row — rather than assigning into an object keyed by shard alone —
      // means a second group from the same shard can never overwrite the
      // first: the array can only grow, never lose a write.
      const groupCols: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(remainder)) {
        if (key === SHARD_KEY) continue
        groupCols[key] = value
      }
      perShard[shard] = perShard[shard] ?? []
      perShard[shard].push({ ...groupCols, ...aggregateEntry })
    }
    const hasContent = Object.keys(remainder).some((k) => k !== SHARD_KEY)
    if (!liftedAny || hasContent) mergeable.push(remainder)
  }

  // Group mergeable rows by identity key, preserving first-seen order, so
  // combineEdge can fold ALL constituents for a key at once (see combineEdge
  // for the per-property rules).
  const groups = new Map<string, ShardRow[]>()
  for (const row of mergeable) {
    const key = rowKey(row)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  const byKey = new Map<string, Record<string, unknown>>()
  for (const [key, group] of groups) {
    // Deep copy so the caller's rows are never mutated.
    const copy = JSON.parse(JSON.stringify(group[0])) as Record<string, unknown>
    delete copy[SHARD_KEY]
    if (group.length > 1) {
      for (const field of Object.keys(copy)) {
        if (!isEdgeObject(copy[field])) continue
        const constituents = group
          .map((g) => g[field])
          .filter(isEdgeObject)
          .map((edge) => edge.properties)
        ;(copy[field] as { properties: Record<string, unknown> }).properties =
          combineEdge(constituents)
      }
    }
    byKey.set(key, copy)
  }

  let out = [...byKey.values()]
  if (opts.orderBy) {
    const { key, desc } = opts.orderBy
    out.sort((a, b) => {
      const av = a[key] as never
      const bv = b[key] as never
      if (av === bv) return 0
      return (av < bv ? -1 : 1) * (desc ? -1 : 1)
    })
  }
  if (typeof opts.limit === 'number' && opts.limit >= 0) out = out.slice(0, opts.limit)
  const ordering: MergedResult['ordering'] = !opts.orderBy
    ? 'unordered'
    : opts.orderKeyClass === 'merge-affected'
      ? 'approximate'
      : 'exact'
  return { rows: out, perShard, ordering }
}
