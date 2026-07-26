/**
 * Wires `mergeShardRows` (federation/merge.ts) into the graph read path.
 *
 * graphrag-mcp's thin fan-out mode tags each row with `__shard` and merges
 * nothing (SPEC-2026-07-26-FED-THIN-FANOUT). Callers here derive merge
 * options — `aggregateKeys`, `orderBy`/`limit`, `orderKeyClass` — from the
 * query text they already hold, because those are caller assertions the
 * merge cannot infer by inspecting rows (spec A7/D3).
 *
 * The query-text parsing below is deliberately narrow: it handles a single
 * flat `RETURN a, b AS c, agg(x) AS y ... ORDER BY <key> [ASC|DESC] LIMIT n`
 * shape, which is what every caller in this codebase emits. It is not a
 * general Cypher/GQL parser. Anything it cannot confidently classify is
 * treated as non-aggregate / merge-affected — the safer default — rather
 * than guessed.
 */

import { mergeShardRows, type MergedResult, type MergeOptions } from './merge.js'

const SHARD_KEY = '__shard'

// Node properties that are shard-invariant: identical for the same node
// regardless of which shard produced the row, so sorting by them survives
// merging exactly (SPEC D3).
const INVARIANT_ORDER_PROPERTIES = new Set([
  'address',
  'network',
  'labels',
  'is_exchange',
  'risk_score',
  'risk_level',
  'identity_id',
  'label_risk',
])

const AGGREGATE_FN_RE = /^(count|sum|avg|min|max)\s*\(/i

interface ProjectionItem {
  expr: string
  alias: string
}

/** Splits `input` on `sep` at paren-depth 0 only, so `sum(a, b)` is not
 *  split on its internal comma. */
function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === sep && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

/** Extracts the text between `\bKEYWORD\b` and the earliest of `stopWords`
 *  (or end of string). Returns null if `keyword` is not present. Matching is
 *  case-insensitive and keyword-boundary based, deliberately not aware of
 *  string literals — query builders in this codebase never put ORDER BY /
 *  LIMIT / RETURN text inside a quoted string literal. */
function extractClause(query: string, keyword: string, stopWords: string[]): string | null {
  const startRe = new RegExp(`\\b${keyword}\\b`, 'i')
  const match = startRe.exec(query)
  if (!match) return null
  const rest = query.slice(match.index + match[0].length)
  let end = rest.length
  for (const stop of stopWords) {
    const stopMatch = new RegExp(`\\b${stop}\\b`, 'i').exec(rest)
    if (stopMatch && stopMatch.index < end) end = stopMatch.index
  }
  return rest.slice(0, end).trim()
}

function parseProjection(query: string): ProjectionItem[] {
  const clause = extractClause(query, 'RETURN', ['ORDER BY', 'LIMIT', 'SKIP'])
  if (!clause) return []
  return splitTopLevel(clause, ',')
    .map((raw) => raw.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const asMatch = /^(.*)\bAS\b\s*(\S+)$/i.exec(item)
      if (asMatch) return { expr: asMatch[1].trim(), alias: asMatch[2].trim() }
      return { expr: item, alias: item }
    })
}

function bareProperty(expr: string): string {
  const trimmed = expr.trim()
  const dot = trimmed.lastIndexOf('.')
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed
}

/**
 * Derives `MergeOptions` from a single query's text: aggregate aliases (so
 * they land in `perShard` instead of being summed as plain row values),
 * `orderBy`/`limit` from ORDER BY / LIMIT, and `orderKeyClass` from whether
 * the sort key is a shard-invariant node property.
 */
