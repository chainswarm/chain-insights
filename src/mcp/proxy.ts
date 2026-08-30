import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ContentBlock, GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import * as z from 'zod'
import type { InvestigatorConfig } from '../config/schema.js'
import { PACKAGE_VERSION } from '../version.js'
import type { McpTool } from './schema-cache.js'
import {
  HIDDEN_REMOTE_TOOL_NAMES,
  PUBLIC_MCP_TOOL_ALLOWED_ARGS,
  PUBLIC_MCP_TOOL_REQUIRED_ARGS,
} from './tool-visibility.js'
import { PaymentRequiredError } from './client.js'
import { primitiveBackendUsageStatus } from './usage-status.js'
import { mirrorGraphNetworkCapabilities } from './capabilities.js'
import { actionLogSignalsFromResult, appendActionLog } from './action-log.js'

const LOCAL_TOOL_NAMES = new Set([
  'meta_network_capabilities',
  'meta_usage_status',
  'meta_help',
  'wallet_balance',
])
const GRAPH_RESOURCE_URI = 'ui://chain-insights/graph'
const GRAPH_APP_TOOL_NAMES = new Set(['aml_address_risk'])
const GRAPH_ARRAY_KEYS = ['nodes', 'edges', 'flows', 'edge_anchors'] as const
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type McpProxyMode = 'workspace' | 'stateless'

export function resolveMcpProxyMode(env: NodeJS.ProcessEnv = process.env): McpProxyMode {
  const raw = env['CHAIN_INSIGHTS_MCP_PROXY_MODE']?.trim().toLowerCase()
  if (!raw || raw === 'workspace') return 'workspace'
  if (raw === 'stateless' || raw === 'no-workspace' || raw === 'workspace-less') return 'stateless'
  throw new Error(`CHAIN_INSIGHTS_MCP_PROXY_MODE must be workspace or stateless; got "${raw}"`)
}

const KNOWN_PUBLIC_TOOL_DESCRIPTIONS: Record<string, string> = {
  meta_network_capabilities: 'Return the current Chain Insights network and tool support matrix.',
  meta_usage_status: "Return the caller's public free graph_query quota for the current UTC day.",
  meta_help: 'Show a short guide to Chain Insights tools and workflow.',
  wallet_balance:
    'Show the local Chain Insights payment wallet address, payment network, token, and amount.',
  aml_address_risk:
    'Screen one blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with another address. Topology reads cover full lifetime history in one unified graph.',
  graph_query:
    'Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. Use USE topology for topology (address/FLOWS_TO/LINKED graph, unified recent+historical, plus the node risk_score/risk_level verdict) and USE facts for bounded TRANSFER rows and enrichment. Preserve full addresses exactly.',
  graph_query_batch:
    'Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads.',
}
const FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES = ['graph_query', 'graph_query_batch'] as const

type ToolInputShape = Record<string, z.ZodTypeAny>
type ToolHandler = (args: unknown, extra?: unknown) => Promise<unknown> | unknown
type ToolRegistrationConfig = Parameters<McpServer['registerTool']>[1]
type ToolCallInput = { name: string; arguments?: Record<string, unknown> }
type RemoteToolCaller = {
  callTool: Client['callTool']
}
type ChainInsightsGraphMeta = {
  schema: string
  url: string
}

const NETWORK_DESCRIPTION =
  'Network to query. Call meta_network_capabilities first and pass a name GraphRAG advertised. CIA does not pick a default network.'
const NETWORK_SCHEMA = z.string().min(1).describe(NETWORK_DESCRIPTION)

const EMPTY_INPUT_SCHEMA = z.strictObject({})
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000

const CHAIN_INSIGHTS_WORKFLOW = [
  'Workflow:',
  '1. Chain Insights workspaces are append-only local working directories. Bootstrap with cia init before workflows that persist artifacts.',
  '2. Do not call investigation tools until required arguments are known. Network is required; use meta_network_capabilities to check supported networks and available tools, or ask the user if missing.',
  '3. Use aml_address_risk for single-address enrichment. Use graph_query(_batch) for graph-level questions that aml_address_risk does not answer.',
  '4. Persisted outputs belong in the initialized workspace under reports/, reports/graphs/, reports/tables/, artifacts/, entities/, sessions/, and published/.',
  '5. For local review, inspect the generated Markdown and graph/table artifacts directly in the workspace.',
].join('\n')

