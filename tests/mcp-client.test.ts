import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockWrappedFetch = vi.hoisted(() => vi.fn(async () => new Response('{}')))
const mockPrepareWalletForPaidCalls = vi.hoisted(() => vi.fn())

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

vi.mock('../src/wallet/tools.js', () => ({
  prepareWalletForPaidCalls: mockPrepareWalletForPaidCalls,
  resolveMaxAutoApprovalUnits: vi.fn(() => 10_000_000n),
  USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  PERMIT2_ADDRESS: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
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
    mockPrepareWalletForPaidCalls.mockResolvedValue({
      readiness: { ready: true },
      approval: { status: 'approved', txHash: '0xapproval' },
    })
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
      schemes: Array<{
        network: string
        client: { _isUptoEvmScheme?: boolean; _isExactEvmScheme?: boolean }
      }>
    }
    expect(config.schemes).toHaveLength(3)
    expect(config.schemes[0]).toMatchObject({
      network: 'eip155:8453',
      client: { _isUptoEvmScheme: true },
    })
    expect(config.schemes[1]).toMatchObject({
      network: 'eip155:8453',
      client: { _isExactEvmScheme: true },
    })
  })

  it('registers the upto/Permit2 scheme for robinhood chain (eip155:4663) too', async () => {
    const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
    const { createMcpFetchClient, ROBINHOOD_NETWORK } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)

    const mockFn = vi.mocked(wrapFetchWithPaymentFromConfig)
    const config = mockFn.mock.calls[0][1] as {
      schemes: Array<{ network: string; client: { _isUptoEvmScheme?: boolean } }>
    }
    expect(ROBINHOOD_NETWORK).toBe('eip155:4663')
    const robinhoodEntry = config.schemes.find((scheme) => scheme.network === ROBINHOOD_NETWORK)
    expect(robinhoodEntry).toMatchObject({
      network: 'eip155:4663',
      client: { _isUptoEvmScheme: true },
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

  it('UptoEvmScheme constructed with the viem account and robinhood chain (4663) RPC options', async () => {
    const { UptoEvmScheme } = await import('@x402/evm/upto/client')
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createMcpFetchClient, ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL } =
      await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    const account = vi.mocked(privateKeyToAccount).mock.results[0].value
    expect(vi.mocked(UptoEvmScheme)).toHaveBeenCalledWith(account, {
      [ROBINHOOD_CHAIN_ID]: { rpcUrl: ROBINHOOD_RPC_URL },
    })
  })

  it('UptoEvmScheme is constructed once and reused for both eip155:8453 and eip155:4663', async () => {
    const { UptoEvmScheme } = await import('@x402/evm/upto/client')
    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    createMcpFetchClient(testKey)
    expect(vi.mocked(UptoEvmScheme)).toHaveBeenCalledTimes(1)
  })

  it('createMcpFetchClient surfaces x402 payment-required errors from final 402 responses', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'invalid_payload',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '2000000',
          },
        ],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      'x402 payment failed: invalid_payload (scheme=upto network=eip155:8453 amount=2000000)'
    )
  })

  it('createMcpFetchClient throws PaymentRequiredError (not generic Error)', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'payment_required',
        accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '300000' }],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )

    const { createMcpFetchClient, PaymentRequiredError } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://mcp.example.test/mcp')).rejects.toBeInstanceOf(
      PaymentRequiredError
    )
  })

  it('createMcpFetchClient includes next-step wallet guidance for generic payment_required', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'payment_required',
        accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '300000' }],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      'chain-insights wallet ready'
    )
  })

  it('createMcpFetchClient prepares the wallet and retries once when approval is missing', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'invalid_exact_evm_permit2_payload_allowance_required: simulation failed',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '2000000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
        ],
      })
    ).toString('base64')
    mockWrappedFetch
      .mockResolvedValueOnce(
        new Response('null', {
          status: 402,
          headers: { 'payment-required': paymentRequired },
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    const response = await client('https://mcp.example.test/mcp')

    expect(response.status).toBe(200)
    expect(mockWrappedFetch).toHaveBeenCalledTimes(2)
    expect(mockPrepareWalletForPaidCalls).toHaveBeenCalledWith({
      account: {
        address: '0xmock',
        privateKey: testKey,
      },
      maxApprovalUnits: 10_000_000n,
      minimumApprovalUnits: 2_000_000n,
    })
  })

  it('createMcpFetchClient explains approval failures with wallet-ready guidance', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'invalid_exact_evm_permit2_payload_allowance_required: simulation failed',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '2000000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
        ],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )
    mockPrepareWalletForPaidCalls.mockRejectedValueOnce(new Error('insufficient Base ETH for gas'))

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      'chain-insights wallet ready'
    )
  })

  it('createMcpFetchClient surfaces a clear Permit2-approval error for non-Base-USDC assets instead of attempting Base-only auto-approval', async () => {
    const choiceAsset = '0x6e30a5f8FC61cd4e8550d2Dd3CDDea2A0196DC69'
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'invalid_upto_evm_permit2_payload_allowance_required: simulation failed',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:4663',
            amount: '102000000000000000',
            asset: choiceAsset,
          },
        ],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )

    const { createMcpFetchClient, PaymentRequiredError } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    // No Base-only auto-approval attempted for this asset/network.
    await expect(client('https://mcp.example.test/mcp')).rejects.toBeInstanceOf(
      PaymentRequiredError
    )
    expect(mockPrepareWalletForPaidCalls).not.toHaveBeenCalled()

    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(choiceAsset)
    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      '0x000000000022D473030F116dDEE9F6B43aC78BA3'
    )
    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      `approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, <amount>)`
    )
  })

  it('createMcpFetchClient explains when the payer wallet matches the MCP payTo address', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'invalid_payload',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '2000000',
            payTo: '0xmock',
          },
        ],
      })
    ).toString('base64')
    mockWrappedFetch.mockResolvedValue(
      new Response('null', {
        status: 402,
        headers: { 'payment-required': paymentRequired },
      })
    )

    const { createMcpFetchClient } = await import('../src/mcp/client.js')
    const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
    const client = createMcpFetchClient(testKey)

    await expect(client('https://mcp.example.test/mcp')).rejects.toThrow(
      'Local payment wallet matches the MCP payTo address'
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
    expect(headers.get('X-MCP-Test-Key')).toBe('debug-secret')
    expect(headers.get('X-Chain-Insights-Test-Key')).toBe('debug-secret')
    expect(headers.get('Authorization')).toBe('Bearer debug-secret')
  })

  it('createMcpAuthFetchClient intercepts 402 with actionable guidance instead of generic transport error', async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'payment_required',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '300000',
          },
        ],
      })
    ).toString('base64')
    const baseFetch = vi.fn(
      async () =>
        new Response('null', {
          status: 402,
          headers: { 'payment-required': paymentRequired },
        })
    )

    const { createMcpAuthFetchClient, PaymentRequiredError } = await import('../src/mcp/client.js')
    const authedFetch = createMcpAuthFetchClient('debug-secret', baseFetch)

    await expect(authedFetch('http://localhost:8011/mcp')).rejects.toBeInstanceOf(
      PaymentRequiredError
    )
    await expect(authedFetch('http://localhost:8011/mcp')).rejects.toThrow(
      'chain-insights wallet ready'
    )
  })

  it('createMcpAuthFetchClient gives guidance even for 402 without x402 header', async () => {
    const baseFetch = vi.fn(async () => new Response('', { status: 402 }))

    const { createMcpAuthFetchClient } = await import('../src/mcp/client.js')
    const authedFetch = createMcpAuthFetchClient('debug-secret', baseFetch)

    await expect(authedFetch('http://localhost:8011/mcp')).rejects.toThrow(
      'chain-insights wallet ready'
    )
  })

  it('resolveGraphMcpEndpoint returns the configured graphMcpEndpoint', async () => {
    const { resolveGraphMcpEndpoint } = await import('../src/mcp/client.js')

    expect(
      resolveGraphMcpEndpoint({
        graphMcpEndpoint: '  http://localhost:8012/mcp  ',
      })
    ).toBe('http://localhost:8012/mcp')
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
        graphMcpAuthToken: 'graph-debug-token',
        graphMcpMode: 'debug',
      })
      await authedFetch('http://localhost:8012/mcp')

      const headers = new Headers(calls[0]?.init?.headers)
      expect(headers.get('X-MCP-Debug-Token')).toBe('graph-debug-token')
      expect(headers.get('X-MCP-Test-Key')).toBe('graph-debug-token')
      expect(headers.get('X-Chain-Insights-Test-Key')).toBe('graph-debug-token')
      expect(headers.get('Authorization')).toBe('Bearer graph-debug-token')
      expect(mockIsWalletConfigured).not.toHaveBeenCalled()
      expect(mockDecryptKey).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('createConfiguredGraphMcpFetch in debug mode errors when no debug token is configured', async () => {
    const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
    await expect(
      createConfiguredGraphMcpFetch({
        graphMcpAuthToken: '',
        graphMcpMode: 'debug',
      })
    ).rejects.toThrow('Chain Insights Graph debug mode requires graphMcpAuthToken')
    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
  })

  it('createConfiguredGraphMcpFetch allows public free calls before wallet setup', async () => {
    mockIsWalletConfigured.mockResolvedValue(false)
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response('{}')
    })
    vi.stubGlobal('fetch', baseFetch)

    try {
      const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
      const graphFetch = await createConfiguredGraphMcpFetch({
        graphMcpAuthToken: '',
        graphMcpMode: 'paid',
      })
      await graphFetch('https://mcp.example.test/mcp')

      expect(calls).toHaveLength(1)
      expect(mockIsWalletConfigured).toHaveBeenCalledOnce()
      expect(mockDecryptKey).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('createConfiguredGraphMcpFetch explains paid fallback without raw wallet config internals', async () => {
    mockIsWalletConfigured.mockResolvedValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            status: 402,
            headers: {
              'payment-required': Buffer.from(
                JSON.stringify({
                  x402Version: 2,
                  error: 'payment_required',
                  accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '1000000' }],
                })
              ).toString('base64'),
            },
          })
      )
    )

    try {
      const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
      const graphFetch = await createConfiguredGraphMcpFetch({
        graphMcpAuthToken: '',
        graphMcpMode: 'paid',
      })

      await expect(graphFetch('https://mcp.example.test/mcp')).rejects.toThrow(
        'chain-insights wallet ready'
      )
      await expect(graphFetch('https://mcp.example.test/mcp')).rejects.toThrow(
        'chain-insights wallet topup'
      )
      await expect(graphFetch('https://mcp.example.test/mcp')).rejects.toThrow(
        'chain-insights access-key set <key>'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('createConfiguredGraphMcpFetch in paid mode ignores debug tokens and uses wallet/x402', async () => {
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue(
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    )

    const { createConfiguredGraphMcpFetch } = await import('../src/mcp/client.js')
    const paymentFetch = await createConfiguredGraphMcpFetch({
      graphMcpAuthToken: 'graph-debug-token',
      graphMcpMode: 'paid',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((paymentFetch as any)._isMockWrapped).toBe(true)
    expect(mockIsWalletConfigured).toHaveBeenCalledOnce()
    expect(mockDecryptKey).toHaveBeenCalledOnce()
  })

  it('reorders 402 accepts by CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE before the payment scheme picks', async () => {
    const prevPreference = process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']
    process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE'] = 'CHOICE,USDC'

    const originalPaymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        error: 'payment_required',
        accepts: [
          {
            scheme: 'upto',
            network: 'eip155:8453',
            amount: '100000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
          {
            scheme: 'upto',
            network: 'eip155:4663',
            amount: '100000',
            asset: '0x5fc5360d0400A0Fd4F2aF552aDd042D716f1D168',
          },
          {
            scheme: 'upto',
            network: 'eip155:4663',
            amount: '102000000000000000',
            asset: '0x6e30a5f8FC61cd4e8550d2Dd3CDDea2A0196DC69',
          },
        ],
      })
    ).toString('base64')
    const rawFetch = vi.fn(
      async () =>
        new Response('null', {
          status: 402,
          headers: { 'payment-required': originalPaymentRequired },
        })
    )
    vi.stubGlobal('fetch', rawFetch)

    try {
      const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
      const { createMcpFetchClient } = await import('../src/mcp/client.js')
      const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
      createMcpFetchClient(testKey)

      // The first arg to wrapFetchWithPaymentFromConfig is the raw transport
      // fetch client.ts wraps with asset-preference reordering; call it
      // directly to observe the reordering independent of the (mocked) x402
      // selection internals.
      const mockFn = vi.mocked(wrapFetchWithPaymentFromConfig)
      const reorderingFetch = mockFn.mock.calls[0][0] as (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => Promise<Response>

      const response = await reorderingFetch('https://mcp.example.test/mcp')
      const reencoded = response.headers.get('payment-required')
      const decoded = JSON.parse(Buffer.from(reencoded ?? '', 'base64').toString('utf8')) as {
        accepts: Array<{ asset: string }>
      }
      expect(decoded.accepts.map((option) => option.asset.toLowerCase())).toEqual([
        '0x6e30a5f8fc61cd4e8550d2dd3cddea2a0196dc69', // CHOICE — first preference
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC — second preference
        '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG — unlisted, kept last
      ])
    } finally {
      vi.unstubAllGlobals()
      if (prevPreference === undefined)
        delete process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']
      else process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE'] = prevPreference
    }
  })

  it('does not wrap fetch for asset-preference reordering when CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE is unset', async () => {
    const prevPreference = process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']
    delete process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']

    try {
      const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
      const { createMcpFetchClient } = await import('../src/mcp/client.js')
      const testKey = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const
      createMcpFetchClient(testKey)

      const mockFn = vi.mocked(wrapFetchWithPaymentFromConfig)
      const passedFetch = mockFn.mock.calls[0][0]
      // Preference unset skips reorder, but a loaded wallet still wraps
      // fetch to attach X-CIA-Wallet-Proof.
      expect(passedFetch).not.toBe(fetch)
      expect(typeof passedFetch).toBe('function')
    } finally {
      if (prevPreference === undefined)
        delete process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE']
      else process.env['CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE'] = prevPreference
    }
  })
})
