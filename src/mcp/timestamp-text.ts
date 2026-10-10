/**
 * A UTC text twin beside every timestamp column of a graph answer.
 *
 * The graph serves integer milliseconds. A model that converts them by head
 * gets the time of day wrong about one time in three (loop 3, 2026-10-10:
 * four of twelve answers about one block named 00:15, 09:35, 06:35 or 09:15
 * for 23:55:43 UTC). Hosts without a shell (Claude Desktop) have no other
 * way to convert, so the proxy writes `<column>_utc` next to each one.
 */

const TIMESTAMP_KEY = /(_timestamp|_time|_at|_seen|_active)$/
const MIN_MS = 1_000_000_000_000 // 2001-09-09
const MAX_MS = 4_000_000_000_000 // 2096-10-02

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `2026-08-05 23:55:43 UTC` for epoch milliseconds. */
export function utcText(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MS && value <= MAX_MS
}

/** One row with a `<key>_utc` string after every epoch-millisecond timestamp column. */
export function addTimestampText(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value
    if (TIMESTAMP_KEY.test(key) && isEpochMs(value) && !(`${key}_utc` in row)) out[`${key}_utc`] = utcText(value)
  }
  return out
}

function mapResults(holder: unknown): unknown {
  if (!isRecord(holder) || !Array.isArray(holder.results)) return holder
  return { ...holder, results: holder.results.map((row) => (isRecord(row) ? addTimestampText(row) : row)) }
}

/**
 * The structured content of graph_query (facts.query.results) or
 * graph_query_batch (facts.queries[].results) with the UTC twins added.
 * Anything else comes back as it was.
 */
export function withTimestampText(structuredContent: unknown): unknown {
  if (!isRecord(structuredContent) || !isRecord(structuredContent.facts)) return structuredContent
  const facts = structuredContent.facts
  if (!isRecord(facts.query) && !Array.isArray(facts.queries)) return structuredContent
  const next: Record<string, unknown> = { ...facts }
  if (isRecord(facts.query)) next.query = mapResults(facts.query)
  if (Array.isArray(facts.queries)) next.queries = facts.queries.map(mapResults)
  return { ...structuredContent, facts: next }
}

type TextBlock = { type: string; text?: string }

/**
 * A tool result whose structured content and single JSON text block both carry
 * the UTC twins. A text block that is not the JSON of the structured content
 * is left alone.
 */
export function withTimestampTextResult<T extends { content?: TextBlock[]; structuredContent?: unknown }>(result: T): T {
  const structured = withTimestampText(result.structuredContent)
  if (structured === result.structuredContent) return result
  const content = result.content ?? []
  const only = content.length === 1 && content[0]?.type === 'text' ? content[0] : null
  let parsed: unknown = undefined
  try {
    parsed = only?.text ? JSON.parse(only.text) : undefined
  } catch {
    parsed = undefined
  }
  const textIsStructured =
    parsed !== undefined && JSON.stringify(parsed) === JSON.stringify(result.structuredContent)
  return {
    ...result,
    structuredContent: structured,
    content: textIsStructured ? [{ ...only, text: JSON.stringify(structured) }] : content,
  }
}