const GRAPH_SCHEMA_HINTS = [
  'Graph query hints:',
  '- Call meta_network_capabilities first. Pass network= exactly as GraphRAG advertised it. CIA does not pick a default network.',
  '- The graph is address-grain. The only topology money node label is Address, keyed by the raw chain-native H160 address on EVM networks, for example 0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24. The network value on Address nodes matches the tool argument. There is no separate identity key.',
  '- Address nodes carry address, network, labels, and is_exchange. (:Address)-[:LINKED]-(:Address) is an undirected ownership-overlay edge (basis derived/associated, plus confidence, source_event, declared_owner) asserting the two addresses are controlled by the same actor. LINKED is served on the topology graph only. Enumerate LINKED neighbors with MATCH (a:Address {address: $addr})-[l:LINKED]-(b:Address) RETURN b.address, b.network, l.basis, l.confidence.',
  '- Address nodes also carry a risk verdict (risk_score float, risk_level string) plus base activity rollups: degree_in/degree_out/degree_total (distinct counterparty addresses), tx_in_count/tx_out_count/tx_total_count, total_in_usd/total_out_usd/total_volume_usd, net_flow_usd (in minus out; positive = net receiver) — all computed from external flows only — and first_activity_timestamp/last_activity_timestamp/activity_span_days, which include all flows (self-loops included). FLOWS_TO edges carry tx_count, amount_usd_sum, avg_tx_size_usd (understates when price_coverage_ratio < 1), first/last_seen_timestamp, first/last_tx_id, price_coverage_ratio. Lifetime aggregates are the only serving window.',
  '- For actor-level exposure (AC11), UNION FLOWS_TO reachability over one visible LINKED hop instead of expanding through the LINKED edge itself: MATCH (a:Address {address: $addr})-[:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN owned.address, b.address, r.amount_usd_sum.',
  '- The risk verdict lives on topology nodes (risk_score float, risk_level string). Labels and per-label risk also live on the address node (labels array + label_risk entries: label, risk_level, updated_timestamp). USE facts serves bounded individual transfer rows (TRANSFER edges) only; lifetime address metrics (degrees, totals, activity window) are node properties on USE topology.',
  '- (from:Address)-[t:TRANSFER]->(to:Address) on USE facts returns individual transfer rows, not aggregates, with properties amount, amount_usd, asset_symbol, asset_contract, tx_id, block_height, block_timestamp, event_index, edge_index, price_usd, and price_missing. Every TRANSFER query — row-select or count()/sum() aggregate — requires an indexed predicate: address equality on either endpoint (for example {address: "..."} on from or to) or a WHERE t.tx_id = "..." equality; a bare LIMIT with no indexed predicate is rejected, since facts_transfers_view is a full transfer-history table, not a small per-address dimension view.',
  '- Facts graph labels include Address; the TRANSFER relationship connects two Address nodes. Facts address keys match topology address values exactly.',
  '- Topology relationships include FLOWS_TO, LINKED, and RISK_PROXIMITY between Address nodes.',
  '- FLOWS_TO properties commonly carry tx_count, amount_usd_sum, avg_tx_size_usd, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id, price_coverage_ratio. Confirm available fields through runtime schema before relying on them.',
  '- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL.',
  '- Start schema discovery with endpoint-safe property reads: MATCH (n:Address) WHERE n.address IS NOT NULL RETURN n.address AS address, n.network AS network, n.labels AS labels, n.risk_score AS risk_score, n.risk_level AS risk_level LIMIT 20',
  '- Relationship discovery: MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20',
  '- graph_query uses the active Chain Insights graph endpoint. Select the graph with USE topology for topology (address/FLOWS_TO/LINKED graph, unified recent+historical, plus the node risk_score/risk_level verdict) and USE facts for bounded TRANSFER rows and enrichment; address is the node grain, not the topology name.',
  '- All graph_query calls are read-only. Never use CREATE, INSERT, MERGE, SET, DELETE, REMOVE, DROP, DETACH, ADD, CONNECT, DISCONNECT, ALTER, TRUNCATE, GRANT, or REVOKE.',
  '- Use USE facts graph patterns for fact and enrichment reads. Do not query internal table namespaces directly.',
].join('\n')

const GRAPH_REPORT_HINTS = [
  'Graph visualization behavior:',
  '- Graph-backed tools return the investigator report as text content and keep raw graph data out of LLM-visible structuredContent.',
  '- Chain Insights prepares the graph view automatically from local workspace report files when graph metadata is available.',
  '- If the graph view cannot load a report, retry the graph-backed tool call so Chain Insights can recreate the local graph report.',
].join('\n')

const SERVER_INSTRUCTIONS = [
  'Chain Insights is a local graph-analysis workspace for AI agents.',
  CHAIN_INSIGHTS_WORKFLOW,
  GRAPH_REPORT_HINTS,
  GRAPH_SCHEMA_HINTS,
  'Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings.',
].join('\n\n')

const STATELESS_SERVER_INSTRUCTIONS = [
  'Chain Insights is running as a stateless AML proxy for a host application.',
  'Do not use local workspace persistence, wallet, or graph report workflows in this mode.',
  'Use meta_network_capabilities first when network support is unknown, then call aml_address_risk, graph_query, or graph_query_batch as needed.',
  GRAPH_SCHEMA_HINTS,
  'Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings.',
].join('\n\n')

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

  throw new Error(`Chain Insights Graph app template not found. Tried: ${candidates.join(', ')}`)
}

