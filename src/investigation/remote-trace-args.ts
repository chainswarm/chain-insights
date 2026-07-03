/**
 * Argument builder for the remote (`--remote`) `aml_trace_victim_funds` MCP call.
 *
 * The remote tool contract (`PUBLIC_MCP_TOOL_ALLOWED_ARGS.aml_trace_victim_funds`)
 * accepts `incident_timestamp_ms` and `max_hops`, but NOT `per_address_limit` or
 * `min_amount_sum` — those two only tune the local Chain Insights recipe. The CLI
 * previously forwarded neither the allowed `incident_timestamp_ms`/`max_hops` nor
 * rejected the local-only flags: every one of the four was silently dropped in
 * `--remote` mode. Forward the allowed args, and reject the local-only ones so
 * `--remote` never silently ignores a flag the user passed.
 */
export interface TraceVictimRemoteOptions {
  victimAddresses: string
  network: string
  knownSuspectAddresses?: string
  incidentTimestampMs?: string
  maxHops?: string
  perAddressLimit?: string
  minAmountSum?: string
  topologyScope?: string
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`)
  return parsed
}

export function buildTraceVictimFundsRemoteArgs(opts: TraceVictimRemoteOptions): Record<string, unknown> {
  const localOnly: string[] = []
  if (opts.perAddressLimit !== undefined) localOnly.push('--per-address-limit')
  if (opts.minAmountSum !== undefined) localOnly.push('--min-amount-sum')
  if (localOnly.length > 0) {
    const flags = localOnly.join(' and ')
    const plural = localOnly.length > 1
    throw new Error(
      `${flags} ${plural ? 'are' : 'is'} only supported by the local Chain Insights recipe, not the remote aml_trace_victim_funds tool. ` +
        `Drop --remote to use ${plural ? 'them' : 'it'}, or remove ${plural ? 'those flags' : 'that flag'}.`,
    )
  }

  const incidentTimestampMs = toNumber(opts.incidentTimestampMs)
  const maxHops = toNumber(opts.maxHops)
  return {
    victim_addresses: opts.victimAddresses,
    network: opts.network,
    ...(opts.knownSuspectAddresses ? { known_suspect_addresses: opts.knownSuspectAddresses } : {}),
    ...(incidentTimestampMs !== undefined ? { incident_timestamp_ms: incidentTimestampMs } : {}),
    ...(maxHops !== undefined ? { max_hops: maxHops } : {}),
    ...(opts.topologyScope ? { topology_scope: opts.topologyScope } : {}),
  }
}
