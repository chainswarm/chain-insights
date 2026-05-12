import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ContentBlock, GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import * as z from 'zod'
import type { InvestigatorConfig } from '../config/schema.js'
import type { McpTool } from './schema-cache.js'

const LOCAL_TOOL_NAMES = new Set(['balance', 'topup', 'help'])
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(['address-risk', 'track-funds'])
const TOPUP_RESOURCE_URI = 'ui://chain-insights/topup.html'
const GRAPH_RESOURCE_URI = 'ui://chain-insights/graph'
const GRAPH_APP_TOOL_NAMES = new Set([
  'address_risk',
  'track_funds',
  'money_flows_between_exchanges',
  'address_connection_risk',
])
const GRAPH_ARRAY_KEYS = ['nodes', 'edges', 'flows', 'edge_anchors'] as const
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readGraphAppHtml(): string {
  const candidates = [
    path.resolve(__dirname, 'templates', 'graph.html'),
    path.resolve(__dirname, '..', 'templates', 'graph.html'),
    path.resolve(__dirname, '..', 'viz', 'templates', 'graph.html'),
  ]

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  throw new Error(`Graph MCP app template not found. Tried: ${candidates.join(', ')}`)
}

function hasGraphApp(tool: McpTool): boolean {
  const configuredUri = tool._meta?.ui
  if (
    configuredUri &&
    typeof configuredUri === 'object' &&
    'resourceUri' in configuredUri &&
    configuredUri.resourceUri === GRAPH_RESOURCE_URI
  ) {
    return true
  }

  if (tool._meta?.['ui/resourceUri'] === GRAPH_RESOURCE_URI) return true
  if (GRAPH_APP_TOOL_NAMES.has(tool.name)) return true
  return JSON.stringify(tool.outputSchema ?? {}).includes('"app_data"')
}

function graphToolMeta(tool: McpTool): Record<string, unknown> & { ui: { resourceUri: string } } {
  const meta = { ...(tool._meta ?? {}) }
  const ui =
    meta.ui && typeof meta.ui === 'object' && !Array.isArray(meta.ui)
      ? { ...(meta.ui as Record<string, unknown>) }
      : {}

  return {
    ...meta,
    ui: {
      ...ui,
      resourceUri: GRAPH_RESOURCE_URI,
    },
  }
}

type RemoteToolResult = {
  content?: ContentBlock[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

type PromptArgs = Record<string, string | undefined>

function promptResult(text: string, description?: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text,
        },
      },
    ],
  }
}

function compactPromptArguments(args: PromptArgs): Record<string, string> {
  const compact: Record<string, string> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.trim() !== '') {
      compact[key] = value
    }
  }
  return compact
}

function promptArgumentSchema(argument: NonNullable<Prompt['arguments']>[number]) {
  const schema = z.string().describe(argument.description ?? argument.name)
  return argument.required === false ? schema.optional() : schema
}

function registerRemotePrompt(server: McpServer, remoteClient: Client, prompt: Prompt): void {
  const argsSchema: Record<string, z.ZodTypeAny> = {}
  for (const argument of prompt.arguments ?? []) {
    argsSchema[argument.name] = promptArgumentSchema(argument)
  }

  server.registerPrompt(
    prompt.name,
    {
      title: prompt.title,
      description: prompt.description,
      argsSchema,
    },
    async (args) => remoteClient.getPrompt({
      name: prompt.name,
      arguments: compactPromptArguments(args as PromptArgs),
    }),
  )
}

