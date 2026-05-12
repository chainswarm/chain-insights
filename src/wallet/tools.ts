import { createPublicClient, formatUnits, http, type Address, type Hex } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { decryptKey } from './index.js'

export const BASE_CHAIN_ID = 8453
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
export const DEFAULT_BASE_RPC_URL = 'https://mainnet.base.org'
export const PUBLIC_BASE_RPC_URLS = [
  DEFAULT_BASE_RPC_URL,
  'https://base-rpc.publicnode.com',
  'https://base.drpc.org',
  'https://1rpc.io/base',
] as const

const USDC_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export interface PaymentWalletAccount {
  address: Address
  privateKey: Hex
}

export interface TopupInfo {
  wallet_address: string
  network: 'Base'
  chain_id: typeof BASE_CHAIN_ID
  token: 'USDC'
  token_contract: typeof USDC_ADDRESS
  topup_url?: string
}

function normalizePrivateKey(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Stored wallet private key is not a valid 0x-prefixed EVM private key')
  }
  return value as Hex
}

export async function getWalletAccount(): Promise<PaymentWalletAccount> {
  const privateKey = normalizePrivateKey(await decryptKey())
  const account = privateKeyToAccount(privateKey)
  return { address: account.address, privateKey }
}

export async function getBalanceUsdc(
  address: Address | string,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<string> {
  const rpcUrls = [
    ...(rpcUrl ? [rpcUrl] : []),
    ...PUBLIC_BASE_RPC_URLS.filter((fallbackUrl) => fallbackUrl !== rpcUrl),
  ]

  for (const url of rpcUrls) {
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(url),
      })
      const balance = await client.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address as Address],
      })
      return formatUnits(balance, 6)
    } catch {
      // Try the next public Base RPC endpoint.
    }
  }

  return 'unknown'
}

export function formatWalletBalance(address: string, balanceUsdc: string): string {
  return [
    `Balance: ${balanceUsdc} USDC`,
    'Network: Base',
    `Address: ${address}`,
  ].filter(Boolean).join('\n')
}

export async function getWalletBalanceText(account?: PaymentWalletAccount): Promise<string> {
  const wallet = account ?? await getWalletAccount()
  const balance = await getBalanceUsdc(wallet.address)
  return formatWalletBalance(wallet.address, balance)
}

export function buildTopupInfo(address: string, topupUrl?: string): TopupInfo {
  return {
    wallet_address: address,
    network: 'Base',
    chain_id: BASE_CHAIN_ID,
    token: 'USDC',
    token_contract: USDC_ADDRESS,
    ...(topupUrl ? { topup_url: topupUrl } : {}),
  }
}
