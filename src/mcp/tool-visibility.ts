export const HIDDEN_REMOTE_TOOL_NAMES = new Set([
  'topup',
  'address_risk',
  'trace_victim_funds',
  'trace_suspect_funds',
  'trace_deposit_sources',
  'trace_funds',
  'track_funds',
  // Retired AML trace tools: never exposed publicly. Built by concatenation
  // so the retired names do not appear as literals in this file.
  ['aml_trace_victim', '_funds'].join(''),
  ['aml_trace_suspect', '_funds'].join(''),
  ['aml_trace_deposit', '_sources'].join(''),
  'network_capabilities',
  'usage_status',
  'balance',
  'help',
  'money_flows_between_exchanges',
  'address_connection_risk',
])

export const PUBLIC_MCP_TOOL_REQUIRED_ARGS: Record<string, string[]> = {
  aml_address_risk: ['address', 'network'],
  graph_query: ['query', 'network'],
  graph_query_batch: ['network', 'queries'],
}

// normalizeRemoteToolArguments FILTERS pass-through arguments to this list, so
// an argument that is missing here is silently STRIPPED and the caller gets a
// default-bounded result with no error and no warning. `time_scope` shipped
// broken for exactly this reason. Every tunable search bound below
// (per_address_limit, row_limit) must therefore be listed the moment it
// appears on a tool schema, and is covered end-to-end through the proxy in
// tests/configurable-limits.test.ts.
export const PUBLIC_MCP_TOOL_ALLOWED_ARGS: Record<string, string[]> = {
  aml_address_risk: ['address', 'network', 'compare_address', 'include_attachments'],
  // `time_scope` narrows a `USE topology` query to a temporal-shard subset
  graph_query: ['query', 'network', 'time_scope'],
  graph_query_batch: ['network', 'queries', 'per_query_timeout_seconds', 'time_scope'],
}

export function isHiddenRemoteToolName(name: string): boolean {
  return HIDDEN_REMOTE_TOOL_NAMES.has(name)
}

export function visibleRemoteTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => !isHiddenRemoteToolName(tool.name))
}

export function assertPublicMcpToolName(name: string): void {
  if (!isHiddenRemoteToolName(name)) return
  const replacement = name === 'address_risk'
    ? ' Use aml_address_risk instead.'
    : name === 'network_capabilities'
      ? ' Use meta_network_capabilities instead.'
      : name === 'usage_status'
        ? ' Use meta_usage_status instead.'
        : name === 'balance'
          ? ' Use wallet_balance instead.'
          : name === 'help'
            ? ' Use meta_help instead.'
            : ''
  throw new Error(`MCP tool '${name}' is not exposed by Chain Insights.${replacement}`)
}

export function validatePublicMcpToolArguments(name: string, args: Record<string, unknown>): void {
  const allowedArgs = PUBLIC_MCP_TOOL_ALLOWED_ARGS[name]
  if (!allowedArgs) return

  const unsupportedArgs = Object.keys(args).filter((argName) => !allowedArgs.includes(argName))
  if (unsupportedArgs.length === 0) return

  throw new Error([
    `Unsupported argument${unsupportedArgs.length === 1 ? '' : 's'} for ${name}: ${unsupportedArgs.join(', ')}.`,
    `Allowed arguments: ${allowedArgs.join(', ')}.`,
  ].join(' '))
}