function graphArtifactOrigins(config: Pick<InvestigatorConfig, 'serverPort'>): string[] {
  return [`http://127.0.0.1:${config.serverPort}`, `http://localhost:${config.serverPort}`]
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

// Exported so a test can prove, for EVERY public tool, that each declared
// schema argument also appears in PUBLIC_MCP_TOOL_ALLOWED_ARGS. An argument
// present here but missing there is silently stripped by
// normalizeRemoteToolArguments and the caller never learns their override was
// ignored — the failure mode that shipped with `time_scope`.
export function knownPublicToolInputSchema(toolName: string): ToolInputShape | null {
  switch (toolName) {
    case 'aml_address_risk':
      return {
        address: z.string().min(1).describe('Blockchain address to screen.'),
        network: NETWORK_SCHEMA,
        compare_address: z
          .string()
          .optional()
          .describe('Optional address to compare against the screened address.'),
        include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
      }
    case 'graph_query':
      return {
        query: z
          .string()
          .min(1)
          .describe(
            'Read-only GQL/Cypher query. Use USE topology for topology (address/FLOWS_TO/LINKED graph, unified recent+historical, plus the node risk_score/risk_level verdict) and USE facts for bounded TRANSFER rows and enrichment.'
          ),
        network: NETWORK_SCHEMA,
      }
    case 'graph_query_batch':
      return {
        network: NETWORK_SCHEMA,
        queries: z
          .array(
            z.object({
              id: z.string().optional(),
              query: z.string().min(1).describe('Read-only GQL/Cypher query'),
            })
          )
          .min(1)
          .max(20),
        per_query_timeout_seconds: z.number().int().min(1).max(600).optional(),
      }
    default:
      return null
  }
}

function fallbackGraphPrimitiveTools(): McpTool[] {
  return FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES.map((name) => ({
    name,
    description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS[name],
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/token|secret|password|private.?key|authorization/i.test(key)) return [key, '[redacted]']
      return [key, redactLogValue(entry)]
    })
  )
}

function errorForLog(err: unknown): Record<string, unknown> {
  const error = err as Error
  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(err),
  }
}

function sanitizeCypher(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

function cypherLogPayload(tool: string, args: unknown): Record<string, unknown> | null {
  if (!isRecord(args)) return null
  if (tool === 'graph_query') {
    return {
      network: args.network,
      queries: [
        {
          id: tool,
          query: typeof args.query === 'string' ? sanitizeCypher(args.query) : args.query,
        },
      ],
    }
  }
  if (tool === 'graph_query_batch') {
    const queries = Array.isArray(args.queries) ? args.queries : []
    return {
      network: args.network,
      per_query_timeout_seconds: args.per_query_timeout_seconds,
      query_count: queries.length,
      queries: queries.map((entry, index) =>
        isRecord(entry)
          ? {
              id: typeof entry.id === 'string' ? entry.id : `q${index + 1}`,
              query: typeof entry.query === 'string' ? sanitizeCypher(entry.query) : entry.query,
            }
          : { id: `q${index + 1}`, query: entry }
      ),
    }
  }
  return null
}

function createMcpLogger(config: Pick<InvestigatorConfig, 'dataDir'>) {
  const disabled = process.env.CHAIN_INSIGHTS_MCP_LOG === '0'
  const filePath =
    process.env.CHAIN_INSIGHTS_MCP_LOG_PATH?.trim() ||
    path.join(config.dataDir, '.chain-insights', 'runtime', 'logs', 'mcp-proxy.jsonl')

  async function write(
    level: 'info' | 'error',
    event: string,
    fields: Record<string, unknown> = {}
  ): Promise<void> {
    if (disabled) return
    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      await appendFile(
        filePath,
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          event,
          pid: process.pid,
          ...fields,
        }) + '\n',
        { mode: 0o600 }
      )
    } catch {
      // Logging must never break the stdio MCP server.
    }
  }

  return {
    filePath,
    info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
  }
}

function installToolLogging(server: McpServer, logger: ReturnType<typeof createMcpLogger>): void {
  const existingRegisterTool = server.registerTool
  const originalRegisterTool = existingRegisterTool.bind(server)
  const wrappedRegisterTool = ((
    name: string,
    config: ToolRegistrationConfig,
    handler: ToolHandler
  ) => {
    const wrapped: ToolHandler = async (args, extra) => {
      const startedAt = Date.now()
      await logger.info('tool.start', {
        tool: name,
        args: redactLogValue(args),
      })
      try {
        const result = await handler(args, extra)
        const isError = isRecord(result) && result.isError === true
        await logger.info('tool.end', {
          tool: name,
          duration_ms: Date.now() - startedAt,
          is_error: isError,
        })
        return result
      } catch (err) {
        await logger.error('tool.throw', {
          tool: name,
          duration_ms: Date.now() - startedAt,
          error: errorForLog(err),
        })
        throw err
      }
    }
    return originalRegisterTool(name, config, wrapped as never)
  }) as typeof server.registerTool
  Object.assign(wrappedRegisterTool, existingRegisterTool)
  server.registerTool = wrappedRegisterTool
}

