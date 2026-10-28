import { parseUnits } from 'viem'
import { CIA_TOKEN_ADDRESS } from '../wallet/robinhood.js'

// The subscription is priced at 120 USD a month of 30 days, so one day costs
// 120 / 30 = 4 USD, paid in $CIA at the CoinGecko price. A subscriber's
// daily query allowance is the month price times 2.5, over 30 days:
// 120 x 2.5 / 30 = 10 USD a day. The server grants quote_usd / 4 days for a
// payment, so the days asked here are the days granted, give or take the
// price move between this quote and the server's own.
export const SUBSCRIPTION_MONTH_USD = 120
export const SUBSCRIPTION_MONTH_DAYS = 30
export const SUBSCRIPTION_ALLOWANCE_MULTIPLIER = 2.5
export const SUBSCRIPTION_DAY_USD = SUBSCRIPTION_MONTH_USD / SUBSCRIPTION_MONTH_DAYS
export const DAILY_ALLOWANCE_USD =
  (SUBSCRIPTION_MONTH_USD * SUBSCRIPTION_ALLOWANCE_MULTIPLIER) / SUBSCRIPTION_MONTH_DAYS
/** The most days one buy may pay for. */
export const MAX_DAYS_PER_BUY = 90

// The price comes from CoinGecko only. Never from an exchange pool: operator
// ruling. A price older than this is refused, the same limit the server keeps.
export const COINGECKO_PLATFORM = 'robinhood'
export const MAX_PRICE_AGE_SECONDS = 10 * 60
const COINGECKO_API = 'https://api.coingecko.com/api/v3'

export interface CiaPrice {
  /** USD per $CIA, as a plain decimal string. */
  usd: string
  /** When CoinGecko last updated the price. */
  updatedAt: Date
}

export interface Quote {
  days: number
  usd: number
  price: CiaPrice
  /** The $CIA to pay, in token units (18 decimals), rounded up. */
  amount: bigint
}

/** A JSON number as a plain decimal string: 3.2e-7 becomes 0.00000032. */
function plainDecimal(value: number): string {
  const text = String(value)
  if (!/e/i.test(text)) return text
  return value.toFixed(18).replace(/0+$/, '').replace(/\.$/, '')
}

export function assertDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS_PER_BUY) {
    throw new Error(`Days must be a whole number from 1 to ${MAX_DAYS_PER_BUY}.`)
  }
}

/**
 * The $CIA amount for `days` at `priceUsd` USD per $CIA: days x 4 USD over the
 * price, in token units, rounded up so the payment never falls short.
 */
export function quoteAmount(days: number, priceUsd: string): bigint {
  assertDays(days)
  const price = parseUnits(priceUsd, 18)
  if (price <= 0n) throw new Error('The $CIA price must be above zero.')
  const usd = parseUnits(String(days * SUBSCRIPTION_DAY_USD), 18)
  const scaled = usd * 10n ** 18n
  return (scaled + price - 1n) / price
}

export function quoteForDays(days: number, price: CiaPrice): Quote {
  return { days, usd: days * SUBSCRIPTION_DAY_USD, price, amount: quoteAmount(days, price.usd) }
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/**
 * The $CIA price in USD from CoinGecko. Sends CHAIN_INSIGHTS_COINGECKO_API_KEY
 * as the demo key header when it is set. Refuses a missing, zero or stale price.
 */
export async function fetchCiaUsdPrice(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<CiaPrice> {
  const contract = CIA_TOKEN_ADDRESS.toLowerCase()
  const url =
    `${COINGECKO_API}/simple/token_price/${COINGECKO_PLATFORM}` +
    `?contract_addresses=${contract}&vs_currencies=usd&include_last_updated_at=true`
  const apiKey = env['CHAIN_INSIGHTS_COINGECKO_API_KEY']?.trim()
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey
  const response = await fetchImpl(url, { headers })
  if (!response.ok) {
    throw new Error(`CoinGecko did not answer the $CIA price (HTTP ${response.status}). Try again in a minute.`)
  }
  const body = (await response.json()) as Record<string, { usd?: unknown; last_updated_at?: unknown } | undefined>
  const entry = body?.[contract]
  const usd = entry?.usd
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) {
    throw new Error('CoinGecko has no $CIA price right now. Try again later.')
  }
  const updated = entry?.last_updated_at
  if (typeof updated !== 'number' || !Number.isFinite(updated)) {
    throw new Error('CoinGecko sent the $CIA price without its time. Try again later.')
  }
  const ageSeconds = now.getTime() / 1000 - updated
  if (ageSeconds > MAX_PRICE_AGE_SECONDS) {
    throw new Error(
      `The $CIA price on CoinGecko is ${Math.round(ageSeconds / 60)} minutes old, over the ${MAX_PRICE_AGE_SECONDS / 60}-minute limit. Try again later.`
    )
  }
  return { usd: plainDecimal(usd), updatedAt: new Date(updated * 1000) }
}
