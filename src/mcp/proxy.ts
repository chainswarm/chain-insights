import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
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
import { PACKAGE_VERSION } from '../version.js'
import type { McpTool } from './schema-cache.js'
import { HIDDEN_REMOTE_TOOL_NAMES } from './tool-visibility.js'
import { PaymentRequiredError } from './client.js'

const LOCAL_TOOL_NAMES = new Set([
  'balance',
  'help',
])
const PUBLIC_GRAPHRAG_PROMPT_NAMES = new Set(['address-risk', 'trace-tools'])
const GRAPH_RESOURCE_URI = 'ui://chain-insights/graph'
const GRAPH_APP_TOOL_NAMES = new Set([
  'aml_address_risk',
  'aml_trace_victim_funds',
  'aml_trace_suspect_funds',
  'aml_trace_deposit_sources',
])
const GRAPH_ARRAY_KEYS = ['nodes', 'edges', 'flows', 'edge_anchors'] as const
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type McpProxyMode = 'workspace' | 'stateless'

export function resolveMcpProxyMode(env: NodeJS.ProcessEnv = process.env): McpProxyMode {
  const raw = env['CHAIN_INSIGHTS_MCP_PROXY_MODE']?.trim().toLowerCase()
  if (!raw || raw === 'workspace') return 'workspace'
  if (raw === 'stateless' || raw === 'no-workspace' || raw === 'workspace-less') return 'stateless'
  throw new Error(`CHAIN_INSIGHTS_MCP_PROXY_MODE must be workspace or stateless; got "${raw}"`)
}

const COMMA_SEPARATED_ADDRESS_FIELDS = new Set([
  'victim_addresses',
  'known_suspect_addresses',
  'suspect_addresses',
  'deposit_addresses',
])

const KNOWN_PUBLIC_TOOL_REQUIRED_ARGS: Record<string, string[]> = {
  aml_address_risk: ['address', 'network'],
  aml_trace_victim_funds: ['victim_addresses', 'network'],
  aml_trace_suspect_funds: ['suspect_addresses', 'network'],
  aml_trace_deposit_sources: ['deposit_addresses', 'network'],
  graph_query: ['query', 'network'],
  graph_query_batch: ['network', 'queries'],
}

const KNOWN_PUBLIC_TOOL_DESCRIPTIONS: Record<string, string> = {
  network_capabilities: 'Return supported Chain Insights networks, graph layers, and available tools. Use this before choosing network-specific tools.',
  aml_address_risk: 'Screen one blockchain address for AML risk, behavior patterns, neighborhood context, exchange exposure, and optional comparison with compare_address. Chain Insights resolves member addresses to identity-grain topology internally and returns member addresses as the public result surface.',
  aml_trace_victim_funds: 'Trace victim/source funds forward through intermediaries to exchange deposit candidates on GraphRAG MCP topology; when incident_timestamp_ms or time_range is set, traced FLOWS_TO edges are filtered to that activity window (first_seen/last_seen) and the effective filter is echoed as time_filter in the result. The result also includes a bounded deposit_funding traceback preview: source-exchange paths covering roughly the first floor(20/max_hops) deposit candidates plus reverse 1-hop leads, where each source_exchange_paths[].path is in traversal order deposit-to-source (the reverse of money flow) and traceback cost grows with each seed; use aml_trace_deposit_sources for deeper reverse traceback from suspected deposit endpoints. Use only when the input addresses are victims or trusted stolen-source addresses, and treat exchange hot wallets as terminal only, never candidate deposits. Returns chain-insights.trace.v1 and preserves full addresses exactly.',
  aml_trace_suspect_funds: 'Trace suspected scammer, mule, operator, or laundering-ring funds forward to cashout topology on GraphRAG MCP; when incident_timestamp_ms or time_range is set, traced FLOWS_TO edges are filtered to that activity window (first_seen/last_seen) and the effective filter is echoed as time_filter in the result. The result also includes a bounded deposit_funding traceback preview (source-exchange paths covering roughly the first floor(20/max_hops) deposit candidates plus reverse 1-hop leads; source_exchange_paths[].path is traversal order deposit-to-source, the reverse of money flow; cost grows per seed). Use only when the input addresses are suspect-controlled seeds, not victim/source addresses or suspected deposit endpoints, and treat exchange hot wallets as terminal only. Returns chain-insights.trace.v1 and preserves full addresses exactly.',
  aml_trace_deposit_sources: 'Trace backward from suspected deposit/cashout addresses to upstream sources, shared funders, and convergence on GraphRAG MCP topology. min_amount_sum drops reverse FLOWS_TO edges below that USD amount (amount_usd_sum; dust control), time_range applies the same first_seen/last_seen activity window echoed as time_filter, and each reverse depth is capped at 500 rows with an explicit truncation warning when the cap is hit. Use only when the input addresses are suspected non-exchange deposit endpoints; do not treat these seeds as scammers, and exchange hot wallets are excluded as seeds and upstream sources. Returns chain-insights.trace.v1 and preserves full addresses exactly.',
  graph_query: 'Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Cross-layer correlated joins may be limited by the active graph endpoint; preserve full addresses exactly.',
  graph_query_batch: 'Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads.',
}
const FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES = ['network_capabilities', 'graph_query', 'graph_query_batch'] as const

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

