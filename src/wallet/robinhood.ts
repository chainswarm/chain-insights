import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  formatUnits,
  http,
  type Address,
  type Hex,
} from 'viem'
import { robinhood } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// Robinhood Chain: the network of the $CIA token and of the subscription
// payment. Also the second EVM network accepted for x402 Permit2 payments
// beside Base (src/mcp/client.ts).
export const ROBINHOOD_CHAIN_ID = 4663
export const ROBINHOOD_NETWORK = 'eip155:4663'
export const ROBINHOOD_NETWORK_DISPLAY = 'Robinhood Chain'
export const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
export const PUBLIC_ROBINHOOD_RPC_URLS = [ROBINHOOD_RPC_URL, 'https://rpc.ordofi.network'] as const
export const ROBINHOOD_EXPLORER_URL = 'https://robin.etherscan.io'

// $CIA, the Chain Insights token on Robinhood Chain.
export const CIA_TOKEN_ADDRESS = '0x766bd6598182586beda76414dc5f8deb1530a213' as const
export const CIA_DECIMALS = 18
export const CIA_SYMBOL = '$CIA'

// The subscription sink. Module-private on purpose: only the buy below sends
// to it, and no text a user reads names it. $CIA sent to it by hand is not
// credited to a subscription.
const SUBSCRIPTION_SINK = '0x67a8c068cc762e371706ea6c399178171f92810d' as const

// viem's chain entry links Blockscout; Chain Insights links Etherscan.
export const robinhoodChain = defineChain({
  ...robinhood,
  blockExplorers: {
    default: { name: 'Robinhood Chain Etherscan', url: ROBINHOOD_EXPLORER_URL },
  },
})

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const SINK_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Received',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * The Robinhood Chain RPC list: ROBINHOOD_RPC_URL from the environment first,
 * then the public endpoints, without duplicates.
 */
export function robinhoodRpcUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env['ROBINHOOD_RPC_URL']?.trim()
  const urls = [...(override ? [override] : []), ...PUBLIC_ROBINHOOD_RPC_URLS]
  return [...new Set(urls)]
}

export function explorerTxUrl(hash: string): string {
  return `${ROBINHOOD_EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${ROBINHOOD_EXPLORER_URL}/address/${address}`
}

/** A $CIA amount in token units (18 decimals) as a decimal string. */
export function formatCia(amount: bigint): string {
  return formatUnits(amount, CIA_DECIMALS)
}

function publicClient(url: string) {
  return createPublicClient({ chain: robinhoodChain, transport: http(url) })
}

/** Walks the RPC list; null when every endpoint fails. */
async function readFirst<T>(env: NodeJS.ProcessEnv, read: (url: string) => Promise<T>): Promise<T | null> {
  for (const url of robinhoodRpcUrls(env)) {
    try {
      return await read(url)
    } catch {
      // Try the next Robinhood Chain RPC endpoint.
    }
  }
  return null
}

export function readCiaBalance(address: string, env: NodeJS.ProcessEnv = process.env): Promise<bigint | null> {
  return readFirst(env, (url) =>
    publicClient(url).readContract({
      address: CIA_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as Address],
    })
  )
}

export function readRobinhoodEthBalance(address: string, env: NodeJS.ProcessEnv = process.env): Promise<bigint | null> {
  return readFirst(env, (url) => publicClient(url).getBalance({ address: address as Address }))
}

/** The $CIA the subscription sink may take from `owner`. */
export function readCiaAllowance(owner: string, env: NodeJS.ProcessEnv = process.env): Promise<bigint | null> {
  return readFirst(env, (url) =>
    publicClient(url).readContract({
      address: CIA_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner as Address, SUBSCRIPTION_SINK],
    })
  )
}

/** The $CIA balance as a decimal string, or 'unknown' when every RPC fails. */
export async function getCiaBalance(address: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const value = await readCiaBalance(address, env)
  return value === null ? 'unknown' : formatCia(value)
}

/** The ETH balance on Robinhood Chain, or 'unknown' when every RPC fails. */
export async function getRobinhoodEthBalance(address: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const value = await readRobinhoodEthBalance(address, env)
  return value === null ? 'unknown' : formatEther(value)
}

/** The allowance of the subscription sink, or 'unknown' when every RPC fails. */
export async function getCiaAllowance(owner: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const value = await readCiaAllowance(owner, env)
  return value === null ? 'unknown' : formatCia(value)
}

export interface SentTransaction {
  txHash: Hex
  status: 'success' | 'reverted'
}

export interface DepositTransaction extends SentTransaction {
  /** The sink's Received log of this deposit, or null when it has none. */
  received: { from: string; token: string; amount: bigint } | null
}

/**
 * A transaction is sent once, through the first RPC of the list, and never
 * resent through another: a send that failed half-way may still land.
 */
function writeClients(privateKey: Hex, env: NodeJS.ProcessEnv) {
  const url = robinhoodRpcUrls(env)[0]
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    publicClient: publicClient(url),
    walletClient: createWalletClient({ account, chain: robinhoodChain, transport: http(url) }),
  }
}

/** Approves exactly `amount` $CIA to the subscription sink, never more. */
export async function approveCiaForSubscription(
  privateKey: Hex,
  amount: bigint,
  env: NodeJS.ProcessEnv = process.env
): Promise<SentTransaction> {
  const { publicClient: reader, walletClient } = writeClients(privateKey, env)
  const txHash = await walletClient.writeContract({
    address: CIA_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [SUBSCRIPTION_SINK, amount],
  })
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash })
  return { txHash, status: receipt.status }
}

/** Deposits `amount` $CIA into the subscription sink and reads its Received log. */
export async function depositCiaForSubscription(
  privateKey: Hex,
  amount: bigint,
  env: NodeJS.ProcessEnv = process.env
): Promise<DepositTransaction> {
  const { publicClient: reader, walletClient } = writeClients(privateKey, env)
  const txHash = await walletClient.writeContract({
    address: SUBSCRIPTION_SINK,
    abi: SINK_ABI,
    functionName: 'deposit',
    args: [CIA_TOKEN_ADDRESS, amount],
  })
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash })
  let received: DepositTransaction['received'] = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SUBSCRIPTION_SINK) continue
    try {
      const event = decodeEventLog({ abi: SINK_ABI, data: log.data, topics: log.topics })
      if (event.eventName === 'Received') {
        received = { from: event.args.from, token: event.args.token, amount: event.args.amount }
      }
    } catch {
      // Not the Received event.
    }
  }
  return { txHash, status: receipt.status, received }
}
