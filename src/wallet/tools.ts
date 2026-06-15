import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseUnits, type Address, type Hex } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { decryptKey, normalizeWalletPrivateKey } from './index.js'

export const BASE_CHAIN_ID = 8453
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const
export const DEFAULT_BASE_RPC_URL = 'https://mainnet.base.org'
export const DEFAULT_PAYMENT_APPROVAL_UNITS = 1_000_000n
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

export interface WalletReadiness {
  address: Address
  balanceUsdc: string
  balanceEth: string
  paymentApprovalUsdc: string
  paymentApprovalUnits: bigint
  minimumApprovalUnits: bigint
  hasUsdc: boolean | null
  hasGas: boolean | null
  hasPaymentApproval: boolean
  needsPaymentApproval: boolean
  ready: boolean
  nextSteps: string[]
}

export interface PaymentApprovalResult {
  status: 'already_ready' | 'approved'
  txHash?: Hex
  paymentApprovalUnits: bigint
  minimumApprovalUnits: bigint
}

export interface PrepareWalletResult {
  readiness: WalletReadiness
  approval?: PaymentApprovalResult
}

export interface PrepareWalletOptions {
  account?: PaymentWalletAccount
  minimumApprovalUnits?: bigint
  approve?: boolean
  rpcUrl?: string
}

export interface WalletBalanceFacts {
  address: Address
  payment_network: 'base'
  payment_network_display: 'Base'
  chain_id: typeof BASE_CHAIN_ID
  token: 'USDC'
  token_balance: string
  gas_token: 'ETH'
  gas_balance?: string
}

export interface WalletBalanceResult {
  schema: 'chain-insights.result.v1'
  tool: 'wallet_balance'
  hint: null
  facts: {
    wallet: WalletBalanceFacts
  }
}

export async function getWalletAccount(): Promise<PaymentWalletAccount> {
  const privateKey = normalizeWalletPrivateKey(await decryptKey()) as Hex
  const account = privateKeyToAccount(privateKey)
  return { address: account.address, privateKey }
}

function baseRpcUrls(rpcUrl = process.env['BASE_RPC_URL']): string[] {
  return [
    ...(rpcUrl ? [rpcUrl] : []),
    ...PUBLIC_BASE_RPC_URLS.filter((fallbackUrl) => fallbackUrl !== rpcUrl),
  ]
}

export async function getBalanceUsdc(
  address: Address | string,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<string> {
  for (const url of baseRpcUrls(rpcUrl)) {
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

export async function getBalanceEth(
  address: Address | string,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<string> {
  for (const url of baseRpcUrls(rpcUrl)) {
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(url),
      })
      const balance = await client.getBalance({ address: address as Address })
      return formatEther(balance)
    } catch {
      // Try the next public Base RPC endpoint.
    }
  }

  return 'unknown'
}

export async function getPaymentApprovalUnits(
  address: Address | string,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<bigint | null> {
  for (const url of baseRpcUrls(rpcUrl)) {
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(url),
      })
      return await client.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'allowance',
        args: [address as Address, PERMIT2_ADDRESS],
      })
    } catch {
      // Try the next public Base RPC endpoint.
    }
  }

  return null
}

export async function getPaymentApprovalUsdc(
  address: Address | string,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<string> {
  const allowance = await getPaymentApprovalUnits(address, rpcUrl)
  return allowance === null ? 'unknown' : formatUnits(allowance, 6)
}

export function parsePaymentApprovalUnits(amountUsdc: string): bigint {
  const trimmed = amountUsdc.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed) || !isPositiveDecimal(trimmed)) {
    throw new Error('Payment setup amount must be a positive USDC value with up to 6 decimals.')
  }
  return parseUnits(trimmed, 6)
}

function isPositiveDecimal(value: string): boolean {
  if (value === 'unknown') return false
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0
}

function decimalStatus(value: string): boolean | null {
  return value === 'unknown' ? null : isPositiveDecimal(value)
}