const NETWORK_DESCRIPTION = 'Required network to query. Do not guess; use network_capabilities or ask the user if missing.'
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000

const CHAIN_INSIGHTS_WORKFLOW = [
  'Workflow:',
  '1. Chain Insights workspaces are append-only local working directories. Bootstrap with cia init before workflows that persist artifacts.',
  '2. Do not call investigation tools until required arguments are known. Network is required; use network_capabilities to check supported networks, graph layers, and available tools, or ask the user if missing.',
  '3. Use aml_address_risk for single-address enrichment. Use aml_trace_victim_funds for victim/source forward tracing and aml_trace_suspect_funds for suspect-controlled outbound laundering/cashout topology; both include a bounded deposit_funding traceback preview for discovered deposit candidates. Use aml_trace_deposit_sources for deeper reverse traceback from suspected deposit endpoints. Use graph_query(_batch) only when the high-level tools do not answer the exact question.',
  '4. Persisted outputs belong in the initialized workspace under reports/, reports/graphs/, reports/tables/, artifacts/, entities/, sessions/, and published/.',
  '5. For local review, inspect the generated Markdown and graph/table artifacts directly in the workspace.',
].join('\n')

const GRAPH_SCHEMA_HINTS = [
  'Graph query hints for network=bittensor:',
  '- The graph is identity-grain. The only topology node label is Identity (satellite Address nodes exist only for member-address lookup), keyed by identity_id in the canonical prefixed form <network>:<canonical_address>, for example bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24.',
  '- Identity nodes carry identity_id, labels, and is_exchange. There is no addresses list property and no network property; each network domain has its own graph. Member-address forms live exclusively on satellite (:Address {address, network}) nodes; enumerate them with MATCH (i:Identity {identity_id: $id})-[:HAS_ADDRESS]->(m:Address) RETURN m.address, m.network.',
  '- Identity nodes also carry a slim live risk verdict (risk_score float, risk_level string) plus base activity rollups: degree_in/degree_out/degree_total (distinct counterparty identities), tx_in_count/tx_out_count/tx_total_count, total_in_usd/total_out_usd/total_volume_usd, net_flow_usd (in minus out; positive = net receiver) — all computed from external flows only — and first_activity_timestamp/last_activity_timestamp/activity_span_days, which include all flows (self-loops included). Movement between an identity\'s own member forms is excluded from the degree/count/USD rollups and exposed separately as internal_tx_count/internal_volume_usd (sparse: absent when zero, like is_exchange). FLOWS_TO edges carry tx_count, amount_usd_sum, avg_tx_size_usd (understates when price_coverage_ratio < 1), first/last_seen_timestamp, first/last_tx_id, dominant_asset (largest USD share), price_coverage_ratio. Lifetime aggregates are the only serving window.',
  '- Resolve any member address form (0x or SS58) to its identity with the indexed exact lookup: MATCH (m:Address {address: $input})<-[:HAS_ADDRESS]-(i:Identity) RETURN i.identity_id LIMIT 1. :Address(address) is unique and index-backed.',
  '- Detailed, provenanced scoring still comes from USE facts: (:Identity)-[:HAS_RISK_SCORE]->(:RiskScore) for model versions/processing dates, (:Identity)-[:HAS_LABEL]->(:AddressLabel) for label risk, (:Identity)-[:HAS_FEATURE]->(:AddressFeature) for feature metrics. Use node risk_score/risk_level only as the quick-triage verdict; never read ml_* properties off topology nodes.',
  '- Facts graph labels include Identity, AddressLabel, AddressFeature, RiskScore, Asset, NeuronEndpoint, Hotkey, and IPAddress. Facts identity keys match live identity_id values exactly.',
  '- Live topology relationships include FLOWS_TO and RISK_PROXIMITY between Identity nodes.',
  '- FLOWS_TO properties are scoped to the selected topology graph and commonly carry tx_count, amount_usd_sum, avg_tx_size_usd, first_seen_timestamp, last_seen_timestamp, first_tx_id, last_tx_id, dominant_asset, price_coverage_ratio. Confirm available fields through runtime schema before relying on them.',
  '- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL.',
  '- Start schema discovery with endpoint-safe property reads: MATCH (n:Identity) WHERE n.identity_id IS NOT NULL RETURN n.identity_id AS identity_id, n.labels AS labels, n.risk_score AS risk_score, n.risk_level AS risk_level LIMIT 20',
  '- Relationship discovery: MATCH (:Identity)-[r:FLOWS_TO]->(:Identity) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20',
  '- graph_query uses the active Chain Insights graph endpoint. Select the graph with USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. If an older endpoint surfaces a legacy topology_scope argument, treat it as compatibility routing only; identity is the node grain, not the topology name.',
  '- Archive topology labels include Identity and Address. Archived money-flow topology is represented as (:Identity)-[:FLOWS_TO]->(:Identity) relationships with period_granularity, period_start_date, and period_end_date, and archive member-address lookup uses (:Identity)-[:HAS_ADDRESS]->(:Address) with Address.address and member-ledger Address.network projected for public address resolution.',
  '- All graph_query calls are read-only. Never use CREATE, INSERT, MERGE, SET, DELETE, REMOVE, DROP, DETACH, ADD, CONNECT, DISCONNECT, ALTER, TRUNCATE, GRANT, or REVOKE.',
  '- Use USE facts graph patterns for fact and enrichment reads. Do not query internal table namespaces directly.',
].join('\n')

