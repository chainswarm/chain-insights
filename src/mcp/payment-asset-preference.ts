/**
 * Payment-asset preference ordering for 402 `accepts` offers.
 *
 * Chain Insights Graph can quote a paid MCP call in more than one ERC-20
 * asset across networks (USDC on Base, USDG/CHOICE on Robinhood Chain). The
 * x402 client's default selector always pays with the first `accepts` entry
 * it can pay with, so re-ordering `accepts` by operator preference before
 * the payment scheme picks lets an operator route payments to a preferred
 * asset without any server-side change.
 */

export interface PaymentOptionLike {
  network: string // CAIP-2, e.g. "eip155:8453"
  asset: string // ERC-20 token contract address
  amount: string // base units
  extra?: Record<string, unknown>
}

/**
 * Known payment asset symbols by lowercase contract address. Extend this map
 * as new payment assets go live; an address not listed here can still be
 * targeted directly by address in CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE.
 */
export const KNOWN_PAYMENT_ASSET_SYMBOLS: Record<string, string> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', // Base
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG', // Robinhood Chain
  '0x6e30a5f8fc61cd4e8550d2dd3cddea2a0196dc69': 'CHOICE', // Robinhood Chain (test token)
}

/**
 * Orders 402 `accepts` by the operator preference list (env
 * CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE, comma-separated symbols or
 * addresses, e.g. "CHOICE,USDG,USDC"). Unlisted assets keep server order
 * after listed ones. Empty preference -> server order (today's behavior).
 *
 * Pure: does not mutate `accepts`. Matching is case-insensitive for both
 * symbols and addresses, and the sort is stable so ties (unlisted assets,
 * or repeated preference entries) preserve server order.
 */
export function orderPaymentOptions(
  accepts: PaymentOptionLike[],
  preference: string,
  assetSymbols: Record<string, string>,
): PaymentOptionLike[] {
  const preferenceList = preference
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  if (preferenceList.length === 0) return accepts

  const rankOf = (option: PaymentOptionLike): number => {
    const addressLower = option.asset.toLowerCase()
    const symbolLower = assetSymbols[addressLower]?.toLowerCase()
    const rank = preferenceList.findIndex((entry) => entry === symbolLower || entry === addressLower)
    return rank === -1 ? preferenceList.length : rank
  }

  return [...accepts].sort((a, b) => rankOf(a) - rankOf(b))
}
