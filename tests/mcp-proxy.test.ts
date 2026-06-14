import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as z from 'zod'
import { PACKAGE_VERSION } from '../src/version.js'

function retiredName(head: string, tail: string): string {
  return `${head}${tail}`
}

const testDataDir = vi.hoisted(() => `/tmp/chain-insights-mcp-proxy-test-${process.pid}`)
const dossierAppendFindingMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionStartMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  sessionId: '20260512_001_exchange-deposit-clustering_s001',
  startTime: '2026-05-12T20:00:00.000Z',
  status: 'active',
}))
const sessionEndMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionArchiveOldMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const ensureArtifactServerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const runFundFlowProbeMock = vi.hoisted(() => vi.fn())
const traceDepositSourcesMock = vi.hoisted(() => vi.fn())

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

vi.mock('../src/mcp/client.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    createMcpFetchClient: vi.fn().mockReturnValue(fetch),
    createConfiguredMcpFetch: vi.fn().mockResolvedValue(fetch),
    createConfiguredGraphMcpFetch: vi.fn().mockResolvedValue(fetch),
    resolveGraphMcpEndpoint: vi.fn((config: { graphMcpEndpoint?: string; mcpEndpoint: string }) => (
      config.graphMcpEndpoint?.trim() || config.mcpEndpoint
    )),
  }
})

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

vi.mock('../src/investigation/public-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/investigation/public-tools.js')>()
  return {
    ...actual,
    traceDepositSources: (...args: Parameters<typeof actual.traceDepositSources>) => {
      if (traceDepositSourcesMock.getMockImplementation()) {
        return traceDepositSourcesMock(...args)
      }
      return actual.traceDepositSources(...args)
    },
  }
})

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const McpServer = vi.fn(function () {
    const registeredTools = new Map<string, Function>()
    const registeredPrompts = new Map<string, Function>()
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
  return { McpServer }
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
            name: 'trace-tools',
            title: 'Trace Tools',
            description: 'Trace funds by address role',
            arguments: [
              { name: 'addresses', description: 'Input addresses', required: true },
              { name: 'role', description: 'victim, suspect, or deposit', required: true },
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

// Non-canonical address inputs (anything that is not a 0x form) now trigger a
// member-address resolution batch before the main tool batch. This response
// resolves nothing, so every input passes through unchanged.
function memberResolutionPassthrough(): Record<string, unknown> {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        schema: 'chain-insights.result.v1',
        tool: 'graph_query_batch',
        facts: { queries: [] },
      }),
    }],
    isError: false,
  }
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, 'utf8')
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

let originalSigintListeners: NodeJS.SignalsListener[] = []
let originalSigtermListeners: NodeJS.SignalsListener[] = []
let originalWorkspace: string | undefined
let originalProxyMode: string | undefined

function removeAddedSignalListeners(signal: NodeJS.Signals, original: NodeJS.SignalsListener[]): void {
  for (const listener of process.listeners(signal)) {
    if (!original.includes(listener)) {
      process.removeListener(signal, listener)
    }
  }
}