function installRemoteCypherLogging(
  remoteClient: RemoteToolCaller,
  logger: ReturnType<typeof createMcpLogger>
): void {
  const existingCallTool = remoteClient.callTool
  const originalCallTool = existingCallTool.bind(remoteClient)
  const wrappedCallTool = (async (...args: Parameters<Client['callTool']>) => {
    const input = args[0] as ToolCallInput
    const queryPayload = cypherLogPayload(input.name, input.arguments)
    const toolArgs = input.arguments ?? {}
    const startedAt = Date.now()
    if (queryPayload) {
      await logger.info('topology.start', {
        tool: input.name,
        ...queryPayload,
      })
    }
    try {
      const result = await originalCallTool(...args)
      if (queryPayload) {
        await logger.info('topology.end', {
          tool: input.name,
          duration_ms: Date.now() - startedAt,
          is_error: isRecord(result) && result.isError === true,
        })
      }
      const { warnings, search_limits } = actionLogSignalsFromResult(result)
      await appendActionLog({
        timestamp: startedAt,
        tool: input.name,
        args: toolArgs,
        outcome: 'ok',
        duration_ms: Date.now() - startedAt,
        warnings,
        search_limits,
      })
      return result
    } catch (err) {
      if (queryPayload) {
        await logger.error('cypher.throw', {
          tool: input.name,
          duration_ms: Date.now() - startedAt,
          error: errorForLog(err),
        })
      }
      await appendActionLog({
        timestamp: startedAt,
        tool: input.name,
        args: toolArgs,
        outcome: 'error',
        duration_ms: Date.now() - startedAt,
        error: (err as Error).message,
      })
      throw err
    }
  }) as typeof remoteClient.callTool
  Object.assign(wrappedCallTool, existingCallTool)
  remoteClient.callTool = wrappedCallTool
}

function remoteToolRequestOptions(toolName: string): Parameters<Client['callTool']>[2] | undefined {
  if (toolName === 'graph_query' || toolName === 'graph_query_batch') {
    return {
      timeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS,
    }
  }
  return undefined
}

function isBlankArgument(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlankArgument)
  return false
}

function normalizeRemoteToolArguments(toolName: string, args: unknown): Record<string, unknown> {
  const normalized = isRecord(args) ? { ...args } : {}
  if (!(toolName in PUBLIC_MCP_TOOL_REQUIRED_ARGS)) return normalized

  const allowedArgs = PUBLIC_MCP_TOOL_ALLOWED_ARGS[toolName]
  if (!allowedArgs) return normalized
  return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowedArgs.includes(key)))
}

function validateKnownPublicToolArguments(
  toolName: string,
  args: Record<string, unknown>
): string | null {
  const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[toolName]
  if (!requiredArgs) return null

  for (const argName of requiredArgs) {
    if (isBlankArgument(args[argName])) {
      return `Missing required argument: ${argName}`
    }
  }

  return null
}

function claudeFacingToolDescription(tool: McpTool): string {
  const baseDescription = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool.name] ?? tool.description ?? tool.name
  const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[tool.name]
  if (!requiredArgs) return baseDescription
  return [
    baseDescription,
    '',
    `Required arguments: ${requiredArgs.join(', ')}.`,
    'If the user did not provide the network, ask for it before calling this tool. Do not guess a default network.',
  ].join('\n')
}

function knownPublicToolAnnotations(toolName: string): Record<string, boolean> | undefined {
  if (
    toolName === 'graph_query' ||
    toolName === 'graph_query_batch' ||
    toolName.startsWith('aml_')
  ) {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    }
  }
  return undefined
}

