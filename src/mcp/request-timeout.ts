import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Above the graph server's 100 s batch budget and the 125 s edge limit.
// The SDK default is 60 s and fails a batch the server is still answering.
export const GRAPH_TOOL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export function graphToolRequestOptions(tool: string): Parameters<Client['callTool']>[2] {
  if (tool === 'graph_query' || tool === 'graph_query_batch') {
    return {
      timeout: GRAPH_TOOL_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: GRAPH_TOOL_REQUEST_TIMEOUT_MS,
    }
  }
  return undefined
}