const GRAPH_REPORT_HINTS = [
  'Graph visualization behavior:',
  '- Graph-backed tools return the investigator report as text content and keep raw graph data out of LLM-visible structuredContent.',
  '- Raw graph data is stored locally under Chain Insights reports/graphs and exposed to the graph app as _meta.chainInsights.graph.url.',
  '- The local graph report server is started automatically by the MCP server when a graph-backed tool returns a report URL; do not ask the user to run chain-insights serve for Claude Desktop graph iframes.',
  '- If an iframe reports that a graph report fetch failed, retry the graph-backed tool call so Chain Insights can recreate the report URL and ensure the local report server is running.',
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
  'Use network_capabilities first when network support is unknown, then call aml_address_risk, aml_trace_victim_funds, aml_trace_suspect_funds, aml_trace_deposit_sources, graph_query, or graph_query_batch as needed.',
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

  throw new Error(`Graph MCP app template not found. Tried: ${candidates.join(', ')}`)
}

function graphArtifactOrigins(config: Pick<InvestigatorConfig, 'serverPort'>): string[] {
  return [
    `http://127.0.0.1:${config.serverPort}`,
    `http://localhost:${config.serverPort}`,
  ]
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

function knownPublicToolInputSchema(toolName: string): ToolInputShape | null {
  switch (toolName) {
    case 'aml_address_risk':
      return {
        address: z.string().min(1).describe('Full blockchain address to screen. Chain Insights resolves member addresses to identity-grain topology internally.'),
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
        compare_address: z.string().optional().describe('Optional second full blockchain address for comparison'),
        include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
      }
    case 'aml_trace_victim_funds':
      return {
        victim_addresses: z.string().min(1).describe('Comma-separated full victim/source blockchain addresses. Min 1, max 5.'),
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
        known_suspect_addresses: z.string().optional().describe('Optional known suspect blockchain addresses for context only. They are not reverse-traced by this tool. Max 5.'),
        incident_timestamp_ms: z.number().min(0).optional().describe('Optional incident timestamp in milliseconds.'),
        include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
      }
    case 'aml_trace_suspect_funds':
      return {
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
        suspect_addresses: z.string().min(1).describe('Comma-separated full suspected scammer, mule, operator, or laundering-ring blockchain addresses. Min 1, max 5.'),
        incident_timestamp_ms: z.number().min(0).optional().describe('Optional incident timestamp in milliseconds. This tool also works without a timestamp.'),
        max_hops: z.number().int().min(1).max(5).optional().describe('Maximum forward trace hops. Default 3.'),
      }
    case 'aml_trace_deposit_sources':
      return {
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
        deposit_addresses: z.string().min(1).describe('Comma-separated full suspected deposit/cashout blockchain addresses. Min 1, max 5.'),
        max_hops: z.number().int().min(1).max(5).optional().describe('Maximum reverse traceback hops. Default 2.'),
        include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
      }
    case 'graph_query':
      return {
        query: z.string().min(1).describe('Read-only GQL/Cypher query. Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment.'),
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
      }
    case 'graph_query_batch':
      return {
        network: z.string().min(1).describe(NETWORK_DESCRIPTION),
        queries: z.array(z.object({
          id: z.string().optional(),
          query: z.string().min(1).describe('Read-only GQL/Cypher query'),
        })).min(1).max(20),
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
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/token|secret|password|private.?key|authorization/i.test(key)) return [key, '[redacted]']
    return [key, redactLogValue(entry)]
  }))
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
      queries: [{
        id: tool,
        query: typeof args.query === 'string' ? sanitizeCypher(args.query) : args.query,
      }],
    }
  }
  if (tool === 'graph_query_batch') {
    const queries = Array.isArray(args.queries) ? args.queries : []
    return {
      network: args.network,
      per_query_timeout_seconds: args.per_query_timeout_seconds,
      query_count: queries.length,
      queries: queries.map((entry, index) => isRecord(entry)
        ? {
            id: typeof entry.id === 'string' ? entry.id : `q${index + 1}`,
            query: typeof entry.query === 'string' ? sanitizeCypher(entry.query) : entry.query,
          }
        : { id: `q${index + 1}`, query: entry }),
    }
  }
  return null
}

