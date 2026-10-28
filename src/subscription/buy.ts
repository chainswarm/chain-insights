import type { Hex } from 'viem'
import type { SubscriptionStatusFacts } from '../mcp/subscription-status.js'
import { PUBLIC_KEY_WALLET_TEXT } from '../wallet/known-keys.js'
import {
  CIA_TOKEN_ADDRESS,
  approveCiaForSubscription,
  depositCiaForSubscription,
  explorerTxUrl,
  formatCia,
  readCiaAllowance,
  readCiaBalance,
  readRobinhoodEthBalance,
} from '../wallet/robinhood.js'
import { MAX_DAYS_HELD, SUBSCRIPTION_DAY_USD, quoteForDays, type CiaPrice, type Quote } from './quote.js'

// `cia subscription buy --days N`: the one way to pay for a subscription. It
// is a terminal command and never an MCP tool: an agent cannot buy. Order:
// wallet, status, quote, balances, the user's yes, approve, deposit, wait.

export const GRANT_WAIT_MS = 120_000
export const GRANT_POLL_MS = 5_000
export const STATUS_COMMAND = 'cia subscription status'
export const TOPUP_COMMAND = 'cia subscription topup'

export interface BuyState {
  wallet: { address: string; keyIsPublic?: boolean }
  /** null when the server's subscription status could not be read. */
  status: SubscriptionStatusFacts | null
  quote: Quote
  ciaBalance: bigint | null
  ethBalance: bigint | null
  allowance: bigint | null
}

export type BuyPlan = { ok: true; approve: boolean; quote: Quote } | { ok: false; reason: string }

/** Decides the buy from what was read. Pure: no I/O. */
export function planBuy(state: BuyState): BuyPlan {
  const { quote } = state
  if (state.wallet.keyIsPublic === true) return { ok: false, reason: PUBLIC_KEY_WALLET_TEXT }
  if (!state.status) {
    return {
      ok: false,
      reason: `The subscription status could not be read, so a payment cannot be checked. Nothing was sent. Run \`${STATUS_COMMAND}\` and try again.`,
    }
  }
  const pending = state.status.pending_payments[0]
  if (pending) {
    return {
      ok: false,
      reason: `A payment is still being credited: ${explorerTxUrl(pending.tx_hash)}. Nothing was sent. Wait a few minutes and run \`${STATUS_COMMAND}\`.`,
    }
  }
  const held = state.status.active ? Math.max(0, state.status.days_left) : 0
  const room = Math.floor(MAX_DAYS_HELD - held)
  if (quote.days > room) {
    return {
      ok: false,
      reason:
        room < 1
          ? `The wallet already holds ${held.toFixed(1)} days, and a wallet may hold at most ${MAX_DAYS_HELD}. Nothing was sent. Buy again after a day has passed.`
          : `The wallet already holds ${held.toFixed(1)} days, and a wallet may hold at most ${MAX_DAYS_HELD}. Buy at most ${room} ${room === 1 ? 'day' : 'days'} now. Nothing was sent.`,
    }
  }
  if (state.ciaBalance === null || state.ethBalance === null) {
    return {
      ok: false,
      reason:
        'The wallet balance on Robinhood Chain could not be read. Nothing was sent. Try again, or set ROBINHOOD_RPC_URL to a working Robinhood Chain RPC.',
    }
  }
  if (state.ciaBalance < quote.amount) {
    const short = quote.amount - state.ciaBalance
    return {
      ok: false,
      reason: `Not enough $CIA: the buy needs ${formatCia(quote.amount)} $CIA and the wallet holds ${formatCia(state.ciaBalance)}, ${formatCia(short)} short. Run \`${TOPUP_COMMAND}\` to fund it.`,
    }
  }
  if (state.ethBalance === 0n) {
    return {
      ok: false,
      reason: `The wallet holds no ETH on Robinhood Chain to pay the gas. Run \`${TOPUP_COMMAND}\` and send a little ETH.`,
    }
  }
  return { ok: true, approve: (state.allowance ?? 0n) < quote.amount, quote }
}

function utcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** The text the user says yes to. It never names the sink address. */
export function confirmText(quote: Quote, approve: boolean): string {
  const transactions = approve
    ? `It signs up to two transactions on Robinhood Chain: approve exactly ${formatCia(quote.amount)} $CIA, then pay.`
    : 'It signs up to two transactions on Robinhood Chain; this time one is enough: the payment.'
  return [
    `Buy about ${quote.days} ${quote.days === 1 ? 'day' : 'days'} of the Chain Insights subscription.`,
    `Price: ${quote.days} x ${SUBSCRIPTION_DAY_USD} USD = ${quote.usd} USD.`,
    `Pay: ${formatCia(quote.amount)} $CIA at ${quote.price.usd} USD per $CIA (CoinGecko, ${utcMinute(quote.price.updatedAt)}).`,
    'The server prices the payment again when it credits it, so the days can differ by a few minutes.',
    transactions,
  ].join('\n')
}

/** A buy needs a typed yes on a terminal, or --yes. */
export function assertConfirmable(options: { stdinIsTTY: boolean; yes: boolean }): void {
  if (options.yes || options.stdinIsTTY) return
  throw new Error(
    '`cia subscription buy` needs a typed yes, and stdin is not a terminal. Run it in a terminal, or pass --yes.'
  )
}

export type GrantOutcome =
  | { outcome: 'granted'; tx_hash: string; window_end: string | null; days_left: number }
  | { outcome: 'pending'; tx_hash: string; next: string }
  | { outcome: 'timeout'; tx_hash: string; next: string }

export interface WaitForGrantOptions {
  txHash: string
  /** The status read before the payment. */
  before: SubscriptionStatusFacts | null
  readStatus: () => Promise<SubscriptionStatusFacts | null>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  intervalMs?: number
}

/**
 * Polls the status every 5 s for at most 120 s. granted: the window moved
 * and the payment is no longer pending. pending: the server saw the payment
 * and has not priced it yet. timeout: the server has not seen it. Never resends.
 */
export async function waitForGrant(options: WaitForGrantOptions): Promise<GrantOutcome> {
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? GRANT_WAIT_MS
  const intervalMs = options.intervalMs ?? GRANT_POLL_MS
  const tx = options.txHash.toLowerCase()
  const before = options.before
  const deadline = now() + timeoutMs
  let seen = false
  while (now() < deadline) {
    await sleep(Math.min(intervalMs, deadline - now()))
    let status: SubscriptionStatusFacts | null = null
    try {
      status = await options.readStatus()
    } catch {
      status = null
    }
    if (!status) continue
    if (status.pending_payments.some((payment) => payment.tx_hash.toLowerCase() === tx)) {
      seen = true
      continue
    }
    const moved = !before || !before.active || status.window_end !== before.window_end
    if (status.active && moved) {
      return { outcome: 'granted', tx_hash: options.txHash, window_end: status.window_end, days_left: status.days_left }
    }
  }
  const next = `Run \`${STATUS_COMMAND}\` in a few minutes. Do not pay again.`
  return seen
    ? { outcome: 'pending', tx_hash: options.txHash, next }
    : { outcome: 'timeout', tx_hash: options.txHash, next }
}

export interface BuyChain {
  readCiaBalance(address: string): Promise<bigint | null>
  readEthBalance(address: string): Promise<bigint | null>
  readAllowance(owner: string): Promise<bigint | null>
  approve: typeof approveCiaForSubscription
  deposit: typeof depositCiaForSubscription
}

/** The Robinhood Chain, through ROBINHOOD_RPC_URL or the public endpoints. */
export function robinhoodBuyChain(env: NodeJS.ProcessEnv = process.env): BuyChain {
  return {
    readCiaBalance: (address) => readCiaBalance(address, env),
    readEthBalance: (address) => readRobinhoodEthBalance(address, env),
    readAllowance: (owner) => readCiaAllowance(owner, env),
    approve: (key, amount) => approveCiaForSubscription(key, amount, env),
    deposit: (key, amount) => depositCiaForSubscription(key, amount, env),
  }
}

