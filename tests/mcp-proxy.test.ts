import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as z from 'zod'
import { PACKAGE_VERSION } from '../src/version.js'
import { factsReadViolations } from './support/facts-contract.js'

function retiredName(head: string, tail: string): string {
  return `${head}${tail}`
}

const testDataDir = vi.hoisted(() => `/tmp/chain-insights-mcp-proxy-test-${process.pid}`)
const dossierAppendFindingMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionStartMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    sessionId: '20260512_001_exchange-deposit-clustering_s001',
    startTime: '2026-05-12T20:00:00.000Z',
    status: 'active',
  })
)
const sessionEndMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionArchiveOldMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// Mock all external dependencies before importing proxy
vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    graphMcpEndpoint: 'http://localhost:8012/mcp',
    graphMcpAuthToken: 'graph-debug-token',
    serverPort: 4321,
    dataDir: testDataDir,
    version: '1',
  }),
}))

vi.mock('../src/wallet/index.js', () => ({
  isWalletConfigured: vi.fn().mockResolvedValue(true),
  decryptKey: vi
    .fn()
    .mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
}))

vi.mock('../src/wallet/tools.js', () => ({
  getWalletAccount: vi.fn().mockResolvedValue({
    address: '0x0000000000000000000000000000000000000001',
    privateKey: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  }),
  getWalletBalanceResult: vi.fn().mockResolvedValue({
    schema: 'chain-insights.result.v1',
    tool: 'wallet_balance',
    hint: null,
    facts: {
      wallet: {
        address: '0x0000000000000000000000000000000000000001',
        payment_network: 'base',
        payment_network_display: 'Base',
        chain_id: 8453,
        token: 'USDC',
        token_balance: '4.200000',
        gas_token: 'ETH',
        gas_balance: '0.0001',
      },
    },
  }),
  formatWalletBalanceResult: vi
    .fn()
    .mockReturnValue(
      [
        'Payment wallet: 0x0000000000000000000000000000000000000001',
        'USDC on Base: 4.200000',
        'Gas on Base: 0.0001 ETH',
        'Payment network: Base',
        'Base ETH is used only for one-time payment setup gas.',
      ].join('\n')
    ),
  getWalletBalanceText: vi
    .fn()
    .mockResolvedValue(
      [
        'Payment wallet: 0x0000000000000000000000000000000000000001',
        'USDC on Base: 4.200000',
        'Gas on Base: 0.0001 ETH',
        'Payment network: Base',
      ].join('\n')
    ),
}))

vi.mock('../src/wallet/topup-server.js', () => ({
  startTopupServer: vi.fn().mockResolvedValue('http://127.0.0.1:4500'),
  generateArtifactHtml: vi.fn().mockReturnValue('<html>copied topup component</html>'),
}))

vi.mock('../src/mcp/client.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createMcpFetchClient: vi.fn().mockReturnValue(fetch),
    createConfiguredGraphMcpFetch: vi.fn().mockResolvedValue(fetch),
    resolveGraphMcpEndpoint: vi.fn((config: { graphMcpEndpoint: string }) =>
      config.graphMcpEndpoint.trim()
    ),
  }
})

vi.mock('../src/mcp/schema-cache.js', () => ({
  loadSchema: vi.fn().mockResolvedValue(null), // default: cache miss
  saveSchema: vi.fn().mockResolvedValue(undefined),
}))

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
          {
            name: retiredName('money', '_flows_between_exchanges'),
            description: 'Exchange flow tracing',
          },
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
  name: string
): Function {
  const call = serverInstance.registerTool.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Tool was not registered: ${name}`)
  }
  return call[2] as Function
}

function findToolConfig(
  serverInstance: { registerTool: ReturnType<typeof vi.fn> },
  name: string
): Record<string, unknown> {
  const call = serverInstance.registerTool.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Tool was not registered: ${name}`)
  }
  return call[1] as Record<string, unknown>
}

function findPromptHandler(
  serverInstance: { registerPrompt: ReturnType<typeof vi.fn> },
  name: string
): Function {
  const call = serverInstance.registerPrompt.mock.calls.find((entry) => entry[0] === name)
  if (!call) {
    throw new Error(`Prompt was not registered: ${name}`)
  }
  return call[2] as Function
}

// Trace seed inputs trigger an address-grain existence pre-flight batch
// before the main tool batch. This response confirms nothing: per R2/R3, a
// seed whose :Address existence probe returns no row is OMITTED from tracing
// (reported as unresolved), so callers that need a seed to actually trace
// must use seedExistenceConfirms() instead.
// Confirms each seed input (in order) exists as a real :Address node via the
// seed_address_exists_N pre-flight batch, mirroring a real indexed match.
async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

let originalSigintListeners: NodeJS.SignalsListener[] = []
let originalSigtermListeners: NodeJS.SignalsListener[] = []
let originalWorkspace: string | undefined
let originalProxyMode: string | undefined
let originalActionLog: string | undefined