export function deriveMergeOptionsFromQuery(query: string): MergeOptions {
  const projections = parseProjection(query)
  const aggregateKeys = projections.filter((p) => AGGREGATE_FN_RE.test(p.expr)).map((p) => p.alias)

  const options: MergeOptions = {}
  if (aggregateKeys.length > 0) options.aggregateKeys = aggregateKeys

  const orderClause = extractClause(query, 'ORDER BY', ['LIMIT', 'SKIP'])
  if (orderClause) {
    // Narrow parsing: only the first sort key of a (possibly multi-key)
    // ORDER BY is honored — mergeShardRows itself only supports one.
    const firstKeyRaw = splitTopLevel(orderClause, ',')[0]?.trim() ?? ''
    const desc = /\bDESC\b/i.test(firstKeyRaw)
    const exprText = firstKeyRaw.replace(/\b(ASC|DESC)\b/gi, '').trim()
    const matched = projections.find((p) => p.expr === exprText || p.alias === exprText)
    const resolvedKey = matched ? matched.alias : exprText
    // If the sort key IS an aggregate alias, it will not exist on merged
    // rows (mergeShardRows lifts aggregate columns into perShard) — sorting
    // by it would be sorting by `undefined`. Skip orderBy entirely rather
    // than guess: this yields `ordering: 'unordered'`, which is honest.
    if (resolvedKey && !aggregateKeys.includes(resolvedKey)) {
      options.orderBy = { key: resolvedKey, desc }
      const bareKey = bareProperty(matched ? matched.expr : exprText)
      options.orderKeyClass = INVARIANT_ORDER_PROPERTIES.has(bareKey) ? 'invariant' : 'merge-affected'
    }
  }

  const limitMatch = /\bLIMIT\s+(\d+)/i.exec(query)
  if (limitMatch) options.limit = Number(limitMatch[1])

  return options
}

export interface GraphRowMergeResult extends MergedResult {
  /** False when no row carried `__shard` — the response was already a
   *  single-shard / non-federated result. `rows` is then the SAME array
   *  reference the caller passed in, unmodified: a true no-op. */
  merged: boolean
}

/**
 * Merges `rows` via `mergeShardRows` if (and only if) at least one row
 * carries `__shard`. This is the flag-off no-op guard: a non-federated
 * response passes through byte-identical, `perShard` empty, `ordering`
 * `'unordered'`.
 */
export function mergeGraphRows(rows: Array<Record<string, unknown>>, query: string): GraphRowMergeResult {
  const isSharded = rows.some((row) => typeof row[SHARD_KEY] === 'string')
  if (!isSharded) {
    return { rows, perShard: {}, ordering: 'unordered', merged: false }
  }
  const options = deriveMergeOptionsFromQuery(query)
  const result = mergeShardRows(rows, options)
  return { ...result, merged: true }
}

export interface BatchQueryEntry {
  id?: string
  ok?: boolean
  results?: Array<Record<string, unknown>>
  error?: string
  perShard?: Record<string, Array<Record<string, unknown>>>
  ordering?: 'exact' | 'approximate' | 'unordered'
}

/**
 * Mutates a parsed `graph_query_batch` response's `facts.queries` entries in
 * place: merges shard-tagged `results`, strips `__shard`, and attaches
 * `perShard`/`ordering` onto the entry so a caller that reads the raw batch
 * entry can see them (SPEC D2/D4 — the client merges, the client never
 * filters). `queries` is the ORIGINAL (pre-`USE topology` prefix) query list
 * sent for this batch, keyed by id, used to derive merge options; text
 * before/after the `USE` prefix does not affect RETURN/ORDER BY/LIMIT
 * parsing, so either form works.
 */
export function applyShardMergeToBatchEntries(
  entries: BatchQueryEntry[] | undefined,
  queries: Array<{ id: string; query: string }>,
): void {
  if (!entries || entries.length === 0) return
  const queryById = new Map(queries.map((q) => [q.id, q.query]))
  for (const entry of entries) {
    if (!entry || entry.ok === false || !entry.results || entry.results.length === 0) continue
    const queryText = entry.id !== undefined ? queryById.get(entry.id) : undefined
    if (queryText === undefined) continue
    const merged = mergeGraphRows(entry.results, queryText)
    if (!merged.merged) continue
    entry.results = merged.rows
    if (Object.keys(merged.perShard).length > 0) entry.perShard = merged.perShard
    entry.ordering = merged.ordering
  }
}
