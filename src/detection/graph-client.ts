// Thin detection-side wrapper over the MCP graph_query tool (rbmk#462). All CIA
// detectors read through this — never StarRocks directly. Returns the row array
// from a single query's structuredContent, or throws with the tool error text.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'

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
// `USE topology` / `USE facts` prefix.
export async function graphQueryRows(
  client: Client,
  network: string,
  query: string,
): Promise<GraphRow[]> {
  const result = (await client.callTool(
    { name: 'graph_query', arguments: { network, query } },
    undefined,
    { timeout: DETECTION_QUERY_TIMEOUT_MS, maxTotalTimeout: DETECTION_QUERY_TIMEOUT_MS },
  )) as RemoteToolResult
  if (result.isError) throw new Error(textOf(result) || 'graph_query failed')
  const rows = extractRows(result.structuredContent) ?? extractRowsFromText(textOf(result))
  return rows ?? []
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
