import { describe, it, expect } from 'vitest'
import {
  isMissingSubscriptionStatusToolError,
  parseSubscriptionStatusToolResult,
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
  const serverFacts = {
    window_end: '2026-10-01T00:00:00Z',
    allowance_usd: 5,
    consumed_usd: 1.25,
    tier: 16,
  }

  it('parses the server subscription_status structured content', () => {
    const facts = parseSubscriptionStatusToolResult({ structuredContent: { ...serverFacts } })
    expect(facts).toEqual({
      window_end: '2026-10-01T00:00:00Z',
      allowance_usd: 5,
      consumed_usd: 1.25,
      tier: 16,
    })
  })

  it('parses the proxy document with facts nested under facts.subscription', () => {
    const facts = parseSubscriptionStatusToolResult({
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'meta_subscription_status',
        facts: { subscription: { wallet: '0xabc', ...serverFacts } },
      },
    })
    expect(facts).toEqual({ wallet: '0xabc', ...serverFacts })
  })

  it('falls back to the first text content block holding JSON', () => {
    const facts = parseSubscriptionStatusToolResult({
      content: [{ type: 'text', text: JSON.stringify(serverFacts) }],
    })
    expect(facts).toEqual(serverFacts)
  })

  it('returns null for error results, junk, and incomplete facts', () => {
    expect(parseSubscriptionStatusToolResult({ isError: true })).toBeNull()
    expect(parseSubscriptionStatusToolResult('junk')).toBeNull()
    expect(
      parseSubscriptionStatusToolResult({ structuredContent: { allowance_usd: 5 } })
    ).toBeNull()
    expect(
      parseSubscriptionStatusToolResult({
        structuredContent: { ...serverFacts, window_end: 'not-a-date' },
      })
    ).toBeNull()
  })
})