function registerLocalPrompts(server: McpServer, remotePromptNames: Set<string>): void {
  if (!remotePromptNames.has('address-risk')) {
    server.registerPrompt(
      'address-risk',
      {
        title: 'Address Risk',
        description: 'Screen an address for AML risk, behavioral patterns, neighborhood profile, and exchange links.',
        argsSchema: {
          address: z.string().describe('Full blockchain address to screen'),
          network: z.string().optional().describe('Network: bittensor, base, or ethereum'),
        },
      },
      async ({ address, network }) => promptResult(
        [
          `Use Chain Insights address_risk on ${network ?? 'bittensor'} for:`,
          '',
          `\`${address}\``,
          '',
          'Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment.',
        ].join('\n'),
        'Address risk screening',
      ),
    )
  }

  if (!remotePromptNames.has('track-funds')) {
    server.registerPrompt(
      'track-funds',
      {
        title: 'Track Funds',
        description: 'Trace stolen funds from victim addresses through intermediaries to exchange deposit addresses.',
        argsSchema: {
          trusted_addresses: z.string().describe('Victim/trusted addresses, comma-separated full addresses'),
          untrusted_addresses: z.string().optional().describe('Known scammer/untrusted addresses, comma-separated full addresses'),
          network: z.string().optional().describe('Network: bittensor, base, or ethereum'),
        },
      },
      async ({ trusted_addresses, untrusted_addresses, network }) => {
        const untrusted = untrusted_addresses?.trim()
          ? `\nKnown untrusted addresses:\n${untrusted_addresses}\n`
          : ''
        return promptResult(
          [
            `Use Chain Insights track_funds on ${network ?? 'bittensor'}.`,
            '',
            'Trusted victim addresses:',
            trusted_addresses,
            untrusted,
            'Present the summary as-is and include recommended next actions exactly as returned.',
          ].join('\n'),
          'Trace stolen funds',
        )
      },
    )
  }

  server.registerPrompt(
    'money-flows-between-exchanges',
    {
      title: 'Money Flows Between Exchanges',
      description: 'Find exchange deposits, withdrawals, and bidirectional fund-flow paths for one or more addresses.',
      argsSchema: {
        addresses: z.string().describe('One or more full blockchain addresses, comma-separated'),
        network: z.string().optional().describe('Network: bittensor, base, or ethereum'),
      },
    },
    async ({ addresses, network }) => promptResult(
      [
        `Use Chain Insights money_flows_between_exchanges on ${network ?? 'bittensor'} for these addresses:`,
        '',
        addresses,
        '',
        'Present the exchange contact table as-is. Show every blockchain address as the full exact string.',
      ].join('\n'),
      'Exchange flow tracing',
    ),
  )

  server.registerPrompt(
    'address-connection-risk',
    {
      title: 'Address Connection Risk',
      description: 'Assess whether two addresses are connected and whether that connection is risky.',
      argsSchema: {
        source: z.string().describe('Full source blockchain address'),
        target: z.string().describe('Full target blockchain address'),
        network: z.string().optional().describe('Network: bittensor, base, or ethereum'),
      },
    },
    async ({ source, target, network }) => promptResult(
      [
        `Use Chain Insights address_connection_risk on ${network ?? 'bittensor'}.`,
        '',
        `Source: \`${source}\``,
        `Target: \`${target}\``,
        '',
        'Present the summary as-is. Do not add analysis, verdicts, or risk assessments.',
      ].join('\n'),
      'Address connection risk',
    ),
  )

  server.registerPrompt(
    'graph-query',
    {
      title: 'Cypher Graph Query',
      description: 'Run a read-only Cypher query against the Chain Insights graph database.',
      argsSchema: {
        query: z.string().describe('Read-only Cypher query'),
        network: z.string().optional().describe('Network: bittensor, base, or ethereum'),
      },
    },
    async ({ query, network }) => promptResult(
      [
        `Use Chain Insights graph_query on ${network ?? 'bittensor'} with this read-only Cypher query:`,
        '',
        '```cypher',
        query,
        '```',
        '',
        'Return full address properties; never shorten addresses with ellipses.',
      ].join('\n'),
      'Graph database query',
    ),
  )

  server.registerPrompt(
    'balance',
    {
      title: 'Wallet Balance',
      description: 'Show the local Chain Insights payment wallet address and Base USDC balance.',
      argsSchema: {},
    },
    async () => promptResult(
      'Use Chain Insights balance. Show the wallet address, network, token, balance, and capacity exactly as returned.',
      'Wallet balance',
    ),
  )

  server.registerPrompt(
    'topup',
    {
      title: 'Wallet Top-Up',
      description: 'Open the local wallet funding page for Base USDC.',
      argsSchema: {},
    },
    async () => promptResult(
      'Use Chain Insights topup. Open the wallet top-up app if the MCP client supports apps, and show the top-up URL and wallet address.',
      'Wallet top-up',
    ),
  )

  server.registerPrompt(
    'help',
    {
      title: 'Chain Insights Help',
      description: 'Show available Chain Insights tools and getting-started commands.',
      argsSchema: {},
    },
    async () => promptResult(
      'Use Chain Insights help. Summarize the available local and remote tools without inventing capabilities.',
      'Chain Insights help',
    ),
  )
}

function hasGraphArrayFields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return GRAPH_ARRAY_KEYS.some((key) => Array.isArray(record[key]))
}

function sanitizeStructuredContentForGraphPayload(
  structuredContent: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!structuredContent) return undefined
  return sanitizeStructuredValue(structuredContent) as Record<string, unknown>
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'app_data') continue
    if (GRAPH_ARRAY_KEYS.includes(key as (typeof GRAPH_ARRAY_KEYS)[number]) && Array.isArray(childValue)) {
      continue
    }
    sanitized[key] = sanitizeStructuredValue(childValue)
  }

  return sanitized
}

