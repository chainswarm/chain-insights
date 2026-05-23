import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as z from 'zod'
import { PACKAGE_VERSION } from '../src/version.js'

const testDataDir = vi.hoisted(() => `/tmp/chain-insights-mcp-proxy-test-${process.pid}`)
const mockCase = vi.hoisted(() => ({
  id: '20260512_001_exchange-deposit-clustering',
  name: 'Exchange deposit clustering',
  status: 'open',
  created: '2026-05-12T20:00:00.000Z',
  updated: '2026-05-12T20:00:00.000Z',
  tags: ['aml'],
  description: 'Claude Desktop case',
}))
const caseStoreCreateMock = vi.hoisted(() => vi.fn().mockResolvedValue(mockCase))
const caseStoreListMock = vi.hoisted(() => vi.fn().mockResolvedValue([
  { id: mockCase.id, name: mockCase.name, status: mockCase.status },
]))
const caseStoreLoadContextMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  case: {
    id: mockCase.id,
    name: mockCase.name,
    status: mockCase.status,
    created: mockCase.created,
    updated: mockCase.updated,
    tags: mockCase.tags,
  },
  lastSession: null,
  dossierSummaries: [],
  evidenceCount: 0,
}))
const evidenceAppendMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  filename: '001_address_risk_20260512T200000.md',
  sha256: 'abc123',
}))
const evidenceVerifyMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, count: 1 }))
const dossierAppendFindingMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionStartMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  sessionId: `${mockCase.id}_s001`,
  caseId: mockCase.id,
  startTime: '2026-05-12T20:00:00.000Z',
  status: 'active',
}))
const sessionEndMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionArchiveOldMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const ensureArtifactServerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const runFundFlowProbeMock = vi.hoisted(() => vi.fn())

// Mock all external dependencies before importing proxy
vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    mcpEndpoint: 'http://localhost:8080/mcp',
    graphMcpEndpoint: 'http://localhost:8012/mcp',
    graphMcpAuthToken: 'graph-debug-token',
    serverPort: 4321,
    dataDir: testDataDir,
    version: '1',
  }),
}))

vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: vi.fn().mockResolvedValue(true),
  decryptKey: vi.fn().mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
}))

vi.mock('../src/wallet/tools.js', () => ({
  getWalletAccount: vi.fn().mockResolvedValue({
    address: '0x0000000000000000000000000000000000000001',
    privateKey: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  }),
  getWalletBalanceText: vi.fn().mockResolvedValue([
    'Balance: 4.200000 USDC',
    'Network: Base',
    'Address: 0x0000000000000000000000000000000000000001',
  ].join('\n')),
}))

vi.mock('../src/wallet/topup-server.js', () => ({
  startTopupServer: vi.fn().mockResolvedValue('http://127.0.0.1:4500'),
  generateArtifactHtml: vi.fn().mockReturnValue('<html>copied topup component</html>'),
}))

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app',
  registerAppResource: vi.fn((_server, _name, _uri, _config, _handler) => ({})),
  registerAppTool: vi.fn((server, name, config, handler) => server.registerTool(name, config, handler)),
}))

vi.mock('../src/mcp/client.js', () => ({
  createMcpFetchClient: vi.fn().mockReturnValue(fetch),
  createConfiguredMcpFetch: vi.fn().mockResolvedValue(fetch),
  createConfiguredGraphMcpFetch: vi.fn().mockResolvedValue(fetch),
  resolveGraphMcpEndpoint: vi.fn((config: { graphMcpEndpoint?: string; mcpEndpoint: string }) => (
    config.graphMcpEndpoint?.trim() || config.mcpEndpoint
  )),
}))

vi.mock('../src/mcp/schema-cache.js', () => ({
  loadSchema: vi.fn().mockResolvedValue(null), // default: cache miss
  saveSchema: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/mcp/artifact-server.js', () => ({
  ensureArtifactServer: ensureArtifactServerMock,
}))

vi.mock('../src/investigation/trace-funds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/investigation/trace-funds.js')>()
  return {
    ...actual,
    runFundFlowProbe: (...args: Parameters<typeof actual.runFundFlowProbe>) => {
      if (runFundFlowProbeMock.getMockImplementation()) {
        return runFundFlowProbeMock(...args)
      }
      return actual.runFundFlowProbe(...args)
    },
  }
})

vi.mock('../src/cases/index.js', () => ({
  CaseStore: {
    create: caseStoreCreateMock,
    list: caseStoreListMock,
    loadContext: caseStoreLoadContextMock,
  },
  EvidenceStore: {
    append: evidenceAppendMock,
    verifyManifest: evidenceVerifyMock,
  },
  DossierStore: {
    appendFinding: dossierAppendFindingMock,
  },
  SessionStore: {
    start: sessionStartMock,
    end: sessionEndMock,
    archiveOldSessions: sessionArchiveOldMock,
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const registeredTools: Map<string, Function> = new Map()
  const registeredPrompts: Map<string, Function> = new Map()
  // Must use regular function (not arrow) so `new McpServer()` works
  const McpServer = vi.fn(function () {
    return {
      registerTool: vi.fn(function (name: string, _opts: unknown, handler: Function) {
        registeredTools.set(name, handler)
      }),
      registerPrompt: vi.fn(function (name: string, _opts: unknown, handler: Function) {
        registeredPrompts.set(name, handler)
      }),
      registerResource: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      _registeredTools: registeredTools,
      _registeredPrompts: registeredPrompts,
    }
  })
  return { McpServer, _registeredTools: registeredTools, _registeredPrompts: registeredPrompts }
})

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  // Must use regular function (not arrow) so `new StdioServerTransport()` works
  StdioServerTransport: vi.fn(function () {
    return { close: vi.fn() }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  // Must use regular function (not arrow) so `new Client()` works
  Client: vi.fn(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'trace_address', description: 'Trace address on-chain' },
          { name: 'money_flows_between_exchanges', description: 'Exchange flow tracing' },
          { name: 'address_connection_risk', description: 'Connection risk' },
          { name: 'graph_query', description: 'Federated graph query' },
          { name: 'graph_query_batch', description: 'Federated graph query batch' },
          { name: 'topup', description: 'Unsupported top-up tool from stale remote schema' },
        ],
      }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [
          {
            name: 'address-risk',
            title: 'Address Risk',
            description: 'Full address screening',
            arguments: [
              { name: 'address', description: 'Blockchain address', required: true },
              { name: 'network', description: 'Network', required: false },
            ],
          },
          {
            name: 'track-funds',
            title: 'Track Funds',
            description: 'Trace stolen funds',
            arguments: [
              { name: 'trusted_addresses', description: 'Victim addresses', required: true },
              { name: 'network', description: 'Network', required: false },
            ],
          },
          {
            name: 'address-poisoning-funding-probe',
            title: 'Address Poisoning Funding Probe',
            description: 'Private probe prompt',
            arguments: [{ name: 'seed_address', required: true }],
          },
        ],
      }),
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'remote prompt text' },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  // Must use regular function (not arrow) so `new StreamableHTTPClientTransport()` works
  StreamableHTTPClientTransport: vi.fn(function () {
    return {}
  }),
}))

function findToolHandler(
  serverInstance: { registerTool: ReturnType<typeof vi.fn> },
  name: string,
): Function {
  const call = serverInstance.registerTool.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Tool was not registered: ${name}`)
  }
  return call[2] as Function
}

function findToolConfig(
  serverInstance: { registerTool: ReturnType<typeof vi.fn> },
  name: string,
): Record<string, unknown> {
  const call = serverInstance.registerTool.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Tool was not registered: ${name}`)
  }
  return call[1] as Record<string, unknown>
}