describe('MCP proxy (MCP-02, MCP-03)', () => {
  beforeEach(async () => {
    originalSigintListeners = process.listeners('SIGINT')
    originalSigtermListeners = process.listeners('SIGTERM')
    originalWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    originalProxyMode = process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE']
    vi.clearAllMocks()
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    vi.mocked(McpServer).mockClear()
    runFundFlowProbeMock.mockReset()
    traceDepositSourcesMock.mockReset()
    rmSync(testDataDir, { recursive: true, force: true })
    mkdirSync(join(testDataDir, '.chain-insights'), { recursive: true })
    writeFileSync(join(testDataDir, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: testDataDir,
    }) + '\n')
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = testDataDir
  })

  afterEach(() => {
    if (originalWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = originalWorkspace
    if (originalProxyMode === undefined) delete process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE']
    else process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = originalProxyMode
    removeAddedSignalListeners('SIGINT', originalSigintListeners)
    removeAddedSignalListeners('SIGTERM', originalSigtermListeners)
  })

  it('resolves workspace mode by default and accepts explicit stateless proxy mode', async () => {
    const { resolveMcpProxyMode } = await import('../src/mcp/proxy.js')

    expect(resolveMcpProxyMode({})).toBe('workspace')
    expect(resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'stateless' })).toBe('stateless')
    expect(resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'no-workspace' })).toBe('stateless')
    expect(() => resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'cases-only' })).toThrow('CHAIN_INSIGHTS_MCP_PROXY_MODE')
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
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
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

    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
      connect: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('balance')
    expect(toolNames).toContain('help')
    expect(toolNames).toContain('network_capabilities')
    expect(toolNames).toContain('graph_query')
    expect(toolNames).toContain('aml_trace_victim_funds')
    expect(toolNames).toContain('aml_trace_suspect_funds')
    expect(toolNames).toContain('aml_trace_deposit_sources')
    expect(toolNames).not.toContain(retiredName('track', '_funds'))
    expect(toolNames).not.toContain(retiredName('scam', '_topology'))
    expect(serverInstance.connect).toHaveBeenCalled()
  })

  it('starts local Chain Insights tools when paid GraphRAG fetch setup needs wallet configuration', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const mcpClient = await import('../src/mcp/client.js')
    vi.mocked(mcpClient.createConfiguredGraphMcpFetch).mockRejectedValueOnce(
      new Error('Wallet not configured. Run `chain-insights wallet ready`.'),
    )

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
    expect(instructions).toContain('aml_address_risk')
    expect(instructions).toContain('Network is required')
    expect(instructions).toContain('Graph visualization behavior')
    expect(instructions).toContain('local graph report server is started automatically')
    expect(instructions).toContain('FLOWS_TO')
    expect(instructions).toContain('first_tx_id')
    expect(instructions).toContain('archive member-address lookup')
    expect(instructions).toContain('(:Identity)-[:HAS_ADDRESS]->(:Address)')
    expect(instructions).toContain('Address.network')
    expect(instructions).toContain('member-ledger')
    expect(instructions).toContain('exchange hot wallets are terminal endpoints only')
    expect(instructions).toContain('schema discovery')
    expect(instructions).toContain('Select the graph with USE live_topology')
    expect(instructions).toContain('identity is the node grain, not the topology name')
    expect(instructions).toContain('NeuronEndpoint')
    expect(instructions).not.toContain('topology_scope accepts only identity')
    expect(instructions).not.toContain('topology_scope=identity')
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

  it('uses extended request timeout for proxied graph_query_batch calls', async () => {
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
    }
    const handler = findToolHandler(serverInstance, 'graph_query_batch')

    await handler({
      network: 'bittensor',
      per_query_timeout_seconds: 120,
      queries: [{ id: 'slow_facts', query: 'USE facts MATCH (n) RETURN n LIMIT 1' }],
    })

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: expect.objectContaining({
        network: 'bittensor',
        per_query_timeout_seconds: 120,
      }),
    }, undefined, expect.objectContaining({
      timeout: expect.any(Number),
      maxTotalTimeout: expect.any(Number),
    }))
    expect(clientInstance.callTool.mock.calls[0]?.[2]?.timeout).toBeGreaterThan(60_000)
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
    expect(result.content[0].text).toContain('Payment required for trace_address')
    expect(result.content[0].text).toContain('chain-insights wallet ready')
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
    const config = findToolConfig(serverInstance, 'balance')
    const handler = findToolHandler(serverInstance, 'balance')
    const result = await handler({})

    expect(config.title).toBe('Balance')
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

  it('does not register legacy trace tools as public MCP tools', async () => {
    const staleTrace = retiredName('trace', '_funds')
    const staleTrack = retiredName('track', '_funds')
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
      { name: staleTrace, description: 'Stale remote trace funds tool' },
      { name: staleTrack, description: 'Legacy remote track funds tool' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('aml_trace_victim_funds')
    expect(toolNames).toContain('aml_trace_suspect_funds')
    expect(toolNames).toContain('aml_trace_deposit_sources')
    expect(toolNames).not.toContain(staleTrace)
    expect(toolNames).not.toContain(staleTrack)
  })

  it('registers aml_trace_victim_funds, writes graph reports, and runs deposit traceback', async () => {
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
      .mockResolvedValueOnce(memberResolutionPassthrough())
      .mockResolvedValueOnce(textResult([
        { id: 'node_labels', ok: true, results: [{ node_label: 'Address', sample_count: 10 }] },
        { id: 'relationship_types', ok: true, results: [{ rel_name: 'FLOWS_TO', sample_count: 4 }] },
        { id: 'address_property_keys', ok: true, results: [{ property_key: 'address', sample_count: 10 }] },
        { id: 'flows_to_property_keys', ok: true, results: [{ property_key: 'amount_usd_sum', sample_count: 4 }] },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'forward_exchange_paths_2',
          ok: true,
          results: [{
            addresses: ['5Seed', '5Hop', '5Deposit', '5Exchange'],
            edge_props: [
              { amount_usd_sum: 456, tx_count: 1, first_tx_id: '1-1', last_tx_id: '1-1' },
              { amount_usd_sum: 455, tx_count: 1, first_tx_id: '2-1', last_tx_id: '2-1' },
              { amount_usd_sum: 454, tx_count: 1, first_tx_id: '3-1', last_tx_id: '3-1' },
            ],
            node_labels: [['Address'], ['Address'], ['Address'], ['Address', 'Exchange']],
            path_nodes: [
              { address: '5Seed', is_exchange: null },
              { address: '5Hop', is_exchange: null },
              { address: '5Deposit', is_exchange: null },
              { address: '5Exchange', is_exchange: true },
            ],
            exchange_address: '5Exchange',
            exchange_labels: ['Exchange'],
            exchange_display_labels: ['Binance'],
            hops: 3,
          }, {
            addresses: ['5Seed', '5ExchangeHot', '5KrakenCold'],
            edge_props: [
              { amount_usd_sum: 198, tx_count: 1, first_tx_id: '4-1', last_tx_id: '4-1' },
              { amount_usd_sum: 196, tx_count: 1, first_tx_id: '5-1', last_tx_id: '5-1' },
            ],
            node_labels: [['Address'], ['Address', 'exchange'], ['Address', 'exchange']],
            path_nodes: [
              { address: '5Seed', is_exchange: null },
              { address: '5ExchangeHot', labels: ['Kraken Hot', 'exchange'], is_exchange: true },
              { address: '5KrakenCold', labels: ['Kraken Cold', 'exchange'], is_exchange: true },
            ],
            exchange_address: '5KrakenCold',
            exchange_labels: ['Kraken Cold', 'exchange'],
            exchange_display_labels: ['Kraken Cold', 'exchange'],
            hops: 2,
          }],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'direct_edge_props',
          ok: true,
          results: [
            { src: '5Seed', dst: '5Hop', amount_usd_sum: 456, tx_count: 1, first_tx_id: '1-1', last_tx_id: '1-1' },
            { src: '5Hop', dst: '5Deposit', amount_usd_sum: 455, tx_count: 1, first_tx_id: '2-1', last_tx_id: '2-1' },
            { src: '5Deposit', dst: '5Exchange', amount_usd_sum: 454, tx_count: 1, first_tx_id: '3-1', last_tx_id: '3-1' },
          ],
        },
      ]))
      .mockResolvedValueOnce(textResult([
        {
          id: 'backward_from_deposit_1_1',
          ok: true,
          results: [{
            deposit_address: '5Deposit',
            source_exchange: '5SourceExchange',
            source_labels: ['OKX, exchange'],
            hops: 1,
            addresses: ['5Deposit', '5SourceExchange'],
            node_labels: [[], ['OKX, exchange']],
            path_nodes: [
              { address: '5Deposit', is_exchange: null },
              { address: '5SourceExchange', labels: ['OKX, exchange'], is_exchange: true },
            ],
          }],
        },
        { id: 'backward_from_deposit_1_2', ok: true, results: [] },
      ]))
      .mockResolvedValueOnce(textResult([
        { id: 'reverse_1hop', ok: true, results: [] },
      ]))

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_trace_victim_funds')
    const result = await handler({
      victim_addresses: '5Seed',
      network: 'bittensor',
      max_hops: 2,
      per_address_limit: 3,
    })

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Trace complete for bittensor:5Seed')
    expect(result.content[0].text).toContain('amount_usd_sum')
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.trace.v1',
      tool: 'aml_trace_victim_funds',
      network: 'bittensor',
      input: {
        addresses: ['5Seed'],
        seed_role: 'victim',
      },
      continuation: {
        candidate_deposit_addresses: ['5Deposit'],
        recommended_next_tools: expect.arrayContaining(['aml_trace_deposit_sources']),
      },
    })
    expect(result.structuredContent.continuation.candidate_deposit_addresses).not.toContain('5ExchangeHot')
    expect(result.structuredContent.candidate_labels).not.toContainEqual(expect.objectContaining({
      address: '5ExchangeHot',
      candidate_label: 'candidate_deposit',
    }))
    expect(result.structuredContent.artifacts.graph_json).toContain('/reports/graphs/')
    expect(result.structuredContent.addresses).toContainEqual(expect.objectContaining({
      address: '5Seed',
      roles: expect.arrayContaining(['seed_victim']),
    }))
    expect(result.structuredContent.edges).toContainEqual(expect.objectContaining({
      from_address: '5Seed',
      to_address: '5Hop',
      edge_type: 'FLOWS_TO',
    }))
    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    expect(result._meta.chainInsights.graph).not.toHaveProperty('id')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
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
    expect(forwardQuery).toContain('r1.amount_usd_sum IS NOT NULL')
    expect(forwardQuery).toContain('r2.amount_usd_sum IS NOT NULL')
    expect(forwardQuery).not.toContain('address_type')
    expect(forwardQuery).toContain('s.is_exchange IS NULL')
    expect(forwardQuery).toContain('n1.is_exchange IS NULL')
    expect(forwardQuery).toContain('t.is_exchange IS NOT NULL')
    expect(forwardQuery).not.toContain('*BFS')
    const backwardCall = clientInstance.callTool.mock.calls.find((call) => {
      const queries = call[0].arguments?.queries as Array<{ id?: string }> | undefined
      return queries?.some((query) => query.id?.startsWith('backward_from_deposit_'))
    })
    expect(backwardCall).toBeDefined()
    const reverseCall = clientInstance.callTool.mock.calls.find((call) => {
      const queries = call[0].arguments?.queries as Array<{ id?: string }> | undefined
      return queries?.some((query) => query.id === 'reverse_1hop')
    })
    expect(reverseCall).toBeDefined()
    expect(result.structuredContent.deposit_funding.source_exchange_paths).toContainEqual(expect.objectContaining({
      deposit_address: '5Deposit',
      source_exchange: '5SourceExchange',
    }))
    expect(result.structuredContent.deposit_funding.reverse_leads).toEqual([])
    expect(result.structuredContent.continuation.deposit_funding_note).toContain('aml_trace_deposit_sources')

    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graphRaw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<Record<string, unknown> & { address: string; labels?: string[]; roles?: string[] }>
      edges: Array<Record<string, unknown> & { amount_usd_sum?: number; source?: string; edge_type?: string }>
    }
    expect(graph.schema).toBe('chain-insights.graph.v1')
    expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('address_type')
    const exchangeNode = graph.nodes.find((node) => node.address === '5Exchange')
    expect(exchangeNode).toMatchObject({
      labels: ['Binance'],
      roles: ['exchange'],
    })
    expect(exchangeNode).not.toHaveProperty('entity_kind')
    expect(exchangeNode).not.toHaveProperty('raw_labels')
    expect(exchangeNode).not.toHaveProperty('risk_level')
    expect(exchangeNode).not.toHaveProperty('pattern_flags')
    expect(exchangeNode).not.toHaveProperty('address_type')
    expect(graph.edges[0]).toMatchObject({ source: '5Seed', amount_usd_sum: 456, edge_type: 'flows_to' })
    expect(graph.edges[0]).not.toHaveProperty('from_address')
    expect(graph.edges[0]).not.toHaveProperty('to_address')
    expect(graph.edges[0]).not.toHaveProperty('type')
  })

  it('routes aml_trace_victim_funds reports to workspace without creating home outputs', async () => {
    const fakeHome = `/tmp/chain-insights-fake-home-${process.pid}-${Date.now()}`
    const workspace = `/tmp/chain-insights-workspace-${process.pid}-${Date.now()}`
    const previousHome = process.env['HOME']
    mkdirSync(join(workspace, '.chain-insights'), { recursive: true })
    writeFileSync(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
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
          { id: 'flows_to_property_keys', ok: true, results: [{ property_key: 'amount_usd_sum', sample_count: 4 }] },
        ]))
        .mockResolvedValueOnce(textResult([
          {
            id: 'forward_exchange_paths',
            ok: true,
            results: [{
              addresses: ['5Seed', '5Deposit', '5Exchange'],
              edge_props: [
                { amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
                { amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
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
              { src: '5Seed', dst: '5Deposit', amount_usd_sum: 100, tx_count: 1, first_tx_id: '1-1' },
              { src: '5Deposit', dst: '5Exchange', amount_usd_sum: 98, tx_count: 1, first_tx_id: '2-1' },
            ],
          },
        ]))
        .mockResolvedValueOnce(textResult([]))

      const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
        registerTool: ReturnType<typeof vi.fn>
      }
      const handler = findToolHandler(serverInstance, 'aml_trace_victim_funds')
      const result = await handler({
        victim_addresses: '5Seed',
        network: 'bittensor',
      })

      expect(result.isError).toBe(false)
      expect(result.structuredContent.artifacts.graph_json).toContain(`${workspace}/reports/graphs/`)
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

  it('runs trace tools in stateless proxy mode without helper tools or graph report artifacts', async () => {
    process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = 'stateless'
    runFundFlowProbeMock.mockResolvedValue({
      summaryText: 'Trace complete for bittensor:5Victim',
      compactEvidence: {},
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [],
        edges: [],
        flows: [],
        deposits: [{ address: '5Deposit', exchangeAddress: '5Exchange' }],
        source_matches: [],
        reverse_leads: [],
      },
      files: {
        schema: '',
        compactEvidence: '',
        graph: '',
        graphHtml: '',
        table: '',
        tableHtml: '',
        report: '',
      },
      continuation: {
        nextHopAddresses: [],
        depositAddresses: ['5Deposit'],
        exchangeAddresses: ['5Exchange'],
        hint: 'Found deposit candidates',
      },
      addressMap: {},
    })

    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const baselineServers = vi.mocked(McpServer).mock.results.length
    const baselineServerCalls = vi.mocked(McpServer).mock.calls.length

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results.slice(baselineServers).at(-1)?.value as {
      _registeredTools: Map<string, Function>
      registerTool: ReturnType<typeof vi.fn>
    }
    expect(vi.mocked(McpServer).mock.calls.length).toBeGreaterThan(baselineServerCalls)
    const toolNames = Array.from(serverInstance._registeredTools.keys())
    expect(toolNames).toEqual([])
    expect(toolNames).not.toContain('help')
    expect(toolNames).not.toContain('aml_trace_victim_funds')
    expect(toolNames).not.toContain('balance')
    expect(ensureArtifactServerMock).not.toHaveBeenCalled()
    expect(runFundFlowProbeMock).not.toHaveBeenCalled()
  })

  it('registers local aml_address_risk recipe with incorporated exchange behavior when remote is topology-query-only', async () => {
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
      .mockResolvedValueOnce(memberResolutionPassthrough())
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
                    live_risk_score: 0.91,
                    live_risk_level: 'critical',
                    degree_in: 3,
                    degree_out: 4,
                  }],
                },
                {
                  id: 'member_addresses',
                  ok: true,
                  results: [{
                    member_addresses: ['0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24', '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6'],
                  }],
                },
                {
                  id: 'address_risk_score',
                  ok: true,
                  results: [{
                    ml_risk_score: 0.82,
                    risk_window_days: 1095,
                    risk_processing_date: '2026-06-09',
                    xgboost_model_version: 'xgb_test_v1',
                    gnn_model_version: 'gnn_test_v1',
                  }],
                },
                {
                  id: 'address_label_risk',
                  ok: true,
                  results: [{
                    label: 'Scam laundering intermediate',
                    risk_level: 'high',
                    trust_level: 'candidate',
                    confidence_score: 0.9,
                    source: 'scam_topology_trace',
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
                    deposit_address: '5Deposit',
                    hops: 2,
                    amount_usd_sum: 88,
                    edge_props: [
                      { amount_usd_sum: 22, tx_count: 1, first_tx_id: 'risk-1', last_tx_id: 'risk-1' },
                      { amount_usd_sum: 88, tx_count: 2, first_tx_id: 'risk-2', last_tx_id: 'risk-2' },
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(clientInstance.callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'graph_query_batch',
      arguments: expect.objectContaining({
        per_query_timeout_seconds: 10,
      }),
    }), undefined, expect.objectContaining({
      timeout: expect.any(Number),
      maxTotalTimeout: expect.any(Number),
    }))
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Address risk for bittensor:5Addr')
    expect(result.content[0].text).toContain('Risk: high (0.82)')
    expect(result.content[0].text).toContain('Live node triage: critical (0.91)')
    expect(result.content[0].text).toContain('Member addresses: 0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24, 5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6.')
    expect(result.content[0].text).toContain('Exchange behavior')
    expect(result.content[0].text).toContain('5Exchange')
    expect(result.structuredContent.facts.risk).toMatchObject({
      level: 'high',
      score: 0.82,
      confidence: 'high',
      live_node: {
        risk_score: 0.91,
        risk_level: 'critical',
        source: 'live_topology_node',
      },
    })
    expect(result.structuredContent.facts.subject.member_addresses).toEqual([
      '0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24',
      '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6',
    ])
    expect(result.structuredContent.facts.exchange_behavior.outflows[0].exchange_address).toBe('5Exchange')
    expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graphRaw = await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')
    const graph = JSON.parse(graphRaw) as {
      nodes: Array<Record<string, unknown> & { address: string; labels?: string[]; roles?: string[] }>
      edges: Array<Record<string, unknown> & { source?: string; target?: string; edge_type?: string }>
    }
    expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('address_type')
    const subjectNode = graph.nodes.find((node) => node.address === '5Addr')
    expect(subjectNode).toMatchObject({
      labels: ['validator'],
      member_addresses: ['0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24', '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6'],
      risk_score: 0.91,
      risk_level: 'critical',
    })
    expect(subjectNode).not.toHaveProperty('evm_address')
    expect(subjectNode).not.toHaveProperty('substrate_address')
    expect(subjectNode).not.toHaveProperty('address_type')
    expect(subjectNode?.roles).toContain('subject')
    const exchangeNode = graph.nodes.find((node) => node.address === '5Exchange')
    expect(exchangeNode?.roles).toContain('exchange')
    expect(exchangeNode?.labels).toEqual(['Binance'])
    expect(exchangeNode).not.toHaveProperty('address_type')
    expect(graph.edges.find((edge) => edge.source === '5Addr' && edge.target === '5Deposit')).toMatchObject({
      amount_usd_sum: 22,
      usd_amount: 22,
      tx_count: 1,
      first_tx_id: 'risk-1',
      last_tx_id: 'risk-1',
    })
    expect(graph.edges.find((edge) => edge.source === '5Deposit' && edge.target === '5Exchange')).toMatchObject({
      amount_usd_sum: 88,
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
    }, undefined, expect.objectContaining({
      timeout: 300_000,
      maxTotalTimeout: 300_000,
    }))
    const resolutionQueries = clientInstance.callTool.mock.calls[0][0].arguments.queries as Array<{ id: string; query: string }>
    expect(resolutionQueries[0]?.id).toBe('resolve_member_address_1')
    expect(resolutionQueries[0]?.query).toContain('MATCH (m:Address {address: "5Addr"})<-[:HAS_ADDRESS]-(i:Identity)')
    const riskQueries = clientInstance.callTool.mock.calls[1][0].arguments.queries as Array<{ id: string; query: string }>
    const outflowQuery = riskQueries.find((query) => query.id === 'exchange_outflows_2')?.query ?? ''
    const inflowQuery = riskQueries.find((query) => query.id === 'exchange_inflows_2')?.query ?? ''
    expect(outflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(inflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(outflowQuery).not.toContain('*BFS')
    expect(inflowQuery).not.toContain('*BFS')
    expect(outflowQuery).toContain('LIMIT 200')
    expect(inflowQuery).toContain('LIMIT 200')
  })

  it('aml_address_risk writes workspace artifacts and references them in evidence', async () => {
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce(memberResolutionPassthrough())
    clientInstance.callTool.mockResolvedValueOnce({
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
                  display_labels: ['Address'],
                  system_labels: ['Address'],
                  address_subtypes: ['coldkey'],
                }],
              },
              {
                id: 'address_feature',
                ok: true,
                results: [{
                  degree_in: 12,
                  degree_out: 3,
                  tx_in_count: 5,
                  tx_out_count: 2,
                }],
              },
              {
                id: 'address_risk_score',
                ok: true,
                results: [{
                  risk_score: 0.41,
                  risk_level: 'medium',
                }],
              },
              {
                id: 'connection_probe',
                ok: true,
                results: [],
              },
            ],
          },
        }),
      }],
      structuredContent: {
        schema: 'chain-insights.graph.v1',
        facts: {},
      },
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(false)
    const artifacts = result.structuredContent.artifacts as Record<string, string>
    expect(artifacts).toMatchObject({
      graph_json: expect.stringContaining(`${testDataDir}/reports/graphs/`),
      table_json: expect.stringContaining(`${testDataDir}/reports/tables/`),
      flows_csv: expect.stringContaining(`${testDataDir}/reports/tables/`),
      table_html: expect.stringContaining(`${testDataDir}/reports/`),
      graph_html: expect.stringContaining(`${testDataDir}/reports/`),
      report_md: expect.stringContaining(`${testDataDir}/reports/`),
    })

    for (const filePath of Object.values(artifacts)) {
      expect(typeof filePath).toBe('string')
      expect(existsSync(filePath)).toBe(true)
    }

    const compactEvidence = JSON.parse(await readFile(artifacts.table_json as string, 'utf8')) as {
      schema: string
      tool: string
      network: string
      input: { address: string }
    }
    expect(compactEvidence).toMatchObject({
      schema: 'chain-insights.trace.v1',
      tool: 'aml_address_risk',
      network: 'bittensor',
      input: { address: '5Addr' },
    })

    const evidence = result.structuredContent.evidence as Array<{ evidence_type: string; path: string }>
    const evidencePaths = evidence
      .filter((entry) => entry.evidence_type === 'artifact_pointer')
      .map((entry) => entry.path)
    expect(evidencePaths).toEqual(expect.arrayContaining(Object.values(artifacts)))
  })

  it('aml_address_risk graphData preserves subject profile metadata before report normalization', async () => {
    const { addressRisk } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn()
        .mockResolvedValueOnce(memberResolutionPassthrough())
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
                      live_risk_score: 0.12,
                      live_risk_level: 'low',
                    }],
                  },
                  {
                    id: 'member_addresses',
                    ok: true,
                    results: [{
                      member_addresses: ['0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24', '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6'],
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
      member_addresses: ['0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24', '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6'],
      risk_score: 0.12,
      risk_level: 'low',
      roles: ['subject'],
    })
    expect(subjectNode).not.toHaveProperty('address_type')
  })

  it('resolves SS58 member-address inputs through the Address lookup and derives canonical 0x inputs locally', async () => {
    const { resolveIdentityKeys } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn().mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            facts: {
              queries: [{
                id: 'resolve_member_address_1',
                ok: true,
                results: [{ identity_id: 'bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24' }],
              }],
            },
          }),
        }],
        isError: false,
      }),
    }

    const resolved = await resolveIdentityKeys(remoteClient as never, 'bittensor', [
      '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6',
      'bittensor:0x1874A43D7C6D888F9EDA3D22A3A49704E3CADB24',
      '0xABCDEF0123456789abcdef0123456789abcdef01',
    ])

    expect(resolved.get('5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6')).toBe('bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24')
    expect(resolved.get('bittensor:0x1874A43D7C6D888F9EDA3D22A3A49704E3CADB24')).toBe('bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24')
    expect(resolved.get('0xABCDEF0123456789abcdef0123456789abcdef01')).toBe('bittensor:0xabcdef0123456789abcdef0123456789abcdef01')
    expect(remoteClient.callTool).toHaveBeenCalledTimes(1)
    const queries = remoteClient.callTool.mock.calls[0]?.[0].arguments.queries as Array<{ id: string; query: string }>
    expect(queries).toHaveLength(1)
    expect(queries[0]?.id).toBe('resolve_member_address_1')
    expect(queries[0]?.query).toContain('MATCH (m:Address {address: "5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6"})<-[:HAS_ADDRESS]-(i:Identity)')
    expect(queries[0]?.query).toContain('RETURN i.identity_id AS identity_id')
  })

  it('passes unresolvable non-0x member-address inputs through unchanged', async () => {
    const { resolveIdentityKeys } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn().mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            facts: {
              queries: [{ id: 'resolve_member_address_1', ok: true, results: [] }],
            },
          }),
        }],
        isError: false,
      }),
    }

    const resolved = await resolveIdentityKeys(remoteClient as never, 'bittensor', ['5UnknownMember'])
    expect(resolved.get('5UnknownMember')).toBe('5UnknownMember')
  })

  it('aml_address_risk reports partial enrichment query failures without failing screening', async () => {
    const { addressRisk } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn()
        .mockResolvedValueOnce(memberResolutionPassthrough())
        .mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            facts: {
              queries: [
                {
                  id: 'address_profile',
                  ok: true,
                  results: [{ address: '5Addr', display_labels: ['subject'] }],
                },
                {
                  id: 'address_risk_score',
                  ok: false,
                  error: 'An unexpected error occurred executing the query',
                  results: [],
                },
                { id: 'exchange_outflows_1', ok: true, results: [] },
                { id: 'exchange_inflows_1', ok: true, results: [] },
              ],
            },
          }),
        }],
        isError: false,
      }),
    }

    const result = await addressRisk(remoteClient as never, {
      address: '5Addr',
      network: 'bittensor',
    })

    expect(result.summaryText).toContain('Partial query failures')
    expect(result.summaryText).toContain('address_risk_score')
    expect(result.structuredContent.facts.partial_query_errors).toEqual([
      {
        id: 'address_risk_score',
        error: 'An unexpected error occurred executing the query',
      },
    ])
    expect(result.graphData).toHaveProperty('schema', 'chain-insights.graph.v1')
  })

  it('registers aml_trace_suspect_funds without requiring incident_timestamp_ms', async () => {
    runFundFlowProbeMock.mockResolvedValue({
      summaryText: 'Trace complete for bittensor:5Suspect',
      compactEvidence: {},
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [
          { id: '5Suspect', address: '5Suspect', node_type: 'address', roles: ['seed'] },
          { id: '5Deposit', address: '5Deposit', node_type: 'address', roles: ['deposit_candidate'] },
        ],
        edges: [
          { source: '5Suspect', target: '5Deposit', edge_type: 'flows_to', amount_usd_sum: 9 },
        ],
        flows: [
          { hop: 1, src: '5Suspect', dst: '5Deposit', amount_usd_sum: 9, terminal_exchange: false },
        ],
        deposits: [],
        source_matches: [],
        reverse_leads: [],
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
        exchangeAddresses: [],
        hint: 'Found deposit candidates',
      },
      addressMap: { S1: '5Suspect', D1: '5Deposit' },
    })

    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce(memberResolutionPassthrough())

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_trace_suspect_funds')
    const result = await handler({
      suspect_addresses: ['5Suspect'],
      network: 'bittensor',
      max_hops: 2,
    })

    expect(result.isError).toBe(false)
    expect(runFundFlowProbeMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      seedAddress: '5Suspect',
      network: 'bittensor',
      includeDepositTraceback: true,
      evidenceSource: 'aml_trace_suspect_funds',
    }))
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.trace.v1',
      tool: 'aml_trace_suspect_funds',
      input: {
        addresses: ['5Suspect'],
        seed_role: 'suspect',
      },
    })
  })

  it('aml_trace_deposit_sources registration forwards min_amount_sum and time_range to the trace', async () => {
    traceDepositSourcesMock.mockResolvedValue({
      summaryText: 'Deposit sources trace complete for bittensor',
      structuredContent: {
        schema: 'chain-insights.trace.v1',
        tool: 'aml_trace_deposit_sources',
      },
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [
          { id: '5Deposit', address: '5Deposit', node_type: 'address', roles: ['seed'] },
          { id: '5Source', address: '5Source', node_type: 'address', roles: ['source'] },
        ],
        edges: [
          { source: '5Source', target: '5Deposit', edge_type: 'flows_to', amount_usd_sum: 31 },
        ],
      },
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
    const handler = findToolHandler(serverInstance, 'aml_trace_deposit_sources')
    const result = await handler({
      deposit_addresses: ['5Deposit'],
      network: 'bittensor',
      min_amount_sum: 25,
      time_range: { from_ms: 1715500000000 },
    })

    expect(result.isError).toBe(false)
    expect(traceDepositSourcesMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      depositAddresses: ['5Deposit'],
      network: 'bittensor',
      minAmountSum: 25,
      timeRange: { from_ms: 1715500000000 },
    }))
  })

  it('aml_trace_victim_funds passes time_range through as the probe activity window', async () => {
    runFundFlowProbeMock.mockResolvedValue({
      summaryText: 'Trace complete for bittensor:5Victim',
      compactEvidence: {},
      graphData: {
        schema: 'chain-insights.graph.v1',
        nodes: [
          { id: '5Victim', address: '5Victim', node_type: 'address', roles: ['seed'] },
          { id: '5Deposit', address: '5Deposit', node_type: 'address', roles: ['deposit_candidate'] },
        ],
        edges: [
          { source: '5Victim', target: '5Deposit', edge_type: 'flows_to', amount_usd_sum: 9 },
        ],
        flows: [
          { hop: 1, src: '5Victim', dst: '5Deposit', amount_usd_sum: 9, terminal_exchange: false },
        ],
        deposits: [],
        source_matches: [],
        reverse_leads: [],
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
        exchangeAddresses: [],
        hint: 'Found deposit candidates',
      },
      addressMap: { V1: '5Victim', D1: '5Deposit' },
    })

    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce(memberResolutionPassthrough())

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_trace_victim_funds')
    const result = await handler({
      victim_addresses: ['5Victim'],
      network: 'bittensor',
      time_range: { from_ms: 1715500000000, to_ms: 1716000000000 },
    })

    expect(result.isError).toBe(false)
    expect(runFundFlowProbeMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      seedAddress: '5Victim',
      network: 'bittensor',
      activityWindow: { fromMs: 1715500000000, toMs: 1716000000000 },
      evidenceSource: 'aml_trace_victim_funds',
    }))
    expect(result.structuredContent.input.time_filter).toEqual({ from_ms: 1715500000000, to_ms: 1716000000000 })
  })

  it('aml_trace_victim_funds input schema rejects time_range without from_ms', async () => {
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
    const config = findToolConfig(serverInstance, 'aml_trace_victim_funds')
    const schema = z.object(config['inputSchema'] as z.ZodRawShape)
    const parsed = schema.safeParse({
      victim_addresses: '5Victim',
      network: 'bittensor',
      time_range: { to_ms: 1716000000000 },
    })

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues ?? [])).toContain('from_ms')
  })

  it('aml_trace_deposit_sources performs reverse tracing and reports shared upstream convergence', async () => {
    const { traceDepositSources } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn()
        .mockResolvedValueOnce(memberResolutionPassthrough())
        .mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            facts: {
              queries: [
                {
                  id: 'reverse_deposit_sources_1',
                  ok: true,
                  results: [
                    {
                      source_address: '5SharedSource',
                      deposit_address: '5DepositA',
                      hop: 1,
                      addresses: ['5SharedSource', '5DepositA'],
                      amount_usd_sum: 11,
                      first_tx_id: 'a-1',
                    },
                    {
                      source_address: '5SharedSource',
                      deposit_address: '5DepositB',
                      hop: 1,
                      addresses: ['5SharedSource', '5DepositB'],
                      amount_usd_sum: 12,
                      first_tx_id: 'b-1',
                    },
                    {
                      source_address: '5ExchangeHot',
                      deposit_address: '5DepositA',
                      source_is_exchange: true,
                      deposit_is_exchange: null,
                      hop: 1,
                      addresses: ['5ExchangeHot', '5DepositA'],
                      path_nodes: [
                        { address: '5ExchangeHot', labels: ['Kraken Hot', 'exchange'], is_exchange: true },
                        { address: '5DepositA', is_exchange: null },
                      ],
                      amount_usd_sum: 13,
                      first_tx_id: 'c-1',
                    },
                    {
                      source_address: '5ExchangeHot',
                      deposit_address: '5DepositB',
                      source_is_exchange: true,
                      deposit_is_exchange: null,
                      hop: 1,
                      addresses: ['5ExchangeHot', '5DepositB'],
                      path_nodes: [
                        { address: '5ExchangeHot', labels: ['Kraken Hot', 'exchange'], is_exchange: true },
                        { address: '5DepositB', is_exchange: null },
                      ],
                      amount_usd_sum: 14,
                      first_tx_id: 'd-1',
                    },
                  ],
                },
              ],
            },
          }),
        }],
        isError: false,
      }),
    }

    const result = await traceDepositSources(remoteClient as never, { dataDir: testDataDir, serverPort: 4321 }, {
      depositAddresses: ['5DepositA', '5DepositB'],
      network: 'bittensor',
      maxHops: 1,
    })

    expect(remoteClient.callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'graph_query_batch',
      arguments: expect.objectContaining({
        network: 'bittensor',
      }),
    }), undefined, expect.anything())
    const query = remoteClient.callTool.mock.calls[1]?.[0].arguments.queries[0].query as string
    expect(query).toContain('MATCH (source:Identity)-[r1:FLOWS_TO]->(deposit:Identity)')
    expect(query).toContain('deposit.identity_id = "5DepositA"')
    expect(query).toContain('deposit.identity_id = "5DepositB"')
    expect(query).toContain('source.is_exchange IS NULL')
    expect(query).toContain('deposit.is_exchange IS NULL')
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.trace.v1',
      tool: 'aml_trace_deposit_sources',
      input: {
        addresses: ['5DepositA', '5DepositB'],
        seed_role: 'deposit',
      },
      continuation: {
        candidate_suspect_addresses: ['5SharedSource'],
      },
    })
    expect(result.structuredContent.continuation.candidate_suspect_addresses).not.toContain('5ExchangeHot')
    expect(result.structuredContent.candidate_labels).not.toContainEqual(expect.objectContaining({
      address: '5ExchangeHot',
      candidate_label: 'candidate_suspect',
    }))
    expect(result.structuredContent.convergence).toContainEqual(expect.objectContaining({
      address: '5SharedSource',
      path_ids: expect.arrayContaining([expect.any(String)]),
    }))
    expect(result.structuredContent.artifacts.table_json).toMatch(/\.compact-evidence\.json$/)
    expect(result.structuredContent.artifacts.table_html).toMatch(/\.table\.html$/)
    expect(existsSync(result.structuredContent.artifacts.table_json as string)).toBe(true)
    expect(existsSync(result.structuredContent.artifacts.table_html as string)).toBe(true)
  })

  it('registers local aml_trace_victim_funds recipe that preserves up to five victim addresses and does not trace known suspects', async () => {
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
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce(memberResolutionPassthrough())

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_trace_victim_funds')
    const result = await handler({
      victim_addresses: ['5Victim', '5Victim2'],
      known_suspect_addresses: ['5Scammer'],
      network: 'bittensor',
    })

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Trace victim funds complete')
    expect(runFundFlowProbeMock).toHaveBeenCalledTimes(2)
    expect(runFundFlowProbeMock).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), expect.objectContaining({
      seedAddress: '5Victim',
      network: 'bittensor',
      includeDepositTraceback: true,
      evidenceSource: 'aml_trace_victim_funds',
    }))
    expect(result.structuredContent.input.addresses).toEqual(['5Victim', '5Victim2'])
    expect(result.structuredContent.artifacts.runs).toEqual([
      expect.objectContaining({ role: 'victim', address: '5Victim', graph_json: '/tmp/graph.json' }),
      expect.objectContaining({ role: 'victim', address: '5Victim2', graph_json: '/tmp/graph.json' }),
    ])
    expect(result.structuredContent.candidate_labels).toContainEqual(expect.objectContaining({
      address: '5Deposit',
      candidate_label: 'candidate_deposit',
      promote_to_core_label: false,
    }))
    const graphUrl = result._meta.chainInsights.graph.url as string
    const filename = graphUrl.split('/graph-reports/')[1]
    expect(filename).toMatch(/\.graph\.json$/)
    const graph = JSON.parse(await readFile(join(testDataDir, 'reports', 'graphs', filename), 'utf8')) as {
      deposits?: Array<Record<string, unknown>>
      source_matches?: Array<Record<string, unknown>>
      reverse_leads?: Array<Record<string, unknown>>
    }
    expect(graph.deposits).toEqual([
      expect.objectContaining({ address: '5Deposit', run_role: 'victim', run_address: '5Victim' }),
      expect.objectContaining({ address: '5Deposit', run_role: 'victim', run_address: '5Victim2' }),
    ])
    expect(graph.source_matches).toEqual([
      expect.objectContaining({ source_exchange: '5SourceExchange', run_role: 'victim', run_address: '5Victim' }),
      expect.objectContaining({ source_exchange: '5SourceExchange', run_role: 'victim', run_address: '5Victim2' }),
    ])
    expect(graph.reverse_leads).toEqual([
      expect.objectContaining({ address: '5Lead', run_role: 'victim', run_address: '5Victim' }),
      expect.objectContaining({ address: '5Lead', run_role: 'victim', run_address: '5Victim2' }),
    ])
  })

  it('does not expose exposure tools in the first production release', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query_batch', description: 'Cypher topology query batch' },
      { name: 'exposure_profile', description: 'Remote exposure profile' },
      { name: 'exposure_quality', description: 'Remote exposure quality' },
      { name: 'exposure_carry', description: 'Remote exposure carry' },
      { name: 'exposure_crowding', description: 'Remote exposure crowding' },
      { name: 'exposure_exit_pressure', description: 'Remote exposure exit pressure' },
      { name: 'exposure_correlation', description: 'Remote exposure correlation' },
      { name: 'exposure_explain', description: 'Remote exposure explain' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    const exposureToolNames = [
      'exposure_profile',
      'exposure_quality',
      'exposure_carry',
      'exposure_crowding',
      'exposure_exit_pressure',
      'exposure_correlation',
      'exposure_explain',
    ]

    for (const name of exposureToolNames) expect(toolNames).not.toContain(name)
    expect(toolNames).toContain('aml_address_risk')
  })

  it('registers graph MCP app resource and preserves graph-backed remote tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'aml_address_risk',
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
      'aml_address_risk',
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
      'trace-tools',
      'network-capabilities',
      'graph-query',
      'graph-query-batch',
      'balance',
      'help',
    ]))
    expect(promptNames).not.toContain('money-flows-between-exchanges')
    expect(promptNames).not.toContain('address-connection-risk')
    expect(promptNames).not.toContain('address-poisoning-funding-probe')

    const addressRiskPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'address-risk')
    const traceToolsPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'trace-tools')
    const networkCapabilitiesPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'network-capabilities')
    const graphQueryPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'graph-query')
    const graphQueryBatchPrompt = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === 'graph-query-batch')
    expect(addressRiskPrompt?.[1].argsSchema.network.safeParse(undefined).success).toBe(false)
    expect(traceToolsPrompt?.[1].argsSchema.network.safeParse(undefined).success).toBe(false)
    expect(addressRiskPrompt?.[1].argsSchema.network.description).toContain('Do not guess')
    expect(traceToolsPrompt?.[1].argsSchema.network.description).toContain('Do not guess')
    expect(networkCapabilitiesPrompt?.[1].title).toBe('Network Capabilities')
    expect(graphQueryPrompt?.[1].title).toBe('Graph Query')
    expect(graphQueryBatchPrompt?.[1].title).toBe('Graph Query Batch')
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
        name: 'aml_address_risk',
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
    const config = findToolConfig(serverInstance, 'aml_address_risk')
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
        name: 'aml_address_risk',
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
    const config = findToolConfig(serverInstance, 'aml_address_risk')

    expect(config.description).toContain('Screen one blockchain address')
    expect(config.description).toContain('Required arguments: address, network.')
    expect(config.description).not.toContain('Use address_connection_risk instead')
  })

  it('rejects known public tool calls with missing required arguments before remote forwarding', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Missing required argument: network')
    expect(clientInstance.callTool).not.toHaveBeenCalled()
  })

  it('normalizes array address inputs for comma-separated GraphRAG tool fields', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'aml_trace_victim_funds',
        title: 'Trace Victim Funds',
        description: 'Victim fund tracing',
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
    const handler = findToolHandler(serverInstance, 'aml_trace_victim_funds')
    await handler({
      victim_addresses: ['5VictimA', '5VictimB'],
      known_suspect_addresses: ['5Scammer'],
      network: 'bittensor',
    })

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'aml_trace_victim_funds',
      arguments: {
        victim_addresses: '5VictimA,5VictimB',
        known_suspect_addresses: '5Scammer',
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
        name: 'aml_address_risk',
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
        tool: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
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
        name: 'aml_address_risk',
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
        tool: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'aml_address_risk',
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
        name: 'aml_address_risk',
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
        tool: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'aml_address_risk',
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
        name: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
  })

  it('fails closed when remote graph arrays are present without data', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
  })

  it('fails closed when remote graph url is forwarded without data', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'aml_address_risk',
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
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP call failed')
    expect(result.content[0].text).toContain('Invalid remote graph payload')
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
    const config = findToolConfig(serverInstance, 'help')
    const handler = findToolHandler(serverInstance, 'help')
    const result = await handler({})

    expect(config.title).toBe('Help')
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Chain Insights workspace for AI agents.')
    expect(result.content[0].text).toContain('Workflow:')
    expect(result.content[0].text).toContain('Network is required')
    expect(result.content[0].text).toContain('aml_address_risk')
    expect(result.content[0].text).toContain('graph_query_batch')
    expect(result.content[0].text).toContain('- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.')
    expect(result.content[0].text).not.toContain('topup')
    expect(result.content[0].text).toContain('Graph visualization behavior')
    expect(result.content[0].text).toContain('local graph report server is started automatically')
    expect(result.content[0].text).toContain('Graph query hints for network=bittensor')
    expect(result.content[0].text).toContain('FLOWS_TO')
    expect(result.content[0].text).toContain('first_tx_id')
    expect(result.content[0].text).toContain('archive member-address lookup')
    expect(result.content[0].text).toContain('(:Identity)-[:HAS_ADDRESS]->(:Address)')
    expect(result.content[0].text).toContain('Address.network')
    expect(result.content[0].text).toContain('member-ledger')
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
