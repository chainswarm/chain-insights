export const HIDDEN_REMOTE_TOOL_NAMES = new Set([
  'topup',
  'trace_funds',
  'track_funds',
  'scam_topology',
  'money_flows_between_exchanges',
  'address_connection_risk',
  'stake_insights',
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
    ? ' Use trace_victim_funds, trace_suspect_funds, or trace_deposit_sources instead.'
    : name === 'track_funds'
      ? ' Use trace_victim_funds instead.'
      : name === 'scam_topology'
        ? ' Use trace_suspect_funds instead.'
        : name === 'stake_insights'
          ? ' Use exposure_profile or the generic exposure_* tools for Bittensor and trading exposure.'
          : ''
  throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${replacement}`)
}
