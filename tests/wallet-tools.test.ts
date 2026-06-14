import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { privateKeyToAccount } from 'viem/accounts'

const readContractMock = vi.hoisted(() => vi.fn())
const getBalanceMock = vi.hoisted(() => vi.fn())
const writeContractMock = vi.hoisted(() => vi.fn())
const waitForTransactionReceiptMock = vi.hoisted(() => vi.fn())

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: readContractMock,
      getBalance: getBalanceMock,
      waitForTransactionReceipt: waitForTransactionReceiptMock,
    })),
    createWalletClient: vi.fn(() => ({ writeContract: writeContractMock })),
    http: vi.fn((url: string) => ({ url })),
  }
})

describe('wallet tools', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    waitForTransactionReceiptMock.mockResolvedValue({ status: 'success' })
    writeContractMock.mockResolvedValue('0xapproval')
    fakeHome = join(tmpdir(), `ci-wallet-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('derives the local payment wallet address from the encrypted private key', async () => {
    const { encryptKey } = await import('../src/wallet/index.js')
    const { getWalletAccount } = await import('../src/wallet/tools.js')
    const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

    await encryptKey(privateKey)

    const account = await getWalletAccount()

    expect(account.privateKey).toBe(privateKey)
    expect(account.address).toBe(privateKeyToAccount(privateKey).address)
  })

  it('reads and formats the Base USDC balance', async () => {
    const { getBalanceUsdc } = await import('../src/wallet/tools.js')
    const { http } = await import('viem')
    readContractMock.mockResolvedValueOnce(1_234_567n)

    const balance = await getBalanceUsdc('0x0000000000000000000000000000000000000001')

    expect(balance).toBe('1.234567')
    expect(http).toHaveBeenCalledWith('https://mainnet.base.org')
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        functionName: 'balanceOf',
        args: ['0x0000000000000000000000000000000000000001'],
      }),
    )
  })

  it('reads and formats the Base ETH balance for gas', async () => {
    const { getBalanceEth } = await import('../src/wallet/tools.js')
    getBalanceMock.mockResolvedValueOnce(100_000_000_000_000n)

    const balance = await getBalanceEth('0x0000000000000000000000000000000000000001')

    expect(balance).toBe('0.0001')
    expect(getBalanceMock).toHaveBeenCalledWith({
      address: '0x0000000000000000000000000000000000000001',
    })
  })

  it('falls back across public Base RPC endpoints before returning unknown', async () => {
    const { getBalanceUsdc } = await import('../src/wallet/tools.js')
    const { http } = await import('viem')
    readContractMock
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce(2_000_000n)

    const balance = await getBalanceUsdc('0x0000000000000000000000000000000000000001')

    expect(balance).toBe('2')
    expect(http).toHaveBeenNthCalledWith(1, 'https://mainnet.base.org')
    expect(http).toHaveBeenNthCalledWith(2, 'https://base-rpc.publicnode.com')
  })

  it('renders operator-friendly balance text', async () => {
    const { formatWalletBalance } = await import('../src/wallet/tools.js')

    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Payment wallet: 0xabc')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('USDC on Base: 2.500000')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Gas on Base: 0.0001 ETH')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Payment network: Base')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Base ETH is used only for one-time payment setup gas.')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('Network: Base')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('Permit2')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('approval')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('Capacity:')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('tool calls')
  })

  it('builds structured wallet balance facts', async () => {
    const { formatWalletBalanceResult, getWalletBalanceResult } = await import('../src/wallet/tools.js')
    readContractMock.mockResolvedValueOnce(2_500_000n)
    getBalanceMock.mockResolvedValueOnce(100_000_000_000_000n)

    const result = await getWalletBalanceResult({
      address: '0x0000000000000000000000000000000000000001',
      privateKey: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })

    expect(result).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'wallet_balance',
      hint: null,
      facts: {
        wallet: {
          address: '0x0000000000000000000000000000000000000001',
          payment_network: 'base',
          payment_network_display: 'Base',
          chain_id: 8453,
          token: 'USDC',
          token_balance: '2.5',
          gas_token: 'ETH',
          gas_balance: '0.0001',
        },
      },
    })
    expect(formatWalletBalanceResult(result)).toContain('Payment network: Base')
  })

  it('reads and formats the Base USDC payment approval allowance', async () => {
    const { getPaymentApprovalUsdc } = await import('../src/wallet/tools.js')
    readContractMock.mockResolvedValueOnce(1_000_000n)

    const approval = await getPaymentApprovalUsdc('0x0000000000000000000000000000000000000001')

    expect(approval).toBe('1')
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        functionName: 'allowance',
        args: [
          '0x0000000000000000000000000000000000000001',
          '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        ],
      }),
    )
  })

  it('prepares the wallet by sending one capped payment approval when needed', async () => {
    const { prepareWalletForPaidCalls } = await import('../src/wallet/tools.js')
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
    }
    readContractMock
      .mockResolvedValueOnce(2_000_000n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1_000_000n)
    getBalanceMock.mockResolvedValueOnce(100_000_000_000_000n)

    const result = await prepareWalletForPaidCalls({ account })

    expect(result.approval).toMatchObject({ status: 'approved', txHash: '0xapproval' })
    expect(result.readiness.ready).toBe(true)
    expect(writeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        functionName: 'approve',
        args: ['0x000000000022D473030F116dDEE9F6B43aC78BA3', 1_000_000n],
      }),
    )
  })

  it('renders wallet readiness without exposing payment approval mechanics', async () => {
    const { formatWalletReadiness } = await import('../src/wallet/tools.js')

    const text = formatWalletReadiness({
      address: '0x0000000000000000000000000000000000000001',
      balanceUsdc: '2',
      balanceEth: '0.0001',
      paymentApprovalUsdc: '1',
      paymentApprovalUnits: 1_000_000n,
      minimumApprovalUnits: 1_000_000n,
      hasUsdc: true,
      hasGas: true,
      hasPaymentApproval: true,
      needsPaymentApproval: false,
      ready: true,
      nextSteps: [],
    }, { status: 'approved', txHash: '0xapproval', paymentApprovalUnits: 1_000_000n, minimumApprovalUnits: 1_000_000n })

    expect(text).toContain('Ready for paid GraphRAG MCP calls')
    expect(text).toContain('Payment setup: ready')
    expect(text).not.toContain('Permit2')
    expect(text).not.toContain('approval')
    expect(text).not.toContain('0xapproval')
    expect(text).not.toContain('transaction')
  })

  it('renders action-needed wallet readiness as one-time setup', async () => {
    const { formatWalletReadiness } = await import('../src/wallet/tools.js')

    const text = formatWalletReadiness({
      address: '0x0000000000000000000000000000000000000001',
      balanceUsdc: '0.99',
      balanceEth: '0.0001',
      paymentApprovalUsdc: '0.99',
      paymentApprovalUnits: 990_000n,
      minimumApprovalUnits: 1_000_000n,
      hasUsdc: true,
      hasGas: true,
      hasPaymentApproval: false,
      needsPaymentApproval: true,
      ready: false,
      nextSteps: ['Run `chain-insights wallet ready` to finish the one-time payment setup.'],
    })

    expect(text).toContain('Action needed before paid GraphRAG MCP calls')
    expect(text).toContain('Payment setup: needs one-time setup')
    expect(text).not.toContain('Permit2')
    expect(text).not.toContain('approval')
    expect(text).not.toContain('0.99 / 1')
  })

  it('builds top-up metadata for MCP and CLI output', async () => {
    const { buildTopupInfo } = await import('../src/wallet/tools.js')

    const info = buildTopupInfo('0xabc', 'http://127.0.0.1:4500')

    expect(info).toEqual(
      expect.objectContaining({
        wallet_address: '0xabc',
        network: 'Base',
        token: 'USDC',
        topup_url: 'http://127.0.0.1:4500',
      }),
    )
  })
})