function readinessNextSteps(readiness: Pick<WalletReadiness, 'hasUsdc' | 'hasGas' | 'needsPaymentApproval'>): string[] {
  const nextSteps: string[] = []
  if (readiness.hasUsdc === false) {
    nextSteps.push('Run `chain-insights wallet topup` and send USDC on Base to this wallet.')
  }
  if (readiness.hasUsdc === null) {
    nextSteps.push('Base USDC balance could not be confirmed; retry or set BASE_RPC_URL to a working Base RPC endpoint.')
  }
  if (readiness.needsPaymentApproval && readiness.hasGas === false) {
    nextSteps.push('Add a small amount of ETH on Base for the one-time payment setup gas.')
  }
  if (readiness.needsPaymentApproval && readiness.hasGas !== false) {
    nextSteps.push('Run `chain-insights wallet ready` to finish the one-time payment setup.')
  }
  if (readiness.hasGas === null) {
    nextSteps.push('Base ETH gas balance could not be confirmed; retry or set BASE_RPC_URL to a working Base RPC endpoint.')
  }
  return nextSteps
}

function buildWalletReadiness(params: {
  address: Address
  balanceUsdc: string
  balanceEth: string
  paymentApprovalUnits: bigint | null
  minimumApprovalUnits: bigint
}): WalletReadiness {
  const paymentApprovalUnits = params.paymentApprovalUnits ?? 0n
  const hasUsdc = decimalStatus(params.balanceUsdc)
  const hasGas = decimalStatus(params.balanceEth)
  const hasPaymentApproval = paymentApprovalUnits >= params.minimumApprovalUnits
  const needsPaymentApproval = !hasPaymentApproval
  const ready = hasUsdc !== false && hasPaymentApproval
  const readiness = {
    address: params.address,
    balanceUsdc: params.balanceUsdc,
    balanceEth: params.balanceEth,
    paymentApprovalUsdc: params.paymentApprovalUnits === null ? 'unknown' : formatUnits(paymentApprovalUnits, 6),
    paymentApprovalUnits,
    minimumApprovalUnits: params.minimumApprovalUnits,
    hasUsdc,
    hasGas,
    hasPaymentApproval,
    needsPaymentApproval,
    ready,
    nextSteps: [],
  }
  return {
    ...readiness,
    nextSteps: readinessNextSteps(readiness),
  }
}

export async function getWalletReadiness(
  account?: PaymentWalletAccount,
  minimumApprovalUnits = DEFAULT_PAYMENT_APPROVAL_UNITS,
): Promise<WalletReadiness> {
  const wallet = account ?? await getWalletAccount()
  const [balanceUsdc, balanceEth, paymentApprovalUnits] = await Promise.all([
    getBalanceUsdc(wallet.address),
    getBalanceEth(wallet.address),
    getPaymentApprovalUnits(wallet.address),
  ])
  return buildWalletReadiness({
    address: wallet.address,
    balanceUsdc,
    balanceEth,
    paymentApprovalUnits,
    minimumApprovalUnits,
  })
}

export function formatWalletReadiness(readiness: WalletReadiness, approval?: PaymentApprovalResult): string {
  const status = readiness.ready ? 'Ready for paid Chain Insights Graph calls' : 'Action needed before paid Chain Insights Graph calls'
  const setup = readiness.needsPaymentApproval
    ? `Payment setup: needs one-time setup for up to ${formatUnits(readiness.minimumApprovalUnits, 6)} USDC of paid calls`
    : 'Payment setup: ready'
  const setupCompletedLine = approval?.status === 'approved'
    ? 'Payment setup completed.'
    : undefined
  return [
    status,
    `Balance: ${readiness.balanceUsdc} USDC`,
    `Gas: ${readiness.balanceEth} ETH on Base`,
    setup,
    setupCompletedLine,
    'Payment network: Base',
    `Address: ${readiness.address}`,
    ...readiness.nextSteps.map((step) => `Next: ${step}`),
  ].filter(Boolean).join('\n')
}

