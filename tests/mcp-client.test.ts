import { describe, it, expect, vi } from 'vitest'

vi.mock('@x402/fetch', () => ({
  wrapFetchWithPaymentFromConfig: vi.fn((fetch, config) => {
    // Return a tagged mock fetch to verify it was called with right args
    return Object.assign(vi.fn(), { _config: config, _isMockWrapped: true })
  }),
}))

vi.mock('@x402/evm', () => ({
  ExactEvmScheme: vi.fn().mockImplementation((account) => ({ account, _isExactEvmScheme: true })),
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn((key) => ({ address: '0xmock', key })),
}))

describe('MCP client (02-01)', () => {
  it('createMcpFetchClient returns a function', async () => {
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)
    expect(typeof client).toBe('function')
  })

  it('returned function has _isMockWrapped: true (wrapFetchWithPaymentFromConfig called)', async () => {
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)._isMockWrapped).toBe(true)
  })

  it('wrapFetchWithPaymentFromConfig called with network eip155:8453', async () => {
    const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    const mockFn = vi.mocked(wrapFetchWithPaymentFromConfig)
    expect(mockFn).toHaveBeenCalled()
    const callArgs = mockFn.mock.calls[0]
    // Second argument is the config object with schemes
    const config = callArgs[1] as { schemes: Array<{ network: string }> }
    expect(config.schemes[0].network).toBe('eip155:8453')
  })

  it('ExactEvmScheme constructed with the viem account from privateKeyToAccount', async () => {
    const { ExactEvmScheme } = await import('@x402/evm')
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    const account = vi.mocked(privateKeyToAccount).mock.results[0].value
    expect(vi.mocked(ExactEvmScheme)).toHaveBeenCalledWith(account)
  })

  it('privateKeyToAccount called with the provided private key', async () => {
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    expect(vi.mocked(privateKeyToAccount)).toHaveBeenCalledWith(testKey)
  })
})
