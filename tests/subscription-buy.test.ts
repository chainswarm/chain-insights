import { describe, expect, it } from 'vitest'
import { parseUnits } from 'viem'
import type { SubscriptionStatusFacts } from '../src/mcp/subscription-status.js'
import {
  assertConfirmable,
  confirmText,
  executeBuy,
  planBuy,
  waitForGrant,
  type BuyChain,
  type BuyState,
} from '../src/subscription/buy.js'
import { quoteForDays } from '../src/subscription/quote.js'
import { CIA_TOKEN_ADDRESS } from '../src/wallet/robinhood.js'

const WALLET = '0x00000000000000000000000000000000000000aa'
const SINK = '0x67a8c068cc762e371706ea6c399178171f92810d'
const TX = `0x${'5c'.repeat(31)}02`
const quote = quoteForDays(3, { usd: '0.0125', updatedAt: new Date('2026-10-28T09:58:00Z') })
const cia = (value: string) => parseUnits(value, 18)

const anonymous: SubscriptionStatusFacts = {
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
const granted = (windowEnd: string, daysLeft: number): SubscriptionStatusFacts => ({
  ...anonymous,
  active: true,
  window_start: '2026-10-28T10:00:00Z',
  window_end: windowEnd,
  days_left: daysLeft,
  daily_allowance_usd: 10,
  remaining_today_usd: 10,
  tier: 'subscriber',
})
const pending = (txHash: string): SubscriptionStatusFacts => ({
  ...anonymous,
  pending_payments: [{ tx_hash: txHash, amount: cia('960').toString() }],
})

function state(overrides: Partial<BuyState> = {}): BuyState {
  return {
    wallet: { address: WALLET },
    status: anonymous,
    quote,
    ciaBalance: cia('1000'),
    ethBalance: parseUnits('0.001', 18),
    allowance: 0n,
    ...overrides,
  }
}

/** A clock that moves only when the wait sleeps. */
function fakeClock() {
  let now = 0
  return { now: () => now, sleep: async (ms: number) => void (now += ms), elapsed: () => now }
}

describe('cia subscription buy: the plan', () => {
  it('3 days at 0.0125 USD is 960 $CIA', () => {
    expect(quote.amount).toBe(cia('960'))
    expect(quote.usd).toBe(12)
  })

  it('plans approve when the allowance is short', () => {
    expect(planBuy(state({ allowance: cia('959') }))).toEqual({ ok: true, approve: true, quote })
    expect(planBuy(state({ allowance: null }))).toEqual({ ok: true, approve: true, quote })
  })

  it('skips approve when the allowance covers the amount', () => {
    expect(planBuy(state({ allowance: cia('960') }))).toEqual({ ok: true, approve: false, quote })
  })

  it('refuses when $CIA is short, naming the shortfall', () => {
    const plan = planBuy(state({ ciaBalance: cia('900') }))
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.reason).toContain('needs 960 $CIA')
      expect(plan.reason).toContain('holds 900')
      expect(plan.reason).toContain('60 short')
      expect(plan.reason).toContain('cia subscription topup')
    }
  })

  it('refuses with no ETH for gas', () => {
    const plan = planBuy(state({ ethBalance: 0n }))
    expect(plan).toMatchObject({ ok: false })
    if (!plan.ok) expect(plan.reason).toContain('no ETH on Robinhood Chain')
  })

  it('caps the days held at 90: buys up to 90 minus the days left, rounded down', () => {
    const cases: Array<{ name: string; status: SubscriptionStatusFacts; days: number; ok: boolean; text?: string }> = [
      { name: 'no subscription, 90 days', status: anonymous, days: 90, ok: true },
      { name: '87.4 left, 2 days', status: granted('2027-01-23T10:00:00Z', 87.4), days: 2, ok: true },
      { name: '87.4 left, 3 days', status: granted('2027-01-23T10:00:00Z', 87.4), days: 3, ok: false, text: 'Buy at most 2 days now' },
      { name: '89.5 left, 1 day', status: granted('2027-01-25T22:00:00Z', 89.5), days: 1, ok: false, text: 'Buy again after a day has passed' },
      { name: '90 left, 1 day', status: granted('2027-01-26T10:00:00Z', 90), days: 1, ok: false, text: 'Buy again after a day has passed' },
      { name: '89 left, 1 day', status: granted('2027-01-25T10:00:00Z', 89), days: 1, ok: true },
    ]
    for (const c of cases) {
      const q = quoteForDays(c.days, { usd: '0.0125', updatedAt: new Date('2026-10-28T09:58:00Z') })
      const plan = planBuy(state({ status: c.status, quote: q, ciaBalance: cia('1000000') }))
      expect(plan.ok, c.name).toBe(c.ok)
      if (!plan.ok && c.text) {
        expect(plan.reason, c.name).toContain(c.text)
        expect(plan.reason, c.name).toContain('Nothing was sent')
      }
    }
  })

  it('refuses while a payment is pending', () => {
    const plan = planBuy(state({ status: pending(TX) }))
    expect(plan).toMatchObject({ ok: false })
    if (!plan.ok) {
      expect(plan.reason).toContain(`https://robin.etherscan.io/tx/${TX}`)
      expect(plan.reason).toContain('Nothing was sent')
    }
  })

  it('refuses unread status or balances, and a public key', () => {
    const cases: Array<{ overrides: Partial<BuyState>; reason: string }> = [
      { overrides: { status: null }, reason: 'status could not be read' },
      { overrides: { ciaBalance: null }, reason: 'ROBINHOOD_RPC_URL' },
      { overrides: { ethBalance: null }, reason: 'ROBINHOOD_RPC_URL' },
      { overrides: { wallet: { address: WALLET, keyIsPublic: true } }, reason: "This wallet's key is public" },
    ]
    for (const { overrides, reason } of cases) {
      const plan = planBuy(state(overrides))
      expect(plan.ok).toBe(false)
      if (!plan.ok) expect(plan.reason).toContain(reason)
    }
  })

  it('confirm text never contains the sink address', () => {
    for (const approve of [true, false]) {
      const text = confirmText(quote, approve)
      expect(text.toLowerCase()).not.toContain(SINK)
      expect(text).toContain('about 3 days')
      expect(text).toContain('3 x 4 USD = 12 USD')
      expect(text).toContain('960 $CIA at 0.0125 USD per $CIA (CoinGecko, 2026-10-28 09:58 UTC)')
      expect(text).toContain('signs up to two transactions on Robinhood Chain')
    }
    expect(confirmText(quote, true)).toContain('approve exactly 960 $CIA')
  })

  it('refuses a non-TTY stdin', () => {
    expect(() => assertConfirmable({ stdinIsTTY: false, yes: false })).toThrow('stdin is not a terminal')
    expect(() => assertConfirmable({ stdinIsTTY: true, yes: false })).not.toThrow()
    expect(() => assertConfirmable({ stdinIsTTY: false, yes: true })).not.toThrow()
  })
})

