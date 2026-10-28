import { describe, expect, it } from 'vitest'
import { parseUnits } from 'viem'
import {
  DAILY_ALLOWANCE_USD,
  MAX_DAYS_PER_BUY,
  SUBSCRIPTION_DAY_USD,
  fetchCiaUsdPrice,
  quoteAmount,
} from '../src/subscription/quote.js'

const CIA = '0x766bd6598182586beda76414dc5f8deb1530a213'
const NOW = new Date('2026-10-28T10:00:00Z')
const nowSeconds = NOW.getTime() / 1000

/** A CoinGecko fake: the fetch is injected. No node and no StarRocks. */
function coingecko(body: unknown, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} })
    return { ok: status === 200, status, json: async () => body }
  }
  return { calls, fetchImpl }
}

describe('the subscription day price', () => {
  it('a day costs 4 USD and the daily allowance is 10 USD', () => {
    expect(SUBSCRIPTION_DAY_USD).toBe(4)
    expect(DAILY_ALLOWANCE_USD).toBe(10)
  })

  it('one day at 0.0125 USD is 320 CIA', () => {
    expect(quoteAmount(1, '0.0125')).toBe(parseUnits('320', 18))
    expect(quoteAmount(30, '0.0125')).toBe(parseUnits('9600', 18))
  })

  it('rounds the amount up, never down', () => {
    // 4 / 0.0003364 = 11890.606... $CIA
    const amount = quoteAmount(1, '0.0003364')
    expect(amount * parseUnits('0.0003364', 18)).toBeGreaterThanOrEqual(parseUnits('4', 36))
    expect((amount - 1n) * parseUnits('0.0003364', 18)).toBeLessThan(parseUnits('4', 36))
    expect(quoteAmount(1, '3')).toBe(parseUnits('4', 18) / 3n + 1n)
  })

  it('refuses zero, negative, fractional and over-cap days', () => {
    for (const days of [0, -1, 1.5, MAX_DAYS_PER_BUY + 1, Number.NaN]) {
      expect(() => quoteAmount(days, '0.01'), String(days)).toThrow(`from 1 to ${MAX_DAYS_PER_BUY}`)
    }
    expect(MAX_DAYS_PER_BUY).toBe(90)
    expect(quoteAmount(MAX_DAYS_PER_BUY, '1')).toBe(parseUnits('360', 18))
  })
})

describe('the $CIA price from CoinGecko', () => {
  it('reads the price keyed by the lower-case contract', async () => {
    const { calls, fetchImpl } = coingecko({ [CIA]: { usd: 0.0003364, last_updated_at: nowSeconds - 60 } })
    const price = await fetchCiaUsdPrice(fetchImpl, {}, NOW)
    expect(price).toEqual({ usd: '0.0003364', updatedAt: new Date((nowSeconds - 60) * 1000) })
    expect(calls[0].url).toBe(
      `https://api.coingecko.com/api/v3/simple/token_price/robinhood?contract_addresses=${CIA}&vs_currencies=usd&include_last_updated_at=true`
    )
    const tiny = coingecko({ [CIA]: { usd: 3.2e-7, last_updated_at: nowSeconds } })
    expect((await fetchCiaUsdPrice(tiny.fetchImpl, {}, NOW)).usd).toBe('0.00000032')
  })

  it('refuses a missing, zero or stale price', async () => {
    const cases: Array<{ body: unknown; status?: number; error: string }> = [
      { body: {}, error: 'no $CIA price' },
      { body: { [CIA]: { usd: 0, last_updated_at: nowSeconds } }, error: 'no $CIA price' },
      { body: { [CIA]: { usd: 0.01 } }, error: 'without its time' },
      { body: { [CIA]: { usd: 0.01, last_updated_at: nowSeconds - 11 * 60 } }, error: '11 minutes old' },
      { body: { error: 'rate limited' }, status: 429, error: 'HTTP 429' },
    ]
    for (const { body, status, error } of cases) {
      const { fetchImpl } = coingecko(body, status)
      await expect(fetchCiaUsdPrice(fetchImpl, {}, NOW)).rejects.toThrow(error)
    }
  })

  it('sends the demo key header only when set', async () => {
    const body = { [CIA]: { usd: 0.01, last_updated_at: nowSeconds } }
    const keyed = coingecko(body)
    await fetchCiaUsdPrice(keyed.fetchImpl, { CHAIN_INSIGHTS_COINGECKO_API_KEY: 'demo-key' }, NOW)
    expect(keyed.calls[0].headers['x-cg-demo-api-key']).toBe('demo-key')
    const keyless = coingecko(body)
    await fetchCiaUsdPrice(keyless.fetchImpl, {}, NOW)
    expect(keyless.calls[0].headers).not.toHaveProperty('x-cg-demo-api-key')
  })
})
