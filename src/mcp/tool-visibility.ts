export const HIDDEN_REMOTE_TOOL_NAMES = new Set([
  'topup',
  'trace_funds',
  'graph_query',
  'graph_query_batch',
  'money_flows_between_exchanges',
  'address_connection_risk',
])

export function isHiddenRemoteToolName(name: string): boolean {
  return HIDDEN_REMOTE_TOOL_NAMES.has(name)
}

export function visibleRemoteTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => !isHiddenRemoteToolName(tool.name))
}

export function assertPublicMcpToolName(name: string): void {
  if (!isHiddenRemoteToolName(name)) return
  const replacement = name === 'trace_funds'
    ? ' Use track_funds instead.'
    : name === 'graph_query'
      ? ' Use topology_query instead.'
      : name === 'graph_query_batch'
        ? ' Use topology_query_batch instead.'
        : ''
  throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${replacement}`)
}
