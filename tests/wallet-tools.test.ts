import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { privateKeyToAccount } from 'viem/accounts'

const readContractMock = vi.hoisted(() => vi.fn())

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: readContractMock })),
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
    readContractMock.mockResolvedValueOnce(1_234_567n)

    const balance = await getBalanceUsdc('0x0000000000000000000000000000000000000001')

    expect(balance).toBe('1.234567')
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        functionName: 'balanceOf',
        args: ['0x0000000000000000000000000000000000000001'],
      }),
    )
  })

  it('renders operator-friendly balance text', async () => {
    const { formatWalletBalance } = await import('../src/wallet/tools.js')

    expect(formatWalletBalance('0xabc', '2.500000')).toContain('Base USDC: 2.500000')
    expect(formatWalletBalance('0xabc', '2.500000')).toContain('Wallet: 0xabc')
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