type RemoteToolResult = {
  content?: ContentBlock[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

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

function registerLocalPrompts(server: McpServer): void {
  server.registerPrompt(
    'aml-address-risk',
    {
      title: 'AML Address Risk',
      description:
        'Screen a blockchain address for AML risk, behavioral patterns, neighborhood profile, member addresses, and exchange links.',
      argsSchema: {
        network: NETWORK_SCHEMA,
        address: z.string().describe('Blockchain address to screen'),
        compare_address: z
          .string()
          .optional()
          .describe('Optional address to compare against the screened address'),
      },
    },
    async ({ network, address, compare_address }) =>
      promptResult(
        [
          `Use Chain Insights aml_address_risk on ${network} for:`,
          '',
          `\`${address}\``,
          compare_address ? `\nCompare with: \`${compare_address}\`` : '',
          '',
          'Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment.',
        ]
          .filter(Boolean)
          .join('\n'),
        'AML address risk screening'
      )
  )

  server.registerPrompt(
    'meta-network-capabilities',
    {
      title: 'Network Capabilities',
      description: 'Inspect supported networks and available tools before selecting a network.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_network_capabilities. Report only the supported networks and available tools exactly as returned; do not infer unsupported networks.',
        'Network capabilities'
      )
  )

  server.registerPrompt(
    'meta-usage-status',
    {
      title: 'Usage Status',
      description: "Check the caller's public free graph_query quota.",
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_usage_status. Report the quota fields exactly as returned.',
        'Usage status'
      )
  )

  server.registerPrompt(
    'graph-query',
    {
      title: 'Graph Query',
      description: 'Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.',
      argsSchema: {
        network: NETWORK_SCHEMA,
        query: z.string().describe('Read-only GQL/Cypher query'),
      },
    },
    async ({ network, query }) =>
      promptResult(
        [
          `Use Chain Insights graph_query on ${network} with this read-only GQL/Cypher query:`,
          '',
          '```gql',
          query,
          '```',
          '',
          'Use USE topology for topology (address/FLOWS_TO/LINKED graph, unified recent+historical, plus the node risk_score/risk_level verdict) and USE facts for bounded TRANSFER rows and enrichment. If you need schema context, first run small discovery queries such as MATCH (a:Address) RETURN a.address AS address, keys(a) AS address_properties LIMIT 5 and MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN keys(r) AS flow_properties LIMIT 5. Return the full address when available; never shorten addresses with ellipses.',
        ].join('\n'),
        'Graph query'
      )
  )

  server.registerPrompt(
    'graph-query-batch',
    {
      title: 'Graph Query Batch',
      description:
        'Run related read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch.',
      argsSchema: {
        network: NETWORK_SCHEMA,
        queries: z
          .string()
          .describe('JSON array of query objects with optional id and required query fields'),
        per_query_timeout_seconds: z
          .string()
          .optional()
          .describe('Optional integer timeout per query, 1-600 seconds'),
      },
    },
    async ({ network, queries, per_query_timeout_seconds }) =>
      promptResult(
        [
          `Use Chain Insights graph_query_batch on ${network} with these read-only GQL/Cypher queries:`,
          '',
          '```json',
          queries,
          '```',
          per_query_timeout_seconds
            ? `per_query_timeout_seconds: ${per_query_timeout_seconds}`
            : '',
          '',
          'Use USE topology for topology (address/FLOWS_TO/LINKED graph, unified recent+historical, plus the node risk_score/risk_level verdict) and USE facts for bounded TRANSFER rows and enrichment. If you need schema context, first run small discovery queries such as MATCH (a:Address) RETURN a.address AS address, keys(a) AS address_properties LIMIT 5 and MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN keys(r) AS flow_properties LIMIT 5. Return the full address when available; never shorten addresses with ellipses.',
        ]
          .filter(Boolean)
          .join('\n'),
        'Graph query batch'
      )
  )

  server.registerPrompt(
    'wallet-balance',
    {
      title: 'Wallet Balance',
      description:
        'Show the local Chain Insights payment wallet address, payment network, token, and amount.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights wallet_balance. Show the wallet address, payment network, token, and amount exactly as returned.',
        'Wallet balance'
      )
  )

  server.registerPrompt(
    'meta-help',
    {
      title: 'Chain Insights Help',
      description: 'Show available Chain Insights tools and workspace workflow.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_help. Summarize the available tools and workspace workflow without inventing capabilities.',
        'Chain Insights help'
      )
  )
}

function hasGraphArrayFields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return GRAPH_ARRAY_KEYS.some((key) => Array.isArray(record[key]))
}

function sanitizeStructuredContentForGraphPayload(
  structuredContent: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!structuredContent) return undefined
  return sanitizeStructuredValue(structuredContent) as Record<string, unknown>
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'app_data') continue
    if (
      GRAPH_ARRAY_KEYS.includes(key as (typeof GRAPH_ARRAY_KEYS)[number]) &&
      Array.isArray(childValue)
    ) {
      continue
    }
    sanitized[key] = sanitizeStructuredValue(childValue)
  }

  return sanitized
}

