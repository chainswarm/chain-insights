import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { privateKeyToAccount } from 'viem/accounts'

const readContractMock = vi.hoisted(() => vi.fn())
const getBalanceMock = vi.hoisted(() => vi.fn())

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: readContractMock, getBalance: getBalanceMock })),
    http: vi.fn((url: string) => ({ url })),
  }
})

describe('wallet tools', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
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

    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Balance: 2.500000 USDC')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Gas: 0.0001 ETH on Base')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Base ETH is required for one-time USDC Permit2 approval gas.')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).toContain('Address: 0xabc')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('Capacity:')
    expect(formatWalletBalance('0xabc', '2.500000', '0.0001')).not.toContain('tool calls')
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