export async function approvePaymentAllowance(
  account?: PaymentWalletAccount,
  minimumApprovalUnits = DEFAULT_PAYMENT_APPROVAL_UNITS,
  rpcUrl = process.env['BASE_RPC_URL'],
): Promise<PaymentApprovalResult> {
  const wallet = account ?? await getWalletAccount()
  const initialApprovalUnits = await getPaymentApprovalUnits(wallet.address, rpcUrl)
  if (initialApprovalUnits !== null && initialApprovalUnits >= minimumApprovalUnits) {
    return {
      status: 'already_ready',
      paymentApprovalUnits: initialApprovalUnits,
      minimumApprovalUnits,
    }
  }

  const clientAccount = privateKeyToAccount(wallet.privateKey)
  for (const url of baseRpcUrls(rpcUrl)) {
    try {
      const publicClient = createPublicClient({ chain: base, transport: http(url) })
      const walletClient = createWalletClient({
        account: clientAccount,
        chain: base,
        transport: http(url),
      })
      const txHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, minimumApprovalUnits],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status === 'reverted') {
        throw new Error(`Payment setup transaction reverted: ${txHash}`)
      }
      const paymentApprovalUnits = await getPaymentApprovalUnits(wallet.address, url)
      return {
        status: 'approved',
        txHash,
        paymentApprovalUnits: paymentApprovalUnits ?? minimumApprovalUnits,
        minimumApprovalUnits,
      }
    } catch (err) {
      if (url === baseRpcUrls(rpcUrl).at(-1)) throw err
    }
  }

  throw new Error('Unable to submit payment setup transaction on Base.')
}

export async function prepareWalletForPaidCalls(options: PrepareWalletOptions = {}): Promise<PrepareWalletResult> {
  const minimumApprovalUnits = options.minimumApprovalUnits ?? DEFAULT_PAYMENT_APPROVAL_UNITS
  const wallet = options.account ?? await getWalletAccount()
  const readiness = await getWalletReadiness(wallet, minimumApprovalUnits)

  if (!readiness.needsPaymentApproval) {
    return {
      readiness,
      approval: {
        status: 'already_ready',
        paymentApprovalUnits: readiness.paymentApprovalUnits,
        minimumApprovalUnits,
      },
    }
  }
  if (options.approve === false || readiness.hasGas === false) {
    return { readiness }
  }

  const approval = await approvePaymentAllowance(wallet, minimumApprovalUnits, options.rpcUrl)
  const updatedReadiness = buildWalletReadiness({
    address: wallet.address,
    balanceUsdc: readiness.balanceUsdc,
    balanceEth: readiness.balanceEth,
    paymentApprovalUnits: approval.paymentApprovalUnits,
    minimumApprovalUnits,
  })
  return { readiness: updatedReadiness, approval }
}

export function formatWalletBalance(address: string, balanceUsdc: string, balanceEth?: string): string {
  return [
    `Payment wallet: ${address}`,
    `USDC on Base: ${balanceUsdc}`,
    balanceEth === undefined ? undefined : `Gas on Base: ${balanceEth} ETH`,
    'Payment network: Base',
    'Base ETH is used only for one-time payment setup gas.',
  ].filter(Boolean).join('\n')
}

export async function getWalletBalanceResult(account?: PaymentWalletAccount): Promise<WalletBalanceResult> {
  const wallet = account ?? await getWalletAccount()
  const [balanceUsdc, balanceEth] = await Promise.all([
    getBalanceUsdc(wallet.address),
    getBalanceEth(wallet.address),
  ])
  return {
    schema: 'chain-insights.result.v1',
    tool: 'wallet_balance',
    hint: null,
    facts: {
      wallet: {
        address: wallet.address,
        payment_network: 'base',
        payment_network_display: 'Base',
        chain_id: BASE_CHAIN_ID,
        token: 'USDC',
        token_balance: balanceUsdc,
        gas_token: 'ETH',
        ...(balanceEth === undefined ? {} : { gas_balance: balanceEth }),
      },
    },
  }
}

export function formatWalletBalanceResult(result: WalletBalanceResult): string {
  const wallet = result.facts.wallet
  return formatWalletBalance(wallet.address, wallet.token_balance, wallet.gas_balance)
}

export async function getWalletBalanceText(account?: PaymentWalletAccount): Promise<string> {
  return formatWalletBalanceResult(await getWalletBalanceResult(account))
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