function getRemoteGraphPayload(result: RemoteToolResult): Record<string, unknown> | null {
  const chainInsights = result._meta?.chainInsights
  if (!chainInsights || typeof chainInsights !== 'object' || Array.isArray(chainInsights))
    return null
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
  toolName = 'remote-graph',
  includeAttachments = true
) {
  const graphPayload = getRemoteGraphPayload(result)
  const meta = { ...(result._meta ?? {}) }

  if (graphPayload && includeAttachments) {
    const { writeGraphReport } = await import('./graph-reports.js')
    const { ensureArtifactServer } = await import('./artifact-server.js')
    const report = await writeGraphReport(graphPayload as never, {
      serverPort: config.serverPort,
      slug: toolName || 'remote-graph',
    })
    await ensureArtifactServer(config.serverPort)
    meta.chainInsights = {
      ...((meta.chainInsights as Record<string, unknown>) ?? {}),
      graph: {
        schema: report.schema,
        url: report.url,
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

function shouldIncludeAttachments(
  args: Record<string, unknown>,
  workspaceArtifactsEnabled: boolean
): boolean {
  return workspaceArtifactsEnabled && args['include_attachments'] !== false
}

async function writeLocalGraphMeta(
  graphData: unknown,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  slug: string,
  includeAttachments: boolean
): Promise<ChainInsightsGraphMeta | undefined> {
  if (!includeAttachments) return undefined
  const { writeGraphReport } = await import('./graph-reports.js')
  const { ensureArtifactServer } = await import('./artifact-server.js')
  const report = await writeGraphReport(graphData as never, {
    serverPort: config.serverPort,
    slug,
  })
  await ensureArtifactServer(config.serverPort)
  return {
    schema: report.schema,
    url: report.url,
  }
}

function graphMetaResult(
  graph: ChainInsightsGraphMeta | undefined
): Record<string, unknown> | undefined {
  return graph
    ? {
        chainInsights: {
          graph,
        },
      }
    : undefined
}

function cleanNetworkCapabilities(value: unknown) {
  const structuredContent = isRecord(value) ? value.structuredContent : undefined
  const facts = isRecord(structuredContent) ? structuredContent.facts : undefined
  const capabilities = isRecord(facts) ? facts.capabilities : undefined
  const networks =
    isRecord(capabilities) && Array.isArray(capabilities.networks) ? capabilities.networks : []

  return {
    schema: 'chain-insights.result.v1' as const,
    tool: 'meta_network_capabilities',
    hint: null,
    facts: {
      capabilities: mirrorGraphNetworkCapabilities({ networks }),
    },
  }
}

function jsonTextResult(structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: false,
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
  const { activeDataDir, findActiveWorkspace } = await import('../workspace/active.js')
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./client.js')
  const { loadSchema, saveSchema } = await import('./schema-cache.js')

  const proxyMode = resolveMcpProxyMode()
  const workspaceArtifactsEnabled = proxyMode === 'workspace'
  const loadedConfig = await loadConfig()
  const activeWorkspace = workspaceArtifactsEnabled ? findActiveWorkspace() : null
  const config = {
    ...loadedConfig,
    dataDir: workspaceArtifactsEnabled ? activeDataDir(loadedConfig.dataDir) : loadedConfig.dataDir,
  }
  const logger = createMcpLogger(config)
  await logger.info('proxy.start', {
    data_dir: config.dataDir,
    workspace_root: activeWorkspace?.root,
    proxy_mode: proxyMode,
    graph_mcp_mode: config.graphMcpMode,
    graph_mcp_endpoint: resolveGraphMcpEndpoint(config),
    log_path: logger.filePath,
  })
  const graphMcpEndpoint = resolveGraphMcpEndpoint(config)

  // Build remote MCP client. The local Chain Insights MCP surface must still
  // start when the graph endpoint is temporarily unavailable so agents can use
  // help and wallet tools.
  const remoteClient = new Client({ name: 'chain-insights-proxy-client', version: PACKAGE_VERSION })
  let remoteConnected = false
  let remoteUnavailableMessage: string | undefined
  let mcpFetch: typeof fetch | undefined

  try {
    mcpFetch = await createConfiguredGraphMcpFetch(config)
  } catch (err) {
    await logger.error('remote.fetch_setup_failed', {
      endpoint: graphMcpEndpoint,
      error: errorForLog(err),
    })
    remoteUnavailableMessage = `Chain Insights Graph setup unavailable at ${graphMcpEndpoint}: ${(err as Error).message}`
    process.stderr.write(
      `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`
    )
  }

  if (mcpFetch) {
    try {
      await remoteClient.connect(
        new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch })
      )
      remoteConnected = true
      await logger.info('remote.connect', {
        transport: 'streamable_http',
        endpoint: graphMcpEndpoint,
      })
    } catch {
      await logger.error('remote.connect_failed', {
        transport: 'streamable_http',
        endpoint: graphMcpEndpoint,
      })
      // StreamableHTTP failed — try SSE fallback (assumption A1 from RESEARCH.md)
      try {
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
        await remoteClient.connect(
          new SSEClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch })
        )
        remoteConnected = true
        await logger.info('remote.connect', {
          transport: 'sse',
          endpoint: graphMcpEndpoint,
        })
      } catch (err2) {
        await logger.error('remote.connect_failed', {
          transport: 'sse',
          endpoint: graphMcpEndpoint,
          error: errorForLog(err2),
        })
        remoteUnavailableMessage = `Chain Insights Graph unreachable at ${graphMcpEndpoint}: ${(err2 as Error).message}`
        process.stderr.write(
          `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`
        )
      }
    }
  }
  if (remoteConnected)
    installRemoteCypherLogging(remoteClient as unknown as RemoteToolCaller, logger)

  // Schema cache check — skip remote listTools call on cache hit
  let tools: McpTool[] | null = await loadSchema(graphMcpEndpoint)

  if (!tools && remoteConnected) {
    // Cache miss — fetch tools from remote (client is already connected above)
    const result = await remoteClient.listTools()
    tools = result.tools as McpTool[]
    await saveSchema(tools, graphMcpEndpoint)
    await logger.info('schema.tools_loaded', {
      source: 'remote',
      count: tools.length,
    })
  } else if (tools) {
    await logger.info('schema.tools_loaded', {
      source: 'cache',
      count: tools.length,
    })
  } else {
    tools = fallbackGraphPrimitiveTools()
    await logger.info('schema.tools_loaded', {
      source: 'unavailable',
      count: tools.length,
    })
  }
  const remoteToolNames = new Set((tools ?? []).map((tool) => tool.name))

  // Build local stdio proxy server
  const server = new McpServer(
    { name: 'chain-insights', version: PACKAGE_VERSION },
    {
      instructions: workspaceArtifactsEnabled ? SERVER_INSTRUCTIONS : STATELESS_SERVER_INSTRUCTIONS,
    }
  )
  installToolLogging(server, logger)

  if (remoteConnected) {
    try {
      await remoteClient.listPrompts()
    } catch (err) {
      await logger.error('remote.prompts_failed', {
        endpoint: graphMcpEndpoint,
        error: errorForLog(err),
      })
      process.stderr.write(
        `Chain Insights MCP remote prompt metadata unavailable at ${graphMcpEndpoint}: ${(err as Error).message}\n`
      )
    }
  }

  registerLocalPrompts(server)

  const caseToolError = (label: string, err: unknown) => ({
    content: [{ type: 'text' as const, text: `${label} failed: ${(err as Error).message}` }],
    isError: true,
  })

  const parseTags = (tags: string | string[] | undefined): string[] => {
    if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean)
    if (typeof tags === 'string')
      return tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    return []
  }

  server.registerTool(
    'meta_network_capabilities',
    {
      title: 'Network Capabilities',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_network_capabilities,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      if (remoteConnected && remoteToolNames.has('network_capabilities')) {
        try {
          const result = await remoteClient.callTool({
            name: 'network_capabilities',
            arguments: {},
          })
          return jsonTextResult(cleanNetworkCapabilities(result))
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Network capabilities failed: ${(err as Error).message}`,
              },
            ],
            isError: true,
          }
        }
      }
      return jsonTextResult(cleanNetworkCapabilities(undefined))
    }
  )

  server.registerTool(
    'meta_usage_status',
    {
      title: 'Usage Status',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_usage_status,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        if (!remoteConnected) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              },
            ],
            isError: true,
          }
        }
        if (!remoteToolNames.has('usage_status')) {
          return jsonTextResult(primitiveBackendUsageStatus(graphMcpEndpoint))
        }
        const result = (await remoteClient.callTool({
          name: 'usage_status',
          arguments: {},
        })) as RemoteToolResult
        const structuredContent = isRecord(result.structuredContent)
          ? { ...result.structuredContent, tool: 'meta_usage_status' }
          : undefined
        return {
          content: structuredContent
            ? [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }]
            : (result.content ?? []),
          structuredContent,
          _meta: result._meta,
          isError: result.isError,
        }
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: `Usage status failed: ${(err as Error).message}` },
          ],
          isError: true,
        }
      }
    }
  )

  if (workspaceArtifactsEnabled) {
    server.registerTool(
      'wallet_balance',
      {
        title: 'Wallet Balance',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.wallet_balance,
        inputSchema: EMPTY_INPUT_SCHEMA,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () => {
        try {
          const { formatWalletBalanceResult, getWalletAccount, getWalletBalanceResult } =
            await import('../wallet/tools.js')
          const account = await getWalletAccount()
          const structuredContent = await getWalletBalanceResult(account)
          return {
            content: [
              { type: 'text' as const, text: formatWalletBalanceResult(structuredContent) },
            ],
            structuredContent: structuredContent as unknown as Record<string, unknown>,
            isError: false,
          }
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Balance failed: ${(err as Error).message}` }],
            isError: true,
          }
        }
      }
    )
  }
  // NOTE: only wallet_balance is workspace-only. Everything below — the graph
  // app resource, the aml_*/graph tools, and server.connect() — is shared and
  // MUST run in stateless mode too. (Regression #136: this brace had drifted to
  // the end of the function, so stateless mode skipped server.connect entirely.)

  registerAppResource(
    server,
    'Fund Flow Graph',
    GRAPH_RESOURCE_URI,
    {
      description:
        'Interactive fund-flow and pattern graph for Chain Insights investigation reports.',
      _meta: {
        ui: {
          csp: {
            resourceDomains: graphArtifactOrigins(config),
            connectDomains: graphArtifactOrigins(config),
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: GRAPH_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readGraphAppHtml(),
          _meta: {
            ui: {
              csp: {
                resourceDomains: graphArtifactOrigins(config),
                connectDomains: graphArtifactOrigins(config),
              },
            },
          },
        },
      ],
    })
  )

  if (!remoteToolNames.has('aml_address_risk')) {
    registerAppTool(
      server,
      'aml_address_risk',
      {
        title: 'Address Risk',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_address_risk,
        inputSchema: {
          address: z.string().min(1).describe('Blockchain address to screen'),
          network: NETWORK_SCHEMA,
          compare_address: z
            .string()
            .optional()
            .describe('Optional address to compare against the screened address'),
          include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
        },
        _meta: {
          ui: {
            resourceUri: GRAPH_RESOURCE_URI,
          },
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ address, network, compare_address, include_attachments }) => {
        try {
          if (!remoteConnected) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
                },
              ],
              isError: true,
            }
          }
          const { addressRisk } = await import('../investigation/public-tools.js')
          const result = await addressRisk(remoteClient, {
            address,
            network,
            compareAddress: compare_address,
            writeArtifacts: workspaceArtifactsEnabled,
          })
          const graph = await writeLocalGraphMeta(
            result.graphData,
            config,
            `address-risk-${network}-${address}`,
            shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled)
          )
          return {
            content: [{ type: 'text' as const, text: result.summaryText }],
            structuredContent: result.structuredContent,
            _meta: graphMetaResult(graph),
            isError: false,
          }
        } catch (err) {
          if (err instanceof PaymentRequiredError) {
            return { content: [{ type: 'text' as const, text: err.message }], isError: true }
          }
          return {
            content: [
              { type: 'text' as const, text: `Address risk failed: ${(err as Error).message}` },
            ],
            isError: true,
          }
        }
      }
    )
  }

  server.registerTool(
    'meta_help',
    {
      title: 'Chain Insights Help',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_help,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: workspaceArtifactsEnabled
            ? [
                'Chain Insights helps AI agents run AML investigation workflows and keep evidence in local workspace files.',
                '',
                CHAIN_INSIGHTS_WORKFLOW,
                '',
                'Investigation tools:',
                '- meta_network_capabilities: inspect supported networks and available tools.',
                '- meta_usage_status: check the caller public free graph_query quota.',
                '- aml_address_risk: screen one blockchain address; optionally compare it with another address.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE topology or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
                '',
                'Wallet tools:',
                '- wallet_balance: show the local payment wallet address, payment network, token, and amount.',
                '- meta_help: show this overview.',
                '',
                GRAPH_REPORT_HINTS,
              ].join('\n')
            : [
                'Chain Insights stateless AML proxy for host applications.',
                '',
                'Local workspace persistence, wallet, and graph report attachment tools are disabled in this mode.',
                '',
                'Available graph-backed tools:',
                '- meta_network_capabilities: inspect supported networks and available tools.',
                '- meta_usage_status: check the caller public free graph_query quota.',
                '- aml_address_risk: screen one blockchain address; optionally compare it with another address.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE topology or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
              ].join('\n'),
        },
      ],
      isError: false,
    })
  )

  // Register each remote tool locally — passthrough proxy pattern
  for (const tool of tools ?? []) {
    if (HIDDEN_REMOTE_TOOL_NAMES.has(tool.name)) continue
    if (LOCAL_TOOL_NAMES.has(tool.name)) continue
    const inputSchema = knownPublicToolInputSchema(tool.name) ?? z.object({}).passthrough()
    const handler = async (args: unknown) => {
      try {
        if (!remoteConnected) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              },
            ],
            isError: true,
          }
        }
        const normalizedArgs = normalizeRemoteToolArguments(tool.name, args)
        const validationError = validateKnownPublicToolArguments(tool.name, normalizedArgs)
        if (validationError) {
          return {
            content: [{ type: 'text' as const, text: validationError }],
            isError: true,
          }
        }
        const request = {
          name: tool.name,
          arguments: normalizedArgs,
        }
        const requestOptions = remoteToolRequestOptions(tool.name)
        const result = requestOptions
          ? await remoteClient.callTool(request, undefined, requestOptions)
          : await remoteClient.callTool(request)
        return await normalizeRemoteToolResult(
          result as RemoteToolResult,
          config,
          tool.name,
          shouldIncludeAttachments(normalizedArgs, workspaceArtifactsEnabled)
        )
      } catch (err) {
        if (err instanceof PaymentRequiredError) {
          return {
            content: [{ type: 'text' as const, text: err.message }],
            isError: true,
          }
        }
        const msg = (err as Error).message ?? String(err)
        const isTransport402 = /\b402\b/.test(msg) || msg.toLowerCase().includes('payment')
        if (isTransport402) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Payment required for ${tool.name}. This tool costs USDC on Base via x402 micropayments. ` +
                  'Next steps: run `chain-insights wallet ready` to check funding and finish one-time payment setup, ' +
                  'run `chain-insights wallet topup` if it says the wallet needs USDC, ' +
                  'or `chain-insights access-key set <key>` if you have been given test access.',
              },
            ],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text' as const, text: `MCP call failed: ${msg}` }],
          isError: true,
        }
      }
    }
    const toolConfig = {
      title: tool.title,
      description: claudeFacingToolDescription(tool),
      inputSchema,
      ...(knownPublicToolAnnotations(tool.name)
        ? { annotations: knownPublicToolAnnotations(tool.name) }
        : {}),
    }

    if (hasGraphApp(tool)) {
      registerAppTool(
        server,
        tool.name,
        {
          ...toolConfig,
          _meta: graphToolMeta(tool),
        },
        handler
      )
    } else {
      server.registerTool(tool.name, toolConfig, handler)
    }
  }

  // Connect to stdio transport — after this line, stdout belongs to MCP
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await logger.info('proxy.ready', {
    tools: [
      ...LOCAL_TOOL_NAMES,
      ...(tools ?? [])
        .map((tool) => tool.name)
        .filter((name) => !HIDDEN_REMOTE_TOOL_NAMES.has(name) && !LOCAL_TOOL_NAMES.has(name)),
    ].length,
  })

  // Signal handling — clean shutdown
  const shutdown = async () => {
    await logger.info('proxy.shutdown')
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
}

// Entry point — only execute when run as the main module (not when imported by tests)
// Using process.argv check to detect direct execution vs import
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))) {
  createProxy().catch((err) => {
    process.stderr.write(`Chain Insights MCP proxy startup failed: ${(err as Error).message}\n`)
    process.exit(1)
  })
}