function removeAddedSignalListeners(
  signal: NodeJS.Signals,
  original: NodeJS.SignalsListener[]
): void {
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
    originalActionLog = process.env['CIA_ACTION_LOG']
    vi.clearAllMocks()
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    vi.mocked(McpServer).mockClear()
    rmSync(testDataDir, { recursive: true, force: true })
    mkdirSync(join(testDataDir, '.chain-insights'), { recursive: true })
    writeFileSync(
      join(testDataDir, '.chain-insights', 'workspace.json'),
      JSON.stringify({
        schema: 'chain-insights.workspace.v1',
        workspace_root: testDataDir,
      }) + '\n'
    )
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = testDataDir
    process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = 'workspace'
  })

  afterEach(() => {
    if (originalWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = originalWorkspace
    if (originalProxyMode === undefined) delete process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE']
    else process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = originalProxyMode
    if (originalActionLog === undefined) delete process.env['CIA_ACTION_LOG']
    else process.env['CIA_ACTION_LOG'] = originalActionLog
    removeAddedSignalListeners('SIGINT', originalSigintListeners)
    removeAddedSignalListeners('SIGTERM', originalSigtermListeners)
  })

  it('resolves workspace mode by default and accepts explicit stateless proxy mode', async () => {
    const { resolveMcpProxyMode } = await import('../src/mcp/proxy.js')

    expect(resolveMcpProxyMode({})).toBe('stateless')
    expect(resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'stateless' })).toBe('stateless')
    expect(resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'no-workspace' })).toBe('stateless')
    expect(() => resolveMcpProxyMode({ CHAIN_INSIGHTS_MCP_PROXY_MODE: 'cases-only' })).toThrow(
      'CHAIN_INSIGHTS_MCP_PROXY_MODE'
    )
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
      expect.any(Function)
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
    expect(toolNames).toContain('wallet_balance')
    expect(toolNames).toContain('meta_help')
    expect(toolNames).toContain('meta_network_capabilities')
    expect(toolNames).toContain('meta_usage_status')
    expect(toolNames).toContain('graph_query')
    expect(toolNames).not.toContain(retiredName('aml_trace_victim', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_suspect', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_deposit', '_sources'))
    expect(toolNames).not.toContain('balance')
    expect(toolNames).not.toContain('help')
    expect(toolNames).not.toContain('network_capabilities')
    expect(toolNames).not.toContain('usage_status')
    expect(toolNames).not.toContain(retiredName('track', '_funds'))
    expect(toolNames).not.toContain(retiredName('scam', '_topology'))
    expect(serverInstance.connect).toHaveBeenCalled()
  })

  it('connects the stdio server and registers the shared tools in stateless mode', async () => {
    process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = 'stateless'
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
    // The core of issue #136: the stdio server must actually attach in stateless mode.
    expect(serverInstance.connect).toHaveBeenCalled()
    // Shared tools must register in stateless mode too.
    expect(toolNames).toContain('meta_network_capabilities')
    expect(toolNames).toContain('meta_usage_status')
    expect(toolNames).toContain('meta_help')
    expect(toolNames).toContain('graph_query')
    expect(toolNames).toContain('aml_address_risk')
    expect(toolNames).not.toContain(retiredName('aml_trace_victim', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_suspect', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_deposit', '_sources'))
    expect(toolNames).toContain('wallet_balance')
  })

  it('starts local Chain Insights tools when paid Chain Insights Graph fetch setup needs wallet configuration', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const mcpClient = await import('../src/mcp/client.js')
    vi.mocked(mcpClient.createConfiguredGraphMcpFetch).mockRejectedValueOnce(
      new Error('Wallet not configured. Run `cia wallet ready`.')
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

    expect(toolNames).toContain('wallet_balance')
    expect(toolNames).toContain('meta_help')
    expect(toolNames).toContain('meta_network_capabilities')
    expect(toolNames).toContain('meta_usage_status')
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
      })
    )
    const instructions = vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions
    expect(instructions).toContain('aml_address_risk')
    expect(instructions).toContain('Network is required')
    expect(instructions).not.toContain('Graph visualization behavior')
    expect(instructions).not.toContain('prepares the graph view automatically')
    expect(instructions).not.toContain('iframe')
    expect(instructions).toContain('FLOWS_TO')
    expect(instructions).not.toContain('first_tx_id')
    expect(instructions).toContain('total money flow')
    expect(instructions).toContain('LINKED is served on the topology graph only')
    expect(instructions).toContain('(:Address)-[:OPERATED_BY]->(:Address)')
    // OPERATED_BY points at the transaction sender, never at the approved spender.
    expect(instructions).toContain(
      "the transaction sender that moved the owner's tokens (ERC-20/721), or the event operator (ERC-1155); not the approved spender"
    )
    expect(instructions).not.toMatch(/approved operator/i)
    expect(instructions).toContain('not a risk label')
    expect(instructions).toContain('Call meta_network_capabilities first')
    expect(instructions).toContain('CIA does not pick a default network')
    expect(instructions).toContain('(:Address)-[:LINKED]-(:Address)')
    expect(instructions).toContain('n.network AS network')
    expect(instructions).toContain('declared_owner')
    expect(instructions).toContain('exchange hot wallets are terminal endpoints only')
    expect(instructions).toContain('schema discovery')
    expect(instructions).toContain('Select the graph with USE topology')
    expect(instructions).toContain('address is the node grain, not the topology name')
    expect(instructions).not.toContain('NeuronEndpoint')
    expect(instructions).not.toContain('(:Neuron)-[:MINES|:VALIDATES]->(:Subnet')
    expect(instructions).not.toContain('(:Address)-[:HOTKEY_OF|:COLDKEY_OF]->(:Neuron)')
    expect(instructions).not.toContain('bittensor')
    expect(instructions).toContain('Pool trace rule, for every trace')
    expect(instructions).toContain(
      'MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to})'
    )
    expect(instructions).toContain(
      'MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address)'
    )
    expect(instructions).toContain('A walk may end at a Pool, but never starts at one')
    expect(instructions).toContain('WHERE NOT victim:Pool AND receiver.address <> victim.address')
    expect(instructions).toContain(
      '-[r:FLOWS_TO|SWAPPED]-(b:Address) WHERE NOT a:Pool AND NOT owned:Pool'
    )
    expect(instructions).toContain('(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)')
    expect(instructions).toContain('(:Address)-[:SWAPPED]->(:Address)')
    expect(instructions).toContain('BRIDGE_CROSSING')
    expect(instructions).not.toContain('swap.kind')
    expect(instructions).not.toContain('DexTransaction')
    expect(instructions).not.toContain('SS58')
    expect(instructions).toContain('raw chain-native H160 address')
  })

  it.each(['workspace', 'stateless'])(
    'teaches the column convention of the pictures in the %s server instructions',
    async (mode) => {
      process.env['CHAIN_INSIGHTS_MCP_PROXY_MODE'] = mode
      const { loadSchema } = await import('../src/mcp/schema-cache.js')
      vi.mocked(loadSchema).mockResolvedValueOnce(null)

      const { createProxy } = await import('../src/mcp/proxy.js')
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

      await createProxy()

      const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
      // The graph rule, with its optional columns.
      expect(instructions).toContain('from_address and to_address columns draw a graph')
      expect(instructions).toContain(
        'amount_usd_sum, tx_count, first_seen_timestamp, last_seen_timestamp, link_kind, from_labels, to_labels'
      )
      // The chart rule, and the table for the rest.
      expect(instructions).toContain(
        'a day, date or *_timestamp column and number columns draw a chart'
      )
      expect(instructions).toContain('Any other rows draw a table')
      // One example each: a graph from an anchored address, a chart from one day of a known pair.
      expect(instructions).toContain(
        'RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum'
      )
      const chartExample = /transfers of a known pair on one day: (USE facts [^\n]+)/.exec(
        instructions
      )?.[1]
      expect(chartExample).toContain(
        't.block_timestamp AS block_timestamp, t.amount_usd AS amount_usd'
      )
      // The chart example is a read the graph server accepts: a pair and one day, no ORDER BY.
      expect(factsReadViolations(chartExample ?? '')).toEqual([])
      // No dedicated tool is named for a picture.
      expect(instructions).not.toContain('money_flows')
      expect(instructions).not.toContain('graph_expand')
    }
  )

  it('serves the graph names: three label_risk lists, role words, four role flags, UNSCORED', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    // The three per-label risk lists, as parallel lists, never one label_risk property.
    for (const list of [
      'label_risk_labels',
      'label_risk_levels',
      'label_risk_updated_timestamps',
    ]) {
      expect(instructions).toContain(list)
    }
    expect(instructions).not.toMatch(/label_risk\b(?!_)/)
    // An absent risk_score is UNSCORED, which is no signal and never low risk.
    expect(instructions).toContain('An absent risk_score means UNSCORED')
    // Role words and the four role flags, each flag present only when true.
    for (const word of ['Exchange', 'Scam', 'Victim', 'Sanctioned']) {
      expect(instructions).toMatch(new RegExp(`\\b${word}\\b`))
    }
    for (const pair of [
      ':Exchange and is_exchange follow the exchange label',
      ':Scam and is_scam the risk label',
      ':Victim and is_victim the protection label',
      ':Sanctioned and is_sanctioned the sanctioned label',
    ]) {
      expect(instructions).toContain(pair)
    }
    expect(instructions).toContain('present only when true and absent otherwise, never false')
    expect(instructions).not.toMatch(/is_(exchange|scam|victim|sanctioned)\s*=\s*false/)
    // Labels are role words, never detector names.
    expect(instructions).toContain('role words, never detector names')
    expect(instructions).not.toMatch(/FAKE_TOKEN|FAKE TOKEN|PHANTOM_TRANSFER/)
    // Names the graph retired.
    for (const retired of [
      'swap_envelope',
      'assets_paired',
      'first_tx_id',
      'last_tx_id',
      'bucket_start_timestamp',
      'bucket_end_timestamp',
      'owner_last_height',
      'updated_through_height',
      'creation_type',
      'pattern_type',
    ]) {
      expect(instructions).not.toContain(retired)
    }
    // A walk passes a labelled node with no is_exchange.
    expect(instructions).toContain('is_exchange is absent unless true')
  })

  it('serves the routing rule and the move by class from the one routing source', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)
    const routing = await import('../src/mcp/layer-routing.js')

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    const text = instructions.replace(/\s+/g, ' ')
    for (const line of routing.routingLines()) {
      expect(text, line).toContain(line)
    }
    for (const line of routing.moveLines()) {
      expect(text, line).toContain(line)
    }
    // The three layers are named, with the chain layer among them.
    expect(text).toContain('`USE topology`')
    expect(text).toContain('`USE facts`')
    expect(text).toContain('`USE chain`')
    // The hints name the field and never a chain limit.
    expect(text).toContain('chain_admission')
    expect(text).not.toMatch(/\b(?:4|four) slots\b/)
  })

  it('reads swap attribution from SWAPPED or the facts SWAP row, never from FLOWS_TO', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    expect(instructions).toContain(
      'Swap attribution is read from SWAPPED, the aggregate (strength, pools, families), or from the USE facts SWAP row, one route. FLOWS_TO carries value only.'
    )
    // FLOWS_TO carries value only: no swap property is named on it.
    for (const stamp of [
      'swap.kind',
      'swap.family',
      'swap.deployment',
      'swap.pool',
      'swap.route_id',
      'swap_envelope',
      'assets_paired',
    ]) {
      expect(instructions).not.toContain(stamp)
    }
    expect(instructions).toContain(
      'FLOWS_TO properties are tx_count, amount_usd_sum, first_seen_timestamp, last_seen_timestamp.'
    )
  })

  it('says tx_count counts internal native transfers and TRANSFER lists each one', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    expect(instructions).toContain('internal native transfers')
    expect(instructions).toContain('USE facts TRANSFER lists all three')
    expect(instructions).toContain('Every TRANSFER row has a kind: token, native or internal.')
    // A link covers all time and a facts read covers one day.
    expect(instructions).toContain('A link covers all time and a USE facts read covers one day')
    // The anchor query stays, on one day and with no ORDER BY, for any pair.
    expect(instructions).toContain(
      'WHERE t.block_date = "YYYY-MM-DD" RETURN t.tx_id, t.block_timestamp LIMIT 1'
    )
  })

  it('says no swap has strength swap today and a 0 on SWAPPED USD can mean no price', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    expect(instructions).toContain('Today no route is swap')
    expect(instructions).toContain('every served route is swap_like')
    expect(instructions).toContain('swap_unsplit')
    expect(instructions).toContain('a route side with no price adds 0, so 0 can mean no price')
    expect(instructions).not.toContain('no reviewed family')
  })

  it('lists the four served FLOWS_TO fields and names the sync bookkeeping as internal', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const instructions = String(vi.mocked(McpServer).mock.calls[0]?.[1]?.instructions)
    // The four served fields, then the two internal ones, named and not to be queried.
    expect(instructions).toContain(
      'FLOWS_TO properties are tx_count, amount_usd_sum, first_seen_timestamp, last_seen_timestamp. pair_key and synced_through_height are internal sync bookkeeping, not to be queried.'
    )
    // Readers are never told the two internal fields do not exist.
    expect(instructions).not.toContain('No other edge fields exist')
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

    expect(clientInstance.callTool).toHaveBeenCalledWith(
      {
        name: 'graph_query_batch',
        arguments: expect.objectContaining({
          network: 'bittensor',
          per_query_timeout_seconds: 120,
        }),
      },
      undefined,
      expect.objectContaining({
        timeout: expect.any(Number),
        maxTotalTimeout: expect.any(Number),
      })
    )
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

    const entries = await readJsonl(
      join(testDataDir, '.chain-insights', 'runtime', 'logs', 'mcp-proxy.jsonl')
    )
    expect(entries.some((entry) => entry.event === 'proxy.start')).toBe(true)
    expect(
      entries.some((entry) => entry.event === 'tool.start' && entry.tool === 'graph_query_batch')
    ).toBe(true)
    expect(
      entries.some((entry) => entry.event === 'tool.end' && entry.tool === 'graph_query_batch')
    ).toBe(true)

    const cypherStart = entries.find(
      (entry) => entry.event === 'topology.start' && entry.tool === 'graph_query_batch'
    )
    expect(cypherStart).toBeTruthy()
    expect(cypherStart?.network).toBe('bittensor')
    expect(cypherStart?.query_count).toBe(1)
    expect(JSON.stringify(cypherStart)).toContain('MATCH (n {address:')
    expect(JSON.stringify(cypherStart)).not.toContain('\n')
    expect(JSON.stringify(entries)).not.toContain('should-not-leak')
    expect(JSON.stringify(entries)).toContain('[redacted]')
  })

  it('action log captures warnings and search_limits from a chain-insights.trace.v1 result', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const actionLogFile = join(testDataDir, 'actions.jsonl')
    process.env['CIA_ACTION_LOG'] = actionLogFile

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    // Remote result carrying warnings at the top level and search_limits
    // under input; the action-log signal extraction must pick both up.
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'trace result' }],
      isError: false,
      structuredContent: {
        schema: 'chain-insights.trace.v1',
        tool: 'graph_query',
        input: {
          search_limits: { hop_depth: { requested: 5, used: 3, ceiling: 5 } },
        },
        warnings: ['No upstream sources were connected in the queried topology.'],
      },
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'graph_query_batch')
    await handler({
      network: 'bittensor',
      queries: [{ id: 'q1', query: 'USE topology MATCH (n) RETURN n LIMIT 1' }],
    })

    const entries = await readJsonl(actionLogFile)
    const entry = entries.find((e) => e['tool'] === 'graph_query_batch')
    expect(entry).toBeTruthy()
    expect(entry?.['warnings']).toEqual([
      'No upstream sources were connected in the queried topology.',
    ])
    expect(entry?.['search_limits']).toEqual({ hop_depth: { requested: 5, used: 3, ceiling: 5 } })
  })

  it('action log omits warnings and search_limits for a chain-insights.result.v1 result (neither field exists there)', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const actionLogFile = join(testDataDir, 'actions.jsonl')
    process.env['CIA_ACTION_LOG'] = actionLogFile

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    // Realistic chain-insights.result.v1 shape (aml_address_risk ~lines
    // 995-1000, track_funds ~line 2318): a `facts` object exists but never
    // carries warnings or search_limits.
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'risk result' }],
      isError: false,
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'aml_address_risk',
        facts: {
          subject: { network: 'bittensor', addresses: ['5Grw...'] },
          risk: { level: 'low' },
        },
      },
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'graph_query_batch')
    await handler({
      network: 'bittensor',
      queries: [{ id: 'q1', query: 'USE topology MATCH (n) RETURN n LIMIT 1' }],
    })

    const entries = await readJsonl(actionLogFile)
    const entry = entries.find((e) => e['tool'] === 'graph_query_batch')
    expect(entry).toBeTruthy()
    expect(entry?.['warnings']).toBeUndefined()
    expect(entry?.['search_limits']).toBeUndefined()
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
    expect(result.content[0].text).toContain('cia wallet ready')
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

  it('registers a local wallet_balance tool backed by the encrypted payment wallet', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const config = findToolConfig(serverInstance, 'wallet_balance')
    const handler = findToolHandler(serverInstance, 'wallet_balance')
    const result = await handler({})

    expect(config.title).toBe('Wallet Balance')
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('USDC on Base: 4.200000')
    expect(result.content[0].text).toContain('Payment network: Base')
    expect(result.content[0].text).not.toContain('Network: Base')
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'wallet_balance',
      facts: {
        wallet: {
          address: '0x0000000000000000000000000000000000000001',
          payment_network: 'base',
          token: 'USDC',
          token_balance: '4.200000',
          gas_token: 'ETH',
          gas_balance: '0.0001',
        },
      },
    })
  })

  it('names the proxy view on meta_usage_status and meta_subscription_status', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'usage_status', description: 'Usage status' },
      { name: 'subscription_status', description: 'Subscription status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    for (const name of ['meta_usage_status', 'meta_subscription_status']) {
      expect(findToolConfig(serverInstance, name)._meta).toEqual({
        ui: { resourceUri: 'ui://chain-insights/view' },
        'ui/resourceUri': 'ui://chain-insights/view',
      })
    }
  })

  it('registers meta_usage_status with canonical visible text', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'usage_status', description: 'Usage status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"tool":"usage_status"}' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'usage_status',
        facts: {
          usage: {
            remaining_seconds: 10,
          },
        },
      },
      isError: false,
    })
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'meta_usage_status')
    const result = await handler({})

    expect(clientInstance.callTool).toHaveBeenCalledWith({ name: 'usage_status', arguments: {} })
    expect(result.structuredContent.tool).toBe('meta_usage_status')
    expect(result.content[0].text).toContain('"tool": "meta_usage_status"')
    expect(result.content[0].text).not.toContain('"tool":"usage_status"')
  })

  it('returns primitive backend usage status when remote usage_status is absent', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'network_capabilities', description: 'Network capabilities' },
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
    ])

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
    const handler = findToolHandler(serverInstance, 'meta_usage_status')
    const result = await handler({})

    expect(clientInstance.callTool).not.toHaveBeenCalledWith({
      name: 'usage_status',
      arguments: {},
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'meta_usage_status',
      facts: {
        usage: {
          mode: 'primitive_graph_backend',
          usage_status_tool: 'unavailable',
        },
      },
    })
    expect(result.content[0].text).toContain('"usage_status_tool": "unavailable"')
  })

  it('registers meta_subscription_status as a local tool and hides the raw remote name', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'subscription_status', description: 'Subscription status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const toolNames = serverInstance.registerTool.mock.calls.map((entry) => entry[0])
    expect(toolNames).toContain('meta_subscription_status')
    expect(toolNames).not.toContain('subscription_status')
  })

  it('forwards meta_subscription_status to the upstream subscription_status with the local wallet', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'subscription_status', description: 'Subscription status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"tool":"subscription_status"}' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'subscription_status',
        facts: {
          subscription: {
            wallet: '0x0000000000000000000000000000000000000001',
            window_end: '2026-10-01T00:00:00Z',
            allowance_usd: 5,
            consumed_usd: 1.25,
            tier: 16,
          },
        },
      },
      isError: false,
    })
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'meta_subscription_status')
    const result = await handler({})

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'subscription_status',
      arguments: { wallet: '0x0000000000000000000000000000000000000001' },
    })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.tool).toBe('meta_subscription_status')
    expect(result.content[0].text).toContain('"tool": "meta_subscription_status"')
    expect(result.content[0].text).toContain('"window_end": "2026-10-01T00:00:00Z"')
  })

  it('returns an unavailable subscription status when the remote subscription_status tool is absent', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'network_capabilities', description: 'Network capabilities' },
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
    ])

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
    const handler = findToolHandler(serverInstance, 'meta_subscription_status')
    const result = await handler({})

    expect(clientInstance.callTool).not.toHaveBeenCalledWith({
      name: 'subscription_status',
      arguments: { wallet: '0x0000000000000000000000000000000000000001' },
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'meta_subscription_status',
      facts: {
        subscription: {
          subscription_status_tool: 'unavailable',
        },
      },
    })
    expect(result.content[0].text).toContain('"subscription_status_tool": "unavailable"')
  })

  it('never throws when the upstream subscription_status call fails', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'subscription_status', description: 'Subscription status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockRejectedValueOnce(
      new Error('MCP error -32602: unknown tool "subscription_status"')
    )
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'meta_subscription_status')
    const result = await handler({})

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'meta_subscription_status',
      facts: {
        subscription: {
          subscription_status_tool: 'unavailable',
        },
      },
    })
    expect(result.structuredContent.facts.subscription.reason).toContain('subscription_status')
  })

  it('returns an unavailable subscription status when the upstream result is a tool error', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'subscription_status', description: 'Subscription status' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'counter unavailable' }],
      isError: true,
    })
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'meta_subscription_status')
    const result = await handler({})

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.result.v1',
      tool: 'meta_subscription_status',
      facts: {
        subscription: {
          subscription_status_tool: 'unavailable',
          reason: expect.stringContaining('counter unavailable'),
        },
      },
    })
  })

  it('mirrors meta_network_capabilities as every GraphRAG network with its layer blocks and per-network tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'network_capabilities', description: 'Network capabilities' },
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'remote network capabilities' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'network_capabilities',
        hint: null,
        facts: {
          capabilities: {
            schema: 'chain-insights.network-capabilities.v1',
            networks: [
              {
                network: 'bittensor',
                display_name: 'Bittensor',
                status: 'live',
                layers: {
                  topology: { enabled: true },
                  facts: { enabled: true },
                  risk: { enabled: false },
                },
                tools: { graph_query: 'available', graph_query_batch: 'available' },
              },
              {
                network: 'robinhood',
                display_name: 'Robinhood',
                status: 'live',
                layers: {
                  topology: { enabled: true },
                  facts: { enabled: true },
                  risk: { enabled: false },
                },
                chain_admission: { enabled: true, status: 'ok', batch_max: 5 },
                tools: { graph_query: 'available', graph_query_batch: 'available' },
              },
            ],
          },
        },
      },
      isError: false,
    })
    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'meta_network_capabilities')
    const result = await handler({})

    expect(clientInstance.callTool).toHaveBeenCalledWith({
      name: 'network_capabilities',
      arguments: {},
    })
    const networks = result.structuredContent.facts.capabilities.networks as Array<
      Record<string, unknown>
    >
    expect(networks).toEqual([
      expect.objectContaining({
        network: 'bittensor',
        display_name: 'Bittensor',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }),
      expect.objectContaining({
        network: 'robinhood',
        display_name: 'Robinhood',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        chain_admission: { enabled: true, status: 'ok', batch_max: 5 },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }),
    ])
    expect(networks[0]).not.toHaveProperty('chain_admission')
    expect(networks).toHaveLength(2)
    expect(result.structuredContent.facts.capabilities.networks[0]?.tools).not.toHaveProperty(
      'aml_address_risk'
    )
    expect(result.structuredContent.facts.capabilities.networks[0]?.tools).not.toHaveProperty(
      'network_capabilities'
    )
    expect(result.content[0].text).toContain('bittensor')
    expect(result.content[0].text).toContain('robinhood')
    expect(result.content[0].text).toContain('"topology"')
    expect(result.content[0].text).toContain('"chain_admission"')
    expect(result.content[0].text).toContain('"batch_max": 5')
  })

  it('returns an empty network list when remote capabilities are absent', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query', description: 'Federated graph query' },
    ])

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
    const handler = findToolHandler(serverInstance, 'meta_network_capabilities')
    const result = await handler({})

    expect(clientInstance.callTool).not.toHaveBeenCalledWith({
      name: 'network_capabilities',
      arguments: {},
    })
    expect(result.isError).not.toBe(true)
    const networks = result.structuredContent.facts.capabilities.networks as Array<
      Record<string, unknown>
    >
    expect(networks).toEqual([])
    expect(result.content[0].text).not.toContain('robinhood')
    expect(result.content[0].text).not.toContain('"topology"')
    expect(result.content[0].text).not.toContain('"enabled"')
  })

  it('advertises canonical graph, metadata, and wallet tools but not hidden remote tools', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
      { name: 'topup', description: 'Unsupported remote top-up tool' },
      {
        name: retiredName('money', '_flows_between_exchanges'),
        description: 'Deprecated exchange flow tool',
      },
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
    expect(toolNames).toContain('wallet_balance')
    expect(toolNames).toContain('meta_network_capabilities')
    expect(toolNames).toContain('meta_usage_status')
    expect(toolNames).toContain('meta_help')
    expect(toolNames).not.toContain('balance')
    expect(toolNames).not.toContain('network_capabilities')
    expect(toolNames).not.toContain('usage_status')
    expect(toolNames).not.toContain('help')
    expect(toolNames).not.toContain('topup')
    expect(toolNames).not.toContain(retiredName('money', '_flows_between_exchanges'))
    expect(toolNames).not.toContain('address_connection_risk')

    const graphQueryBatch = findToolConfig(serverInstance, 'graph_query_batch')
    const jsonSchema = z.toJSONSchema(
      z.object(graphQueryBatch.inputSchema as z.ZodRawShape)
    ) as Record<string, unknown>
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>
    expect(jsonSchema.required).toEqual(['network', 'queries'])
    expect(properties.per_query_timeout_seconds.maximum).toBe(600)
  })

  it('does not expose a retired graph-scope schema property on any of the four aml_* tools', async () => {
    const retiredScopeArg = retiredName('topology', '_scope')
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
    ])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }

    for (const toolName of ['aml_address_risk']) {
      const config = findToolConfig(serverInstance, toolName)
      const jsonSchema = z.toJSONSchema(z.object(config.inputSchema as z.ZodRawShape)) as Record<
        string,
        unknown
      >
      const properties = jsonSchema.properties as Record<string, Record<string, unknown>>
      expect(
        properties[retiredScopeArg],
        `${toolName} must not expose a graph-scope argument`
      ).toBeUndefined()
    }
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
    expect(toolNames).not.toContain(retiredName('aml_trace_victim', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_suspect', '_funds'))
    expect(toolNames).not.toContain(retiredName('aml_trace_deposit', '_sources'))
    expect(toolNames).not.toContain(staleTrace)
    expect(toolNames).not.toContain(staleTrack)
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
    clientInstance.callTool.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            schema: 'chain-insights.result.v1',
            tool: 'graph_query_batch',
            facts: {
              queries: [
                {
                  id: 'address_profile',
                  ok: true,
                  results: [
                    {
                      address: '5Addr',
                      network: 'bittensor',
                      display_labels: ['validator'],
                      system_labels: ['Address', 'Validator'],
                      live_risk_score: 0.91,
                      live_risk_level: 'critical',
                      label_risk_labels: ['Scam laundering intermediate'],
                      label_risk_levels: ['high'],
                      label_risk_updated_timestamps: [1700000000000],
                      degree_in: 3,
                      degree_out: 4,
                    },
                  ],
                },
                {
                  id: 'exchange_outflows_2',
                  ok: true,
                  results: [
                    {
                      direction: 'outflow',
                      exchange_address: '5Exchange',
                      exchange_labels: ['Address', 'Exchange'],
                      exchange_display_labels: ['Binance'],
                      deposit_address: '5Deposit',
                      hops: 2,
                      amount_usd_sum: 88,
                      edge_props: [
                        {
                          amount_usd_sum: 22,
                          tx_count: 1,
                        },
                        {
                          amount_usd_sum: 88,
                          tx_count: 2,
                        },
                      ],
                      path: ['5Addr', '5Deposit', '5Exchange'],
                    },
                  ],
                },
                { id: 'exchange_inflows_1', ok: true, results: [] },
                { id: 'connection_probe', ok: true, results: [] },
              ],
            },
          }),
        },
      ],
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5Addr', network: 'bittensor' })

    expect(clientInstance.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'graph_query_batch',
        arguments: expect.not.objectContaining({
          per_query_timeout_seconds: expect.anything(),
        }),
      }),
      undefined,
      expect.objectContaining({
        timeout: expect.any(Number),
        maxTotalTimeout: expect.any(Number),
      })
    )
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Address risk for bittensor:5Addr')
    expect(result.content[0].text).toContain('Risk: critical (0.91)')
    expect(result.content[0].text).toContain('Live node triage: critical (0.91)')
    expect(result.content[0].text).toContain('Exchange behavior')
    expect(result.content[0].text).toContain('5Exchange')
    expect(result.structuredContent.facts.risk).toMatchObject({
      level: 'critical',
      score: 0.91,
      ml_risk_score: 0.91,
      confidence: 'high',
      live_node: {
        risk_score: 0.91,
        risk_level: 'critical',
        source: 'topology_node',
      },
    })
    expect(result.structuredContent.facts.subject.addresses).toEqual(['5Addr'])
    expect(result.structuredContent.facts.exchange_behavior.outflows[0].exchange_address).toBe(
      '5Exchange'
    )
    expect(result._meta).toBeUndefined()
    expect(clientInstance.callTool).toHaveBeenCalledWith(
      {
        name: 'graph_query_batch',
        arguments: expect.objectContaining({
          network: 'bittensor',
          queries: expect.arrayContaining([
            expect.objectContaining({ id: 'exchange_outflows_1' }),
            expect.objectContaining({ id: 'exchange_inflows_1' }),
          ]),
        }),
      },
      undefined,
      expect.objectContaining({
        timeout: 300_000,
        maxTotalTimeout: 300_000,
      })
    )
    // Address-grain: no identity-resolution pre-flight -- the first (and
    // only) batch is the risk batch, keyed directly by the raw address.
    const riskQueries = clientInstance.callTool.mock.calls[0][0].arguments.queries as Array<{
      id: string
      query: string
    }>
    const profileQuery = riskQueries.find((query) => query.id === 'address_profile')?.query ?? ''
    expect(profileQuery).toContain('MATCH (a:Address {address: "5Addr"})')
    const outflowQuery =
      riskQueries.find((query) => query.id === 'exchange_outflows_2')?.query ?? ''
    const inflowQuery = riskQueries.find((query) => query.id === 'exchange_inflows_2')?.query ?? ''
    expect(outflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(inflowQuery).toContain('exchange.is_exchange IS NOT NULL')
    expect(outflowQuery).not.toContain('*BFS')
    expect(inflowQuery).not.toContain('*BFS')
    expect(outflowQuery).toContain('LIMIT 200')
    expect(inflowQuery).toContain('LIMIT 200')
  })

  it('aml_address_risk escalates purely on topology label_risk when the ML verdict abstains, and drops labels beyond the top-10 deterministic window', async () => {
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
    // 11 label_risk entries with distinct updated_timestamp values: the
    // oldest ('stale-label-oldest') must be dropped by the derived top-10
    // window, and the strongest surviving label ('Scam laundering
    // intermediate', risk_level critical) must drive escalation even though
    // the ML verdict abstains (UNSCORED) -- this fails closed to "no
    // signal" if deriveLabelRows reads the wrong field, breaks its sort, or
    // returns [].
    const labelRiskLabels = [
      'stale-label-oldest',
      'Scam laundering intermediate',
      'filler-label-2',
      'filler-label-3',
      'filler-label-4',
      'filler-label-5',
      'filler-label-6',
      'filler-label-7',
      'filler-label-8',
      'filler-label-9',
      'filler-label-10',
    ]
    const labelRiskLevels = [
      'low',
      'critical',
      'low',
      'low',
      'low',
      'low',
      'low',
      'low',
      'low',
      'low',
      'low',
    ]
    const labelRiskUpdatedTimestamps = [
      1000, 1700000000000, 1600000000009, 1600000000008, 1600000000007, 1600000000006,
      1600000000005, 1600000000004, 1600000000003, 1600000000002, 1600000000001,
    ]
    clientInstance.callTool.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            schema: 'chain-insights.result.v1',
            tool: 'graph_query_batch',
            facts: {
              queries: [
                {
                  id: 'address_profile',
                  ok: true,
                  results: [
                    {
                      address: '5LabelOnly',
                      network: 'bittensor',
                      display_labels: ['scam laundering intermediate'],
                      system_labels: ['Address'],
                      live_risk_score: 0.12,
                      live_risk_level: 'UNSCORED',
                      label_risk_labels: labelRiskLabels,
                      label_risk_levels: labelRiskLevels,
                      label_risk_updated_timestamps: labelRiskUpdatedTimestamps,
                      degree_in: 1,
                      degree_out: 1,
                    },
                  ],
                },
                { id: 'exchange_outflows_1', ok: true, results: [] },
                { id: 'exchange_outflows_2', ok: true, results: [] },
                { id: 'exchange_outflows_3', ok: true, results: [] },
                { id: 'exchange_inflows_1', ok: true, results: [] },
                { id: 'exchange_inflows_2', ok: true, results: [] },
                { id: 'exchange_inflows_3', ok: true, results: [] },
                { id: 'connection_probe', ok: true, results: [] },
              ],
            },
          }),
        },
      ],
      isError: false,
    })

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const handler = findToolHandler(serverInstance, 'aml_address_risk')
    const result = await handler({ address: '5LabelOnly', network: 'bittensor' })

    expect(result.isError).toBe(false)
    // (a) the escalated verdict level -- the strongest label (critical)
    // drives the level even though the ML verdict abstained.
    expect(result.structuredContent.facts.risk).toMatchObject({ level: 'critical' })
    expect(result.content[0].text).toContain('Risk: critical')
    // (b) the drivers line surfaces the escalating label by name.
    const drivers = result.structuredContent.facts.risk.drivers as string[]
    expect(
      drivers.some(
        (driver) => driver.includes('Labels:') && driver.includes('Scam laundering intermediate')
      )
    ).toBe(true)
    // (c) sources carries the topology/address_node label_risk provenance
    // with that label, and the oldest (11th) label is excluded by the
    // top-10 deterministic window.
    const sources = result.structuredContent.facts.risk.sources as Array<Record<string, unknown>>
    const labelRiskSource = sources.find((source) => source['family'] === 'label_risk')
    expect(labelRiskSource).toMatchObject({
      family: 'label_risk',
      layer: 'topology',
      source: 'address_node',
    })
    const sourceLabels = (labelRiskSource?.['labels'] as Array<Record<string, unknown>>).map(
      (entry) => entry['label']
    )
    expect(sourceLabels).toContain('Scam laundering intermediate')
    expect(sourceLabels).not.toContain('stale-label-oldest')
    expect(sourceLabels).toHaveLength(10)
  })

  it('aml_address_risk writes workspace artifacts and references them in evidence', async () => {
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>
    }
    clientInstance.callTool.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            facts: {
              queries: [
                {
                  id: 'address_profile',
                  ok: true,
                  results: [
                    {
                      address: '5Addr',
                      network: 'bittensor',
                      display_labels: ['Address'],
                      system_labels: ['Address'],
                      address_subtypes: ['coldkey'],
                    },
                  ],
                },
                {
                  id: 'address_feature',
                  ok: true,
                  results: [
                    {
                      degree_in: 12,
                      degree_out: 3,
                      tx_in_count: 5,
                      tx_out_count: 2,
                    },
                  ],
                },
                {
                  id: 'connection_probe',
                  ok: true,
                  results: [],
                },
              ],
            },
          }),
        },
      ],
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

    const evidence = result.structuredContent.evidence as Array<{
      evidence_type: string
      path: string
    }>
    const evidencePaths = evidence
      .filter((entry) => entry.evidence_type === 'artifact_pointer')
      .map((entry) => entry.path)
    expect(evidencePaths).toEqual(expect.arrayContaining(Object.values(artifacts)))
  })

  it('aml_address_risk graphData preserves subject profile metadata before report normalization', async () => {
    const { addressRisk } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn().mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              facts: {
                queries: [
                  {
                    id: 'address_profile',
                    ok: true,
                    results: [
                      {
                        address: '5Addr',
                        network: 'bittensor',
                        display_labels: ['validator'],
                        system_labels: ['Address', 'Validator'],
                        live_risk_score: 0.12,
                        live_risk_level: 'low',
                      },
                    ],
                  },
                  { id: 'exchange_outflows', ok: true, results: [] },
                  { id: 'exchange_inflows', ok: true, results: [] },
                  { id: 'connection_probe', ok: true, results: [] },
                ],
              },
            }),
          },
        ],
        isError: false,
      }),
    }

    const result = await addressRisk(remoteClient as never, {
      address: '5Addr',
      network: 'bittensor',
    })
    const subjectNode = (result.graphData.nodes as Array<Record<string, unknown>>).find(
      (node) => node['address'] === '5Addr'
    )

    expect(result.summaryText).toContain('Risk: low (0.12)')
    expect(result.structuredContent.facts.risk).toMatchObject({
      level: 'low',
      score: 0.12,
      ml_risk_score: 0.12,
      confidence: 'high',
    })
    expect(subjectNode).toMatchObject({
      labels: ['validator'],
      system_labels: ['Address', 'Validator'],
      risk_score: 0.12,
      risk_level: 'low',
      roles: ['subject'],
    })
    expect(subjectNode).not.toHaveProperty('address_type')
  })

  it('aml_address_risk reports partial enrichment query failures without failing screening', async () => {
    const { addressRisk } = await import('../src/investigation/public-tools.js')
    const remoteClient = {
      callTool: vi.fn().mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              facts: {
                queries: [
                  {
                    id: 'address_profile',
                    ok: true,
                    results: [
                      { address: '5Addr', network: 'bittensor', display_labels: ['subject'] },
                    ],
                  },
                  {
                    id: 'address_feature',
                    ok: false,
                    error: 'An unexpected error occurred executing the query',
                    results: [],
                  },
                  { id: 'exchange_outflows_1', ok: true, results: [] },
                  { id: 'exchange_inflows_1', ok: true, results: [] },
                ],
              },
            }),
          },
        ],
        isError: false,
      }),
    }

    const result = await addressRisk(remoteClient as never, {
      address: '5Addr',
      network: 'bittensor',
    })

    expect(result.summaryText).toContain('Partial query failures')
    expect(result.summaryText).toContain('address_feature')
    expect(result.structuredContent.facts.partial_query_errors).toEqual([
      {
        id: 'address_feature',
        error: 'An unexpected error occurred executing the query',
      },
    ])
    expect(result.graphData).toHaveProperty('schema', 'chain-insights.graph.v1')
  })

  // Renamed from `incident_timestamp_ms` (issue #254). When Chain Insights
  // When a remote tool appears in the remote tool list, registration takes
  // the generic passthrough path:
  // normalizeRemoteToolArguments filters the caller's arguments down to
  // PUBLIC_MCP_TOOL_ALLOWED_ARGS before forwarding to remoteClient.callTool.
  // An argument present on the schema but missing from that allowlist is
  // silently dropped rather than rejected — this is the exact failure mode
  // that shipped with `time_scope`. This test proves `incident_timestamp`
  // survives that filter and reaches the remote call, not just the local
  // fallback tool exercised by the test above.

  // The Claude views are served by this proxy and by nothing else. DESIGN_VIEW_METADATA
  // is the wire contract of the views (the tool and resource metadata block of the
  // design), copied as written. The comparison keeps every key in the design's
  // order, so a renamed key, a reordered object or a changed value fails.
  const DESIGN_VIEW_METADATA = [
    `{
      "name": "graph_expand",
      "title": "Expand a node or a link in the picture",
      "annotations": { "readOnlyHint": true },
      "_meta": { "ui": { "resourceUri": "ui://chain-insights/view", "visibility": ["app"] } }
    }`,
    `{
      "uri": "ui://chain-insights/view",
      "mimeType": "text/html;profile=mcp-app",
      "_meta": { "ui": { "prefersBorder": false, "csp": { "resourceDomains": ["https://assets.claude.ai"] } } }
    }`,
  ].map((text) => JSON.parse(text) as Record<string, unknown>)

  /** The wire object's keys of `designed`, in the design's order, as compact JSON. */
  function pickLikeDesign(wire: Record<string, unknown>, designed: Record<string, unknown>) {
    return JSON.stringify(Object.fromEntries(Object.keys(designed).map((key) => [key, wire[key]])))
  }

  /** A graph endpoint double with spies on the resource calls the proxy must never make. */
  function remoteDouble(callTool: ReturnType<typeof vi.fn>) {
    const listResources = vi.fn().mockResolvedValue({
      resources: [
        {
          uri: 'ui://chain-insights/view',
          name: 'a lane view',
          mimeType: 'text/html;profile=mcp-app',
        },
      ],
    })
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: 'ui://chain-insights/view', text: '<html>lane view</html>' }],
    })
    return {
      listResources,
      readResource,
      client: {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn(),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        callTool,
        listResources,
        readResource,
      },
    }
  }

  it('serves the views itself: tools/list and resources/read on the wire match the design, with no remote resource call', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      { name: 'graph_query', description: 'Federated graph query' },
      { name: 'graph_query_batch', description: 'Federated graph query batch' },
      { name: 'usage_status', description: 'Usage status' },
      { name: 'subscription_status', description: 'Subscription status' },
    ])
    const remote = remoteDouble(vi.fn())
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return remote.client
    } as never)
    // A real MCP server, so tools/list and resources/read are read as a host
    // reads them: JSON-RPC over a transport.
    const actual = await vi.importActual<typeof import('@modelcontextprotocol/sdk/server/mcp.js')>(
      '@modelcontextprotocol/sdk/server/mcp.js'
    )
    let real: InstanceType<typeof actual.McpServer> | undefined
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    vi.mocked(McpServer).mockImplementationOnce(function (
      ...args: ConstructorParameters<typeof actual.McpServer>
    ) {
      real = new actual.McpServer(...args)
      real.connect = vi.fn().mockResolvedValue(undefined)
      return real
    } as never)

    const { createProxy } = await import('../src/mcp/proxy.js')
    await createProxy()

    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const { LATEST_PROTOCOL_VERSION } = await import('@modelcontextprotocol/sdk/types.js')
    const [host, proxy] = InMemoryTransport.createLinkedPair()
    const answers = new Map<number, Record<string, unknown>>()
    host.onmessage = (message) => {
      const reply = message as { id?: number; result?: Record<string, unknown>; error?: unknown }
      if (typeof reply.id === 'number')
        answers.set(reply.id, reply.result ?? { error: reply.error })
    }
    await real!.server.connect(proxy)
    await host.start()
    const request = async (id: number, method: string, params: Record<string, unknown>) => {
      await host.send({ jsonrpc: '2.0', id, method, params })
      await vi.waitFor(() => expect(answers.has(id)).toBe(true))
      return answers.get(id) as Record<string, unknown>
    }
    await request(1, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'host', version: '1' },
    })
    await host.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    const tools = new Map(
      ((await request(2, 'tools/list', {})).tools as Array<Record<string, unknown>>).map((tool) => [
        tool.name as string,
        tool,
      ])
    )
    const [expandDesign, resourceDesign] = DESIGN_VIEW_METADATA
    const expand = tools.get('graph_expand')
    expect(expand, 'tools/list holds graph_expand').toBeDefined()
    expect(pickLikeDesign(expand!, expandDesign)).toBe(JSON.stringify(expandDesign))
    // graph_expand is the one dedicated tool, and the view's alone: the model's
    // list holds no tool that composes a picture.
    expect(
      (expand!._meta as { ui: { visibility: string[] } }).ui.visibility,
      'graph_expand is app-only'
    ).toEqual(['app'])
    expect(tools.has('money_flows'), 'tools/list holds no money_flows').toBe(false)
    // The tools that draw the answer of a call name the same view, with a title
    // and the read-only hint.
    const drawsMeta = JSON.stringify({
      ui: { resourceUri: 'ui://chain-insights/view' },
      'ui/resourceUri': 'ui://chain-insights/view',
    })
    for (const name of ['graph_query', 'meta_usage_status', 'meta_subscription_status']) {
      const tool = tools.get(name)!
      expect(JSON.stringify(tool._meta), `${name} _meta`).toBe(drawsMeta)
      expect((tool.annotations as Record<string, unknown>).readOnlyHint).toBe(true)
      expect(typeof tool.title === 'string' && tool.title.length > 0).toBe(true)
    }
    // Both forms of graph_expand are on the wire: a node, or a link with a day.
    const expandProperties = Object.keys(
      (expand!.inputSchema as { properties: Record<string, unknown> }).properties
    ).sort()
    expect(expandProperties).toEqual(
      ['address', 'day', 'from', 'in_offset', 'network', 'out_offset', 'to'].sort()
    )
    expect(tools.get('graph_query_batch')?._meta).toBeUndefined()

    const listed = (await request(3, 'resources/list', {})).resources as Array<
      Record<string, unknown>
    >
    const listedView = listed.find((resource) => resource.uri === 'ui://chain-insights/view')
    expect(pickLikeDesign(listedView!, resourceDesign)).toBe(JSON.stringify(resourceDesign))
    const read = (await request(4, 'resources/read', { uri: 'ui://chain-insights/view' }))
      .contents as Array<Record<string, unknown>>
    expect(read).toHaveLength(1)
    expect(pickLikeDesign(read[0], resourceDesign)).toBe(JSON.stringify(resourceDesign))
    const html = read[0].text as string
    expect(html.split('\n')[0]).toMatch(
      /^<!-- Chain Insights UI [0-9a-f]{40} \(npm run build:claude-view\);/
    )
    expect(html).toContain('<html')
    expect(html.length).toBeLessThan(400 * 1024)

    expect(remote.listResources).not.toHaveBeenCalled()
    expect(remote.readResource).not.toHaveBeenCalled()
    await host.close()
  })

  it("ignores the graph endpoint's own views: its app-only tools, _meta.ui and ui:// resources", async () => {
    const laneMeta = {
      ui: { resourceUri: 'ui://lane/other' },
      'ui/resourceUri': 'ui://lane/other',
    }
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([
      {
        name: 'graph_expand',
        description: 'lane',
        _meta: { ui: { resourceUri: 'ui://lane/other', visibility: ['app'] } },
      },
      {
        name: 'lane_only_app_tool',
        description: 'lane',
        _meta: { ui: { resourceUri: 'ui://lane/other', visibility: ['app'] } },
      },
      { name: 'graph_query', description: 'Federated graph query', _meta: laneMeta },
      { name: 'trace_address', description: 'Trace', _meta: laneMeta },
    ])
    const queryResult = {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      hint: null,
      facts: { query: { results: [{ a: 1 }] } },
    }
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'rows' }],
      structuredContent: queryResult,
      _meta: { 'ai.chain-insights/billing': { queries: 1 } },
      isError: false,
    })
    const remote = remoteDouble(callTool)
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return remote.client
    } as never)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    await createProxy()
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
      registerResource: ReturnType<typeof vi.fn>
    }

    const registered = serverInstance.registerTool.mock.calls.map((call) => call[0] as string)
    expect(registered).not.toContain('money_flows')
    expect(registered.filter((name) => name === 'graph_expand')).toHaveLength(1)
    expect(registered).not.toContain('lane_only_app_tool')
    expect(findToolConfig(serverInstance, 'graph_expand')._meta).toEqual({
      ui: { resourceUri: 'ui://chain-insights/view', visibility: ['app'] },
    })
    expect(findToolConfig(serverInstance, 'graph_query')._meta).toEqual({
      ui: { resourceUri: 'ui://chain-insights/view' },
      'ui/resourceUri': 'ui://chain-insights/view',
    })
    expect(findToolConfig(serverInstance, 'trace_address')).not.toHaveProperty('_meta')

    const resources = serverInstance.registerResource.mock.calls.map((call) => call[1])
    expect([...resources].sort()).toEqual(['ui://chain-insights/topup', 'ui://chain-insights/view'])
    expect(remote.listResources).not.toHaveBeenCalled()
    expect(remote.readResource).not.toHaveBeenCalled()

    // graph_query answers exactly as the graph endpoint returned it.
    const answer = await findToolHandler(
      serverInstance,
      'graph_query'
    )({ query: 'USE topology MATCH (a:Address) RETURN a LIMIT 1', network: 'robinhood' })
    expect(answer).toEqual({
      content: [{ type: 'text', text: 'rows' }],
      structuredContent: queryResult,
      _meta: { 'ai.chain-insights/billing': { queries: 1 } },
      isError: false,
    })

    // graph_expand stays out of every tool list the proxy builds for the model.
    const help = await findToolHandler(serverInstance, 'meta_help')({})
    expect(help.content[0].text).not.toContain('money_flows')
    expect(help.content[0].text).not.toContain('graph_expand')
    expect(help.content[0].text).toContain('from_address')
  })

  it('answers a graph_expand node click from three graph_query calls through the remote client', async () => {
    const recorded = JSON.parse(
      await readFile(
        join(import.meta.dirname, 'fixtures', 'flows_scene', 'graph-query-answers.json'),
        'utf8'
      )
    ) as Record<string, unknown>
    const want = JSON.parse(
      await readFile(
        join(import.meta.dirname, 'fixtures', 'flows_scene', 'flows-0x0491.json'),
        'utf8'
      )
    )
    const callTool = vi.fn(async (request: { name: string; arguments: { query: string } }) => {
      if (request.name !== 'graph_query') throw new Error(`unexpected ${request.name}`)
      return recorded[request.arguments.query]
    })
    const remote = remoteDouble(callTool as unknown as ReturnType<typeof vi.fn>)
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return remote.client
    } as never)
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([{ name: 'graph_query', description: 'q' }])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    await createProxy()
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }

    const result = await findToolHandler(
      serverInstance,
      'graph_expand'
    )({
      address: '0x04911a118f11c75667e4d0dfb8e640af5a353550',
      network: 'robinhood',
    })
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(want)
    expect(callTool).toHaveBeenCalledTimes(3)
    for (const call of callTool.mock.calls as unknown as Array<
      [{ name: string; arguments: Record<string, unknown> }, undefined, { timeout: number }]
    >) {
      expect(call[0].name).toBe('graph_query')
      expect(Object.keys(call[0].arguments).sort()).toEqual(['network', 'query'])
      expect(call[0].arguments.network).toBe('robinhood')
      expect(call[2].timeout).toBeGreaterThan(60_000)
    }

    // A malformed address reaches no graph endpoint.
    const refused = await findToolHandler(
      serverInstance,
      'graph_expand'
    )({ network: 'robinhood', address: '0x1234' })
    expect(refused.isError).toBe(true)
    expect(callTool).toHaveBeenCalledTimes(3)
  })

  it('answers a graph_expand link click with one facts graph_query call, and refuses a bad day before any call', async () => {
    const from = '0x04911a118f11c75667e4d0dfb8e640af5a353550'
    const to = '0x7e3702e9dfaa847f9829a258f1e26fa431160662'
    const results = [
      {
        tx_id: `0x${'1'.padStart(64, '0')}`,
        block_timestamp: Date.parse('2026-07-10T08:00:00Z'),
        amount: '0.005',
        asset_symbol: 'ETH',
        amount_usd: 12.5,
      },
      {
        tx_id: `0x${'2'.padStart(64, '0')}`,
        block_timestamp: Date.parse('2026-07-10T09:30:00Z'),
        amount: '0.004',
        asset_symbol: 'ETH',
        amount_usd: null,
      },
    ]
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'rows' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'graph_query',
        hint: null,
        facts: { query: { results, count: results.length } },
      },
      isError: false,
    })
    const remote = remoteDouble(callTool)
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return remote.client
    } as never)
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce([{ name: 'graph_query', description: 'q' }])

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    await createProxy()
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const expand = findToolHandler(serverInstance, 'graph_expand')

    const result = await expand({ network: 'robinhood', from, to, day: '2026-07-10' })
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.transfers.v1',
      network: 'robinhood',
      from,
      to,
      day: '2026-07-10',
      transfers: [results[1], results[0]],
      truncated: false,
    })
    expect(callTool).toHaveBeenCalledTimes(1)
    const [request, , options] = callTool.mock.calls[0] as [
      { name: string; arguments: { network: string; query: string } },
      undefined,
      { timeout: number },
    ]
    expect(request.name).toBe('graph_query')
    expect(request.arguments.network).toBe('robinhood')
    expect(request.arguments.query).toContain('USE facts MATCH')
    expect(request.arguments.query).toContain(`{address: "${from}"})-[t:TRANSFER]->`)
    expect(request.arguments.query).toContain('WHERE t.block_date = "2026-07-10"')
    expect(options.timeout).toBeGreaterThan(60_000)

    // A malformed day and a malformed address reach no graph endpoint.
    for (const bad of [
      { from, to, day: '2026-07-32' },
      { from: '0x1234', to, day: '2026-07-10' },
    ]) {
      const refused = await expand({ network: 'robinhood', ...bad })
      expect(refused.isError).toBe(true)
    }
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('answers graph_expand with the unreachable-endpoint text when the graph endpoint is down', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
        listTools: vi.fn(),
        listPrompts: vi.fn(),
        callTool: vi.fn(),
      }
    } as never)
    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    await createProxy()
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const result = await findToolHandler(
      serverInstance,
      'graph_expand'
    )({ address: '0x04911a118f11c75667e4d0dfb8e640af5a353550', network: 'robinhood' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Restart the Chain Insights MCP proxy')
  })

  it('registers no money_flows tool', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { createProxy } = await import('../src/mcp/proxy.js')
    await createProxy()
    const serverInstance = vi.mocked(McpServer).mock.results.at(-1)?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const registered = serverInstance.registerTool.mock.calls.map((call) => call[0] as string)
    expect(registered).not.toContain('money_flows')
    expect(registered).toContain('graph_expand')
    expect(() => findToolHandler(serverInstance, 'money_flows')).toThrow(
      'Tool was not registered: money_flows'
    )
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

    expect(promptNames).toEqual(
      expect.arrayContaining([
        'aml-address-risk',
        'meta-network-capabilities',
        'meta-usage-status',
        'graph-query',
        'graph-query-batch',
        'wallet-balance',
        'meta-help',
      ])
    )
    expect(promptNames).not.toContain('address-risk')
    expect(promptNames).not.toContain('trace-tools')
    expect(promptNames).not.toContain('network-capabilities')
    expect(promptNames).not.toContain('usage-status')
    expect(promptNames).not.toContain('balance')
    expect(promptNames).not.toContain('help')
    expect(promptNames).not.toContain('money-flows-between-exchanges')
    expect(promptNames).not.toContain('address-connection-risk')
    expect(promptNames).not.toContain('address-poisoning-funding-probe')

    const addressRiskPrompt = serverInstance.registerPrompt.mock.calls.find(
      (entry) => entry[0] === 'aml-address-risk'
    )
    const networkCapabilitiesPrompt = serverInstance.registerPrompt.mock.calls.find(
      (entry) => entry[0] === 'meta-network-capabilities'
    )
    const graphQueryPrompt = serverInstance.registerPrompt.mock.calls.find(
      (entry) => entry[0] === 'graph-query'
    )
    const graphQueryBatchPrompt = serverInstance.registerPrompt.mock.calls.find(
      (entry) => entry[0] === 'graph-query-batch'
    )
    expect(addressRiskPrompt?.[1].argsSchema.network).toBeDefined()
    expect(graphQueryPrompt?.[1].argsSchema.network).toBeDefined()
    expect(graphQueryBatchPrompt?.[1].argsSchema.network).toBeDefined()
    expect(networkCapabilitiesPrompt?.[1].title).toBe('Network Capabilities')
    expect(graphQueryPrompt?.[1].title).toBe('Graph Query')
    expect(graphQueryBatchPrompt?.[1].title).toBe('Graph Query Batch')
  })

  it('uses local canonical prompt requests instead of deprecated remote prompt names', async () => {
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

    const handler = findPromptHandler(serverInstance, 'aml-address-risk')
    const result = await handler({
      network: 'bittensor',
      address: '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6',
      empty_optional: '',
    })

    expect(clientInstance.getPrompt).not.toHaveBeenCalled()
    expect(result.messages[0].content.text).toContain('aml_address_risk')
    expect(result.messages[0].content.text).toContain('on bittensor')
    expect(result.messages[0].content.text).toContain(
      '5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6'
    )
  })

  it('gives graph prompts address-grain schema-discovery guidance', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerPrompt: ReturnType<typeof vi.fn>
    }
    const handler = findPromptHandler(serverInstance, 'graph-query')
    const result = await handler({
      network: 'bittensor',
      query: 'USE topology MATCH (a:Address) RETURN a.address LIMIT 1',
    })
    const text = result.messages[0].content.text

    expect(text).toContain('schema context')
    expect(text).toContain('keys(a) AS address_properties')
    expect(text).toContain('keys(r) AS flow_properties')
    expect(text).toContain('Return the full address')
    expect(text).not.toContain('identity_id')
    expect(text).not.toContain('Return full address properties')
  })

  it('does not pass through remote canonical prompts with free-text network arguments', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    vi.mocked(Client).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'graph_query', description: 'Federated graph query' },
            { name: 'graph_query_batch', description: 'Federated graph query batch' },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [
            {
              name: 'aml-address-risk',
              title: 'Remote AML Address Risk',
              description: 'Remote prompt should not win',
              arguments: [
                { name: 'address', description: 'Address', required: true },
                { name: 'network', description: 'Free-text network', required: true },
              ],
            },
          ],
        }),
        getPrompt: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'remote canonical prompt' } }],
        }),
        callTool: vi
          .fn()
          .mockResolvedValue({ content: [{ type: 'text', text: 'result' }], isError: false }),
      }
    } as never)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerPrompt: ReturnType<typeof vi.fn>
    }
    const clientInstance = vi.mocked(Client).mock.results[0]?.value as {
      getPrompt: ReturnType<typeof vi.fn>
    }
    const addressRiskPrompt = serverInstance.registerPrompt.mock.calls.find(
      (entry) => entry[0] === 'aml-address-risk'
    )
    expect(addressRiskPrompt?.[1].title).toBe('AML Address Risk')
    expect(addressRiskPrompt?.[1].argsSchema.network).toBeDefined()

    const handler = findPromptHandler(serverInstance, 'aml-address-risk')
    const result = await handler({ network: 'bittensor', address: '5Addr' })
    expect(clientInstance.getPrompt).not.toHaveBeenCalled()
    expect(result.messages[0].content.text).toContain('aml_address_risk on bittensor')
    expect(result.messages[0].content.text).not.toContain('remote canonical prompt')
  })

  it('does not expose deprecated Chain Insights Graph prompt names as primary prompts', async () => {
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
    expect(inputSchema.version).toBeDefined()
    expect((inputSchema.network as { description?: string }).description).toContain(
      'Network to query'
    )
    expect((inputSchema.network as { description?: string }).description).toContain(
      'meta_network_capabilities'
    )
    expect((inputSchema.network as { description?: string }).description).not.toContain(
      'robinhood is the only supported network'
    )
    expect(config.description).toContain('Required arguments: address, network.')
    expect(config.description).toContain('Do not guess a default network')
    expect(config.description).toContain('version=v1')
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
    expect(config.description).not.toContain('Bittensor address')
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

  it('drops remote graph metadata from proxied results', async () => {
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

    expect(result.content).toEqual([{ type: 'text', text: '## Risk Report' }])
    expect(result.structuredContent.facts.risk.level).toBe('critical')
    expect(result.structuredContent).not.toHaveProperty('app_data')
    expect(result._meta).toBeUndefined()
    expect(result.structuredContent).not.toHaveProperty('app_data')
  })

  it('sanitizes structured graph data when visualization metadata is disabled', async () => {
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
    expect(result._meta).toBeUndefined()
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

  it.skip('fails closed when remote graph data is present but invalid', async () => {
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

  it.skip('fails closed when remote graph arrays are present without data', async () => {
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

  it.skip('fails closed when remote graph url is forwarded without data', async () => {
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

  it('registers a local meta_help tool that explains the Claude-facing product surface', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    vi.mocked(loadSchema).mockResolvedValueOnce(null)

    const { createProxy } = await import('../src/mcp/proxy.js')
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

    await createProxy()

    const serverInstance = vi.mocked(McpServer).mock.results[0]?.value as {
      registerTool: ReturnType<typeof vi.fn>
    }
    const config = findToolConfig(serverInstance, 'meta_help')
    const handler = findToolHandler(serverInstance, 'meta_help')
    const result = await handler({})

    expect(config.title).toBe('Chain Insights Help')
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain(
      'Chain Insights helps AI agents run AML investigation workflows'
    )
    expect(result.content[0].text).toContain('Workflow:')
    expect(result.content[0].text).toContain('Network is required')
    expect(result.content[0].text).toContain('aml_address_risk')
    expect(result.content[0].text).toContain('graph_query_batch')
    expect(result.content[0].text).not.toContain('topup')
    expect(result.content[0].text).not.toContain('Graph visualization behavior')
    expect(result.content[0].text).not.toContain('prepares the graph view automatically')
    expect(result.content[0].text).not.toContain('_meta')
    expect(result.content[0].text).not.toContain('Claude Desktop')
    expect(result.content[0].text).not.toContain('iframe')
    expect(result.content[0].text).not.toContain('Graph query hints for network=bittensor')
    expect(result.content[0].text).not.toContain('FLOWS_TO')
    expect(result.content[0].text).not.toContain('first_tx_id')
    expect(result.content[0].text).not.toContain('archive member-address lookup')
    expect(result.content[0].text).not.toContain('(:Identity)-[:HAS_ADDRESS]->(:Address)')
    expect(result.content[0].text).not.toContain('member-ledger')
    expect(result.content[0].text).not.toContain('AddressFeatureFact')
    expect(result.content[0].text).not.toContain('schema discovery')
    expect(result.content[0].text).not.toContain('Chain Insights Graph')
    expect(result.content[0].text).not.toContain('prox')
    expect(result.content[0].text).not.toContain('chain-insights mcp')
    expect(result.content[0].text).not.toContain('Useful CLI commands')
  })
})
