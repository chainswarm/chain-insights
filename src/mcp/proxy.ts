import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as z from 'zod'
import type { McpTool } from './schema-cache.js'

const LOCAL_TOOL_NAMES = new Set(['balance', 'topup'])

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

  server.registerTool(
    'topup',
    {
      description: 'Start a local browser page for topping up the Chain Insights payment wallet with Base USDC.',
      inputSchema: z.object({}).passthrough(),
    },
    async () => {
      try {
        const { getWalletAccount } = await import('../wallet/tools.js')
        const { startTopupServer } = await import('../wallet/topup-server.js')
        const account = await getWalletAccount()
        const topupUrl = await startTopupServer(account)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                wallet_address: account.address,
                network: 'Base',
                token: 'USDC',
                topup_url: topupUrl,
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

  // Register each remote tool locally — passthrough proxy pattern
  for (const tool of tools ?? []) {
    if (LOCAL_TOOL_NAMES.has(tool.name)) continue
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? tool.name,
        inputSchema: z.object({}).passthrough(),
      },
      async (args) => {
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
      },
    )
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