function findPromptHandler(
  serverInstance: { registerPrompt: ReturnType<typeof vi.fn> },
  name: string,
): Function {
  const call = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Prompt was not registered: ${name}`)
  }
  return call[2] as Function
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, 'utf8')
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

let originalSigintListeners: NodeJS.SignalsListener[] = []
let originalSigtermListeners: NodeJS.SignalsListener[] = []
let originalWorkspace: string | undefined

function removeAddedSignalListeners(signal: NodeJS.Signals, original: NodeJS.SignalsListener[]): void {
  for (const listener of process.listeners(signal)) {
    if (!original.includes(listener)) {
      process.removeListener(signal, listener)
    }
  }
}

describe('MCP proxy (MCP-02, MCP-03)', () => {
  beforeEach(() => {
    originalSigintListeners = process.listeners('SIGINT')
    originalSigtermListeners = process.listeners('SIGTERM')
    originalWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    vi.clearAllMocks()
    runFundFlowProbeMock.mockReset()
    rmSync(testDataDir, { recursive: true, force: true })
    mkdirSync(join(testDataDir, '.chain-insights'), { recursive: true })
    writeFileSync(join(testDataDir, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: testDataDir,
      cases_dir: 'cases',
    }) + '\n')
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = testDataDir
  })

  afterEach(() => {
    if (originalWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = originalWorkspace
    removeAddedSignalListeners('SIGINT', originalSigintListeners)
    removeAddedSignalListeners('SIGTERM', originalSigtermListeners)
  })

  it('registers remote tool on the local server by name', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null) // cache miss → fetch from remote

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    // Client fetched tools
    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      listTools: ReturnType<typeof vi.fn>
    }
    expect(clientInstance.listTools).toHaveBeenCalled()

    // Server registered the tool
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    expect(serverInstance.registerTool).toHaveBeenCalledWith(
      'trace_address',
      expect.objectContaining({ description: 'Trace address on-chain' }),
      expect.any(Function),
    )
  })

  it('starts local Chain Insights tools when the graph MCP endpoint is unavailable', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        listTools: vi.fn(),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        callTool: vi.fn(),
      }
    } as never)

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()
    stderrSpy.mockRestore()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
      connect: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('balance')
    expect(toolNames).toContain('help')
    expect(toolNames).toContain('case_list')
    expect(serverInstance.connect).toHaveBeenCalled()
  })

  it('publishes investigation workflow and live graph schema hints as server instructions', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    expect(McpServer).toHaveBeenCalledWith(
      { name: 'chain-insights', version: PACKAGE_VERSION },
      expect.objectContaining({
        instructions: expect.stringContaining('Workflow:'),
      }),
    )
    const instructions = vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions
    expect(instructions).toContain('case_open')
    expect(instructions).toContain('case_add_evidence')
    expect(instructions).toContain('Network is required')
    expect(instructions).toContain('Graph visualization behavior')
    expect(instructions).toContain('local graph report server is started automatically')
    expect(instructions).toContain('FLOWS_TO')
    expect(instructions).toContain('first_tx_id')
    expect(instructions).toContain('schema discovery')
  })

  it('forwards tool call arguments to remoteClient.callTool', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
      _registeredTools: Map<string, Function>
    }

    // Call the registered handler
    const handler = findToolHandler(serverInstance, 'trace_address')
    const args = { address: '0xabc123' }
    const result = await handler(args)

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'trace_address',
      arguments: args,
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'result' }])
  })

  it('writes MCP tool and Cypher query logs as JSONL', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'graph_query_batch')
    await handler({
      network: 'bittensor',
      graphMcpAuthToken: 'should-not-leak',
      queries: [
        {
          id: 'address_exists',
          query: [
            'MATCH (n {address: "5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5"})',
            'RETURN n.labels AS labels',
            'LIMIT 1',
          ].join('\n'),
        },
      ],
    })

    const entries = await readJsonl(join(testDataDir, '.chain-insights', 'runtime', 'logs', 'mcp-proxy.jsonl'))
    expect(entries.some((entry) => entry.event === 'proxy.start')).toBe(true)
    expect(entries.some((entry) => entry.event === 'tool.start' && entry.tool === 'graph_query_batch')).toBe(true)
    expect(entries.some((entry) => entry.event === 'tool.end' && entry.tool === 'graph_query_batch')).toBe(true)

    const cypherStart = entries.find((entry) => entry.event === 'topology.start' && entry.tool === 'graph_query_batch')
    expect(cypherStart).toBeTruthy()
    expect(cypherStart?.network).toBe('bittensor')
    expect(cypherStart?.query_count).toBe(1)
    expect(JSON.stringify(cypherStart)).toContain('MATCH (n {address:')
    expect(JSON.stringify(cypherStart)).not.toContain('\n')
    expect(JSON.stringify(entries)).not.toContain('should-not-leak')
    expect(JSON.stringify(entries)).toContain('[redacted]')
  })

  it('returns isError:true when remoteClient.callTool throws', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockRejectedValueOnce(new Error('Payment failed'))

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'trace_address')
    const result = await handler({ address: '0xabc' })

    expect(result.isError).toBe(true)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Payment failed')
  })

  it('calls remoteClient.connect but not listTools when schema cache has tools (WR-01: always connect)', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'cached_tool', description: 'From cache' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    // remoteClient.connect MUST be called even on cache hit — required for tool call forwarding
    // remoteClient.listTools should NOT be called — schema is served from cache
    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      connect: ReturnType<typeof vi.fn>
      listTools: ReturnType<typeof vi.fn>
    }
    expect(clientInstance.connect).toHaveBeenCalledOnce()
    expect(clientInstance.listTools).not.toHaveBeenCalled()
  })

  it('registers a local balance tool backed by the encrypted payment wallet', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'balance')
    const result = await handler({})

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Balance: 4.200000 USDC')
  })

  it('advertises graph query tools and balance but not hidden remote tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
      { name: 'topup', description: 'Unsupported remote top-up tool' },
      { name: 'money_flows_between_exchanges', description: 'Deprecated exchange flow tool' },
      { name: 'address_connection_risk', description: 'Deprecated connection risk tool' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])

    expect(toolNames).toContain('graph_query')
    expect(toolNames).toContain('graph_query_batch')
    expect(toolNames).toContain('balance')
    expect(toolNames).not.toContain('topup')
    expect(toolNames).not.toContain('money_flows_between_exchanges')
    expect(toolNames).not.toContain('address_connection_risk')

    const graphQueryBatch = findToolConfig(serverInstance, 'graph_query_batch')
    const jsonSchema = z.toJSONSchema(
      z.object(graphQueryBatch.inputSchema as z.ZodRawShape),
    ) as Record<string, unknown>
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>
    expect(jsonSchema.required).toEqual(['network', 'queries'])
    expect(properties.per_query_timeout_seconds.maximum).toBe(600)
  })

  it('does not register trace_funds as a public MCP tool', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
      { name: 'trace_funds', description: 'Stale remote trace funds tool' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('track_funds')
    expect(toolNames).not.toContain('trace_funds')
  })

  it('registers track_funds and writes graph reports from graph_query_batch results', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    const textResult = (queries: unknown[]) => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries },
        }),
      }],
      isError: false,
    })
    clientInstance.callTool
      .mockResolvedValueOnce(textResult([
        { id: 'node_labels', ok: true, results: [{ node_label: 'Address', sample_count: 10 }] },
        { id: 'relationship_types', ok: true, results: [{ rel_name: 'FLOWS_TO', sample_count: 4 }] },
        { id: 'address_property_keys', ok: true, results: [{ property_key: 'address', sample_count: 10 }] },
        { id: 'flows_to_property_keys', ok: true, results: [{ property_key: 'amount_sum', sample_count: 4 }] },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'forward_exchange_paths_2',
          ok: true,
          results: [{
            addresses: ['5Seed', '5Hop', '5Deposit', '5Exchange'],
            edge_props: [
              { amount_sum: 123, amount_usd_sum: 456, tx_count: 1, first_tx_id: '1-1', last_tx_id: '1-1' },
              { amount_sum: 122, amount_usd_sum: 455, tx_count: 1, first_tx_id: '2-1', last_tx_id: '2-1' },
              { amount_sum: 121, amount_usd_sum: 454, tx_count: 1, first_tx_id: '3-1', last_tx_id: '3-1' },
            ],
            node_labels: [['Address'], ['Address'], ['Address'], ['Address', 'Exchange']],
            exchange_address: '5Exchange',
            exchange_labels: ['Exchange'],
            exchange_display_labels: ['Binance'],
            exchange_address_type: 'substrate',
            hops: 3,
          }],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'direct_edge_props',
          ok: true,
          results: [
            { src: '5Seed', dst: '5Hop', amount_sum: 123, amount_usd_sum: 456, tx_count: 1, first_tx_id: '1-1', last_tx_id: '1-1' },
            { src: '5Hop', dst: '5Deposit', amount_sum: 122, amount_usd_sum: 455, tx_count: 1, first_tx_id: '2-1', last_tx_id: '2-1' },
            { src: '5Deposit', dst: '5Exchange', amount_sum: 121, amount_usd_sum: 454, tx_count: 1, first_tx_id: '3-1', last_tx_id: '3-1' },
          ],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        { id: 'backward_from_deposit_1', ok: true, results: [] },
      ]))
      .mockResolvedValueOnce(textResult([
        { id: 'reverse_1hop', ok: true, results: [] },
      ]))

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'track_funds')
    const result = await handler({
      trusted_addresses: '5Seed',
      network: 'bittensor',
      case_id: mockCase.id,
      max_hops: 2,
      per_address_limit: 3,
    })
    const run = result.structuredContent.facts.runs[0]

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Trace complete for bittensor:5Seed')
    expect(result.content[0].text).toContain('amount_sum')
    expect(run.files.graph).toContain('/reports/graphs/')
    expect(run.continuation.depositAddresses).toEqual(['5Deposit'])
    expect(run.address_map).toMatchObject({
      V1: '5Seed',
      I1: '5Hop',
      D1: '5Deposit',
      E1: '5Exchange',
    })
    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
    expect(evidenceAppendMock).toHaveBeenCalledWith(mockCase.id, expect.objectContaining({
      source: 'track_funds',
      content: expect.stringContaining('"compactEvidence"'),
    }))
    expect(ensureArtifactServerMock).toHaveBeenCalledWith(4321)
    const schemaCall = clientInstance.callTool.mock.calls.find((call) => {
      const queries = call[0].arguments?.queries as Array<{ id?: string }> | undefined
      return queries?.some((query) => query.id === 'node_labels')
    })
    const schemaQueries = schemaCall?.[0].arguments.queries as Array<{ id: string; query: string }>
    expect(schemaQueries.find((query) => query.id === 'node_labels')?.query).toContain('AS node_label')
    expect(schemaQueries.find((query) => query.id === 'relationship_types')?.query).toContain('AS rel_name')
    const forwardCall = clientInstance.callTool.mock.calls.find((call) => {
      const queries = call[0].arguments?.queries as Array<{ id?: string }> | undefined
      return queries?.some((query) => query.id?.startsWith('forward_exchange_paths_'))
    })
    const forwardQueries = forwardCall?.[0].arguments.queries as Array<{ id: string; query: string }>
    const forwardQuery = forwardQueries.find((query) => query.id === 'forward_exchange_paths_2')?.query ?? ''
    expect(forwardQuery).toContain('USE live_topology MATCH')
    expect(forwardQuery).toContain('r1.amount_sum IS NOT NULL')
    expect(forwardQuery).toContain('r2.amount_sum IS NOT NULL')
    expect(forwardQuery).toContain('t.is_exchange IS NOT NULL')
    expect(forwardQuery).not.toContain('*BFS')
    const reverseCall = clientInstance.callTool.mock.calls.find((call) => {
      const queries = call[0].arguments?.queries as Array<{ id?: string }> | undefined
      return queries?.some((query) => query.id === 'reverse_1hop')
    })
    const reverseQuery = (reverseCall?.[0].arguments.queries as Array<{ id: string; query: string }>)
      .find((query) => query.id === 'reverse_1hop')?.query ?? ''
    expect(reverseQuery).toContain('MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address)')
    expect(reverseQuery).toContain('deposit.address = "5Deposit"')
    expect(reverseQuery).not.toContain('UNWIND')

    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graphRaw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<Record<string, unknown> & { address: string; labels?: string[]; roles?: string[]; address_type?: string }>
      edges: Array<Record<string, unknown> & { amount_sum?: number; source?: string; edge_type?: string }>
    }
    expect(graph.schema).toBe('chain-insights.graph.v1')
    expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('address_type', 'wallet')
    const exchangeNode = graph.nodes.find((node) => node.address === '5Exchange')
    expect(exchangeNode).toMatchObject({
      labels: ['Binance'],
      roles: ['exchange'],
      address_type: 'substrate',
    })
    expect(exchangeNode).not.toHaveProperty('entity_kind')
    expect(exchangeNode).not.toHaveProperty('raw_labels')
    expect(exchangeNode).not.toHaveProperty('risk_level')
    expect(exchangeNode).not.toHaveProperty('pattern_flags')
    expect(graph.edges[0]).toMatchObject({ source: '5Seed', amount_sum: 123, edge_type: 'flows_to' })
    expect(graph.edges[0]).not.toHaveProperty('from_address')
    expect(graph.edges[0]).not.toHaveProperty('to_address')
    expect(graph.edges[0]).not.toHaveProperty('type')
  })

  it('routes track_funds reports to workspace without creating home outputs', async () => {
    const fakeHome = `/tmp/chain-insights-fake-home-${process.pid}-${Date.now()}`
    const workspace = `/tmp/chain-insights-workspace-${process.pid}-${Date.now()}`
    const previousHome = process.env['HOME']
    mkdirSync(join(workspace, '.chain-insights'), { recursive: true })
    writeFileSync(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    mkdirSync(fakeHome, { recursive: true })
    process.env['HOME'] = fakeHome
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace

    try {
      const { loadSchema } = await import('../src/mcp/schema-cache.js')
      vi.mocked(loadSchema).mockResolvedValueOnce([
        { name: 'graph_query_batch', description: 'Cypher topology query batch' },
      ])

      const { createProxy } = await import('../src/mcp/proxy.js')
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

      await createProxy()

      const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
        callTool: ReturnType<typeof vi.fn>
      }
      const textResult = (queries: unknown[]) => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            schema: 'chain-insights.result.v1',
            tool: 'graph_query_batch',
            facts: { queries },
          }),
        }],
        isError: false,
      })
      clientInstance.callTool
        .mockResolvedValueOnce(textResult([
          { id: 'node_labels', ok: true, results: [{ node_label: 'Address', sample_count: 10 }] },
          { id: 'relationship_types', ok: true, results: [{ rel_name: 'FLOWS_TO', sample_count: 4 }] },
          { id: 'address_property_keys', ok: true, results: [{ property_key: 'address', sample_count: 10 }] },
          { id: 'flows_to_property_keys', ok: true, results: [{ property_key: 'amount_sum', sample_count: 4 }] },
        ]))
        .mockResolvedValueOnce(textResult([
          {
            id: 'forward_exchange_paths',
            ok: true,
            results: [{
              addresses: ['5Seed', '5Deposit', '5Exchange'],
              edge_props: [
                { amount_sum: 50, amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
                { amount_sum: 49, amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
              ],
              node_labels: [['Address'], ['Address'], ['Address', 'Exchange']],
              exchange_address: '5Exchange',
              exchange_labels: ['Exchange'],
              hops: 2,
            }],
          },
        ]))
        .mockResolvedValueOnce(textResult([
          {
            id: 'direct_edge_props',
            ok: true,
            results: [
              { src: '5Seed', dst: '5Deposit', amount_sum: 50, amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
              { src: '5Deposit', dst: '5Exchange', amount_sum: 49, amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
            ],
          },
        ]))
        .mockResolvedValueOnce(textResult([
          { id: 'backward_from_deposit_1', ok: true, results: [] },
        ]))
        .mockResolvedValueOnce(textResult([
          { id: 'reverse_1hop', ok: true, results: [] },
        ]))

      const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
        registerTool: ReturnType<typeof vi.fn>
      }
      const handler = findToolHandler(serverInstance, 'track_funds')
      const result = await handler({
        trusted_addresses: '5Seed',
        network: 'bittensor',
      })
      const run = result.structuredContent.facts.runs[0]

      expect(result.isError).toBe(false)
      expect(run.files.graph).toContain(`${workspace}/reports/graphs/`)
      expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
      expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
      expect(result._meta.chainInsights.graph.data).toBeUndefined()
      const graphUrl = result._meta.chainInsights.graph.url as string
      const filename = graphUrl.split('/graph-reports/')[1]
      expect(filename).toMatch(/\.graph\.json$/)
      const graph = JSON.parse(await readFile(join(workspace, 'reports', 'graphs', filename), 'utf8')) as { schema: string }
      expect(graph.schema).toBe('chain-insights.graph.v1')
      expect(existsSync(join(fakeHome, '.chain-insights', 'reports'))).toBe(false)
      expect(existsSync(join(fakeHome, '.chain-insights', 'artifacts'))).toBe(false)
      expect(existsSync(join(fakeHome, '.chain-insights', 'cases'))).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
      rmSync(fakeHome, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('track_funds reports deposit candidates and does not continue through Exchange nodes', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    const textResult = (queries: unknown[]) => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries },
        }),
      }],
      isError: false,
    })
    clientInstance.callTool
      .mockResolvedValueOnce(textResult([
        { id: 'node_labels', ok: true, results: [{ node_label: 'Address', sample_count: 10 }, { node_label: 'Exchange', sample_count: 1 }] },
        { id: 'relationship_types', ok: true, results: [{ rel_name: 'FLOWS_TO', sample_count: 4 }] },
        { id: 'address_property_keys', ok: true, results: [{ property_key: 'address', sample_count: 10 }] },
        { id: 'flows_to_property_keys', ok: true, results: [{ property_key: 'amount_sum', sample_count: 4 }] },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'forward_exchange_paths_2',
          ok: true,
          results: [
            {
              addresses: ['5Seed', '5Deposit', '5Exchange'],
              edge_props: [
                { amount_sum: 50, amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
                { amount_sum: 49, amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
              ],
              node_labels: [['Address'], ['Address'], ['Address', 'Exchange']],
              exchange_address: '5Exchange',
              exchange_labels: ['Exchange'],
              exchange_display_labels: ['Binance'],
              exchange_address_type: 'substrate',
              hops: 2,
            },
            {
              addresses: ['5Seed', '5OtherDeposit', '5OtherExchange'],
              edge_props: [
                { amount_sum: 40, amount_usd_sum: 80, tx_count: 1, first_tx_id: '3-1' },
                { amount_sum: 39, amount_usd_sum: 78, tx_count: 1, first_tx_id: '4-1' },
              ],
              node_labels: [['Address'], ['Address'], ['Address', 'Exchange']],
              exchange_address: '5OtherExchange',
              exchange_labels: ['Exchange'],
              exchange_display_labels: ['Kraken'],
              exchange_address_type: 'substrate',
              hops: 2,
            },
          ],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'direct_edge_props',
          ok: true,
          results: [
            { src: '5Seed', dst: '5Deposit', amount_sum: 50, amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
            { src: '5Deposit', dst: '5Exchange', amount_sum: 49, amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
            { src: '5Seed', dst: '5OtherDeposit', amount_sum: 40, amount_usd_sum: 80, tx_count: 1, first_tx_id: '3-1' },
            { src: '5OtherDeposit', dst: '5OtherExchange', amount_sum: 39, amount_usd_sum: 78, tx_count: 1, first_tx_id: '4-1' },
          ],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'backward_from_deposit_1',
          ok: true,
          results: [{
            deposit_address: '5Deposit',
            source_exchange: '5SourceExchange',
            source_labels: ['Exchange'],
            source_display_labels: ['Bitget'],
            source_address_type: 'substrate',
            hops: 2,
            addresses: ['5Deposit', '5SourceMid', '5SourceExchange'],
            node_labels: [['Address'], ['Address'], ['Address', 'Exchange']],
            path_nodes: [
              { address: '5Deposit', labels: ['deposit'], system_labels: ['Address'], address_type: 'substrate' },
              { address: '5SourceMid', labels: ['source bridge'], system_labels: ['Address'], address_type: 'substrate' },
              { address: '5SourceExchange', labels: ['Bitget'], system_labels: ['Address', 'Exchange'], address_type: 'substrate' },
            ],
          }],
        },
        { id: 'backward_from_deposit_2', ok: true, results: [] },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'reverse_1hop',
          ok: true,
          results: [{
            address: '5Lead',
            labels: ['KnownEntity'],
            system_labels: ['Address'],
            address_type: 'substrate',
            degree_in: 10,
            degree_out: 1,
            total_volume_usd: 200000,
            deposit_address: '5Deposit',
            amount_usd: 75,
          }],
        },
      ]))

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'track_funds')
    const result = await handler({
      trusted_addresses: '5Seed',
      network: 'bittensor',
      max_hops: 5,
      per_address_limit: 3,
    })
    const run = result.structuredContent.facts.runs[0]

    expect(result.isError).toBe(false)
    expect(run.continuation.depositAddresses).toEqual(['5Deposit', '5OtherDeposit'])
    expect(run.continuation.exchangeAddresses).toEqual(['5Exchange', '5OtherExchange'])
    expect(run.continuation.nextHopAddresses).toEqual([])
    expect(run.address_map).toMatchObject({
      V1: '5Seed',
      D1: '5Deposit',
      E1: '5Exchange',
      D2: '5OtherDeposit',
      E2: '5OtherExchange',
      X1: '5SourceExchange',
      I1: '5SourceMid',
      L1: '5Lead',
    })
    expect(result.content[0].text).toContain('Deposit candidates: D1, D2')
    expect(clientInstance.callTool).toHaveBeenCalledTimes(5)

    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graphRaw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<Record<string, unknown> & { address: string; roles?: string[]; labels?: string[]; address_type?: string }>
      edges: Array<Record<string, unknown> & { source?: string; target: string; terminal_exchange?: boolean; edge_type?: string; direction?: string }>
    }
    expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('address_type', 'wallet')
    expect(graph.nodes.find((node) => node.address === '5Exchange')?.roles).toContain('exchange')
    expect(graph.nodes.find((node) => node.address === '5Exchange')?.labels).toEqual(['Binance'])
    expect(graph.nodes.find((node) => node.address === '5Exchange')?.address_type).toBe('substrate')
    expect(graph.nodes.find((node) => node.address === '5Exchange')).not.toHaveProperty('raw_labels')
    expect(graph.edges.find((edge) => edge.target === '5Exchange')?.terminal_exchange).toBe(true)
    expect(graph.edges.find((edge) => edge.target === '5Exchange')?.edge_type).toBe('flows_to')
    expect(graph.edges[0]).not.toHaveProperty('from_address')
    expect(graph.edges[0]).not.toHaveProperty('to_address')
    expect(graph.edges[0]).not.toHaveProperty('type')
    expect(graph.nodes.find((node) => node.address === '5SourceExchange')?.roles).toContain('exchange')
    expect(graph.nodes.find((node) => node.address === '5SourceExchange')?.labels).toEqual(['Bitget'])
    expect(graph.nodes.find((node) => node.address === '5SourceExchange')?.address_type).toBe('substrate')
    expect(graph.nodes.find((node) => node.address === '5SourceMid')?.labels).toEqual(['source bridge'])
    expect(graph.edges.find((edge) => edge.source === '5SourceExchange' && edge.target === '5Deposit')).toBeUndefined()
    expect(graph.edges.find((edge) => edge.source === '5SourceExchange' && edge.target === '5SourceMid')).toMatchObject({
      edge_type: 'flows_to',
      direction: 'traceback',
    })
    expect(graph.edges.find((edge) => edge.source === '5SourceMid' && edge.target === '5Deposit')).toMatchObject({
      edge_type: 'flows_to',
      direction: 'traceback',
    })
    expect(graph.nodes.find((node) => node.address === '5Lead')?.roles).toContain('lead')
  })

  it('registers local address_risk recipe with incorporated exchange behavior when remote is topology-query-only', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool
      .mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            schema: 'chain-insights.result.v1',
            tool: 'graph_query_batch',
            facts: {
              queries: [
                {
                  id: 'address_profile',
                  ok: true,
                  results: [{
                    address: '5Addr',
                    display_labels: ['validator'],
                    system_labels: ['Address', 'Validator'],
                    address_type: 'substrate',
                    address_subtypes: ['validator_hotkey'],
                    confluence_score: 0.82,
                    ml_risk_level: 'high',
                    degree_in: 3,
                    degree_out: 4,
                  }],
                },
                {
                  id: 'exchange_outflows_2',
                  ok: true,
                  results: [{
                    direction: 'outflow',
                    exchange_address: '5Exchange',
                    exchange_labels: ['Address', 'Exchange'],
                    exchange_display_labels: ['Binance'],
                    exchange_address_type: 'substrate',
                    deposit_address: '5Deposit',
                    hops: 2,
                    amount_sum: 44,
                    amount_usd_sum: 88,
                    edge_props: [
                      { amount_sum: 11, amount_usd_sum: 22, tx_count: 1, first_tx_id: 'risk-1', last_tx_id: 'risk-1' },
                      { amount_sum: 44, amount_usd_sum: 88, tx_count: 2, first_tx_id: 'risk-2', last_tx_id: 'risk-2' },
                    ],
                    path: ['5Addr', '5Deposit', '5Exchange'],
                  }],
                },
                { id: 'exchange_inflows_1', ok: true, results: [] },
                { id: 'connection_probe', ok: true, results: [] },
              ],
            },
          }),
        }],
        isError: false,
      })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Address risk for bittensor:5Addr')
    expect(result.content[0].text).toContain('Risk: high (0.82)')
    expect(result.content[0].text).toContain('Exchange behavior')
    expect(result.content[0].text).toContain('5Exchange')
    expect(result.structuredContent.facts.risk).toMatchObject({
      level: 'high',
      score: 0.82,
      confidence: 'high',
    })
    expect(result.structuredContent.facts.exchange_behavior.outflows[0].exchange_address).toBe('5Exchange')
    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graphRaw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<Record<string, unknown> & { address: string; labels?: string[]; roles?: string[]; address_type?: string }>
      edges: Array<Record<string, unknown> & { source?: string; target?: string; edge_type?: string }>
    }
    expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('address_type', 'wallet')
    const subjectNode = graph.nodes.find((node) => node.address === '5Addr')
    expect(subjectNode).toMatchObject({
      labels: ['validator'],
      address_type: 'substrate',
      address_subtypes: ['validator_hotkey'],
    })
    expect(subjectNode?.roles).toContain('subject')
    const exchangeNode = graph.nodes.find((node) => node.address === '5Exchange')
    expect(exchangeNode?.roles).toContain('exchange')
    expect(exchangeNode?.labels).toEqual(['Binance'])
    expect(exchangeNode?.address_type).toBe('substrate')
    expect(graph.edges.find((edge) => edge.source === '5Addr' && edge.target === '5Deposit')).toMatchObject({
      amount_sum: 11,
      usd_amount: 22,
      tx_count: 1,
      first_tx_id: 'risk-1',
      last_tx_id: 'risk-1',
    })
    expect(graph.edges.find((edge) => edge.source === '5Deposit' && edge.target === '5Exchange')).toMatchObject({
      amount_sum: 44,
      usd_amount: 88,
      tx_count: 2,
      first_tx_id: 'risk-2',
      last_tx_id: 'risk-2',
    })
    expect(graph.edges[0]).toHaveProperty('edge_type', 'flows_to')
    expect(graph.edges[0]).not.toHaveProperty('from_address')
    expect(graph.edges[0]).not.toHaveProperty('to_address')
    expect(graph.edges[0]).not.toHaveProperty('type')
    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: expect.objectContaining({
        network: 'bittensor',
        queries: expect.arrayContaining([
          expect.objectContaining({ id: 'exchange_outflows_1' }),
          expect.objectContaining({ id: 'exchange_inflows_1' }),
        ]),
      }),
    })
    const riskQueries = clientInstance.callTool.mock.calls[0][0].arguments.queries as Array<{ id: string; query: string }>
    const outflowQuery = riskQueries.find((query) => query.id === 'exchange_outflows_2')?.query ?? ''
    const inflowQuery = riskQueries.find((query) => query.id === 'exchange_inflows_2')?.query ?? ''
    expect(outflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(inflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(outflowQuery).not.toContain('*BFS')
    expect(inflowQuery).not.toContain('*BFS')
    expect(outflowQuery).toContain('LIMIT 200')
    expect(inflowQuery).toContain('LIMIT 200')
  })

  it('address_risk graphData preserves subject profile metadata before report normalization', async () => {
    const { addressRisk } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn()
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              facts: {
                queries: [
                  {
                    id: 'address_profile',
                    ok: true,
                    results: [{
                      address: '5Addr',
                      display_labels: ['validator'],
                      system_labels: ['Address', 'Validator'],
                      address_type: 'substrate',
                      address_subtypes: ['validator_hotkey'],
                    }],
                  },
                  { id: 'exchange_outflows', ok: true, results: [] },
                  { id: 'exchange_inflows', ok: true, results: [] },
                  { id: 'connection_probe', ok: true, results: [] },
                ],
              },
            }),
          }],
          isError: false,
        }),
    }

    const result = await addressRisk(remoteClient as never, { address: '5Addr', network: 'bittensor' })
    const subjectNode = (result.graphData.nodes as Array<Record<string, unknown>>).find((node) => node['address'] === '5Addr')

    expect(result.summaryText).toContain('Risk: low (0)')
    expect(result.structuredContent.facts.risk).toMatchObject({
      level: 'low',
      score: 0,
      confidence: 'low',
    })
    expect(subjectNode).toMatchObject({
      labels: ['validator'],
      system_labels: ['Address', 'Validator'],
      address_type: 'substrate',
      address_subtypes: ['validator_hotkey'],
      roles: ['subject'],
    })
  })

  it('registers local track_funds recipe that preserves up to five trusted and untrusted addresses', async () => {
    runFundFlowProbeMock.mockResolvedValue({
      summaryText: 'Trace complete for bittensor:5Victim',
      compactEvidence: {},
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [],
        edges: [],
        deposits: [{ address: '5Deposit', exchangeAddress: '5Exchange' }],
        source_matches: [{ deposit_address: '5Deposit', source_exchange: '5SourceExchange' }],
        reverse_leads: [{ address: '5Lead', deposit_address: '5Deposit' }],
      },
      files: {
        schema: '/tmp/schema.json',
        compactEvidence: '/tmp/compact.json',
        graph: '/tmp/graph.json',
        graphHtml: '/tmp/graph.html',
        table: '/tmp/table.csv',
        tableHtml: '/tmp/table.html',
        report: '/tmp/report.md',
      },
      continuation: {
        nextHopAddresses: [],
        depositAddresses: ['5Deposit'],
        exchangeAddresses: ['5Exchange'],
        hint: 'Found deposit candidates',
      },
      addressMap: { V1: '5Victim', D1: '5Deposit', E1: '5Exchange' },
    })

    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'track_funds')
    const result = await handler({
      trusted_addresses: ['5Victim', '5Victim2'],
      untrusted_addresses: ['5Scammer'],
      network: 'bittensor',
      case_id: mockCase.id,
    })

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Track funds complete')
    expect(runFundFlowProbeMock).toHaveBeenCalledTimes(3)
    expect(runFundFlowProbeMock).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), expect.objectContaining({
      seedAddress: '5Victim',
      network: 'bittensor',
      caseId: mockCase.id,
    }))
    expect(result.structuredContent.facts.trusted_addresses).toEqual(['5Victim', '5Victim2'])
    expect(result.structuredContent.facts.untrusted_addresses).toEqual(['5Scammer'])
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graph = JSON.parse(await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')) as {
      deposits?: Array<Record<string, unknown>>
      source_matches?: Array<Record<string, unknown>>
      reverse_leads?: Array<Record<string, unknown>>
    }
    expect(graph.deposits).toEqual([
      expect.objectContaining({ address: '5Deposit', run_role: 'trusted', run_address: '5Victim' }),
      expect.objectContaining({ address: '5Deposit', run_role: 'trusted', run_address: '5Victim2' }),
      expect.objectContaining({ address: '5Deposit', run_role: 'untrusted', run_address: '5Scammer' }),
    ])
    expect(graph.source_matches).toEqual([
      expect.objectContaining({ source_exchange: '5SourceExchange', run_role: 'trusted', run_address: '5Victim' }),
      expect.objectContaining({ source_exchange: '5SourceExchange', run_role: 'trusted', run_address: '5Victim2' }),
      expect.objectContaining({ source_exchange: '5SourceExchange', run_role: 'untrusted', run_address: '5Scammer' }),
    ])
    expect(graph.reverse_leads).toEqual([
      expect.objectContaining({ address: '5Lead', run_role: 'trusted', run_address: '5Victim' }),
      expect.objectContaining({ address: '5Lead', run_role: 'trusted', run_address: '5Victim2' }),
      expect.objectContaining({ address: '5Lead', run_role: 'untrusted', run_address: '5Scammer' }),
    ])
  })

  it('registers scam_topology and writes graph reports with scam labels', async () => {
    runFundFlowProbeMock.mockResolvedValue({
      summaryText: 'Trace complete for bittensor:5Victim',
      compactEvidence: {},
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [
          { id: '5Victim', address: '5Victim', node_type: 'address', roles: ['seed'] },
          { id: '5Hop', address: '5Hop', node_type: 'address' },
          { id: '5Deposit', address: '5Deposit', node_type: 'address', roles: ['deposit_candidate'] },
          { id: '5Exchange', address: '5Exchange', node_type: 'address', roles: ['exchange'] },
        ],
        edges: [
          { source: '5Victim', target: '5Hop', edge_type: 'flows_to', amount_sum: 10 },
          { source: '5Hop', target: '5Deposit', edge_type: 'flows_to', amount_sum: 9 },
          { source: '5Deposit', target: '5Exchange', edge_type: 'flows_to', amount_sum: 8, terminal_exchange: true },
        ],
        flows: [
          { hop: 1, src: '5Victim', dst: '5Hop', amount_sum: 10, terminal_exchange: false },
          { hop: 2, src: '5Hop', dst: '5Deposit', amount_sum: 9, terminal_exchange: false },
          { hop: 3, src: '5Deposit', dst: '5Exchange', amount_sum: 8, terminal_exchange: true },
        ],
        deposits: [{
          address: '5Deposit',
          exchangeAddress: '5Exchange',
          amount_sum: 8,
          hops: 3,
          path: ['5Victim', '5Hop', '5Deposit', '5Exchange'],
        }],
        reverse_leads: [],
        edge_anchors: [],
      },
      files: {
        schema: '/tmp/schema.json',
        compactEvidence: '/tmp/compact.json',
        graph: '/tmp/graph.json',
        graphHtml: '/tmp/graph.html',
        table: '/tmp/table.csv',
        tableHtml: '/tmp/table.html',
        report: '/tmp/report.md',
      },
      continuation: {
        nextHopAddresses: [],
        depositAddresses: ['5Deposit'],
        exchangeAddresses: ['5Exchange'],
        hint: 'Found deposit candidates',
      },
      addressMap: { S1: '5Victim', D1: '5Deposit', E1: '5Exchange' },
    })

    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries: [] },
        }),
      }],
      isError: false,
    })
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries: [{
            id: 'incident_hop_1',
            ok: true,
            results: [{
              src: '5Victim',
              dst: '5Deposit',
              amount_sum: 10,
              tx_count: 1,
              src_labels: [],
              dst_labels: [],
            }],
          }] },
        }),
      }],
      isError: false,
    })
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries: [{
            id: 'incident_hop_2',
            ok: true,
            results: [{
              src: '5Deposit',
              dst: '5Exchange',
              amount_sum: 8,
              tx_count: 1,
              src_labels: [],
              dst_labels: ['exchange'],
              dst_is_exchange: true,
            }],
          }] },
        }),
      }],
      isError: false,
    })
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: { queries: [{
            id: 'incident_deposit_cluster_1',
            ok: true,
            results: [],
          }] },
        }),
      }],
      isError: false,
    })
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('scam_topology')

    const toolConfig = findToolConfig(serverInstance, 'scam_topology')
    const inputSchema = toolConfig.inputSchema as Record<string, z.ZodTypeAny>
    expect(inputSchema.victim_address.safeParse('5Victim').success).toBe(true)
    expect(inputSchema.incident_timestamp_ms.safeParse(1715532228001).success).toBe(true)
    expect(inputSchema.incident_timestamp_ms.safeParse(-1).success).toBe(false)
    expect(inputSchema.max_hops.safeParse(16).success).toBe(true)
    expect(inputSchema.max_hops.safeParse(65).success).toBe(false)
    expect(inputSchema.activity_policy.safeParse('node_relative_only').success).toBe(true)
    expect(inputSchema.activity_policy.safeParse('global_incident_only').success).toBe(true)
    expect(inputSchema.activity_policy.safeParse('compare').success).toBe(false)
    expect(inputSchema.case_id.safeParse(mockCase.id).success).toBe(true)
    expect(inputSchema.compare_activity_policies).toBeUndefined()
    expect(inputSchema.scope).toBeUndefined()
    expect(inputSchema.since_timestamp_ms).toBeUndefined()
    expect(inputSchema.scammer_addresses).toBeUndefined()

    const handler = findToolHandler(serverInstance, 'scam_topology')
    const result = await handler({
      victim_address: '5Victim',
      network: 'bittensor',
      incident_timestamp_ms: 1715532228001,
      max_hops: 4,
      activity_policy: 'global_incident_only',
      case_id: mockCase.id,
    })

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Scam topology complete for bittensor')
    expect(result.structuredContent.tool).toBe('scam_topology')
    expect(result.structuredContent.facts.scam_labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Deposit', scam: true, source_victim_address: '5Victim' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Deposit', address_subtype: 'exchange_deposit_candidate' }),
    ]))
    expect(result.structuredContent.facts.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity_policy: 'global_incident', primary: true }),
    ]))
    expect(clientInstance.callTool.mock.calls[0]?.[0].arguments.queries[0].query)
      .toContain('r.last_seen_timestamp >= 1715532228001')
    expect(clientInstance.callTool.mock.calls[2]?.[0].arguments.queries[0].id)
      .toBe('incident_deposit_cluster_1')
    expect(evidenceAppendMock).toHaveBeenCalledWith(
      mockCase.id,
      expect.objectContaining({
        source: 'scam_topology',
        content: expect.stringContaining('"schema": "chain-insights.evidence_pointer.v1"'),
      }),
    )
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graph = JSON.parse(await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')) as {
      nodes?: Array<Record<string, unknown>>
      flows?: Array<Record<string, unknown>>
      deposits?: Array<Record<string, unknown>>
      source_matches?: Array<Record<string, unknown>>
      reverse_leads?: Array<Record<string, unknown>>
      scam_topology?: unknown
      topology_edges?: unknown
    }
    expect(graph.scam_topology).toBeUndefined()
    expect(graph.topology_edges).toBeUndefined()
    expect(graph.source_matches).toEqual([])
    expect(graph.reverse_leads).toEqual([])
    expect(graph.deposits).toEqual([
      expect.objectContaining({ address: '5Deposit', exchangeAddress: '5Exchange', path: ['5Victim', '5Deposit', '5Exchange'] }),
    ])
    expect(graph.flows).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Deposit', dst: '5Exchange', terminal_exchange: true }),
    ]))
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Deposit', scam: true, scam_confidence: 0.68 }),
    ]))
  })

  it('registers graph MCP app resource and preserves graph-backed remote tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report with app_data',
        outputSchema: {
          type: 'object',
          properties: {
            app_data: { type: 'object' },
          },
        },
        _meta: {
          ui: { resourceUri: 'ui://chain-insights/graph' },
          fastmcp: { tags: [] },
        },
      },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { registerAppResource, registerAppTool } = await import('@modelcontextprotocol/ext-apps/server')

    await createProxy()

    expect(registerAppResource).toHaveBeenCalledWith(
      expect.anything(),
      'Fund Flow Graph',
      'ui://chain-insights/graph',
      expect.objectContaining({
        description: expect.stringContaining('D3 force-directed graph'),
      }),
      expect.any(Function),
    )
    const graphResourceConfig = vi
      .mocked(registerAppResource)
      .mock.calls.find((entry) => entry[2] === 'ui://chain-insights/graph')?.[3]
    expect(graphResourceConfig?.description).toContain('_meta.chainInsights.graph.url')
    expect(graphResourceConfig?._meta?.ui?.csp?.connectDomains).toContain('http://127.0.0.1:4321')
    expect(graphResourceConfig?._meta?.ui?.csp?.connectDomains).toContain('http://localhost:4321')
    expect(registerAppTool).toHaveBeenCalledWith(
      expect.anything(),
      'address_risk',
      expect.objectContaining({
        title: 'Address Risk',
        _meta: expect.objectContaining({
          fastmcp: { tags: [] },
          ui: {
            resourceUri: 'ui://chain-insights/graph',
          },
        }),
      }),
      expect.any(Function),
    )

    const graphCall = vi
      .mocked(registerAppResource)
      .mock.calls.find((entry) => entry[2] === 'ui://chain-insights/graph')
    expect(graphCall).toBeDefined()

    const result = await graphCall![4](new URL('ui://chain-insights/graph'), {} as never)
    expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app')
    expect(result.contents[0].text).toContain('bgPatternImg')
    expect(result.contents[0].text).toContain('data:image/png;base64')
    expect(result.contents[0]._meta.ui.csp.connectDomains).toContain('http://127.0.0.1:4321')
    expect(result.contents[0]._meta.ui.csp.connectDomains).toContain('http://localhost:4321')
  })

  it('exposes public investigation prompts for Chain Insights tools and cases', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      listPrompts: ReturnType<typeof vi.fn>
    }
    expect(clientInstance.listPrompts).toHaveBeenCalled()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerPrompt: ReturnType<typeof vi.fn>
    }
    const promptNames = serverInstance.registerPrompt.mock.calls.map((entry) => entry[0])

    expect(promptNames).toEqual(expect.arrayContaining([
      'address-risk',
      'track-funds',
      'graph-query',
      'graph-query-batch',
      'balance',
      'help',
      'open-investigation-case',
      'resume-investigation-case',
      'save-investigation-evidence',
    ]))
    expect(promptNames).not.toContain('money-flows-between-exchanges')
    expect(promptNames).not.toContain('address-connection-risk')
    expect(promptNames).not.toContain('address-poisoning-funding-probe')

    const addressRiskPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'address-risk')
    const trackFundsPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'track-funds')
    expect(addressRiskPrompt?.[1].argsSchema.network.safeParse(undefined).success).toBe(false)
    expect(trackFundsPrompt?.[1].argsSchema.network.safeParse(undefined).success).toBe(false)
    expect(addressRiskPrompt?.[1].argsSchema.network.description).toContain('Do not guess')
    expect(trackFundsPrompt?.[1].argsSchema.network.description).toContain('Do not guess')
  })

  it('forwards GraphRAG prompt requests to the remote MCP prompt implementation', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerPrompt: ReturnType<typeof vi.fn>
    }
    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      getPrompt: ReturnType<typeof vi.fn>
    }

    const handler = findPromptHandler(serverInstance, 'address-risk')
    const result = await handler({
      address: '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6',
      network: 'bittensor',
      empty_optional: '',
    })

    expect(clientInstance.getPrompt).toHaveBeenCalledWith({
      name: 'address-risk',
      arguments: {
        address: '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6',
        network: 'bittensor',
      },
    })
    expect(result.messages[0].content.text).toBe('remote prompt text')
  })

  it('does not expose deprecated GraphRAG prompt names as primary prompts', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerPrompt: ReturnType<typeof vi.fn>
    }

    const promptNames = serverInstance.registerPrompt.mock.calls.map((entry) => entry[0])

    expect(promptNames).not.toContain('address-connection-risk')
    expect(promptNames).not.toContain('money-flows-between-exchanges')
  })

  it('registers known public tools with required Claude-facing schemas', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const config = findToolConfig(serverInstance, 'address_risk')
    const inputSchema = config.inputSchema as Record<string, unknown>

    expect(inputSchema.address).toBeDefined()
    expect(inputSchema.network).toBeDefined()
    expect((inputSchema.network as { description?: string }).description).toContain('Do not guess')
    expect(config.description).toContain('Required arguments: address, network.')
    expect(config.description).toContain('Do not guess a default network')
  })

  it('uses Chain Insights-owned descriptions for known public tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Upstream stale description. Use address_connection_risk instead.',
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const config = findToolConfig(serverInstance, 'address_risk')

    expect(config.description).toContain('Screen one full blockchain address')
    expect(config.description).toContain('Required arguments: address, network.')
    expect(config.description).not.toContain('Use address_connection_risk instead')
  })

  it('rejects known public tool calls with missing required arguments before remote forwarding', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Missing required argument: network')
    expect(clientInstance.callTool).not.toHaveBeenCalled()
  })

  it('normalizes array address inputs for comma-separated GraphRAG tool fields', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'track_funds',
        title: 'Track Funds',
        description: 'Fund tracing',
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'track_funds')
    await handler({
      trusted_addresses: ['5VictimA', '5VictimB'],
      untrusted_addresses: ['5Scammer'],
      network: 'bittensor',
    })

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'track_funds',
      arguments: {
        trusted_addresses: '5VictimA,5VictimB',
        untrusted_addresses: '5Scammer',
        network: 'bittensor',
      },
    })
  })

  it('persists remote graph _meta and returns only local graph report pointer', async () => {
    const remoteGraphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [],
      edges: [],
      flows: [],
      edge_anchors: [],
    }
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'address_risk',
        facts: { risk: { level: 'critical' } },
      },
      _meta: {
        chainInsights: {
          graph: {
            schema: 'chain-insights.graph.v1',
            data: remoteGraphData,
          },
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(ensureArtifactServerMock).toHaveBeenCalledWith(4321)
    expect(result.content).toEqual([{ type: 'text', text: '## Risk Report' }])
    expect(result.structuredContent.facts.risk.level).toBe('critical')
    expect(result.structuredContent).not.toHaveProperty('app_data')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
    expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
    expect(result._meta.chainInsights.graph.url).toMatch(/^http:\/\/127\.0\.0\.1:4321\/graph-reports\/.+\.graph\.json$/)

    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const raw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    expect(JSON.parse(raw)).toEqual(remoteGraphData)
  })

  it('sanitizes structured graph data when remote graph _meta is persisted', async () => {
    const remoteGraphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ id: 'a' }],
      edges: [{ source: 'a', target: 'b' }],
      flows: [{ from: 'a', to: 'b' }],
      edge_anchors: [{ edge_id: 'a-b' }],
    }
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'address_risk',
        hint: 'review graph report',
        facts: { risk: { level: 'critical' } },
        app_data: remoteGraphData,
        nodes: remoteGraphData.nodes,
        edges: remoteGraphData.edges,
        flows: remoteGraphData.flows,
        edge_anchors: remoteGraphData.edge_anchors,
      },
      _meta: {
        chainInsights: {
          graph: {
            schema: 'chain-insights.graph.v1',
            data: remoteGraphData,
          },
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'address_risk',
      hint: 'review graph report',
      facts: { risk: { level: 'critical' } },
    })
    expect(result.structuredContent).not.toHaveProperty('app_data')
    expect(result.structuredContent).not.toHaveProperty('nodes')
    expect(result.structuredContent).not.toHaveProperty('edges')
    expect(result.structuredContent).not.toHaveProperty('flows')
    expect(result.structuredContent).not.toHaveProperty('edge_anchors')
    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
  })

  it('sanitizes legacy structured graph data without a graph _meta envelope', async () => {
    const remoteGraphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ id: 'a' }],
      edges: [{ source: 'a', target: 'b' }],
      flows: [{ from: 'a', to: 'b' }],
      edge_anchors: [{ edge_id: 'a-b' }],
    }
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Legacy Risk Report' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'address_risk',
        facts: { risk: { level: 'critical' } },
        app_data: remoteGraphData,
        nested: {
          nodes: remoteGraphData.nodes,
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'address_risk',
      facts: { risk: { level: 'critical' } },
      nested: {},
    })
    expect(JSON.stringify(result.structuredContent)).not.toContain('app_data')
    expect(JSON.stringify(result.structuredContent)).not.toContain('"nodes"')
  })

  it('fails closed when remote graph data is present but invalid', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      _meta: {
        chainInsights: {
          graph: {
            schema: 'chain-insights.graph.v1',
            data: [],
          },
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
  })

  it('fails closed when remote graph arrays are present without data', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      _meta: {
        chainInsights: {
          graph: {
            schema: 'chain-insights.graph.v1',
            nodes: [],
            edges: [],
            flows: [],
            edge_anchors: [],
          },
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
  })

  it('fails closed when remote graph url is forwarded without data', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'address_risk',
        title: 'Address Risk',
        description: 'Risk report',
        outputSchema: {
          type: 'object',
          properties: { schema: { type: 'string' }, facts: { type: 'object' } },
        },
        _meta: { ui: { resourceUri: 'ui://chain-insights/graph' } },
      },
    ])

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '## Risk Report' }],
      _meta: {
        chainInsights: {
          graph: {
            schema: 'chain-insights.graph.v1',
            url: 'https://example.invalid/graph.json',
          },
        },
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
  })

  it('registers local case workflow tools for Claude Desktop investigations', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }

    const caseOpen = findToolHandler(serverInstance, 'case_open')
    const openResult = await caseOpen({
      name: 'Exchange deposit clustering',
      tags: 'aml,exchange',
      description: 'Claude Desktop case',
    })

    expect(openResult.isError).toBe(false)
    expect(openResult.content[0].text).toContain(mockCase.id)
    expect(caseStoreCreateMock).toHaveBeenCalledWith({
      name: 'Exchange deposit clustering',
      tags: ['aml', 'exchange'],
      description: 'Claude Desktop case',
    })

    const addEvidence = findToolHandler(serverInstance, 'case_add_evidence')
    const evidenceResult = await addEvidence({
      case_id: mockCase.id,
      source: 'address_risk',
      content: 'Risk summary',
      query_params: 'network=bittensor address=5Addr',
    })

    expect(evidenceResult.isError).toBe(false)
    expect(evidenceResult.content[0].text).toContain('001_address_risk_20260512T200000.md')
    expect(evidenceAppendMock).toHaveBeenCalledWith(mockCase.id, {
      source: 'address_risk',
      content: 'Risk summary',
      queryParams: 'network=bittensor address=5Addr',
    })
  })

  it('registers a local help tool that explains the Claude-facing product surface', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'help')
    const result = await handler({})

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Chain Insights AML investigation workspace')
    expect(result.content[0].text).toContain('Workflow:')
    expect(result.content[0].text).toContain('Network is required')
    expect(result.content[0].text).toContain('address_risk')
    expect(result.content[0].text).toContain('graph_query_batch')
    expect(result.content[0].text).toContain('balance')
    expect(result.content[0].text).not.toContain('topup')
    expect(result.content[0].text).toContain('case_open')
    expect(result.content[0].text).toContain('case_add_evidence')
    expect(result.content[0].text).toContain('Graph visualization behavior')
    expect(result.content[0].text).toContain('local graph report server is started automatically')
    expect(result.content[0].text).toContain('Graph query hints for network=bittensor')
    expect(result.content[0].text).toContain('FLOWS_TO')
    expect(result.content[0].text).toContain('first_tx_id')
    expect(result.content[0].text).toContain('AddressFeature')
    expect(result.content[0].text).toContain('HAS_FEATURE')
    expect(result.content[0].text).not.toContain('AddressFeatureFact')
    expect(result.content[0].text).toContain('schema discovery')
    expect(result.content[0].text).not.toContain('GraphRAG')
    expect(result.content[0].text).not.toContain('prox')
    expect(result.content[0].text).not.toContain('chain-insights mcp')
    expect(result.content[0].text).not.toContain('Useful CLI commands')
  })
})
