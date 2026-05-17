import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockWrappedFetch = vi.hoisted(() => vi.fn(async () => new Response('{}')))

vi.mock('@x402/fetch', () => ({
  wrapFetchWithPaymentFromConfig: vi.fn((fetch, config) => {
    // Return a tagged mock fetch to verify it was called with right args
    return Object.assign(mockWrappedFetch, { _config: config, _isMockWrapped: true })
  }),
}))

vi.mock('@x402/evm', () => ({
  ExactEvmScheme: vi.fn(function (account) {
    return { account, _isExactEvmScheme: true }
  }),
}))

vi.mock('@x402/evm/upto/client', () => ({
  UptoEvmScheme: vi.fn(function (account) {
    return { account, _isUptoEvmScheme: true }
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
    mockWrappedFetch.mockResolvedValue(new Response('{}'))
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

  it('registers upto before exact so dynamic x402 pricing is supported', async () => {
    const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)

    const mockFn = vi.mocked(wrapFetchWithPaymentFromConfig)
    const config = mockFn.mock.calls[0][1] as {
      schemes: Array<{ network: string; client: { _isUptoEvmScheme?: boolean; _isExactEvmScheme?: boolean } }>
    }
    expect(config.schemes).toHaveLength(2)
    expect(config.schemes[0]).toMatchObject({
      network: 'eip155:8453',
      client: { _isUptoEvmScheme: true },
    })
    expect(config.schemes[1]).toMatchObject({
      network: 'eip155:8453',
      client: { _isExactEvmScheme: true },
    })
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

  it('UptoEvmScheme constructed with the viem account from privateKeyToAccount', async () => {
    const { UptoEvmScheme } = await import('@x402/evm/upto/client')
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    const account = vi.mocked(privateKeyToAccount).mock.results[0].value
    expect(vi.mocked(UptoEvmScheme)).toHaveBeenCalledWith(account)
  })

  it('createMcpFetchClient surfaces x402 payment-required errors from final 402 responses', async () => {
    const paymentRequired = Buffer.from(JSON.stringify({
      x402Version: 2,
      error: 'invalid_payload',
      accepts: [{
        scheme: 'upto',
        network: 'eip155:8453',
        amount: '2000000',
      }],
    })).toString('base64')
    mockWrappedFetch.mockResolvedValue(new Response('null', {
      status: 402,
      headers: { 'payment-required': paymentRequired },
    }))

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://staging-mcp.chain-insights.ai/mcp')).rejects.toThrow(
      'x402 payment failed: invalid_payload',
    )
  })

  it('createMcpFetchClient explains when the payer wallet matches the MCP payTo address', async () => {
    const paymentRequired = Buffer.from(JSON.stringify({
      x402Version: 2,
      error: 'invalid_payload',
      accepts: [{
        scheme: 'upto',
        network: 'eip155:8453',
        amount: '2000000',
        payTo: '0xmock',
      }],
    })).toString('base64')
    mockWrappedFetch.mockResolvedValue(new Response('null', {
      status: 402,
      headers: { 'payment-required': paymentRequired },
    }))

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://staging-mcp.chain-insights.ai/mcp')).rejects.toThrow(
      'Local payment wallet matches the MCP payTo address',
    )
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

  it('createConfiguredGraphMcpFetch in debug mode requires and uses graphMcpAuthToken without wallet', async () => {
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
        graphMcpMode: 'debug',
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

  it('createConfiguredGraphMcpFetch in debug mode errors when no debug token is configured', async () => {
    const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
    await expect(createConfiguredGraphMcpFetch({
      mcpAuthToken: '',
      graphMcpAuthToken: '',
      graphMcpMode: 'debug',
    })).rejects.toThrow('Graph MCP debug mode requires graphMcpAuthToken')
    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
  })

  it('createConfiguredGraphMcpFetch in paid mode ignores debug tokens and uses wallet/x402', async () => {
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

    const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
    const paymentFetch = await createConfiguredGraphMcpFetch({
      mcpAuthToken: 'legacy-debug-token',
      graphMcpAuthToken: 'graph-debug-token',
      graphMcpMode: 'paid',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((paymentFetch as any)._isMockWrapped).toBe(true)
    expect(mockIsWalletConfigured).toHaveBeenCalledOnce()
    expect(mockDecryptKey).toHaveBeenCalledOnce()
  })
})
