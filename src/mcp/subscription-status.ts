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

// Launch list price from the subscription spec (§8, operator-owned env on the
// server). The CLI mirrors it only for deposit guidance; the server freezes
// the authoritative value into every grant.
export const DEFAULT_SUBSCRIPTION_MONTH_USD = 120
export type SubscriptionPass = 'day' | 'month'

const DAY_MS = 24 * 60 * 60 * 1000
// Receipt windows follow duration.go: quote / month_usd x 720 hours. A
// full-price month pass is 720 hours; the day pass is one thirtieth of it.
const MONTH_PASS_DAYS = 30

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

/**
 * Resolves the list month price used for deposit guidance. Mirrors the
 * operator-owned SUBSCRIPTION_MONTH_USD launch value ($120 default); a
 * non-positive or non-numeric override fails loudly rather than printing
 * wrong guidance.
 */
export function resolveSubscriptionMonthUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['SUBSCRIPTION_MONTH_USD']?.trim()
  if (!raw) return DEFAULT_SUBSCRIPTION_MONTH_USD
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SUBSCRIPTION_MONTH_USD must be a positive number; got "${raw}"`)
  }
  return parsed
}

export function subscriptionPassPriceUsd(pass: SubscriptionPass, monthUsd: number): number {
  return pass === 'day' ? monthUsd / MONTH_PASS_DAYS : monthUsd
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * Deposit amount guidance for `cia buy day|month`. The $CIA amount at quote
 * time is computed by the indexer TWAP, so the CLI shows the USD-equivalent
 * and instructs sending approximately that value in $CIA.
 */
export function formatSubscriptionPassHint(pass: SubscriptionPass, monthUsd: number): string {
  const priceUsd = subscriptionPassPriceUsd(pass, monthUsd)
  const priceLine =
    pass === 'day'
      ? `Day pass: ${formatUsd(priceUsd)} (SUBSCRIPTION_MONTH_USD / 30)`
      : `Month pass: ${formatUsd(priceUsd)} (list price)`
  return [
    priceLine,
    'The exact $CIA amount is computed by the indexer TWAP at quote time.',
    `Send approximately ${formatUsd(priceUsd)} worth of $CIA to the subscription sink.`,
    'The receipt quote freezes the USD value and the daily allowance at deposit time.',
  ].join('\n')
}

export function depositExtensionDays(pass: SubscriptionPass): number {
  return pass === 'day' ? 1 : MONTH_PASS_DAYS
}

/**
 * Pre-sign guard line from the server-authoritative window end: stacking
 * queues the new pass after the current window end (or now when expired).
 * Spec example: "23 days active; this deposit extends to 53".
 */
export function formatDepositGuardLine(
  facts: Pick<SubscriptionStatusFacts, 'window_end'>,
  pass: SubscriptionPass,
  now: Date = new Date()
): string {
  const windowEndMs = Date.parse(facts.window_end)
  const nowMs = now.getTime()
  const activeDays = Math.max(0, Math.ceil((windowEndMs - nowMs) / DAY_MS))
  const extendedEndMs = Math.max(nowMs, windowEndMs) + depositExtensionDays(pass) * DAY_MS
  const extendedDays = Math.ceil((extendedEndMs - nowMs) / DAY_MS)
  return `${activeDays} days active; this deposit extends to ${extendedDays}`
}

export function isDepositConfirmed(answer: string): boolean {
  return answer === 'DEPOSIT'
}

export function formatDepositIrreversibilityWarning(reason: string): string {
  return [
    `Subscription status is unavailable: ${reason}`,
    'The no-admin subscription sink cannot refund deposits.',
    'Double-check the deposit amount before you send funds.',
  ].join('\n')
}
