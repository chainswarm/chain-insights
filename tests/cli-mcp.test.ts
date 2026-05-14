/**
 * Tests for the CLI `mcp` subcommand group and the `config set walletPrivateKey` interceptor.
 *
 * Strategy: mock all I/O modules (wallet, schema-cache, mcp/client, MCP SDK) and invoke
 * the action handlers directly via vitest. Commander parsing tested via the existing cli.test.ts.
 *
 * These tests import src/cli.ts indirectly — they exercise the action handler logic by
 * calling the underlying module functions with mocks injected via vi.mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock schema-cache
const mockLoadSchema = vi.fn()
const mockSaveSchema = vi.fn()
vi.mock('../src/mcp/schema-cache.js', () => ({
  loadSchema: mockLoadSchema,
  saveSchema: mockSaveSchema,
}))

// Mock format
const mockFormatToolsTable = vi.fn()
vi.mock('../src/mcp/format.js', () => ({
  formatToolsTable: mockFormatToolsTable,
}))

// Mock wallet
const mockIsWalletConfigured = vi.fn()
const mockDecryptKey = vi.fn()
const mockEncryptKey = vi.fn()
vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: mockIsWalletConfigured,
  decryptKey: mockDecryptKey,
  encryptKey: mockEncryptKey,
}))

// Mock config
const mockLoadConfig = vi.fn()
const mockSaveConfig = vi.fn()
vi.mock('../src/config/index.js', () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  resetConfigCache: vi.fn(),
}))

// Mock mcp/client
const mockCreateMcpFetchClient = vi.fn()
const mockCreateConfiguredMcpFetch = vi.fn()
const mockCreateConfiguredGraphMcpFetch = vi.fn()
vi.mock('../src/mcp/client.js', () => ({
  createMcpFetchClient: mockCreateMcpFetchClient,
  createConfiguredMcpFetch: mockCreateConfiguredMcpFetch,
  createConfiguredGraphMcpFetch: mockCreateConfiguredGraphMcpFetch,
  resolveGraphMcpEndpoint: vi.fn((config: { graphMcpEndpoint?: string; mcpEndpoint: string }) => (
    config.graphMcpEndpoint?.trim() || config.mcpEndpoint
  )),
}))

// Mock MCP SDK Client
const mockClientConnect = vi.fn()
const mockClientListTools = vi.fn()
const mockClientCallTool = vi.fn()
const mockClientClose = vi.fn()
const MockClient = vi.fn(function (this: Record<string, unknown>) {
  this.connect = mockClientConnect
  this.listTools = mockClientListTools
  this.callTool = mockClientCallTool
  this.close = mockClientClose
})
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

// Mock StreamableHTTPClientTransport
const MockStreamableHTTPClientTransport = vi.fn(function () {
  // transport object
})
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the `mcp tools` action handler logic extracted from cli.ts.
 * This mirrors what the actual Commander action handler does.
 */
async function runMcpToolsAction(opts: { refresh?: boolean } = {}): Promise<void> {
  const { loadSchema, saveSchema } = await import('../src/mcp/schema-cache.js')
  const { formatToolsTable } = await import('../src/mcp/format.js')
  const { loadConfig } = await import('../src/config/index.js')
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('../src/mcp/client.js')
  const config = await loadConfig()
  const graphMcpEndpoint = resolveGraphMcpEndpoint(config)
  let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint)
  if (!tools) {
    const paymentFetch = await createConfiguredGraphMcpFetch(config)
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'chain-insights-cli', version: '0.1.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: paymentFetch }))
    const result = await client.listTools()
    tools = result.tools as Array<{ name: string; description?: string }>
    await saveSchema(tools, graphMcpEndpoint)
    await client.close()
  }
  console.log(formatToolsTable(tools))
}

/**
 * Simulate the `mcp call` action handler logic extracted from cli.ts.
 */
async function runMcpCallAction(tool: string, rawArgs: string[]): Promise<void> {
  let args: Record<string, unknown>
  try {
    const { parseMcpCallArgs } = await import('../src/mcp/call-args.js')
    args = parseMcpCallArgs(rawArgs)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
  const { loadConfig } = await import('../src/config/index.js')
  const config = await loadConfig()
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('../src/mcp/client.js')
  const paymentFetch = await createConfiguredGraphMcpFetch(config)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name: 'chain-insights-cli-call', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), { fetch: paymentFetch }))
  const result = await client.callTool({ name: tool, arguments: args })
  const content = result.content as Array<{ type: string; text?: string }>
  for (const item of content) {
    if (item.type === 'text') console.log(item.text)
  }
  await client.close()
}

/**
 * Simulate the `config set` action handler logic for the walletPrivateKey interceptor.
 */
