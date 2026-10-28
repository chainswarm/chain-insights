import { qrTerminalText } from '../wallet/mcp-proxy/qr.js'
import { SUBSCRIPTION_TOPUP_TEXT, startTopupServer } from '../wallet/mcp-proxy/topup-server.js'
import {
  CIA_SYMBOL,
  CIA_TOKEN_ADDRESS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NETWORK_DISPLAY,
} from '../wallet/robinhood.js'

export interface SubscriptionTopupFacts {
  wallet_address: string
  network: typeof ROBINHOOD_NETWORK_DISPLAY
  chain_id: typeof ROBINHOOD_CHAIN_ID
  token: typeof CIA_SYMBOL
  token_contract: typeof CIA_TOKEN_ADDRESS
  gas_token: 'ETH'
  topup_url?: string
}

export function subscriptionTopupFacts(walletAddress: string, topupUrl?: string): SubscriptionTopupFacts {
  return {
    wallet_address: walletAddress,
    network: ROBINHOOD_NETWORK_DISPLAY,
    chain_id: ROBINHOOD_CHAIN_ID,
    token: CIA_SYMBOL,
    token_contract: CIA_TOKEN_ADDRESS,
    gas_token: 'ETH',
    ...(topupUrl ? { topup_url: topupUrl } : {}),
  }
}

/** The terminal text of `cia subscription topup`: facts, then the QR code. */
export function subscriptionTopupText(facts: SubscriptionTopupFacts): string {
  return [
    ...(facts.topup_url ? [`Top-up page: ${facts.topup_url}`] : []),
    `Wallet:      ${facts.wallet_address}`,
    `Network:     ${facts.network} (chain ID ${facts.chain_id})`,
    `Token:       ${facts.token} ${facts.token_contract}, and a little ETH for gas`,
    '',
    qrTerminalText(facts.wallet_address),
    '',
    SUBSCRIPTION_TOPUP_TEXT,
  ].join('\n')
}

/** `cia subscription topup`: the user's own wallet, never the payment address. */
export async function runSubscriptionTopup(opts: { open?: boolean; json?: boolean }): Promise<void> {
  const { assertWalletKeyNotPublic, getWalletAccount } = await import('../wallet/tools.js')
  const account = await getWalletAccount()
  assertWalletKeyNotPublic(account)
  const url = await startTopupServer(account.address, 'robinhood-cia')
  const facts = subscriptionTopupFacts(account.address, url)
  console.log(opts.json ? JSON.stringify(facts, null, 2) : subscriptionTopupText(facts))
  if (!opts.json) console.log('Press Ctrl+C to stop the top-up page.')
  if (opts.open !== false) {
    const open = (await import('open')).default
    await open(url)
  }
}
