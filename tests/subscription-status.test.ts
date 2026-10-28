import { describe, it, expect } from 'vitest'
import {
  formatSubscriptionStatus,
  isMissingSubscriptionStatusToolError,
  parseSubscriptionStatusToolResult,
  subscriptionStatusArguments,
  subscriptionStatusNeedsWallet,
  subscriptionStatusText,
  unavailableSubscriptionStatus,
} from '../src/mcp/subscription-status.js'

describe('meta_subscription_status result shapes', () => {
  it('unavailable result keeps the chain-insights.result.v1 schema discipline', () => {
    const result = unavailableSubscriptionStatus(
      'http://127.0.0.1:8012/mcp',
      'The graph backend exposes primitive graph tools but no subscription_status tool.'
    )
    expect(result.schema).toBe('chain-insights.result.v1')
    expect(result.tool).toBe('meta_subscription_status')
    expect(result.facts.subscription.subscription_status_tool).toBe('unavailable')
    expect(result.facts.subscription.reason).toContain('subscription_status')
    expect(result.facts.backend).toEqual({ endpoint: 'http://127.0.0.1:8012/mcp' })
    expect(result.hint).toContain('subscription')
  })

  it('subscriptionStatusText pretty-prints the result document', () => {
    const text = subscriptionStatusText(
      unavailableSubscriptionStatus('http://127.0.0.1:8012/mcp', 'endpoint down')
    )
    expect(text).toContain('"tool": "meta_subscription_status"')
    expect(text).toContain('"subscription_status_tool": "unavailable"')
  })

  it('isMissingSubscriptionStatusToolError matches missing-tool failures only', () => {
    expect(
      isMissingSubscriptionStatusToolError(
        new Error('MCP error -32602: unknown tool "subscription_status"')
      )
    ).toBe(true)
    expect(isMissingSubscriptionStatusToolError(new Error('tool not found'))).toBe(true)
    expect(isMissingSubscriptionStatusToolError(new Error('connection refused'))).toBe(false)
  })
})

describe('subscription status tool result parsing', () => {
  const NOW = new Date('2026-10-28T12:00:00Z')
  const WALLET = '0x00000000000000000000000000000000000000aa'
  const TX = `0x${'7a'.repeat(31)}01`
  // The server answer of subscription_status: the facts under `facts`.
  const serverFacts = {
    wallet: WALLET,
    active: true,
    window_start: '2026-10-20T08:00:00Z',
    window_end: '2026-11-03T12:00:00Z',
    days_left: 6,
    daily_allowance_usd: 10,
    consumed_today_usd: 1.25,
    remaining_today_usd: 8.75,
    tier: 'subscriber',
    pending_payments: [],
  }
  const serverDocument = (facts: Record<string, unknown>) => ({
    structuredContent: { schema: 'chain-insights.result.v1', tool: 'subscription_status', hint: null, facts },
  })

  it('parses the server subscription_status structured content', () => {
    expect(parseSubscriptionStatusToolResult(serverDocument(serverFacts), NOW)).toEqual(serverFacts)
  })

  it('parses an anonymous answer with window_end null', () => {
    const facts = parseSubscriptionStatusToolResult(
      serverDocument({
        ...serverFacts,
        active: false,
        window_start: null,
        window_end: null,
        days_left: 0,
        daily_allowance_usd: 0,
        consumed_today_usd: 0,
        remaining_today_usd: 0,
        tier: 'anonymous',
      }),
      NOW
    )
    expect(facts).toMatchObject({ active: false, window_end: null, window_start: null, tier: 'anonymous', days_left: 0 })
  })

  it('carries pending payments seen but not priced', () => {
    const pending = {
      receipt_id: 'r-1',
      tx_hash: TX,
      block_number: 99958600,
      token: '0x766bd6598182586beda76414dc5f8deb1530a213',
      amount: '320000000000000000000',
      indexed_at: '2026-10-28T11:59:00Z',
    }
    const facts = parseSubscriptionStatusToolResult(
      serverDocument({ ...serverFacts, pending_payments: [pending] }),
      NOW
    )
    expect(facts?.pending_payments).toEqual([pending])
    expect(
      parseSubscriptionStatusToolResult(serverDocument({ ...serverFacts, pending_payments: [{ amount: '1' }] }), NOW)
    ).toBeNull()
  })

  it('keeps grant_id and rail', () => {
    const facts = parseSubscriptionStatusToolResult(
      serverDocument({ ...serverFacts, grant_id: 'grant-7', rail: 'cia-robinhood' }),
      NOW
    )
    expect(facts).toMatchObject({ grant_id: 'grant-7', rail: 'cia-robinhood' })
  })

  it('reads the older fields and derives what they lack', () => {
    const older = { wallet: WALLET, window_end: '2026-10-30T12:00:00Z', allowance_usd: 5, consumed_usd: 1.25, tier: 16 }
    const cases = [
      { result: serverDocument(older) },
      { result: { structuredContent: { tool: 'meta_subscription_status', facts: { subscription: older } } } },
      { result: { content: [{ type: 'text', text: JSON.stringify(older) }] } },
    ]
    for (const { result } of cases) {
      expect(parseSubscriptionStatusToolResult(result, NOW)).toEqual({
        wallet: WALLET,
        active: true,
        window_start: null,
        window_end: '2026-10-30T12:00:00Z',
        days_left: 2,
        daily_allowance_usd: 5,
        consumed_today_usd: 1.25,
        remaining_today_usd: 3.75,
        tier: 16,
        pending_payments: [],
      })
    }
  })

  it('returns null for error results, junk, and incomplete facts', () => {
    expect(parseSubscriptionStatusToolResult({ isError: true })).toBeNull()
    expect(parseSubscriptionStatusToolResult('junk')).toBeNull()
    expect(parseSubscriptionStatusToolResult({ structuredContent: { allowance_usd: 5 } })).toBeNull()
    expect(parseSubscriptionStatusToolResult(serverDocument({ ...serverFacts, window_end: 'not-a-date' }))).toBeNull()
  })
})