async function runConfigSetAction(key: string, value: string): Promise<void> {
  if (key === 'walletPrivateKey') {
    try {
      const { encryptKey } = await import('../src/wallet/index.js')
      await encryptKey(value)
      console.log('Wallet private key encrypted and stored in ~/.chain-insights/wallet.json')
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
    return
  }
  const { loadConfig, saveConfig } = await import('../src/config/index.js')
  const { CONFIG_KEYS, DEFAULT_CONFIG } = await import('../src/config/schema.js')
  const current = await loadConfig()
  if (!CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
    console.error(`Unknown config key: ${key}`)
    process.exit(1)
  }
  const existing = (current as Record<string, unknown>)[key]
  const defaultValue = (DEFAULT_CONFIG as Record<string, unknown>)[key]
  const coerced = typeof existing === 'number' || typeof defaultValue === 'number' ? Number(value) : value
  await saveConfig({ [key]: coerced } as Parameters<typeof saveConfig>[0])
  const displayed = key.toLowerCase().includes('token') ? '[redacted]' : coerced
  console.log(`Set ${key} = ${displayed}`)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CLI mcp subcommand (MCP-02)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadConfig.mockResolvedValue({ mcpEndpoint: 'http://localhost:4000' })
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── mcp tools — cache hit ─────────────────────────────────────────────────

  it('mcp tools — cache hit: formatToolsTable called with cached tools, no network', async () => {
    const cachedTools = [{ name: 'wallet-risk', description: 'Score wallet risk' }]
    mockLoadSchema.mockResolvedValue(cachedTools)
    mockFormatToolsTable.mockReturnValue('wallet-risk  Score wallet risk')

    await runMcpToolsAction()

    expect(mockLoadSchema).toHaveBeenCalledOnce()
    expect(mockLoadSchema).toHaveBeenCalledWith('http://localhost:4000')
    expect(mockFormatToolsTable).toHaveBeenCalledWith(cachedTools)
    expect(consoleLogSpy).toHaveBeenCalledWith('wallet-risk  Score wallet risk')
    // No network calls
    expect(mockClientConnect).not.toHaveBeenCalled()
    expect(mockClientListTools).not.toHaveBeenCalled()
  })

  // ─── mcp tools — cache miss + wallet configured ────────────────────────────

  it('mcp tools — cache miss: fetches schema from remote, saves to cache, prints', async () => {
    const remoteTools = [{ name: 'trace-funds', description: 'Trace money flows' }]
    mockLoadSchema.mockResolvedValue(null) // cache miss
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue('0xdeadbeef')
    mockCreateMcpFetchClient.mockReturnValue(fetch)
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue({ tools: remoteTools })
    mockSaveSchema.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockFormatToolsTable.mockReturnValue('trace-funds  Trace money flows')

    await runMcpToolsAction()

    expect(mockLoadSchema).toHaveBeenCalledOnce()
    expect(mockLoadSchema).toHaveBeenCalledWith('http://localhost:4000')
    expect(mockCreateConfiguredGraphMcpFetch).toHaveBeenCalledWith({ mcpEndpoint: 'http://localhost:4000' })
    expect(mockClientConnect).toHaveBeenCalledOnce()
    expect(mockClientListTools).toHaveBeenCalledOnce()
    expect(mockSaveSchema).toHaveBeenCalledWith(remoteTools, 'http://localhost:4000')
    expect(mockClientClose).toHaveBeenCalledOnce()
    expect(mockFormatToolsTable).toHaveBeenCalledWith(remoteTools)
    expect(consoleLogSpy).toHaveBeenCalledWith('trace-funds  Trace money flows')
  })

  // ─── mcp tools — missing wallet ───────────────────────────────────────────

  it('mcp tools — configured graph auth token: skips direct wallet checks and uses graph endpoint', async () => {
    const remoteTools = [{ name: 'address_risk', description: 'Screen address risk' }]
    mockLoadSchema.mockResolvedValue(null) // cache miss
    mockLoadConfig.mockResolvedValue({
      mcpEndpoint: 'http://localhost:8011/mcp',
      mcpAuthToken: 'legacy-debug-secret',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue({ tools: remoteTools })
    mockSaveSchema.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockFormatToolsTable.mockReturnValue('address_risk  Screen address risk')

    await runMcpToolsAction()

    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
    expect(mockCreateConfiguredGraphMcpFetch).toHaveBeenCalledWith({
      mcpEndpoint: 'http://localhost:8011/mcp',
      mcpAuthToken: 'legacy-debug-secret',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    expect(MockStreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('http://localhost:8012/mcp'),
      { fetch },
    )
  })

  // ─── mcp tools — --refresh flag ───────────────────────────────────────────

  it('mcp tools --refresh: skips cache, fetches fresh', async () => {
    const remoteTools = [{ name: 'entity-profile', description: 'Profile entity' }]
    mockLoadSchema.mockResolvedValue([{ name: 'old-tool' }]) // stale cache (should be skipped)
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue('0xdeadbeef')
    mockCreateMcpFetchClient.mockReturnValue(fetch)
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue({ tools: remoteTools })
    mockSaveSchema.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockFormatToolsTable.mockReturnValue('entity-profile  Profile entity')

    await runMcpToolsAction({ refresh: true })

    // loadSchema should not be consulted when refresh=true
    expect(mockLoadSchema).not.toHaveBeenCalled()
    expect(mockClientListTools).toHaveBeenCalledOnce()
    expect(mockSaveSchema).toHaveBeenCalledWith(remoteTools, 'http://localhost:4000')
  })

  // ─── mcp call — key=value args ────────────────────────────────────────────

  it('mcp call — callTool called with correct name and parsed args', async () => {
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue('0xdeadbeef')
    mockCreateMcpFetchClient.mockReturnValue(fetch)
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Risk score: 72' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('wallet-risk', ['address=0x1234', 'chain=ethereum'])

    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'wallet-risk',
      arguments: { address: '0x1234', chain: 'ethereum' },
    })
    expect(consoleLogSpy).toHaveBeenCalledWith('Risk score: 72')
  })

  it('mcp call parses JSON arrays and numeric args for graph_query_batch', async () => {
    mockLoadConfig.mockResolvedValue({
      mcpEndpoint: 'http://localhost:8011/mcp',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"completed":1}' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('graph_query_batch', [
      'network=bittensor',
      'queries=[{"id":"count","query":"MATCH (n) RETURN count(n) AS count LIMIT 1"}]',
      'per_query_timeout_seconds=10',
    ])

    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: {
        network: 'bittensor',
        queries: [{ id: 'count', query: 'MATCH (n) RETURN count(n) AS count LIMIT 1' }],
        per_query_timeout_seconds: 10,
      },
    })
  })

  it('mcp call preserves number-like scalar strings', async () => {
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('wallet-risk', ['id=001', 'amount=10'])

    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'wallet-risk',
      arguments: { id: '001', amount: '10' },
    })
  })

  it('mcp call prints model-visible content only', async () => {
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      structuredContent: { facts: { risk: { level: 'critical' } } },
      _meta: { chainInsights: { graph: { url: 'http://127.0.0.1:4321/artifacts/a/graph.json' } } },
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('address_risk', ['network=bittensor', 'address=5Addr'])

    expect(consoleLogSpy).toHaveBeenCalledWith('## Risk Report')
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('graph.json')
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('critical')
  })

  // ─── mcp call — invalid arg format ────────────────────────────────────────

  it('mcp call — invalid arg format: exits 1 with Invalid arg format', async () => {
    await expect(runMcpCallAction('wallet-risk', ['badarg'])).rejects.toThrow('process.exit(1)')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid arg format')
    )
  })

  // ─── mcp call — missing wallet ────────────────────────────────────────────

  it('mcp call — configured graph auth token: skips direct wallet checks and uses graph endpoint', async () => {
    mockLoadConfig.mockResolvedValue({
      mcpEndpoint: 'http://localhost:8011/mcp',
      mcpAuthToken: 'legacy-debug-secret',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('address_risk', ['address=5abc', 'network=bittensor'])

    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
    expect(MockStreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('http://localhost:8012/mcp'),
      { fetch },
    )
    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'address_risk',
      arguments: { address: '5abc', network: 'bittensor' },
    })
  })
})

