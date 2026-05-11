import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import * as z from 'zod'
import type { McpTool } from './schema-cache.js'

const LOCAL_TOOL_NAMES = new Set(['balance', 'topup', 'help'])
const TOPUP_RESOURCE_URI = 'ui://chain-insights/topup.html'
const GRAPH_RESOURCE_URI = 'ui://chain-insights/graph'
const GRAPH_APP_TOOL_NAMES = new Set([
  'address_risk',
  'track_funds',
  'money_flows_between_exchanges',
  'address_connection_risk',
])
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
        return {
          content: result.content as Array<{ type: 'text'; text: string }>,
          isError: result.isError as boolean | undefined,
        }
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