describe('subscription status arguments and text', () => {
  const proofSchema = { type: 'object', properties: { wallet: { type: 'string' } } }
  const olderSchema = { ...proofSchema, required: ['wallet'] }

  it('sends no wallet argument unless the server schema still requires it', () => {
    const cases = [
      { tool: undefined, want: {} },
      { tool: { inputSchema: { type: 'object' } }, want: {} },
      { tool: { inputSchema: proofSchema }, want: {} },
      { tool: { inputSchema: olderSchema }, want: { wallet: '0xabc' } },
    ]
    for (const { tool, want } of cases) {
      expect(subscriptionStatusArguments(tool, '0xabc')).toEqual(want)
      expect(subscriptionStatusNeedsWallet(tool)).toBe('wallet' in want)
    }
    expect(subscriptionStatusArguments({ inputSchema: olderSchema }, null)).toEqual({})
  })

  it('formats an active, a pending and an empty status', () => {
    const base = {
      active: false,
      window_start: null,
      window_end: null,
      days_left: 0,
      daily_allowance_usd: 0,
      consumed_today_usd: 0,
      remaining_today_usd: 0,
      tier: 'anonymous',
      pending_payments: [],
    }
    expect(formatSubscriptionStatus(base)).toContain('cia subscription buy --days N')
    expect(
      formatSubscriptionStatus({ ...base, pending_payments: [{ tx_hash: '0xfeed' }] })
    ).toContain('Payment seen, not credited yet: 0xfeed')
    const active = formatSubscriptionStatus({
      ...base,
      active: true,
      window_end: '2026-11-03T12:00:00Z',
      days_left: 6.25,
      daily_allowance_usd: 10,
      consumed_today_usd: 1.25,
      remaining_today_usd: 8.75,
      tier: 'subscriber',
    })
    expect(active).toContain('Ends: 2026-11-03T12:00:00Z (about 6.3 days left)')
    expect(active).toContain('Today: 1.25 USD used of 10.00 USD, 8.75 USD left')
  })
})
