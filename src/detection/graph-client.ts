// Thin detection-side wrapper over the MCP graph_query tool (rbmk#462). All CIA
// detectors read through this — never StarRocks directly. Returns the row array
// from a single query's structuredContent, or throws with the tool error text.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { mergeGraphRows } from '../federation/apply-merge.js'

type RemoteToolResult = { content?: ContentBlock[]; isError?: boolean; structuredContent?: unknown }

const DETECTION_QUERY_TIMEOUT_MS = 5 * 60 * 1000

function textOf(result: RemoteToolResult): string {
  return (result.content ?? [])
    .filter((item): item is Extract<ContentBlock, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

export interface GraphRow {
  [key: string]: unknown
}

// Runs one graph_query and returns its result rows. `query` must carry its own
// `USE topology` / `USE facts` prefix. `timeScope` (optional) narrows a USE
// topology query to a temporal-shard subset — "recent" (live shard only) makes
// an otherwise-refused cross-shard node-metric projection exact (DEC-11).
export async function graphQueryRows(
  client: Client,
  network: string,
  query: string,
  timeScope?: string,
): Promise<GraphRow[]> {
  const args: Record<string, unknown> = { network, query }
  if (timeScope) args.time_scope = timeScope
  const result = (await client.callTool(
    { name: 'graph_query', arguments: args },
    undefined,
    { timeout: DETECTION_QUERY_TIMEOUT_MS, maxTotalTimeout: DETECTION_QUERY_TIMEOUT_MS },
  )) as RemoteToolResult
  if (result.isError) throw new Error(textOf(result) || 'graph_query failed')
  const rows = extractRows(result.structuredContent) ?? extractRowsFromText(textOf(result))
  if (!rows) return []
  // graphQueryRows returns a bare row array — there is no envelope slot to
  // carry perShard/ordering here, so a shard-tagged response is merged and
  // stripped of __shard but its perShard/ordering metadata is necessarily
  // dropped at this seam (see apply-merge.ts and the wiring report).
  return mergeGraphRows(rows, query).rows
}

function extractRows(structured: unknown): GraphRow[] | null {
  if (!structured || typeof structured !== 'object') return null
  const facts = (structured as { facts?: { query?: { results?: unknown } } }).facts
  const results = facts?.query?.results
  return Array.isArray(results) ? (results as GraphRow[]) : null
}

function extractRowsFromText(text: string): GraphRow[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return extractRows(JSON.parse(trimmed))
  } catch {
    return null
  }
}

// Shared timeout export for detectors that build their own tool calls.
export const DETECTION_TIMEOUT_MS = DETECTION_QUERY_TIMEOUT_MS