function getRemoteGraphPayload(result: RemoteToolResult): Record<string, unknown> | null {
  const chainInsights = result._meta?.chainInsights
  if (!chainInsights || typeof chainInsights !== 'object' || Array.isArray(chainInsights)) return null
  const graph = (chainInsights as Record<string, unknown>).graph
  if (graph === undefined) return null
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error('Invalid remote graph payload')
  }

  const graphRecord = graph as Record<string, unknown>
  if (!('data' in graphRecord)) {
    if ('url' in graphRecord || hasGraphArrayFields(graphRecord)) {
      throw new Error('Invalid remote graph payload')
    }
    return null
  }

  const data = graphRecord.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid remote graph payload')
  }

  return data as Record<string, unknown>
}

async function normalizeRemoteToolResult(
  result: RemoteToolResult,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
) {
  const graphPayload = getRemoteGraphPayload(result)
  const meta = { ...(result._meta ?? {}) }

  if (graphPayload) {
    const { writeGraphArtifact } = await import('./artifacts.js')
    const artifact = await writeGraphArtifact(graphPayload as never, config)
    meta.chainInsights = {
      ...((meta.chainInsights as Record<string, unknown>) ?? {}),
      graph: {
        schema: artifact.schema,
        id: artifact.id,
        url: artifact.url,
      },
    }
  }

  return {
    content: result.content ?? [],
    structuredContent: sanitizeStructuredContentForGraphPayload(result.structuredContent),
    _meta: Object.keys(meta).length > 0 ? meta : undefined,
    isError: result.isError,
  }
}

/**
 * Core proxy logic — exported so tests can inject dependencies directly.
 * The IIFE at the bottom calls this with real dependencies.
 *
 * stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
 * All diagnostic output goes to console.error() or process.stderr.write().
 */
