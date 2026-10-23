export type UsageStatusResult = {
  schema: 'chain-insights.result.v1'
  tool: 'meta_usage_status'
  facts: {
    usage: {
      mode: 'primitive_graph_backend'
      quota_enforced: false
      usage_status_tool: 'unavailable'
    }
    backend: {
      endpoint: string
      reason: string
    }
  }
  hint: string
}

export function primitiveBackendUsageStatus(endpoint: string): UsageStatusResult {
  return {
    schema: 'chain-insights.result.v1',
    tool: 'meta_usage_status',
    facts: {
      usage: {
        mode: 'primitive_graph_backend',
        quota_enforced: false,
        usage_status_tool: 'unavailable',
      },
      backend: {
        endpoint,
        reason: 'The graph backend exposes primitive graph tools but no usage_status quota tool.',
      },
    },
    hint: 'This backend does not expose Chain Insights quota telemetry; calls against it are treated as unmetered by Chain Insights.',
  }
}

export function usageStatusText(result: UsageStatusResult): string {
  return JSON.stringify(result, null, 2)
}

export function isMissingUsageStatusToolError(err: unknown): boolean {
  const message = String((err as Error).message ?? err).toLowerCase()
  return (
    message.includes('unknown tool') ||
    message.includes('tool not found') ||
    message.includes('method not found') ||
    message.includes('usage_status')
  )
}

/**
 * The first sentence of a payment failure when the caller's free tier for the
 * day is spent. The server gives every caller 5,000 free units a day before
 * it answers 402, so a payment failure right after that is a used-up free
 * tier, not a service that must be paid for to try. `usage` is the
 * `facts.usage` object a `usage_status` read answers with. Undefined when the
 * quota is not spent, or the object is not a free-tier quota.
 */
export function freeTierSpentText(usage: unknown): string | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const u = usage as Record<string, unknown>
  if (u['access_mode'] !== 'public_free') return undefined
  const remaining = Number(u['remaining_units'])
  if (!Number.isFinite(remaining) || remaining > 0) return undefined
  const used = Number(u['daily_units_used'])
  const limit = Number(u['daily_units_limit'])
  const units =
    Number.isFinite(used) && Number.isFinite(limit)
      ? `${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} free units`
      : 'every free unit'
  const resetAt = typeof u['reset_at'] === 'string' ? u['reset_at'] : undefined
  const reset = resetAt ? resetAtText(resetAt) : 'midnight UTC'
  const who = u['identifier_kind'] === 'ip' ? 'this network address' : 'this caller'
  return (
    `The free tier for today is used up: ${who} spent ${units}, and the quota resets at ${reset}. ` +
    'Until then every graph call is paid per call.'
  )
}

function resetAtText(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