describe('cia subscription buy: the wait for the grant', () => {
  it('waitForGrant returns granted', async () => {
    const clock = fakeClock()
    const answers = [anonymous, pending(TX), granted('2026-10-31T10:00:00Z', 3)]
    const outcome = await waitForGrant({
      txHash: TX,
      before: anonymous,
      readStatus: async () => answers.shift() ?? null,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome).toEqual({ outcome: 'granted', tx_hash: TX, window_end: '2026-10-31T10:00:00Z', days_left: 3 })
    expect(clock.elapsed()).toBe(15_000)
  })

  it('waitForGrant counts a longer window as granted for a wallet already active', async () => {
    const clock = fakeClock()
    const before = granted('2026-10-30T10:00:00Z', 2)
    const answers = [before, granted('2026-11-02T10:00:00Z', 5)]
    const outcome = await waitForGrant({ txHash: TX, before, readStatus: async () => answers.shift() ?? before, now: clock.now, sleep: clock.sleep })
    expect(outcome).toMatchObject({ outcome: 'granted', window_end: '2026-11-02T10:00:00Z' })
  })

  it('waitForGrant reports pending with the tx hash', async () => {
    const clock = fakeClock()
    const outcome = await waitForGrant({
      txHash: TX.toUpperCase().replace('0X', '0x'),
      before: anonymous,
      readStatus: async () => pending(TX),
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome.outcome).toBe('pending')
    expect(outcome.tx_hash.toLowerCase()).toBe(TX)
  })

  it('waitForGrant stops at 120 s and names the status command', async () => {
    const clock = fakeClock()
    let reads = 0
    const outcome = await waitForGrant({
      txHash: TX,
      before: anonymous,
      readStatus: async () => {
        reads++
        if (reads % 2 === 0) throw new Error('server busy')
        return anonymous
      },
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome).toEqual({
      outcome: 'timeout',
      tx_hash: TX,
      next: 'Run `cia subscription status` in a few minutes. Do not pay again.',
    })
    expect(clock.elapsed()).toBe(120_000)
    expect(reads).toBe(24)
  })
})

// The order of one buy, over the answers its chain gives. The chain is the
// buy's own seam, answered in memory: what the sink contract does with a
// deposit is judged on the staging lane by chain-insights-validator, never here.
describe('cia subscription buy: the order of one run', () => {
  const KEY = `0x${'11'.repeat(32)}` as const
  // 1 day at 0.01 USD per $CIA is 400 $CIA.
  const PRICE = { usd: '0.01', updatedAt: new Date('2026-10-28T09:58:00Z') }
  const ONE_DAY = cia('400')
  const APPROVE_TX = `0x${'a1'.repeat(32)}`
  const DEPOSIT_TX = `0x${'d1'.repeat(32)}`

  type Sent = { approve: number; deposit: number }
  function chainOf(answers: {
    allowance?: bigint
    approveStatus?: 'success' | 'reverted'
    depositStatus?: 'success' | 'reverted'
    received?: { from: string; token: string; amount: bigint } | null
  }): { chain: BuyChain; sent: Sent } {
    const sent: Sent = { approve: 0, deposit: 0 }
    const chain: BuyChain = {
      readCiaBalance: async () => cia('1000'),
      readEthBalance: async () => parseUnits('0.001', 18),
      readAllowance: async () => answers.allowance ?? 0n,
      approve: async () => {
        sent.approve++
        return { txHash: APPROVE_TX, status: answers.approveStatus ?? 'success' }
      },
      deposit: async (_key, amount) => {
        sent.deposit++
        return {
          txHash: DEPOSIT_TX,
          status: answers.depositStatus ?? 'success',
          received:
            answers.received === undefined ? { from: WALLET, token: CIA_TOKEN_ADDRESS, amount } : answers.received,
        }
      },
    }
    return { chain, sent }
  }

  function buy(chain: BuyChain) {
    let reads = 0
    const clock = fakeClock()
    const run = executeBuy({
      account: { address: WALLET, privateKey: KEY },
      days: 1,
      chain,
      readStatus: async () => (reads++ === 0 ? anonymous : granted('2026-10-29T10:00:00Z', 1)),
      fetchPrice: async () => PRICE,
      confirm: async () => true,
      now: clock.now,
      sleep: clock.sleep,
    })
    return { run, reads: () => reads }
  }

  it('approves, then deposits, then reads the grant', async () => {
    const { chain, sent } = chainOf({})
    const result = await buy(chain).run
    expect(sent).toEqual({ approve: 1, deposit: 1 })
    expect(result).toMatchObject({ approve_tx: APPROVE_TX, deposit_tx: DEPOSIT_TX, amount_cia: '400' })
    expect(result.grant).toMatchObject({ outcome: 'granted', window_end: '2026-10-29T10:00:00Z' })
    expect(result.deposit_url).toBe(`https://robin.etherscan.io/tx/${DEPOSIT_TX}`)
  })

  it('sends one transaction when the allowance covers the amount', async () => {
    const { chain, sent } = chainOf({ allowance: ONE_DAY })
    const result = await buy(chain).run
    expect(sent).toEqual({ approve: 0, deposit: 1 })
    expect(result.approve_tx).toBeNull()
  })

  it('a failed approval sends no deposit', async () => {
    const { chain, sent } = chainOf({ approveStatus: 'reverted' })
    await expect(buy(chain).run).rejects.toThrow('The approval failed on chain')
    expect(sent).toEqual({ approve: 1, deposit: 0 })
  })

  it('a reverted deposit stops before the grant is read', async () => {
    const { chain } = chainOf({ allowance: ONE_DAY, depositStatus: 'reverted' })
    const run = buy(chain)
    await expect(run.run).rejects.toThrow('The payment failed on chain')
    expect(run.reads()).toBe(1)
  })

  it('a receipt that does not show this wallet paying the amount says not to pay again', async () => {
    for (const received of [
      null,
      { from: SINK, token: CIA_TOKEN_ADDRESS, amount: ONE_DAY },
      { from: WALLET, token: CIA_TOKEN_ADDRESS, amount: ONE_DAY - 1n },
    ]) {
      const { chain } = chainOf({ allowance: ONE_DAY, received })
      const run = buy(chain)
      await expect(run.run).rejects.toThrow('Do not pay again')
      expect(run.reads()).toBe(1)
    }
  })
})