export async function createProxy(): Promise<void> {
  // Lazy imports to avoid module-load side effects (critical for stdio proxy)
  const { loadConfig } = await import('../config/index.js')
  const { createConfiguredMcpFetch } = await import('./client.js')
  const { loadSchema, saveSchema } = await import('./schema-cache.js')

  const config = await loadConfig()
  const mcpFetch = await createConfiguredMcpFetch(config)

  // Build remote MCP client — always connect before registering tool handlers
  // so tool call forwarding works regardless of whether schema is cached.
  const remoteClient = new Client({ name: 'chain-insights-proxy-client', version: '0.1.0' })

  try {
    await remoteClient.connect(
      new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }),
    )
  } catch {
    // StreamableHTTP failed — try SSE fallback (assumption A1 from RESEARCH.md)
    try {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
      await remoteClient.connect(
        new SSEClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }),
      )
    } catch (err2) {
      process.stderr.write(
        `Chain Insights MCP unreachable at ${config.mcpEndpoint}: ${(err2 as Error).message}\n`,
      )
      process.exit(1)
    }
  }

  // Schema cache check — skip remote listTools call on cache hit
  let tools: McpTool[] | null = await loadSchema()

  if (!tools) {
    // Cache miss — fetch tools from remote (client is already connected above)
    const result = await remoteClient.listTools()
    tools = result.tools as McpTool[]
    await saveSchema(tools)
  }

  // Build local stdio proxy server
  const server = new McpServer(
    { name: 'chain-insights-proxy', version: '0.1.0' },
    { instructions: 'Chain Insights AML investigation tools. Pay-per-call via x402 on Base.' },
  )

  const remotePrompts: Prompt[] = []
  try {
    const promptResult = await remoteClient.listPrompts()
    for (const prompt of promptResult.prompts as Prompt[]) {
      if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(prompt.name)) {
        remotePrompts.push(prompt)
      }
    }
  } catch (err) {
    process.stderr.write(
      `Chain Insights MCP prompt passthrough unavailable at ${config.mcpEndpoint}: ${(err as Error).message}\n`,
    )
  }

  const remotePromptNames = new Set(remotePrompts.map((prompt) => prompt.name))
  for (const prompt of remotePrompts) {
    registerRemotePrompt(server, remoteClient, prompt)
  }
  registerLocalPrompts(server, remotePromptNames)

  let topupState: Promise<{ address: string; url: string }> | null = null
  const getTopupState = async (): Promise<{ address: string; url: string }> => {
    topupState ??= (async () => {
      const { getWalletAccount } = await import('../wallet/tools.js')
      const { startTopupServer } = await import('../wallet/topup-server.js')
      const account = await getWalletAccount()
      const url = await startTopupServer(account)
      return { address: account.address, url }
    })()
    return topupState
  }

  server.registerTool(
    'balance',
    {
      description: 'Show the local Chain Insights payment wallet address and Base USDC balance.',
      inputSchema: z.object({}).passthrough(),
    },
    async () => {
      try {
        const { getWalletAccount, getWalletBalanceText } = await import('../wallet/tools.js')
        const account = await getWalletAccount()
        return {
          content: [{ type: 'text' as const, text: await getWalletBalanceText(account) }],
          isError: false,
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Balance failed: ${(err as Error).message}` }],
          isError: true,
        }
      }
    },
  )

  registerAppResource(
    server,
    'Chain Insights Wallet Topup',
    TOPUP_RESOURCE_URI,
    {
      description: 'Chain Insights wallet funding page with QR code and MetaMask link',
    },
    async () => {
      const { address, url } = await getTopupState()
      const { generateArtifactHtml } = await import('../wallet/topup-server.js')
      return {
        contents: [
          {
            uri: TOPUP_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: generateArtifactHtml(address, url),
            _meta: {
              ui: {
                csp: {
                  resourceDomains: [url],
                  connectDomains: [url],
                },
              },
            },
          },
        ],
      }
    },
  )

  registerAppResource(
    server,
    'Fund Flow Graph',
    GRAPH_RESOURCE_URI,
    {
      description: 'Interactive D3 force-directed graph for fund flow and pattern visualization.',
    },
    async () => ({
      contents: [
        {
          uri: GRAPH_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readGraphAppHtml(),
        },
      ],
    }),
  )

  registerAppTool(
    server,
    'topup',
    {
      description: 'Fund your Chain Insights wallet with USDC via MetaMask. Does NOT check balance.',
      _meta: {
        ui: {
          resourceUri: TOPUP_RESOURCE_URI,
        },
      },
    },
    async () => {
      try {
        const { address, url } = await getTopupState()
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                wallet_address: address,
                topup_url: url,
                message: `Open ${url} in your browser to send USDC via MetaMask.`,
              }, null, 2),
            },
          ],
          isError: false,
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Top-up failed: ${(err as Error).message}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'help',
    {
      description: 'Show Chain Insights overview, available local tools, and getting-started commands.',
      inputSchema: z.object({}).passthrough(),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: [
            'Chain Insights - local AML investigation toolkit for AI agents.',
            '',
            'Remote GraphRAG tools are proxied from the configured MCP endpoint.',
            'Known public GraphRAG tools include address_risk, track_funds, money_flows_between_exchanges, address_connection_risk, and graph_query.',
            '',
            'Local tools:',
            '- balance: show the encrypted local payment wallet address and Base USDC balance.',
            '- topup: start a local browser page for funding the payment wallet with Base USDC.',
            '- help: show this overview.',
            '',
            'Useful CLI commands:',
            '- chain-insights mcp tools --refresh',
            '- chain-insights wallet balance',
            '- chain-insights wallet topup',
            '- chain-insights playbook list',
          ].join('\n'),
        },
      ],
      isError: false,
    }),
  )

  // Register each remote tool locally — passthrough proxy pattern
  for (const tool of tools ?? []) {
    if (LOCAL_TOOL_NAMES.has(tool.name)) continue
    const handler = async (args: unknown) => {
      try {
        const result = await remoteClient.callTool({
          name: tool.name,
          arguments: args as Record<string, unknown>,
        })
        return await normalizeRemoteToolResult(result as RemoteToolResult, config)
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `MCP call failed: ${(err as Error).message}` }],
          isError: true,
        }
      }
    }
    const toolConfig = {
      title: tool.title,
      description: tool.description ?? tool.name,
      inputSchema: z.object({}).passthrough(),
    }

    if (hasGraphApp(tool)) {
      registerAppTool(
        server,
        tool.name,
        {
          ...toolConfig,
          _meta: graphToolMeta(tool),
        },
        handler,
      )
    } else {
      server.registerTool(tool.name, toolConfig, handler)
    }
  }

  // Connect to stdio transport — after this line, stdout belongs to MCP
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Signal handling — clean shutdown
  const shutdown = () => {
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Entry point — only execute when run as the main module (not when imported by tests)
// Using process.argv check to detect direct execution vs import
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))) {
  createProxy().catch((err) => {
    process.stderr.write(`Chain Insights MCP proxy startup failed: ${(err as Error).message}\n`)
    process.exit(1)
  })
}
