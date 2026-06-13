export const HIDDEN_REMOTE_TOOL_NAMES = new Set([
  'topup',
  'address_risk',
  'trace_victim_funds',
  'trace_suspect_funds',
  'trace_deposit_sources',
  'trace_funds',
  'track_funds',
  'money_flows_between_exchanges',
  'address_connection_risk',
  'exposure_profile',
  'exposure_quality',
  'exposure_carry',
  'exposure_crowding',
  'exposure_exit_pressure',
  'exposure_correlation',
  'exposure_explain',
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
    ? ' Use aml_trace_victim_funds, aml_trace_suspect_funds, or aml_trace_deposit_sources instead.'
    : name === 'trace_victim_funds'
      ? ' Use aml_trace_victim_funds instead.'
      : name === 'trace_suspect_funds'
        ? ' Use aml_trace_suspect_funds instead.'
        : name === 'trace_deposit_sources'
          ? ' Use aml_trace_deposit_sources instead.'
    : name === 'track_funds'
      ? ' Use aml_trace_victim_funds instead.'
      : name === 'address_risk'
        ? ' Use aml_address_risk instead.'
      : ''
  throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${replacement}`)
}
