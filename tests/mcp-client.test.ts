import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@x402/fetch', () => ({
  wrapFetchWithPaymentFromConfig: vi.fn((fetch, config) => {
    // Return a tagged mock fetch to verify it was called with right args
    return Object.assign(vi.fn(), { _config: config, _isMockWrapped: true })
  }),
}))

vi.mock('@x402/evm', () => ({
  ExactEvmScheme: vi.fn(function (account) {
    return { account, _isExactEvmScheme: true }
  }),
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn((key) => ({ address: '0xmock', key })),
}))

const mockIsWalletConfigured = vi.hoisted(() => vi.fn())
const mockDecryptKey = vi.hoisted(() => vi.fn())
vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: mockIsWalletConfigured,
  decryptKey: mockDecryptKey,
}))

describe('MCP client (02-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('createMcpAuthFetchClient injects debug bypass and bearer headers', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response('{}')
    })

    const { createMcpAuthFetchClient } = await import('../src/mcp/client.js')
    const authedFetch = createMcpAuthFetchClient('debug-secret', baseFetch)

    await authedFetch('http://localhost:8011/mcp', {
      headers: { Accept: 'application/json' },
    })

    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('X-MCP-Debug-Token')).toBe('debug-secret')
    expect(headers.get('Authorization')).toBe('Bearer debug-secret')
  })

  it('resolveGraphMcpEndpoint prefers graphMcpEndpoint over legacy mcpEndpoint', async () => {
    const { resolveGraphMcpEndpoint } = await import('../src/mcp/client.js')

    expect(resolveGraphMcpEndpoint({
      mcpEndpoint: 'http://localhost:8011/mcp',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
    })).toBe('http://localhost:8012/mcp')
  })

  it('createConfiguredMcpFetch uses legacy mcpAuthToken even when graph token is present', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response('{}')
    })
    vi.stubGlobal('fetch', baseFetch)

    try {
      const { createConfiguredMcpFetch } = await import('../src/mcp/client.js')
      const config = {
        mcpAuthToken: 'legacy-debug-token',
        graphMcpAuthToken: 'graph-debug-token',
      }
      const authedFetch = await createConfiguredMcpFetch(config)
      await authedFetch('http://localhost:8011/mcp')

      const headers = new Headers(calls[0]?.init?.headers)
      expect(headers.get('X-MCP-Debug-Token')).toBe('legacy-debug-token')
      expect(headers.get('Authorization')).toBe('Bearer legacy-debug-token')
      expect(mockIsWalletConfigured).not.toHaveBeenCalled()
      expect(mockDecryptKey).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('createConfiguredGraphMcpFetch prefers graphMcpAuthToken over legacy mcpAuthToken', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response('{}')
    })
    vi.stubGlobal('fetch', baseFetch)

    try {
      const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
      const authedFetch = await createConfiguredGraphMcpFetch({
        mcpAuthToken: 'legacy-debug-token',
        graphMcpAuthToken: 'graph-debug-token',
      })
      await authedFetch('http://localhost:8012/mcp')

      const headers = new Headers(calls[0]?.init?.headers)
      expect(headers.get('X-MCP-Debug-Token')).toBe('graph-debug-token')
      expect(headers.get('Authorization')).toBe('Bearer graph-debug-token')
      expect(mockIsWalletConfigured).not.toHaveBeenCalled()
      expect(mockDecryptKey).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