export interface BuyDependencies {
  account: { address: string; privateKey: Hex; keyIsPublic?: boolean }
  days: number
  readStatus: () => Promise<SubscriptionStatusFacts | null>
  fetchPrice: () => Promise<CiaPrice>
  /** Shows the text and resolves true on the user's yes. */
  confirm: (text: string) => Promise<boolean>
  chain?: BuyChain
  log?: (line: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface BuyResult {
  days: number
  usd: number
  amount_cia: string
  price_usd: string
  price_time: string
  approve_tx: string | null
  deposit_tx: string
  deposit_url: string
  grant: GrantOutcome
}

/** Runs one buy. Throws, with nothing sent, on every refusal before the yes. */
export async function executeBuy(deps: BuyDependencies): Promise<BuyResult> {
  const chain = deps.chain ?? robinhoodBuyChain()
  const log = deps.log ?? (() => {})
  const { account } = deps
  if (account.keyIsPublic === true) throw new Error(PUBLIC_KEY_WALLET_TEXT)

  const status = await deps.readStatus()
  const price = await deps.fetchPrice()
  const quote = quoteForDays(deps.days, price)
  const [ciaBalance, ethBalance, allowance] = await Promise.all([
    chain.readCiaBalance(account.address),
    chain.readEthBalance(account.address),
    chain.readAllowance(account.address),
  ])
  const plan = planBuy({ wallet: account, status, quote, ciaBalance, ethBalance, allowance })
  if (!plan.ok) throw new Error(plan.reason)
  if (!(await deps.confirm(confirmText(quote, plan.approve)))) {
    throw new Error('Buy cancelled. Nothing was sent.')
  }

  let approveTx: string | null = null
  if (plan.approve) {
    const approval = await chain.approve(account.privateKey, quote.amount)
    approveTx = approval.txHash
    log(`Approve: ${explorerTxUrl(approval.txHash)}`)
    if (approval.status !== 'success') {
      throw new Error(`The approval failed on chain: ${explorerTxUrl(approval.txHash)}. No $CIA was paid.`)
    }
  }
  const deposit = await chain.deposit(account.privateKey, quote.amount)
  log(`Payment: ${explorerTxUrl(deposit.txHash)}`)
  if (deposit.status !== 'success') {
    throw new Error(`The payment failed on chain: ${explorerTxUrl(deposit.txHash)}. No $CIA was paid.`)
  }
  const received = deposit.received
  if (
    !received ||
    received.from.toLowerCase() !== account.address.toLowerCase() ||
    received.token.toLowerCase() !== CIA_TOKEN_ADDRESS ||
    received.amount !== quote.amount
  ) {
    throw new Error(
      `The payment landed, but its receipt does not show ${formatCia(quote.amount)} $CIA from this wallet: ${explorerTxUrl(deposit.txHash)}. Do not pay again. Run \`${STATUS_COMMAND}\`.`
    )
  }

  const grant = await waitForGrant({
    txHash: deposit.txHash,
    before: status,
    readStatus: deps.readStatus,
    now: deps.now,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  })
  return {
    days: quote.days,
    usd: quote.usd,
    amount_cia: formatCia(quote.amount),
    price_usd: price.usd,
    price_time: price.updatedAt.toISOString(),
    approve_tx: approveTx,
    deposit_tx: deposit.txHash,
    deposit_url: explorerTxUrl(deposit.txHash),
    grant,
  }
}

/** The outcome in plain lines. */
export function formatBuyResult(result: BuyResult): string {
  const lines = [`Paid ${result.amount_cia} $CIA for about ${result.days} ${result.days === 1 ? 'day' : 'days'}: ${result.deposit_url}`]
  const grant = result.grant
  if (grant.outcome === 'granted') {
    lines.push(`Subscription active until ${grant.window_end ?? 'unknown'} (about ${grant.days_left.toFixed(1)} days left).`)
  } else if (grant.outcome === 'pending') {
    lines.push('The server has seen the payment and is pricing it.', grant.next)
  } else {
    lines.push('The server has not credited the payment yet.', grant.next)
  }
  return lines.join('\n')
}
