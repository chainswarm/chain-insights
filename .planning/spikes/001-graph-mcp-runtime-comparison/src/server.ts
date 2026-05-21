import { serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { cors } from 'hono/cors'
import { Hono } from 'hono'
import * as z from 'zod/v4'

import { buildGraphQueryResult } from './chain-insights-result.js'
import { validateReadOnlyCypher } from './cypher.js'
import { closeCachedDrivers, getCachedDriver, runReadQuery } from './memgraph.js'

const RESULT_OUTPUT_SCHEMA = {
  schema: z.literal('chain-insights.result.v1'),
  tool: z.literal('graph_query'),
  hint: z.string().nullable(),
  facts: z.record(z.string(), z.unknown()),
}

function getServer() {
  const server = new McpServer(
    {
      name: 'chain-insights-graph-query-hono-spike',
      version: '0.0.0',
    },
    {
      instructions: [
        'Spike MCP server for direct Memgraph graph_query over TypeScript/Hono.',
        'Only graph_query is exposed. Queries are read-only Cypher and get LIMIT 1000 when missing.',
      ].join('\n'),
    },
  )

  server.registerTool(
    'graph_query',
    {
      title: 'Cypher Graph Query',
      description: [
        'Execute a read-only Cypher query against Memgraph.',
        'Write operations (MERGE, DELETE, CREATE, SET, REMOVE, DROP, DETACH) are blocked.',
        'Queries without LIMIT get LIMIT 1000 auto-appended.',
      ].join(' '),
      inputSchema: {
        query: z.string().describe('Cypher read query to execute'),
        network: z.string().describe('Network to query. This spike supports bittensor by default.'),
      },
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, network }) => {
      const cypher = validateReadOnlyCypher(query)
      const results = await runReadQuery(getCachedDriver(network), cypher)
      return buildGraphQueryResult(network, { results, count: results.length })
    },
  )

  return server
}

const app = new Hono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
    exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
  }),
)

app.get('/health', (c) => c.json({ status: 'ok', service: 'graph-query-hono-spike' }))

app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport()
  const server = getServer()
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

const port = Number(process.env.PORT ?? 8911)

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })

console.error(`graph-query Hono MCP spike listening on http://127.0.0.1:${port}/mcp`)

process.on('SIGINT', () => {
  void closeCachedDrivers().finally(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void closeCachedDrivers().finally(() => process.exit(0))
})
