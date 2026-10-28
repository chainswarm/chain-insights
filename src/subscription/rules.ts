// The subscription rules, in the one text every host reads: the tool
// description. Claude Desktop chat loads no skill, so the rules ride on each
// subscription tool; the chain-insights-cypher skill repeats them.

export const SUBSCRIPTION_RULES =
  'Two funding doors for the one local wallet: wallet_topup is USDC on Base, for pay-per-call queries; subscription_topup is $CIA and a little ETH on Robinhood Chain, for the subscription. ' +
  'Buying subscription days is `cia subscription buy --days N`, run by the user in a terminal, and it needs the user\'s own yes. An agent never buys: no tool can buy or pay. ' +
  'Never send $CIA by hand to any other address: it is not credited.'

export const META_SUBSCRIPTION_STATUS_DESCRIPTION =
  "Return the subscription of the caller's wallet, proven by the wallet's own signature: active or not, the window start and end, the days left, the daily allowance of 10 USD with what is used and left today, the tier, and payments seen on chain and not credited yet. Takes no arguments: send {}. " +
  SUBSCRIPTION_RULES

export const SUBSCRIPTION_TOPUP_TOOL = 'subscription_topup'

export const SUBSCRIPTION_TOPUP_DESCRIPTION =
  'Show the local Chain Insights wallet address and its QR code for funding with $CIA and ETH (for gas) on Robinhood Chain, with its $CIA and ETH balances. Read-only: it signs nothing and sends nothing. Takes no arguments: send {}. ' +
  SUBSCRIPTION_RULES

export const WALLET_TOPUP_DESCRIPTION =
  'Show the local Chain Insights payment wallet address and its QR code for funding with USDC on Base Mainnet. Read-only: it makes no payment and signs nothing. ' +
  SUBSCRIPTION_RULES