function createMcpLogger(config: Pick<InvestigatorConfig, 'dataDir'>) {
  const disabled = process.env.CHAIN_INSIGHTS_MCP_LOG === '0'
  const filePath = process.env.CHAIN_INSIGHTS_MCP_LOG_PATH?.trim() || path.join(config.dataDir, '.chain-insights', 'runtime', 'logs', 'mcp-proxy.jsonl')

  async function write(level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}): Promise<void> {
    if (disabled) return
    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      await appendFile(filePath, JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        pid: process.pid,
        ...fields,
      }) + '\n', { mode: 0o600 })
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
  const wrappedRegisterTool = ((name: string, config: ToolRegistrationConfig, handler: ToolHandler) => {
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

function installRemoteCypherLogging(remoteClient: RemoteToolCaller, logger: ReturnType<typeof createMcpLogger>): void {
  const existingCallTool = remoteClient.callTool
  const originalCallTool = existingCallTool.bind(remoteClient)
  const wrappedCallTool = (async (...args: Parameters<Client['callTool']>) => {
    const input = args[0] as ToolCallInput
    const queryPayload = cypherLogPayload(input.name, input.arguments)
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
      return result
    } catch (err) {
      if (queryPayload) {
        await logger.error('cypher.throw', {
          tool: input.name,
          duration_ms: Date.now() - startedAt,
          error: errorForLog(err),
        })
      }
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
  if (!(toolName in KNOWN_PUBLIC_TOOL_REQUIRED_ARGS)) return normalized

  for (const fieldName of COMMA_SEPARATED_ADDRESS_FIELDS) {
    const value = normalized[fieldName]
    if (Array.isArray(value)) {
      normalized[fieldName] = value
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .join(',')
    }
  }

  return normalized
}

function validateKnownPublicToolArguments(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const requiredArgs = KNOWN_PUBLIC_TOOL_REQUIRED_ARGS[toolName]
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
  const requiredArgs = KNOWN_PUBLIC_TOOL_REQUIRED_ARGS[tool.name]
  if (!requiredArgs) return baseDescription
  return [
    baseDescription,
    '',
    `Required arguments: ${requiredArgs.join(', ')}.`,
    'If the user did not provide the network, ask for it before calling this tool. Do not guess a default network.',
  ].join('\n')
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

function promptArgumentSchema(promptName: string, argument: NonNullable<Prompt['arguments']>[number]) {
  const description = PUBLIC_GRAPHRAG_PROMPT_NAMES.has(promptName) && argument.name === 'network'
    ? NETWORK_DESCRIPTION
    : argument.description ?? argument.name
  const schema = z.string().describe(description)
  if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(promptName) && argument.name === 'network') {
    return schema
  }
  return argument.required === false ? schema.optional() : schema
}

function registerRemotePrompt(server: McpServer, remoteClient: Client, prompt: Prompt): void {
  const argsSchema: Record<string, z.ZodTypeAny> = {}
  for (const argument of prompt.arguments ?? []) {
    argsSchema[argument.name] = promptArgumentSchema(prompt.name, argument)
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
        description: 'Screen a blockchain address for AML risk, behavioral patterns, neighborhood profile, member addresses, and exchange links.',
        argsSchema: {
          address: z.string().describe('Full blockchain/member address to screen'),
          network: z.string().describe(NETWORK_DESCRIPTION),
        },
      },
      async ({ address, network }) => promptResult(
        [
          `Use Chain Insights aml_address_risk on ${network} for:`,
          '',
          `\`${address}\``,
          '',
          'Present the summary as-is. Do not add analysis, verdicts, or risk assessments; the tool output already contains the risk assessment.',
        ].join('\n'),
        'Address risk screening',
      ),
    )
  }

  if (!remotePromptNames.has('trace-tools')) {
    server.registerPrompt(
      'trace-tools',
      {
        title: 'Trace Tools',
        description: 'Choose aml_trace_victim_funds, aml_trace_deposit_sources, or aml_trace_suspect_funds based on the evidence role.',
        argsSchema: {
          addresses: z.string().describe('Input addresses, comma-separated full addresses'),
          role: z.enum(['victim', 'suspect', 'deposit']).describe('Role of the supplied addresses'),
          network: z.string().describe(NETWORK_DESCRIPTION),
        },
      },
      async ({ addresses, role, network }) => {
        const toolName = role === 'deposit' ? 'aml_trace_deposit_sources' : `aml_trace_${role}_funds`
        return promptResult([
          `Use Chain Insights ${toolName} on ${network}.`,
          '',
          'Full addresses:',
          addresses,
          '',
          role === 'deposit'
            ? 'For deposit role, use aml_trace_deposit_sources rather than aml_trace_deposit_funds.'
            : 'Present the summary as-is and use continuation.recommended_next_tools for follow-up.',
        ].join('\n'), 'Trace role-specific funds')
      },
    )
  }

  server.registerPrompt(
    'network-capabilities',
    {
      title: 'Network Capabilities',
      description: 'Inspect supported semantic networks, graph layers, and available tools before selecting a network.',
      argsSchema: {},
    },
    async () => promptResult(
      'Use Chain Insights network_capabilities. Report only the supported networks and available tools exactly as returned; do not infer unsupported networks.',
      'Network capabilities',
    ),
  )

  server.registerPrompt(
    'graph-query',
    {
      title: 'Graph Query',
      description: 'Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.',
      argsSchema: {
        query: z.string().describe('Read-only GQL/Cypher query'),
        network: z.string().describe(NETWORK_DESCRIPTION),
      },
    },
    async ({ query, network }) => promptResult(
      [
        `Use Chain Insights graph_query on ${network} with this read-only GQL/Cypher query:`,
        '',
        '```gql',
        query,
        '```',
        '',
        'Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Return full address properties; never shorten addresses with ellipses.',
      ].join('\n'),
      'Graph query',
    ),
  )

  server.registerPrompt(
    'graph-query-batch',
    {
      title: 'Graph Query Batch',
      description: 'Run related read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch.',
      argsSchema: {
        queries: z.string().describe('JSON array of query objects with optional id and required query fields'),
        network: z.string().describe(NETWORK_DESCRIPTION),
        per_query_timeout_seconds: z.string().optional().describe('Optional integer timeout per query, 1-600 seconds'),
      },
    },
    async ({ queries, network, per_query_timeout_seconds }) => promptResult(
      [
        `Use Chain Insights graph_query_batch on ${network} with these read-only GQL/Cypher queries:`,
        '',
        '```json',
        queries,
        '```',
        per_query_timeout_seconds ? `per_query_timeout_seconds: ${per_query_timeout_seconds}` : '',
        '',
        'Use USE live_topology for recent topology, USE archive_topology for historical topology, and USE facts for labels, features, risk scores, assets, and enrichment. Return full address properties; never shorten addresses with ellipses.',
      ].filter(Boolean).join('\n'),
      'Graph query batch',
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
      'Use Chain Insights balance. Show the wallet address, network, token, and balance exactly as returned.',
      'Wallet balance',
    ),
  )

  server.registerPrompt(
    'help',
    {
      title: 'Chain Insights Help',
      description: 'Show available Chain Insights tools and workspace workflow.',
      argsSchema: {},
    },
    async () => promptResult(
      'Use Chain Insights help. Summarize the available tools and workspace workflow without inventing capabilities.',
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
  toolName = 'remote-graph',
  includeAttachments = true,
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

function shouldIncludeAttachments(args: Record<string, unknown>, workspaceArtifactsEnabled: boolean): boolean {
  return workspaceArtifactsEnabled && args['include_attachments'] !== false
}

async function writeLocalGraphMeta(
  graphData: unknown,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  slug: string,
  includeAttachments: boolean,
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

function graphMetaResult(graph: ChainInsightsGraphMeta | undefined): Record<string, unknown> | undefined {
  return graph
    ? {
        chainInsights: {
          graph,
        },
      }
    : undefined
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
    remoteUnavailableMessage = `Graph MCP setup unavailable at ${graphMcpEndpoint}: ${(err as Error).message}`
    process.stderr.write(
      `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`,
    )
  }

  if (mcpFetch) {
    try {
      await remoteClient.connect(
        new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch }),
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
          new SSEClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch }),
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
        remoteUnavailableMessage = `Graph MCP unreachable at ${graphMcpEndpoint}: ${(err2 as Error).message}`
        process.stderr.write(
          `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`,
        )
      }
    }
  }
  if (remoteConnected) installRemoteCypherLogging(remoteClient as unknown as RemoteToolCaller, logger)

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
    { instructions: workspaceArtifactsEnabled ? SERVER_INSTRUCTIONS : STATELESS_SERVER_INSTRUCTIONS },
  )
  installToolLogging(server, logger)

  const remotePrompts: Prompt[] = []
  if (remoteConnected) {
    try {
      const promptResult = await remoteClient.listPrompts()
      for (const prompt of promptResult.prompts as Prompt[]) {
        if (PUBLIC_GRAPHRAG_PROMPT_NAMES.has(prompt.name)) {
          remotePrompts.push(prompt)
        }
      }
    } catch (err) {
      await logger.error('remote.prompts_failed', {
        endpoint: graphMcpEndpoint,
        error: errorForLog(err),
      })
      process.stderr.write(
        `Chain Insights MCP prompt passthrough unavailable at ${graphMcpEndpoint}: ${(err as Error).message}\n`,
      )
    }
  }

  const remotePromptNames = new Set(remotePrompts.map((prompt) => prompt.name))
  for (const prompt of remotePrompts) {
    registerRemotePrompt(server, remoteClient, prompt)
  }
  registerLocalPrompts(server, remotePromptNames)

  const caseToolError = (label: string, err: unknown) => ({
    content: [{ type: 'text' as const, text: `${label} failed: ${(err as Error).message}` }],
    isError: true,
  })

  const parseTags = (tags: string | string[] | undefined): string[] => {
    if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean)
    if (typeof tags === 'string') return tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    return []
  }

  if (workspaceArtifactsEnabled) {
  server.registerTool(
    'balance',
    {
      title: 'Balance',
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
    'Fund Flow Graph',
    GRAPH_RESOURCE_URI,
    {
      description: 'Interactive D3 force-directed graph for fund flow and pattern visualization. It loads local graph report URLs returned in _meta.chainInsights.graph.url.',
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
    }),
  )



  if (!remoteToolNames.has('aml_address_risk')) {
    registerAppTool(
      server,
      'aml_address_risk',
      {
        title: 'Address Risk',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_address_risk,
        inputSchema: {
          address: z.string().min(1).describe('Full blockchain/member address to screen'),
          network: z.string().min(1).describe(NETWORK_DESCRIPTION),
          compare_address: z.string().optional().describe('Optional second full address for comparison'),
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
              content: [{
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              }],
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
            shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled),
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
            content: [{ type: 'text' as const, text: `Address risk failed: ${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }

  const timeRangeSchema = z.object({
    from_ms: z.number().min(0),
    to_ms: z.number().min(0).optional(),
  }).optional().describe('Optional activity window applied to traced FLOWS_TO edges (first_seen/last_seen). from_ms is required when time_range is set and takes precedence over incident_timestamp_ms; the effective filter is echoed as time_filter in the result.')

  if (!remoteToolNames.has('aml_trace_victim_funds')) {
    registerAppTool(
      server,
      'aml_trace_victim_funds',
      {
        title: 'Trace Victim Funds',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_victim_funds,
        inputSchema: {
          victim_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe('Comma-separated victim/source blockchain addresses, or an array. Min 1, max 5.'),
          network: z.string().min(1).describe(NETWORK_DESCRIPTION),
          known_suspect_addresses: z.union([z.string(), z.array(z.string())]).optional().describe('Known suspect addresses for context only. This tool does not reverse-trace them. Max 5.'),
          include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
          incident_timestamp_ms: z.number().min(0).optional().describe('Optional incident timestamp in milliseconds. When set (or when time_range is set), traced FLOWS_TO edges are filtered to the activity window.'),
          time_range: timeRangeSchema,
          max_hops: z.number().int().min(1).max(5).optional(),
          per_address_limit: z.number().int().min(1).max(10).optional(),
          min_amount_sum: z.number().min(0).optional().describe('Minimum USD amount (amount_usd_sum) required on traced FLOWS_TO edges.'),
        },
        _meta: {
          ui: {
            resourceUri: GRAPH_RESOURCE_URI,
          },
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ victim_addresses, known_suspect_addresses, network, incident_timestamp_ms, time_range, max_hops, per_address_limit, min_amount_sum, include_attachments }) => {
        try {
          if (!remoteConnected) {
            return {
              content: [{
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              }],
              isError: true,
            }
          }
          const { traceVictimFunds } = await import('../investigation/public-tools.js')
          const result = await traceVictimFunds(remoteClient, config, {
            victimAddresses: victim_addresses,
            knownSuspectAddresses: known_suspect_addresses,
            network,
            incidentTimestampMs: incident_timestamp_ms,
            timeRange: time_range,
            maxHops: max_hops,
            perAddressLimit: per_address_limit,
            minAmountSum: min_amount_sum,
            writeArtifacts: workspaceArtifactsEnabled,
          })
          const graph = await writeLocalGraphMeta(
            result.graphData,
            config,
            `trace-victim-funds-${network}`,
            shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled),
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
            content: [{ type: 'text' as const, text: `Trace victim funds failed: ${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }

  if (!remoteToolNames.has('aml_trace_suspect_funds')) {
    registerAppTool(
      server,
      'aml_trace_suspect_funds',
      {
        title: 'Trace Suspect Funds',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_suspect_funds,
        inputSchema: {
          network: z.string().min(1).describe(NETWORK_DESCRIPTION),
          suspect_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe('Comma-separated suspect-controlled blockchain addresses, or an array. Min 1, max 5.'),
          incident_timestamp_ms: z.number().min(0).optional().describe('Optional incident timestamp in milliseconds. When set (or when time_range is set), traced FLOWS_TO edges are filtered to the activity window.'),
          time_range: timeRangeSchema,
          max_hops: z.number().int().min(1).max(5).optional().describe('Maximum forward trace hops. Default 3.'),
          per_address_limit: z.number().int().min(1).max(10).optional(),
          min_amount_sum: z.number().min(0).optional().describe('Minimum USD amount (amount_usd_sum) required on traced FLOWS_TO edges.'),
          include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
        },
        _meta: {
          ui: {
            resourceUri: GRAPH_RESOURCE_URI,
          },
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ suspect_addresses, incident_timestamp_ms, time_range, network, max_hops, per_address_limit, min_amount_sum, include_attachments }) => {
        try {
          if (!remoteConnected) {
            return {
              content: [{
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              }],
              isError: true,
            }
          }
          const { traceSuspectFunds } = await import('../investigation/public-tools.js')
          const result = await traceSuspectFunds(remoteClient, config, {
            suspectAddresses: suspect_addresses,
            network,
            maxHops: max_hops,
            perAddressLimit: per_address_limit,
            minAmountSum: min_amount_sum,
            incidentTimestampMs: incident_timestamp_ms,
            timeRange: time_range,
            writeArtifacts: workspaceArtifactsEnabled,
          })
          const graph = await writeLocalGraphMeta(
            result.graphData,
            config,
            `trace-suspect-funds-${network}`,
            shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled),
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
            content: [{ type: 'text' as const, text: `Trace suspect funds failed: ${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }

  if (!remoteToolNames.has('aml_trace_deposit_sources')) {
    registerAppTool(
      server,
      'aml_trace_deposit_sources',
      {
        title: 'Trace Deposit Sources',
        description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.aml_trace_deposit_sources,
        inputSchema: {
          network: z.string().min(1).describe(NETWORK_DESCRIPTION),
          deposit_addresses: z.union([z.string().min(1), z.array(z.string().min(1))]).describe('Comma-separated suspected deposit/cashout blockchain addresses, or an array. Min 1, max 5.'),
          max_hops: z.number().int().min(1).max(5).optional().describe('Maximum reverse traceback hops. Default 2.'),
          min_amount_sum: z.number().min(0).optional().describe('Drop reverse FLOWS_TO edges below this USD amount (amount_usd_sum; dust control).'),
          time_range: timeRangeSchema,
          include_attachments: z.boolean().optional().describe('Include graph app report metadata'),
        },
        _meta: {
          ui: {
            resourceUri: GRAPH_RESOURCE_URI,
          },
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ deposit_addresses, network, max_hops, min_amount_sum, time_range, include_attachments }) => {
        try {
          if (!remoteConnected) {
            return {
              content: [{
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              }],
              isError: true,
            }
          }
          const { traceDepositSources } = await import('../investigation/public-tools.js')
          const result = await traceDepositSources(remoteClient, config, {
            depositAddresses: deposit_addresses,
            network,
            maxHops: max_hops,
            minAmountSum: min_amount_sum,
            timeRange: time_range,
            writeArtifacts: workspaceArtifactsEnabled,
          })
          const graph = await writeLocalGraphMeta(
            result.graphData,
            config,
            `trace-deposit-sources-${network}`,
            shouldIncludeAttachments({ include_attachments }, workspaceArtifactsEnabled),
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
            content: [{ type: 'text' as const, text: `Trace deposit sources failed: ${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }

  server.registerTool(
    'help',
    {
      title: 'Help',
      description: 'Show Chain Insights overview, available tools, and investigation workflow.',
      inputSchema: z.object({}).passthrough(),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: workspaceArtifactsEnabled
            ? [
                'Chain Insights workspace for AI agents. Workspaces are plain local files for reports, artifacts, graphs, and published outputs.',
                '',
                CHAIN_INSIGHTS_WORKFLOW,
                '',
                'Investigation tools:',
                '- network_capabilities: inspect supported networks, graph layers, and available tools.',
                '- aml_address_risk: screen a blockchain address for AML risk, behavior, neighborhood, member addresses, exchange exposure, and optional compare_address connection checks.',
                '- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.',
                '- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.',
                '- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
                'Wallet tools:',
                '- balance: show the local payment wallet address and Base USDC balance.',
                '- help: show this overview.',
                '',
                GRAPH_REPORT_HINTS,
                '',
                GRAPH_SCHEMA_HINTS,
              ].join('\n')
            : [
                'Chain Insights stateless AML proxy for host applications.',
                '',
                'Local workspace persistence, wallet, and graph report attachment tools are disabled in this mode.',
                '',
                'Available graph-backed tools:',
                '- network_capabilities: inspect supported networks, graph layers, and available tools.',
                '- aml_address_risk: screen a blockchain address for AML risk, behavior, neighborhood, member addresses, exchange exposure, and optional compare_address connection checks.',
                '- aml_trace_victim_funds: trace up to five victim/source addresses forward to exchange deposit candidates.',
                '- aml_trace_deposit_sources: trace backward from suspected deposit/cashout addresses to upstream funders and shared-source convergence.',
                '- aml_trace_suspect_funds: trace up to five suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE live_topology, USE archive_topology, or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
                '',
                GRAPH_SCHEMA_HINTS,
              ].join('\n'),
        },
      ],
      isError: false,
    }),
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
            content: [{
              type: 'text' as const,
              text: `${remoteUnavailableMessage ?? `Graph MCP is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
            }],
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
          shouldIncludeAttachments(normalizedArgs, workspaceArtifactsEnabled),
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
            content: [{
              type: 'text' as const,
              text: `Payment required for ${tool.name}. This tool costs USDC on Base via x402 micropayments. ` +
                'Next steps: run `chain-insights wallet ready` to check funding and finish one-time payment setup, ' +
                'run `chain-insights wallet topup` if it says the wallet needs USDC, ' +
                'or `chain-insights access-key set <key>` if you have been given test access.',
            }],
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
  await logger.info('proxy.ready', {
    tools: [
      ...LOCAL_TOOL_NAMES,
      ...(tools ?? []).map((tool) => tool.name).filter((name) => !HIDDEN_REMOTE_TOOL_NAMES.has(name) && !LOCAL_TOOL_NAMES.has(name)),
    ].length,
  })

  // Signal handling — clean shutdown
  const shutdown = async () => {
    await logger.info('proxy.shutdown')
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}
}


// Entry point — only execute when run as the main module (not when imported by tests)
// Using process.argv check to detect direct execution vs import
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))) {
  createProxy().catch((err) => {
    process.stderr.write(`Chain Insights MCP proxy startup failed: ${(err as Error).message}\n`)
    process.exit(1)
  })
}
