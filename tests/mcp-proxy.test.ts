import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const testDataDir = vi.hoisted(() => `/tmp/chain-insights-mcp-proxy-test-${process.pid}`)

// Mock all external dependencies before importing proxy
vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    mcpEndpoint: 'http://localhost:8080/mcp',
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
    'Capacity: ~420 standard tool calls',
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
}))

vi.mock('../src/mcp/schema-cache.js', () => ({
  loadSchema: vi.fn().mockResolvedValue(null), // default: cache miss
  saveSchema: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const registeredTools: Map<string, Function> = new Map()
  // Must use regular function (not arrow) so `new McpServer()` works
  const McpServer = vi.fn(function () {
    return {
      registerTool: vi.fn(function (name: string, _opts: unknown, handler: Function) {
        registeredTools.set(name, handler)
      }),
      registerResource: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      _registeredTools: registeredTools,
    }
  })
  return { McpServer, _registeredTools: registeredTools }
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
        tools: [{ name: 'trace_address', description: 'Trace address on-chain' }],
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

let originalSigintListeners: NodeJS.SignalsListener[] = []
let originalSigtermListeners: NodeJS.SignalsListener[] = []

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
    vi.clearAllMocks()
    rmSync(testDataDir, { recursive: true, force: true })
  })

  afterEach(() => {
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

  it('registers a local topup tool that returns a browser URL', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'topup')
    const result = await handler({})

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('http://127.0.0.1:4500')
    expect(result.content[0].text).toContain('0x0000000000000000000000000000000000000001')
  })

  it('registers topup as an MCP Apps tool/resource using the copied component', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { registerAppResource, registerAppTool } = await import('@modelcontextprotocol/ext-apps/server')

    await createProxy()

    expect(registerAppResource).toHaveBeenCalledWith(
      expect.anything(),
      'Chain Insights Wallet Topup',
      'ui://chain-insights/topup.html',
      expect.objectContaining({
        description: expect.stringContaining('wallet funding page'),
      }),
      expect.any(Function),
    )
    expect(registerAppTool).toHaveBeenCalledWith(
      expect.anything(),
      'topup',
      expect.objectContaining({
        _meta: {
          ui: {
            resourceUri: 'ui://chain-insights/topup.html',
          },
        },
      }),
      expect.any(Function),
    )
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
  })

  it('persists remote graph _meta and returns only local artifact pointer', async () => {
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

    expect(result.content).toEqual([{ type: 'text', text: '## Risk Report' }])
    expect(result.structuredContent.facts.risk.level).toBe('critical')
    expect(result.structuredContent).not.toHaveProperty('app_data')
    expect(result._meta.chainInsights.graph.data).toBeUndefined()
    expect(result._meta.chainInsights.graph.url).toMatch(/^http:\/\/127\.0\.0\.1:4321\/artifacts\/.+\/graph\.json$/)

    const artifactId = result._meta.chainInsights.graph.id
    const raw = await readFile(join(testDataDir, 'artifacts', artifactId, 'graph.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(remoteGraphData)
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

  it('registers a local help tool that explains proxy-local tools', async () => {
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
    expect(result.content[0].text).toContain('Remote GraphRAG tools')
    expect(result.content[0].text).toContain('balance')
    expect(result.content[0].text).toContain('topup')
  })
})