describe('config set walletPrivateKey interceptor (D-01)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('config set walletPrivateKey — calls encryptKey, does NOT call saveConfig', async () => {
    mockEncryptKey.mockResolvedValue(undefined)

    await runConfigSetAction('walletPrivateKey', '0xmyprivatekey')

    expect(mockEncryptKey).toHaveBeenCalledWith('0xmyprivatekey')
    // Critical per D-01: saveConfig must NEVER be called for walletPrivateKey
    expect(mockSaveConfig).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('encrypted and stored')
    )
  })

  it('config set walletPrivateKey — encryptKey throws: exits 1 with error message', async () => {
    mockEncryptKey.mockRejectedValue(new Error('Encryption failed'))

    await expect(runConfigSetAction('walletPrivateKey', '0xbadkey')).rejects.toThrow('process.exit(1)')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Encryption failed')
    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it('config set for non-walletPrivateKey key routes to saveConfig normally', async () => {
    mockLoadConfig.mockResolvedValue({ serverPort: 4321 })
    mockSaveConfig.mockResolvedValue(undefined)

    await runConfigSetAction('serverPort', '8080')

    expect(mockEncryptKey).not.toHaveBeenCalled()
    expect(mockSaveConfig).toHaveBeenCalledWith({ serverPort: 8080 })
  })

  it('config set mcpAuthToken stores token but redacts console output', async () => {
    mockLoadConfig.mockResolvedValue({ serverPort: 4321 })
    mockSaveConfig.mockResolvedValue(undefined)

    await runConfigSetAction('mcpAuthToken', 'debug-secret')

    expect(mockSaveConfig).toHaveBeenCalledWith({ mcpAuthToken: 'debug-secret' })
    expect(consoleLogSpy).toHaveBeenCalledWith('Set mcpAuthToken = [redacted]')
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('debug-secret'))
  })
})
