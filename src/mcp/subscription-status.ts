export type SubscriptionStatusFacts = {
  wallet?: string
  window_end: string
  allowance_usd: number
  consumed_usd: number
  tier: string | number
}

export type UnavailableSubscriptionStatusResult = {
  schema: 'chain-insights.result.v1'
  tool: 'meta_subscription_status'
  facts: {
    subscription: {
      subscription_status_tool: 'unavailable'
      reason: string
    }
    backend: {
      endpoint: string
    }
  }
  hint: string
}

export function unavailableSubscriptionStatus(
  endpoint: string,
  reason: string
): UnavailableSubscriptionStatusResult {
  return {
    schema: 'chain-insights.result.v1',
    tool: 'meta_subscription_status',
    facts: {
      subscription: {
        subscription_status_tool: 'unavailable',
        reason,
      },
      backend: {
        endpoint,
      },
    },
    hint: 'This backend does not expose the Chain Insights subscription_status tool; subscription windows, daily allowances, and tiers are not tracked here.',
  }
}

export function subscriptionStatusText(result: UnavailableSubscriptionStatusResult): string {
  return JSON.stringify(result, null, 2)
}

export function isMissingSubscriptionStatusToolError(err: unknown): boolean {
  const message = String((err as Error).message ?? err).toLowerCase()
  return (
    message.includes('unknown tool') ||
    message.includes('tool not found') ||
    message.includes('method not found') ||
    message.includes('subscription_status')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Extracts `{ window_end, allowance_usd, consumed_usd, tier }` from a server
 * `subscription_status` tool result. Accepts the flat server document, the
 * proxy document with facts nested under `facts.subscription`, or a JSON text
 * content block. Returns null when the facts are absent or malformed so
 * callers can degrade to the unavailable shape instead of throwing.
 */
export function parseSubscriptionStatusToolResult(result: unknown): SubscriptionStatusFacts | null {
  if (!isRecord(result) || result.isError === true) return null

  let payload: unknown = isRecord(result.structuredContent) ? result.structuredContent : undefined
  if (payload === undefined && Array.isArray(result.content)) {
    const textBlock = result.content.find(
      (block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string'
    ) as { text: string } | undefined
    if (!textBlock) return null
    try {
      payload = JSON.parse(textBlock.text) as unknown
    } catch {
      return null
    }
  }
  if (!isRecord(payload)) return null

  const facts = isRecord(payload.facts) ? payload.facts : undefined
  const subscription = isRecord(facts?.subscription) ? facts.subscription : undefined
  const source = subscription ?? payload

  const windowEnd = source['window_end']
  if (typeof windowEnd !== 'string' || Number.isNaN(Date.parse(windowEnd))) return null
  const allowanceUsd = source['allowance_usd']
  const consumedUsd = source['consumed_usd']
  if (typeof allowanceUsd !== 'number' || typeof consumedUsd !== 'number') return null
  const tier = source['tier']
  if (typeof tier !== 'string' && typeof tier !== 'number') return null
  const wallet = source['wallet']

  return {
    ...(typeof wallet === 'string' ? { wallet } : {}),
    window_end: windowEnd,
    allowance_usd: allowanceUsd,
    consumed_usd: consumedUsd,
    tier,
  }
}
