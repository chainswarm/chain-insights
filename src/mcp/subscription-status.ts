/** A payment the server has seen on chain but not priced into a grant yet. */
export type PendingPayment = {
  tx_hash: string
  receipt_id?: string
  block_number?: number
  token?: string
  /** Token units, as the server sends them. */
  amount?: string
  indexed_at?: string
}

/**
 * The subscription of the proven wallet. The server reads the wallet from the
 * X-CIA-Wallet-Proof header, never from an argument.
 */
export type SubscriptionStatusFacts = {
  wallet?: string
  active: boolean
  window_start: string | null
  /** null when the wallet has no grant. */
  window_end: string | null
  days_left: number
  daily_allowance_usd: number
  consumed_today_usd: number
  remaining_today_usd: number
  tier: string | number
  pending_payments: PendingPayment[]
  grant_id?: string
  rail?: string
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

function optionalTime(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return value
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parsePendingPayments(value: unknown): PendingPayment[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const out: PendingPayment[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.tx_hash !== 'string') return null
    out.push({
      tx_hash: item.tx_hash,
      ...(typeof item.receipt_id === 'string' || typeof item.receipt_id === 'number'
        ? { receipt_id: String(item.receipt_id) }
        : {}),
      ...(typeof item.block_number === 'number' ? { block_number: item.block_number } : {}),
      ...(typeof item.token === 'string' ? { token: item.token } : {}),
      ...(typeof item.amount === 'string' || typeof item.amount === 'number'
        ? { amount: String(item.amount) }
        : {}),
      ...(typeof item.indexed_at === 'string' ? { indexed_at: item.indexed_at } : {}),
    })
  }
  return out
}

/**
 * Extracts the subscription facts from a server `subscription_status` tool
 * result. Accepts the server document with facts under `facts`, the proxy
 * document with facts under `facts.subscription`, a flat document, or a JSON
 * text content block. Reads the current fields (daily_allowance_usd,
 * consumed_today_usd) and the older ones (allowance_usd, consumed_usd). A
 * wallet with no grant answers window_end null, which parses as inactive.
 * Returns null when the facts are absent or malformed, so callers degrade to
 * the unavailable shape instead of throwing.
 */
export function parseSubscriptionStatusToolResult(
  result: unknown,
  now: Date = new Date()
): SubscriptionStatusFacts | null {
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
  const source = subscription ?? facts ?? payload

  const windowEnd = optionalTime(source['window_end'])
  if (windowEnd === undefined) return null
  const windowStart = optionalTime(source['window_start']) ?? null
  const allowance = numberOr(source['daily_allowance_usd'], numberOr(source['allowance_usd'], undefined))
  const consumed = numberOr(source['consumed_today_usd'], numberOr(source['consumed_usd'], undefined))
  if (allowance === undefined || consumed === undefined) return null
  const tier = source['tier']
  if (typeof tier !== 'string' && typeof tier !== 'number') return null
  const pending = parsePendingPayments(source['pending_payments'])
  if (pending === null) return null

  const endMs = windowEnd === null ? null : Date.parse(windowEnd)
  const active =
    typeof source['active'] === 'boolean' ? source['active'] : endMs !== null && endMs > now.getTime()
  const daysLeft =
    numberOr(source['days_left'], undefined) ??
    (endMs === null ? 0 : Math.max(0, (endMs - now.getTime()) / 86_400_000))
  const remaining = numberOr(source['remaining_today_usd'], undefined) ?? Math.max(0, allowance - consumed)
  const wallet = source['wallet']
  const grantId = source['grant_id']
  const rail = source['rail']

  return {
    ...(typeof wallet === 'string' ? { wallet } : {}),
    active,
    window_start: windowStart,
    window_end: windowEnd,
    days_left: daysLeft,
    daily_allowance_usd: allowance,
    consumed_today_usd: consumed,
    remaining_today_usd: remaining,
    tier,
    pending_payments: pending,
    ...(typeof grantId === 'string' ? { grant_id: grantId } : {}),
    ...(typeof rail === 'string' ? { rail } : {}),
  }
}

/**
 * True only for an older server whose advertised subscription_status schema
 * still requires a `wallet` argument. The current server reads the wallet
 * from the X-CIA-Wallet-Proof header and takes no argument.
 */
export function subscriptionStatusNeedsWallet(
  tool: { inputSchema?: Record<string, unknown> } | undefined
): boolean {
  const required = tool?.inputSchema?.['required']
  return Array.isArray(required) && required.includes('wallet')
}

/** The arguments for the server's subscription_status: {} unless an older server needs the wallet. */
export function subscriptionStatusArguments(
  tool: { inputSchema?: Record<string, unknown> } | undefined,
  wallet: string | null
): Record<string, unknown> {
  return wallet && subscriptionStatusNeedsWallet(tool) ? { wallet } : {}
}

function money(value: number): string {
  return `${value.toFixed(2)} USD`
}

/** The status in plain lines, for the terminal. */
export function formatSubscriptionStatus(facts: SubscriptionStatusFacts): string {
  const lines = [
    facts.active ? 'Subscription: active' : 'Subscription: none active',
    ...(facts.wallet ? [`Wallet: ${facts.wallet}`] : []),
  ]
  if (facts.active && facts.window_end) {
    lines.push(`Ends: ${facts.window_end} (about ${facts.days_left.toFixed(1)} days left)`)
    lines.push(
      `Today: ${money(facts.consumed_today_usd)} used of ${money(facts.daily_allowance_usd)}, ${money(facts.remaining_today_usd)} left`
    )
  }
  for (const payment of facts.pending_payments) {
    lines.push(`Payment seen, not credited yet: ${payment.tx_hash}`)
  }
  if (!facts.active && facts.pending_payments.length === 0) {
    lines.push('Buy days with `cia subscription buy --days N`.')
  }
  return lines.join('\n')
}
