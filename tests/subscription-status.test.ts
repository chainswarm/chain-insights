import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SUBSCRIPTION_MONTH_USD,
  formatDepositGuardLine,
  formatDepositIrreversibilityWarning,
  formatSubscriptionPassHint,
  isDepositConfirmed,
  isMissingSubscriptionStatusToolError,
  parseSubscriptionStatusToolResult,
  resolveSubscriptionMonthUsd,
  subscriptionPassPriceUsd,
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

describe('subscription pass hints (cia buy day|month)', () => {
  it('day pass derives SUBSCRIPTION_MONTH_USD / 30 ($4.00 at the $120 default)', () => {
    expect(subscriptionPassPriceUsd('day', 120)).toBe(4)
    const hint = formatSubscriptionPassHint('day', 120)
    expect(hint).toContain('Day pass: $4.00')
    expect(hint).toContain('SUBSCRIPTION_MONTH_USD / 30')
    expect(hint).toContain('$4.00')
  })

  it('month pass shows the list price', () => {
    expect(subscriptionPassPriceUsd('month', 120)).toBe(120)
    const hint = formatSubscriptionPassHint('month', 120)
    expect(hint).toContain('Month pass: $120.00')
    expect(hint).toContain('list price')
  })

  it('both hints explain the indexer TWAP quote and the approximate $CIA amount', () => {
    for (const pass of ['day', 'month'] as const) {
      const hint = formatSubscriptionPassHint(pass, 120)
      expect(hint).toContain('TWAP')
      expect(hint).toContain('approximately')
      expect(hint).toContain('$CIA')
    }
  })

  it('resolveSubscriptionMonthUsd defaults to 120 and honors the env override', () => {
    expect(DEFAULT_SUBSCRIPTION_MONTH_USD).toBe(120)
    expect(resolveSubscriptionMonthUsd({})).toBe(120)
    expect(resolveSubscriptionMonthUsd({ SUBSCRIPTION_MONTH_USD: '90' })).toBe(90)
    expect(() => resolveSubscriptionMonthUsd({ SUBSCRIPTION_MONTH_USD: 'abc' })).toThrow(
      'SUBSCRIPTION_MONTH_USD'
    )
    expect(() => resolveSubscriptionMonthUsd({ SUBSCRIPTION_MONTH_USD: '0' })).toThrow(
      'SUBSCRIPTION_MONTH_USD'
    )
  })
})

describe('deposit pre-sign guard', () => {
  const now = new Date('2026-09-08T00:00:00Z')

  it('prints the server-authoritative extension line for a month deposit', () => {
    const line = formatDepositGuardLine({ window_end: '2026-10-01T00:00:00Z' }, 'month', now)
    expect(line).toBe('23 days active; this deposit extends to 53')
  })

  it('a day deposit extends the live window by one day', () => {
    const line = formatDepositGuardLine({ window_end: '2026-09-10T00:00:00Z' }, 'day', now)
    expect(line).toBe('2 days active; this deposit extends to 3')
  })

  it('an expired window starts the new pass from now', () => {
    const line = formatDepositGuardLine({ window_end: '2026-09-01T00:00:00Z' }, 'month', now)
    expect(line).toBe('0 days active; this deposit extends to 30')
  })

  it('requires the exact typed DEPOSIT confirmation', () => {
    expect(isDepositConfirmed('DEPOSIT')).toBe(true)
    expect(isDepositConfirmed('deposit')).toBe(false)
    expect(isDepositConfirmed('BACKED UP')).toBe(false)
    expect(isDepositConfirmed('')).toBe(false)
  })

  it('the unavailable-server warning is a generic irreversibility warning with the reason', () => {
    const warning = formatDepositIrreversibilityWarning('connection refused')
    expect(warning).toContain('connection refused')
    expect(warning).toContain('cannot refund')
  })
})

describe('cia buy CLI surface', () => {
  const srcCli = join(process.cwd(), 'src', 'cli.ts')
  const tsxLoader = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')

  it('buy --help lists the day and month passes', () => {
    const out = execSync(`node --import ${tsxLoader} ${srcCli} buy --help`, { encoding: 'utf8' })
    expect(out).toContain('day')
    expect(out).toContain('month')
    expect(out).toContain('deposit')
  })

  it('buy day prints the pass guidance and the generic warning when subscription status is unavailable', () => {
    const home = mkdtempSync(join(tmpdir(), 'chain-insights-buy-day-'))
    try {
      const result = spawnSync(process.execPath, ['--import', tsxLoader, srcCli, 'buy', 'day'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Day pass: $4.00')
      expect(result.stdout).toContain('TWAP')
      expect(result.stderr).toContain('cannot refund')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('buy month prints the list price guidance when subscription status is unavailable', () => {
    const home = mkdtempSync(join(tmpdir(), 'chain-insights-buy-month-'))
    try {
      const result = spawnSync(process.execPath, ['--import', tsxLoader, srcCli, 'buy', 'month'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Month pass: $120.00')
      expect(result.stdout).toContain('list price')
      expect(result.stderr).toContain('cannot refund')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
