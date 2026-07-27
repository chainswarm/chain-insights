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

function retiredName(head: string, tail: string): string {
  return `${head}${tail}`
}

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
const mockSetWalletPrivateKey = vi.fn()
vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: mockIsWalletConfigured,
  decryptKey: mockDecryptKey,
  encryptKey: mockEncryptKey,
  setWalletPrivateKey: mockSetWalletPrivateKey,
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
const mockCreateConfiguredGraphMcpFetch = vi.fn()
vi.mock('../src/mcp/client.js', () => ({
  createMcpFetchClient: mockCreateMcpFetchClient,
  createConfiguredGraphMcpFetch: mockCreateConfiguredGraphMcpFetch,
  resolveGraphMcpEndpoint: vi.fn((config: { graphMcpEndpoint: string }) => config.graphMcpEndpoint.trim()),
}))

const mockTraceVictimFunds = vi.fn()
const mockTraceSuspectFunds = vi.fn()
const mockTraceDepositSources = vi.fn()
vi.mock('../src/investigation/public-tools.js', () => ({
  traceVictimFunds: mockTraceVictimFunds,
  traceSuspectFunds: mockTraceSuspectFunds,
  traceDepositSources: mockTraceDepositSources,
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
  const { visibleRemoteTools } = await import('../src/mcp/tool-visibility.js')
  const { loadConfig } = await import('../src/config/index.js')
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('../src/mcp/client.js')
  const config = await loadConfig()
  const graphMcpEndpoint = resolveGraphMcpEndpoint(config)
  let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint)
  if (!tools) {
    const paymentFetch = await createConfiguredGraphMcpFetch(config)
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'chain-insights-cli', version: '0.2.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: paymentFetch }))
    const result = await client.listTools()
    tools = result.tools as Array<{ name: string; description?: string }>
    await saveSchema(tools, graphMcpEndpoint)
    await client.close()
  }
  console.log(formatToolsTable(visibleRemoteTools(tools)))
}

/**
 * Simulate the `mcp call` action handler logic extracted from cli.ts.
 */
async function runMcpCallAction(tool: string, rawArgs: string[]): Promise<void> {
  let args: Record<string, unknown>
  try {
    const { parseMcpCallArgs } = await import('../src/mcp/call-args.js')
    const { assertPublicMcpToolName, validatePublicMcpToolArguments } = await import('../src/mcp/tool-visibility.js')
    args = parseMcpCallArgs(rawArgs)
    assertPublicMcpToolName(tool)
    validatePublicMcpToolArguments(tool, args)
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
  const client = new Client({ name: 'chain-insights-cli-call', version: '0.2.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), { fetch: paymentFetch }))
  if (tool === 'meta_usage_status') {
    try {
      const result = await client.callTool({ name: 'usage_status', arguments: {} })
      const content = result.content as Array<{ type: string; text?: string }>
      for (const item of content) {
        if (item.type === 'text') console.log(item.text)
      }
    } catch (err) {
      const { isMissingUsageStatusToolError, primitiveBackendUsageStatus, usageStatusText } = await import('../src/mcp/usage-status.js')
      if (!isMissingUsageStatusToolError(err)) throw err
      console.log(usageStatusText(primitiveBackendUsageStatus(resolveGraphMcpEndpoint(config))))
    }
    await client.close()
    return
  }
  if (tool === 'aml_trace_suspect_funds') {
    const { traceSuspectFunds } = await import('../src/investigation/public-tools.js')
    const incidentTimestamp = args['incident_timestamp'] === undefined
      ? undefined
      : Number(args['incident_timestamp'])
    const result = await traceSuspectFunds(client, config, {
      suspectAddresses: args['suspect_addresses'] as string | string[] | undefined ?? '',
      network: String(args['network'] ?? ''),
      maxHops: typeof args['max_hops'] === 'number' ? args['max_hops'] : undefined,
      incidentTimestamp: Number.isFinite(incidentTimestamp) ? incidentTimestamp : undefined,
    })
    console.log(result.summaryText)
    console.log(JSON.stringify(result.structuredContent, null, 2))
    await client.close()
    return
  }
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
      const { setWalletPrivateKey } = await import('../src/wallet/index.js')
      const address = await setWalletPrivateKey(value)
      console.log('Wallet private key encrypted and stored in ~/.chain-insights/wallet.json')
      console.log(`Wallet address: ${address}`)
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
    mockLoadConfig.mockResolvedValue({ graphMcpEndpoint: 'http://127.0.0.1:8012/mcp' })
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
    expect(mockLoadSchema).toHaveBeenCalledWith('http://127.0.0.1:8012/mcp')
    expect(mockFormatToolsTable).toHaveBeenCalledWith(cachedTools)
    expect(consoleLogSpy).toHaveBeenCalledWith('wallet-risk  Score wallet risk')
    // No network calls
    expect(mockClientConnect).not.toHaveBeenCalled()
    expect(mockClientListTools).not.toHaveBeenCalled()
  })

  it('mcp tools — cache hit: hides stale retired trace tools from public output', async () => {
    const staleTrace = ['trace', '_funds'].join('')
    const staleTrack = ['track', '_funds'].join('')
    const cachedTools = [
      { name: staleTrace, description: 'Stale fund tracing tool' },
      { name: 'money_flows_between_exchanges', description: 'Deprecated exchange flow tool' },
      { name: 'address_connection_risk', description: 'Deprecated connection risk tool' },
      { name: staleTrack, description: 'Legacy trace money flows' },
      { name: 'aml_trace_victim_funds', description: 'Trace victim funds' },
    ]
    mockLoadSchema.mockResolvedValue(cachedTools)
    mockFormatToolsTable.mockReturnValue('aml_trace_victim_funds  Trace victim funds')

    await runMcpToolsAction()

    expect(mockFormatToolsTable).toHaveBeenCalledWith([
      { name: 'aml_trace_victim_funds', description: 'Trace victim funds' },
    ])
    expect(consoleLogSpy).toHaveBeenCalledWith('aml_trace_victim_funds  Trace victim funds')
  })

  // ─── mcp tools — cache miss + wallet configured ────────────────────────────

  it('mcp tools — cache miss: fetches schema from remote, saves to cache, prints', async () => {
    const staleTrace = ['trace', '_funds'].join('')
    const staleTrack = ['track', '_funds'].join('')
    const remoteTools = [
      { name: staleTrace, description: 'Stale fund tracing tool' },
      { name: 'money_flows_between_exchanges', description: 'Deprecated exchange flow tool' },
      { name: 'address_connection_risk', description: 'Deprecated connection risk tool' },
      { name: staleTrack, description: 'Legacy trace money flows' },
      { name: 'aml_trace_victim_funds', description: 'Trace victim funds' },
    ]
    mockLoadSchema.mockResolvedValue(null) // cache miss
    mockIsWalletConfigured.mockResolvedValue(true)
    mockDecryptKey.mockResolvedValue('0xdeadbeef')
    mockCreateMcpFetchClient.mockReturnValue(fetch)
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue({ tools: remoteTools })
    mockSaveSchema.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockFormatToolsTable.mockReturnValue('aml_trace_victim_funds  Trace victim funds')

    await runMcpToolsAction()

    expect(mockLoadSchema).toHaveBeenCalledOnce()
    expect(mockLoadSchema).toHaveBeenCalledWith('http://127.0.0.1:8012/mcp')
    expect(mockCreateConfiguredGraphMcpFetch).toHaveBeenCalledWith({ graphMcpEndpoint: 'http://127.0.0.1:8012/mcp' })
    expect(mockClientConnect).toHaveBeenCalledOnce()
    expect(mockClientListTools).toHaveBeenCalledOnce()
    expect(mockSaveSchema).toHaveBeenCalledWith(remoteTools, 'http://127.0.0.1:8012/mcp')
    expect(mockClientClose).toHaveBeenCalledOnce()
    expect(mockFormatToolsTable).toHaveBeenCalledWith([
      { name: 'aml_trace_victim_funds', description: 'Trace victim funds' },
    ])
    expect(consoleLogSpy).toHaveBeenCalledWith('aml_trace_victim_funds  Trace victim funds')
  })

  // ─── mcp tools — missing wallet ───────────────────────────────────────────

  it('mcp tools — configured graph auth token: skips direct wallet checks and uses graph endpoint', async () => {
    const remoteTools = [{ name: 'aml_address_risk', description: 'Screen address risk' }]
    mockLoadSchema.mockResolvedValue(null) // cache miss
    mockLoadConfig.mockResolvedValue({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue({ tools: remoteTools })
    mockSaveSchema.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockFormatToolsTable.mockReturnValue('aml_address_risk  Screen address risk')

    await runMcpToolsAction()

    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
    expect(mockCreateConfiguredGraphMcpFetch).toHaveBeenCalledWith({
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
    expect(mockSaveSchema).toHaveBeenCalledWith(remoteTools, 'http://127.0.0.1:8012/mcp')
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

  it('mcp call sends meta_usage_status through the upstream usage_status primitive', async () => {
    mockLoadConfig.mockResolvedValue({
      graphMcpEndpoint: 'https://staging-mcp.chain-insights.ai/mcp',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"usage":{"remaining_seconds":10}}' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('meta_usage_status', [])

    expect(mockCreateConfiguredGraphMcpFetch).toHaveBeenCalledOnce()
    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'usage_status',
      arguments: {},
    })
    expect(consoleLogSpy).toHaveBeenCalledWith('{"usage":{"remaining_seconds":10}}')
  })

  it('mcp call returns a devkit usage status when upstream usage_status is absent', async () => {
    mockLoadConfig.mockResolvedValue({
      graphMcpEndpoint: 'http://127.0.0.1:18012/mcp',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockRejectedValue(new Error('MCP error -32602: unknown tool "usage_status"'))
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('meta_usage_status', [])

    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'usage_status',
      arguments: {},
    })
    const text = String(consoleLogSpy.mock.calls.at(-1)?.[0] ?? '')
    expect(text).toContain('"tool": "meta_usage_status"')
    expect(text).toContain('"mode": "primitive_graph_backend"')
    expect(text).toContain('"usage_status_tool": "unavailable"')
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

  it('mcp call parses current public trace numeric controls only', async () => {
    const { parseMcpCallArgs } = await import('../src/mcp/call-args.js')

    expect(parseMcpCallArgs([
      'victim_addresses=5Seed',
      'network=bittensor',
      'max_hops=8',
      'incident_timestamp=1715500000000',
      'per_address_limit=10',
      'min_amount_sum=1.5',
    ])).toEqual({
      victim_addresses: '5Seed',
      network: 'bittensor',
      max_hops: 8,
      incident_timestamp: 1715500000000,
      per_address_limit: 10,
      min_amount_sum: '1.5',
    })
  })

  it('mcp call rejects removed trace controls before local recipe execution', async () => {
    await expect(runMcpCallAction('aml_trace_suspect_funds', [
      'network=bittensor',
      'suspect_addresses=5Suspect',
      'min_amount_sum=1.5',
    ])).rejects.toThrow('process.exit(1)')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unsupported argument for aml_trace_suspect_funds: min_amount_sum. Allowed arguments: suspect_addresses, network, incident_timestamp, max_hops, per_address_limit, include_attachments.'
    )
    expect(mockClientConnect).not.toHaveBeenCalled()
    expect(mockTraceSuspectFunds).not.toHaveBeenCalled()
  })

  it('mcp call rejects a retired graph-scope argument as unsupported before local recipe execution', async () => {
    const retiredScopeArg = ['topology', 'scope'].join('_')
    await expect(runMcpCallAction('aml_trace_suspect_funds', [
      'network=bittensor',
      'suspect_addresses=5Suspect',
      `${retiredScopeArg}=anything`,
    ])).rejects.toThrow('process.exit(1)')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `Unsupported argument for aml_trace_suspect_funds: ${retiredScopeArg}. Allowed arguments: suspect_addresses, network, incident_timestamp, max_hops, per_address_limit, include_attachments.`
    )
    expect(mockClientConnect).not.toHaveBeenCalled()
    expect(mockTraceSuspectFunds).not.toHaveBeenCalled()
  })

  it('mcp call parses aml_trace_suspect_funds without requiring incident timestamp', async () => {
    const { parseMcpCallArgs } = await import('../src/mcp/call-args.js')

    expect(parseMcpCallArgs([
      'suspect_addresses=5Suspect',
      'network=bittensor',
    ])).toEqual({
      suspect_addresses: '5Suspect',
      network: 'bittensor',
    })
  })

  it('mcp call routes aml_trace_suspect_funds through the local recipe', async () => {
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockTraceSuspectFunds.mockResolvedValueOnce({
      summaryText: 'Trace suspect funds complete for bittensor',
      structuredContent: {
        schema: 'chain-insights.trace.v1',
        tool: 'aml_trace_suspect_funds',
      },
      graphData: { schema: 'chain-insights.graph.v1', nodes: [], edges: [], flows: [], edge_anchors: [] },
    })

    await runMcpCallAction('aml_trace_suspect_funds', [
      'network=bittensor',
      'suspect_addresses=5Suspect',
      'max_hops=2',
    ])

    expect(mockTraceSuspectFunds).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      network: 'bittensor',
      suspectAddresses: '5Suspect',
      incidentTimestamp: undefined,
      maxHops: 2,
    }))
    expect(mockClientCallTool).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('Trace suspect funds complete for bittensor')
  })

  it.each([
    [retiredName('trace', '_funds'), `MCP tool '${retiredName('trace', '_funds')}' is not exposed by Chain Insights. Use aml_trace_victim_funds, aml_trace_suspect_funds, or aml_trace_deposit_sources instead.`],
    [retiredName('track', '_funds'), `MCP tool '${retiredName('track', '_funds')}' is not exposed by Chain Insights. Use aml_trace_victim_funds instead.`],
    ['network_capabilities', "MCP tool 'network_capabilities' is not exposed by Chain Insights. Use meta_network_capabilities instead."],
    ['usage_status', "MCP tool 'usage_status' is not exposed by Chain Insights. Use meta_usage_status instead."],
    ['balance', "MCP tool 'balance' is not exposed by Chain Insights. Use wallet_balance instead."],
    ['help', "MCP tool 'help' is not exposed by Chain Insights. Use meta_help instead."],
  ])('mcp call rejects hidden tool %s before remote passthrough', async (tool, message) => {
    await expect(runMcpCallAction(tool, ['trusted_addresses=5Seed', 'network=bittensor']))
      .rejects.toThrow('process.exit(1)')

    expect(consoleErrorSpy).toHaveBeenCalledWith(message)
    expect(mockClientConnect).not.toHaveBeenCalled()
    expect(mockClientCallTool).not.toHaveBeenCalled()
  })

  it('mcp call prints model-visible content only', async () => {
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      structuredContent: { facts: { risk: { level: 'critical' } } },
      _meta: { chainInsights: { graph: { url: 'http://127.0.0.1:4321/graph-reports/a.graph.json' } } },
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('aml_address_risk', ['network=bittensor', 'address=5Addr'])

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
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpAuthToken: 'debug-secret',
    })
    mockCreateConfiguredGraphMcpFetch.mockResolvedValue(fetch)
    mockClientConnect.mockResolvedValue(undefined)
    mockClientCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }],
    })
    mockClientClose.mockResolvedValue(undefined)

    await runMcpCallAction('aml_address_risk', ['address=5abc', 'network=bittensor'])

    expect(mockIsWalletConfigured).not.toHaveBeenCalled()
    expect(mockDecryptKey).not.toHaveBeenCalled()
    expect(MockStreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('http://localhost:8012/mcp'),
      { fetch },
    )
    expect(mockClientCallTool).toHaveBeenCalledWith({
      name: 'aml_address_risk',
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

  it('config set walletPrivateKey — stores key, prints derived address, and does NOT call saveConfig', async () => {
    mockSetWalletPrivateKey.mockResolvedValue('0xC96aAa54E2d44c299564da76e1cD3184A2386B8D')

    await runConfigSetAction('walletPrivateKey', '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

    expect(mockSetWalletPrivateKey).toHaveBeenCalledWith('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    // Critical per D-01: saveConfig must NEVER be called for walletPrivateKey
    expect(mockSaveConfig).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('encrypted and stored')
    )
    expect(consoleLogSpy).toHaveBeenCalledWith('Wallet address: 0xC96aAa54E2d44c299564da76e1cD3184A2386B8D')
  })

  it('config set walletPrivateKey — setWalletPrivateKey throws: exits 1 with error message', async () => {
    mockSetWalletPrivateKey.mockRejectedValue(new Error('Stored wallet private key is not a valid 0x-prefixed EVM private key'))

    await expect(runConfigSetAction('walletPrivateKey', '0xbadkey')).rejects.toThrow('process.exit(1)')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Stored wallet private key is not a valid 0x-prefixed EVM private key')
    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it('config set for non-walletPrivateKey key routes to saveConfig normally', async () => {
    mockLoadConfig.mockResolvedValue({ serverPort: 4321 })
    mockSaveConfig.mockResolvedValue(undefined)

    await runConfigSetAction('serverPort', '8080')

    expect(mockEncryptKey).not.toHaveBeenCalled()
    expect(mockSaveConfig).toHaveBeenCalledWith({ serverPort: 8080 })
  })

  it('config set graphMcpAuthToken stores token but redacts console output', async () => {
    mockLoadConfig.mockResolvedValue({ serverPort: 4321 })
    mockSaveConfig.mockResolvedValue(undefined)

    await runConfigSetAction('graphMcpAuthToken', 'debug-secret')

    expect(mockSaveConfig).toHaveBeenCalledWith({ graphMcpAuthToken: 'debug-secret' })
    expect(consoleLogSpy).toHaveBeenCalledWith('Set graphMcpAuthToken = [redacted]')
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('debug-secret'))
  })
})
