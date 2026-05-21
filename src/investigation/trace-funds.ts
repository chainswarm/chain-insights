import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { workspaceOutputPaths, type WorkspaceOutputPaths } from '../workspace/output-root.js'

type RemoteToolResult = {
  content?: ContentBlock[]
  isError?: boolean
}

type TopologyBackend = 'memgraph' | 'puppygraph'

export interface TraceFundsOptions {
  seedAddress: string
  network: string
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
}

export interface TraceFlow {
  hop: number
  src: string
  dst: string
  amount_sum: number
  amount_usd_sum?: number
  tx_count?: number
  first_tx_id?: string
  last_tx_id?: string
  src_labels?: string[]
  dst_labels?: string[]
  src_node?: GraphNodeMetadata
  dst_node?: GraphNodeMetadata
  dst_degree_in?: number
  dst_degree_out?: number
  terminal_exchange: boolean
}

export interface TraceFundsResult {
  summaryText: string
  compactEvidence: Record<string, unknown>
  graphData: Record<string, unknown>
  files: {
    schema: string
    compactEvidence: string
    graph: string
    graphHtml: string
    table: string
    tableHtml: string
    report: string
  }
  continuation: {
    nextHopAddresses: string[]
    depositAddresses: string[]
    exchangeAddresses: string[]
    hint: string
  }
  addressMap: Record<string, string>
}

interface TraceDeposit {
  address: string
  exchangeAddress: string
  exchangeLabels?: string[]
  exchangeNode?: GraphNodeMetadata
  amount_sum?: number
  amount_usd_sum?: number
  hops: number
  path: string[]
  pathNodes?: GraphNodeMetadata[]
}

interface SourceMatch {
  deposit_address: string
  source_exchange: string
  source_labels?: string[]
  sourceNode?: GraphNodeMetadata
  hops: number
  path: string[]
  pathNodes?: GraphNodeMetadata[]
}

interface ReverseLead {
  address: string
  labels?: string[]
  node?: GraphNodeMetadata
  deposit_address: string
  amount_usd?: number
  degree_in?: number
  degree_out?: number
  total_volume_usd?: number
  reason: string
}

interface GraphNodeMetadata {
  address: string
  labels?: string[]
  system_labels?: string[]
  address_type?: string
  address_subtypes?: string[]
}

class AliasTracker {
  private readonly byAddress = new Map<string, string>()
  private readonly byAlias = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  assign(address: string, prefix: string): string {
    const existing = this.byAddress.get(address)
    if (existing) return existing
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    const alias = `${prefix}${next}`
    this.byAddress.set(address, alias)
    this.byAlias.set(alias, address)
    return alias
  }

  alias(address: string): string | undefined {
    return this.byAddress.get(address)
  }

  addressMap(): Record<string, string> {
    return Object.fromEntries([...this.byAlias.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })))
  }

  compactAddressMap(maxIntermediaries = 20, maxSourceExchanges = 20, maxLeads = 20): Record<string, string> {
    const counts = new Map<string, number>()
    const entries = [...this.byAlias.entries()].filter(([alias]) => {
      const prefix = alias.slice(0, 1)
      if (['V', 'D', 'E'].includes(prefix)) return true
      const next = (counts.get(prefix) ?? 0) + 1
      counts.set(prefix, next)
      if (prefix === 'I') return next <= maxIntermediaries
      if (prefix === 'X') return next <= maxSourceExchanges
      if (prefix === 'L') return next <= maxLeads
      return true
    })
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })))
  }
}

interface ParsedTopologyBatch {
  facts?: {
    queries?: Array<{
      id?: string
      ok?: boolean
      results?: Array<Record<string, unknown>>
      error?: string
    }>
  }
}

interface ParsedNetworkCapabilities {
  facts?: {
    capabilities?: {
      networks?: Array<{
        network?: string
        layers?: Record<string, { backend?: string; enabled?: boolean }>
      }>
    }
  }
}

const SCHEMA_QUERY_SET = [
  {
    id: 'node_labels',
    query: 'MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY count DESC LIMIT 100',
  },
  {
    id: 'relationship_types',
    query: 'MATCH ()-[r]->() RETURN type(r) AS relationship_type, count(*) AS count ORDER BY count DESC LIMIT 100',
  },
  {
    id: 'address_property_keys',
    query: 'MATCH (n:Address) WITH keys(n) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200',
  },
  {
    id: 'flows_to_property_keys',
    query: 'MATCH ()-[r:FLOWS_TO]->() WITH keys(r) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200',
  },
]

const PUPPYGRAPH_SCHEMA_QUERY_SET = [
  {
    id: 'node_labels',
    query: 'MATCH (n:Address) RETURN "Address" AS label, count(n) AS count LIMIT 100',
  },
  {
    id: 'relationship_types',
    query: 'MATCH ()-[r:FLOWS_TO]->() RETURN "FLOWS_TO" AS relationship_type, count(r) AS count UNION ALL MATCH ()-[r:FLOWS_TO_ROLLUP]->() RETURN "FLOWS_TO_ROLLUP" AS relationship_type, count(r) AS count',
  },
  {
    id: 'address_property_keys',
    query: 'MATCH (n:Address) WITH keys(n) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200',
  },
  {
    id: 'flows_to_property_keys',
    query: 'MATCH ()-[r:FLOWS_TO]->() WITH keys(r) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200',
  },
]

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function escapeCypherString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function sanitizeSegment(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
  return sanitized || 'trace'
}

async function ensureDirs(paths: WorkspaceOutputPaths): Promise<void> {
  await mkdir(paths.schemaDir, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportsRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportGraphsRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.reportTablesRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.logsRoot, { recursive: true, mode: 0o700 })
}

function textFromToolResult(result: RemoteToolResult): string {
  return (result.content ?? [])
    .filter((item): item is Extract<ContentBlock, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

function parseTopologyBatchResult(result: RemoteToolResult): ParsedTopologyBatch {
  const text = textFromToolResult(result).trim()
  if (!text) throw new Error('topology_query_batch returned no text content')
  const parsed = JSON.parse(text) as ParsedTopologyBatch
  if (!parsed.facts?.queries) throw new Error('topology_query_batch response did not include facts.queries')
  return parsed
}

function parseNetworkCapabilitiesResult(result: RemoteToolResult): ParsedNetworkCapabilities {
  const text = textFromToolResult(result).trim()
  if (!text) throw new Error('network_capabilities returned no text content')
  return JSON.parse(text) as ParsedNetworkCapabilities
}

async function topologyBackendFor(remoteClient: Client, network: string): Promise<TopologyBackend> {
  const result = await remoteClient.callTool({
    name: 'network_capabilities',
    arguments: {},
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'network_capabilities failed')
  const capabilities = parseNetworkCapabilitiesResult(result)
  const networkCapabilities = capabilities.facts?.capabilities?.networks?.find((entry) => entry.network === network)
  const backend = networkCapabilities?.layers?.['topology']?.backend
  if (backend === 'puppygraph') return 'puppygraph'
  return 'memgraph'
}

async function callTopologyBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedTopologyBatch> {
  const result = await remoteClient.callTool({
    name: 'topology_query_batch',
    arguments: {
      network,
      queries,
      per_query_timeout_seconds: 10,
    },
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'topology_query_batch failed')
  return parseTopologyBatchResult(result)
}

function resultsFor(batch: ParsedTopologyBatch, id: string): Array<Record<string, unknown>> {
  const query = batch.facts?.queries?.find((entry) => entry.id === id)
  if (!query) return []
  if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`)
  return query.results ?? []
}

function schemaFromTopologyBatch(network: string, batch: ParsedTopologyBatch): Record<string, unknown> {
  return {
    schema: 'chain-insights.runtime_graph_schema.v1',
    network,
    source: 'topology_query_batch',
    node_labels: resultsFor(batch, 'node_labels'),
    relationship_types: resultsFor(batch, 'relationship_types'),
    address_property_keys: resultsFor(batch, 'address_property_keys').map((row) => row['property_key']),
    flows_to_property_keys: resultsFor(batch, 'flows_to_property_keys').map((row) => row['property_key']),
    recommended_flow_projection: [
      'src.address AS src',
      'dst.address AS dst',
      'r.amount_sum AS amount_sum',
      'r.amount_usd_sum AS amount_usd_sum',
      'r.tx_count AS tx_count',
      'r.first_tx_id AS first_tx_id',
      'r.last_tx_id AS last_tx_id',
      'dst.labels AS dst_labels',
      'dst.degree_in AS dst_degree_in',
      'dst.degree_out AS dst_degree_out',
    ],
  }
}

async function loadOrCaptureTopologySchema(
  remoteClient: Client,
  paths: WorkspaceOutputPaths,
  network: string,
  topologyBackend: TopologyBackend,
): Promise<{ schema: Record<string, unknown>; filePath: string }> {
  const filePath = path.join(paths.schemaDir, `${sanitizeSegment(network)}.${topologyBackend}.graph-schema.json`)
  try {
    return { schema: JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>, filePath }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const batch = await callTopologyBatch(
    remoteClient,
    network,
    topologyBackend === 'puppygraph' ? PUPPYGRAPH_SCHEMA_QUERY_SET : SCHEMA_QUERY_SET,
  )
  const schema = schemaFromTopologyBatch(network, batch)
  await writeFile(filePath, JSON.stringify(schema, null, 2) + '\n', { mode: 0o600 })
  return { schema, filePath }
}

function forwardExchangeQuery(address: string, limit: number, minAmountSum: number, maxHops: number): { id: string; query: string } {
  void maxHops
  const amountFilter = minAmountSum > 0 ? ` AND e.amount_sum >= ${minAmountSum}` : ''
  return {
    id: 'forward_exchange_paths',
    query: [
      `MATCH p = (s:Address {address: "${escapeCypherString(address)}"})-[:FLOWS_TO *BFS (e, v | e.amount_sum IS NOT NULL${amountFilter})]->(t:Exchange)`,
      'WHERE s <> t AND NOT any(n IN nodes(p)[1..-1] WHERE "Exchange" IN labels(n))',
      'WITH p, t, [n IN nodes(p) | n.address] AS addresses, [n IN nodes(p) | labels(n)] AS node_labels, [n IN nodes(p) | {address: n.address, labels: n.labels, system_labels: labels(n), address_type: n.address_type, address_subtypes: n.address_subtypes}] AS path_nodes, [r IN relationships(p) | {amount_sum: r.amount_sum, amount_usd_sum: r.amount_usd_sum, tx_count: r.tx_count, first_tx_id: r.first_tx_id, last_tx_id: r.last_tx_id}] AS edge_props',
      'RETURN addresses, node_labels, path_nodes, edge_props, t.address AS exchange_address, t.labels AS exchange_display_labels, labels(t) AS exchange_labels, t.address_type AS exchange_address_type, t.address_subtypes AS exchange_address_subtypes, nodes(p)[size(nodes(p))-2].address AS deposit_address, size(nodes(p)) - 1 AS hops',
      'ORDER BY hops ASC',
      `LIMIT ${limit}`,
    ].join(' '),
  }
}

function puppyEdgeFilter(edgeAlias: string, minAmountSum = 0): string {
  const amountFilter = minAmountSum > 0 ? ` AND ${edgeAlias}.amount_sum >= ${minAmountSum}` : ''
  return `${edgeAlias}.period_granularity = "current" AND ${edgeAlias}.amount_sum IS NOT NULL${amountFilter}`
}

function puppyDistinctNodeFilters(nodeAliases: string[]): string[] {
  const filters: string[] = []
  for (let left = 0; left < nodeAliases.length; left += 1) {
    for (let right = left + 1; right < nodeAliases.length; right += 1) {
      filters.push(`${nodeAliases[left]}.address <> ${nodeAliases[right]}.address`)
    }
  }
  return filters
}

function puppyNodeMetadataExpression(nodeAlias: string, systemLabels: string): string {
  return `{address: ${nodeAlias}.address, labels: ${nodeAlias}.labels, system_labels: ${systemLabels}, address_type: ${nodeAlias}.address_type, address_subtypes: ${nodeAlias}.address_subtypes}`
}

function puppyEdgeMetadataExpression(edgeAlias: string): string {
  return `{amount_sum: ${edgeAlias}.amount_sum, amount_usd_sum: ${edgeAlias}.amount_usd_sum, tx_count: ${edgeAlias}.tx_count, first_tx_id: ${edgeAlias}.first_tx_id, last_tx_id: ${edgeAlias}.last_tx_id}`
}

function puppyForwardExchangeSubquery(address: string, minAmountSum: number, hops: number): string {
  const nodeAliases = Array.from({ length: hops + 1 }, (_, index) => `n${index}`)
  const edgeAliases = Array.from({ length: hops }, (_, index) => `r${index}`)
  const pattern = [
    `(n0:Address {address: "${escapeCypherString(address)}"})`,
    ...edgeAliases.flatMap((edgeAlias, index) => [`-[${edgeAlias}:FLOWS_TO]->`, `(${nodeAliases[index + 1]}:Address)`]),
  ].join('')
  const terminal = nodeAliases[hops]!
  const deposit = nodeAliases[hops - 1]!
  const filters = [
    ...edgeAliases.map((edgeAlias) => puppyEdgeFilter(edgeAlias, minAmountSum)),
    `${terminal}.is_exchange = 1`,
    ...nodeAliases.slice(1, -1).map((nodeAlias) => `coalesce(${nodeAlias}.is_exchange, 0) <> 1`),
    ...puppyDistinctNodeFilters(nodeAliases),
  ]
  const nodeLabels = nodeAliases.map((_, index) => (index === hops ? '["Address", "Exchange"]' : '["Address"]')).join(', ')
  const pathNodes = nodeAliases
    .map((nodeAlias, index) => puppyNodeMetadataExpression(nodeAlias, index === hops ? '["Address", "Exchange"]' : '["Address"]'))
    .join(', ')
  return [
    `MATCH ${pattern}`,
    `WHERE ${filters.join(' AND ')}`,
    `RETURN [${nodeAliases.map((nodeAlias) => `${nodeAlias}.address`).join(', ')}] AS addresses, [${nodeLabels}] AS node_labels, [${pathNodes}] AS path_nodes, [${edgeAliases.map(puppyEdgeMetadataExpression).join(', ')}] AS edge_props, ${terminal}.address AS exchange_address, ${terminal}.labels AS exchange_display_labels, ["Address", "Exchange"] AS exchange_labels, ${terminal}.address_type AS exchange_address_type, ${terminal}.address_subtypes AS exchange_address_subtypes, ${deposit}.address AS deposit_address, ${hops} AS hops`,
  ].join(' ')
}

function puppyForwardExchangeQuery(address: string, limit: number, minAmountSum: number, maxHops: number): { id: string; query: string } {
  void minAmountSum
  return {
    id: 'forward_exchange_paths',
    query: [
      'MATCH (s:Address), (t:Address)',
      `WHERE s.address = "${escapeCypherString(address)}" AND t.is_exchange = 1`,
      `MATCH p = shortestPath((s)-[:FLOWS_TO*1..${maxHops}]->(t))`,
      'WHERE all(n IN nodes(p) WHERE n.address = s.address OR n.address = t.address OR coalesce(n.is_exchange, 0) <> 1)',
      'RETURN [n IN nodes(p) | n.address] AS addresses, [] AS node_labels, [n IN nodes(p) | {address: n.address, labels: n.labels, system_labels: ["Address"], address_type: n.address_type, address_subtypes: n.address_subtypes}] AS path_nodes, [r IN relationships(p) | {amount_sum: r.amount_sum, amount_usd_sum: r.amount_usd_sum, tx_count: r.tx_count, first_tx_id: r.first_tx_id, last_tx_id: r.last_tx_id}] AS edge_props, t.address AS exchange_address, t.labels AS exchange_display_labels, ["Address", "Exchange"] AS exchange_labels, t.address_type AS exchange_address_type, t.address_subtypes AS exchange_address_subtypes, "" AS deposit_address, length(p) AS hops',
      `LIMIT ${limit}`,
    ].join(' '),
  }
}

function backwardSourceQuery(id: string, depositAddress: string): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (dep:Address {address: "${escapeCypherString(depositAddress)}"})`,
      'MATCH path=(dep)<-[:FLOWS_TO *BFS (e, v | true)]-(source:Exchange)',
      'WHERE source <> dep AND NOT any(n IN nodes(path)[1..-1] WHERE "Exchange" IN labels(n))',
      'RETURN dep.address AS deposit_address, source.address AS source_exchange, source.labels AS source_display_labels, labels(source) AS source_labels, source.address_type AS source_address_type, source.address_subtypes AS source_address_subtypes, size(nodes(path)) - 1 AS hops, [n IN nodes(path) | n.address] AS addresses, [n IN nodes(path) | labels(n)] AS node_labels, [n IN nodes(path) | {address: n.address, labels: n.labels, system_labels: labels(n), address_type: n.address_type, address_subtypes: n.address_subtypes}] AS path_nodes',
      'LIMIT 20',
    ].join(' '),
  }
}

function puppyBackwardSourceSubquery(depositAddress: string, hops: number): string {
  const intermediateAliases = Array.from({ length: Math.max(0, hops - 1) }, (_, index) => `m${index + 1}`)
  const edgeAliases = Array.from({ length: hops }, (_, index) => `r${index}`)
  const sourceToDepositNodes = ['source', ...intermediateAliases, 'dep']
  const pattern = [
    '(source:Address)',
    ...edgeAliases.flatMap((edgeAlias, index) => {
      const nextNode = sourceToDepositNodes[index + 1]!
      const nodePattern = nextNode === 'dep'
        ? `(dep:Address {address: "${escapeCypherString(depositAddress)}"})`
        : `(${nextNode}:Address)`
      return [`-[${edgeAlias}:FLOWS_TO]->`, nodePattern]
    }),
  ].join('')
  const depToSourceNodes = [...sourceToDepositNodes].reverse()
  const filters = [
    'source.is_exchange = 1',
    ...intermediateAliases.map((nodeAlias) => `coalesce(${nodeAlias}.is_exchange, 0) <> 1`),
    ...edgeAliases.map((edgeAlias) => puppyEdgeFilter(edgeAlias)),
    ...puppyDistinctNodeFilters(sourceToDepositNodes),
  ]
  const nodeLabels = depToSourceNodes.map((nodeAlias) => (nodeAlias === 'source' ? '["Address", "Exchange"]' : '["Address"]')).join(', ')
  const pathNodes = depToSourceNodes
    .map((nodeAlias) => puppyNodeMetadataExpression(nodeAlias, nodeAlias === 'source' ? '["Address", "Exchange"]' : '["Address"]'))
    .join(', ')
  return [
    `MATCH ${pattern}`,
    `WHERE ${filters.join(' AND ')}`,
    `RETURN dep.address AS deposit_address, source.address AS source_exchange, source.labels AS source_display_labels, ["Address", "Exchange"] AS source_labels, source.address_type AS source_address_type, source.address_subtypes AS source_address_subtypes, ${hops} AS hops, [${depToSourceNodes.map((nodeAlias) => `${nodeAlias}.address`).join(', ')}] AS addresses, [${nodeLabels}] AS node_labels, [${pathNodes}] AS path_nodes`,
  ].join(' ')
}

function puppyBackwardSourceQuery(id: string, depositAddress: string, maxHops: number): { id: string; query: string } {
  return {
    id,
    query: [
      'MATCH (dep:Address), (source:Address)',
      `WHERE dep.address = "${escapeCypherString(depositAddress)}" AND source.is_exchange = 1`,
      `MATCH path = shortestPath((dep)<-[:FLOWS_TO*1..${maxHops}]-(source))`,
      'WHERE all(n IN nodes(path) WHERE n.address = dep.address OR n.address = source.address OR coalesce(n.is_exchange, 0) <> 1)',
      'RETURN dep.address AS deposit_address, source.address AS source_exchange, source.labels AS source_display_labels, ["Address", "Exchange"] AS source_labels, source.address_type AS source_address_type, source.address_subtypes AS source_address_subtypes, length(path) AS hops, [n IN nodes(path) | n.address] AS addresses, [] AS node_labels, [n IN nodes(path) | {address: n.address, labels: n.labels, system_labels: ["Address"], address_type: n.address_type, address_subtypes: n.address_subtypes}] AS path_nodes',
      'LIMIT 20',
    ].join(' '),
  }
}

function reverseLeadsQuery(depositAddresses: string[], topologyBackend: TopologyBackend): { id: string; query: string } {
  const addrList = depositAddresses.map((address) => `"${escapeCypherString(address)}"`).join(', ')
  if (topologyBackend === 'puppygraph') {
    return {
      id: 'reverse_1hop',
      query: [
        `UNWIND [${addrList}] AS dep_addr`,
        'MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address {address: dep_addr})',
        'WHERE r.period_granularity = "current" AND coalesce(sender.is_exchange, 0) <> 1 AND sender.address <> dep_addr',
        'WITH DISTINCT sender, dep_addr, r',
        'OPTIONAL MATCH (inbound:Address)-[:FLOWS_TO]->(sender)',
        'WITH sender, dep_addr, r, count(inbound) AS degree_in',
        'OPTIONAL MATCH (sender)-[:FLOWS_TO]->(outbound:Address)',
        'RETURN sender.address AS address, sender.labels AS display_labels, ["Address"] AS system_labels, sender.address_type AS address_type, sender.address_subtypes AS address_subtypes, degree_in AS degree_in, count(outbound) AS degree_out, 0 AS total_volume_usd, dep_addr AS deposit_address, r.amount_usd_sum AS amount_usd',
        'ORDER BY r.amount_usd_sum DESC',
        `LIMIT ${Math.max(50, depositAddresses.length * 50)}`,
      ].join(' '),
    }
  }
  return {
    id: 'reverse_1hop',
    query: [
      `UNWIND [${addrList}] AS dep_addr`,
      'MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address {address: dep_addr})',
      'WHERE NOT ("Exchange" IN labels(sender)) AND sender.address <> dep_addr',
      'RETURN DISTINCT sender.address AS address, sender.labels AS display_labels, labels(sender) AS system_labels, sender.address_type AS address_type, sender.address_subtypes AS address_subtypes, coalesce(sender.degree_in, 0) AS degree_in, coalesce(sender.degree_out, 0) AS degree_out, coalesce(sender.total_volume_usd, 0) AS total_volume_usd, dep_addr AS deposit_address, r.amount_usd_sum AS amount_usd',
      'ORDER BY r.amount_usd_sum DESC',
      `LIMIT ${Math.max(50, depositAddresses.length * 50)}`,
    ].join(' '),
  }
}

function edgeKey(src: string, dst: string): string {
  return `${src}\u0000${dst}`
}

function directEdgePropsQuery(flows: TraceFlow[], topologyBackend: TopologyBackend): { id: string; query: string } | null {
  const pairs = [...new Map(flows.map((flow) => [edgeKey(flow.src, flow.dst), { src: flow.src, dst: flow.dst }])).values()]
  if (pairs.length === 0) return null
  const predicates = pairs.map((pair) =>
    `(a.address = "${escapeCypherString(pair.src)}" AND b.address = "${escapeCypherString(pair.dst)}")`
  )
  const currentFilter = topologyBackend === 'puppygraph' ? ' AND r.period_granularity = "current"' : ''
  return {
    id: 'direct_edge_props',
    query: [
      'MATCH (a:Address)-[r:FLOWS_TO]->(b:Address)',
      `WHERE (${predicates.join(' OR ')})${currentFilter}`,
      'RETURN a.address AS src, b.address AS dst, r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count, r.first_tx_id AS first_tx_id, r.last_tx_id AS last_tx_id',
      `LIMIT ${pairs.length}`,
    ].join(' '),
  }
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function rowTerminalAmount(row: Record<string, unknown>): number | undefined {
  const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
  const terminalEdge = edgeProps[edgeProps.length - 1]
  if (!terminalEdge) return undefined
  return numberValue(terminalEdge['amount_sum']) ?? numberValue(terminalEdge['amount_usd_sum'])
}

function rowsMatchingMinimumAmount(rows: Array<Record<string, unknown>>, minAmountSum: number): Array<Record<string, unknown>> {
  if (minAmountSum <= 0) return rows
  return rows.filter((row) => (rowTerminalAmount(row) ?? 0) >= minAmountSum)
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return [value]
  return undefined
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])]
}

function nodeMetadataFromValue(value: unknown, fallbackAddress?: string): GraphNodeMetadata | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fallbackAddress ? { address: fallbackAddress } : undefined
  }
  const record = value as Record<string, unknown>
  const address = typeof record['address'] === 'string' ? record['address'] : fallbackAddress
  if (!address) return undefined
  return {
    address,
    labels: stringArrayValue(record['labels']),
    system_labels: stringArrayValue(record['system_labels']),
    address_type: typeof record['address_type'] === 'string' ? record['address_type'] : undefined,
    address_subtypes: stringArrayValue(record['address_subtypes']),
  }
}

function isExchangeFlow(flow: TraceFlow): boolean {
  return flow.terminal_exchange || flow.dst_labels?.includes('Exchange') === true || flow.dst_node?.system_labels?.includes('Exchange') === true
}

function depositFromRow(row: Record<string, unknown>): TraceDeposit | null {
  const pathAddresses = stringArrayValue(row['addresses']) ?? []
  if (pathAddresses.length < 2) return null
  const exchangeAddress = typeof row['exchange_address'] === 'string' ? row['exchange_address'] : pathAddresses[pathAddresses.length - 1]
  const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
  const terminalEdge = edgeProps[edgeProps.length - 1] ?? {}
  const pathNodes = Array.isArray(row['path_nodes'])
    ? row['path_nodes'].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node): node is GraphNodeMetadata => Boolean(node))
    : undefined
  const exchangeNode = {
    address: exchangeAddress,
    labels: stringArrayValue(row['exchange_display_labels']),
    system_labels: stringArrayValue(row['exchange_system_labels']) ?? stringArrayValue(row['exchange_labels']),
    address_type: typeof row['exchange_address_type'] === 'string' ? row['exchange_address_type'] : undefined,
    address_subtypes: stringArrayValue(row['exchange_address_subtypes']),
  }
  return {
    address: pathAddresses[pathAddresses.length - 2]!,
    exchangeAddress,
    exchangeLabels: stringArrayValue(row['exchange_labels']),
    exchangeNode,
    amount_sum: numberValue(terminalEdge['amount_sum']),
    amount_usd_sum: numberValue(terminalEdge['amount_usd_sum']),
    hops: numberValue(row['hops']) ?? pathAddresses.length - 1,
    path: pathAddresses,
    pathNodes,
  }
}

function flowsFromForwardRows(rows: Array<Record<string, unknown>>): { flows: TraceFlow[]; deposits: TraceDeposit[] } {
  const flows: TraceFlow[] = []
  const deposits: TraceDeposit[] = []
  const seenEdges = new Set<string>()
  for (const row of rows) {
    const pathAddresses = stringArrayValue(row['addresses']) ?? []
    const nodeLabels = Array.isArray(row['node_labels']) ? row['node_labels'].map((labels) => stringArrayValue(labels) ?? []) : []
    const pathNodes = Array.isArray(row['path_nodes'])
      ? row['path_nodes'].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index]))
      : []
    const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
    const deposit = depositFromRow(row)
    if (deposit) deposits.push(deposit)
    for (let index = 0; index < pathAddresses.length - 1; index += 1) {
      const src = pathAddresses[index]!
      const dst = pathAddresses[index + 1]!
      const edge = edgeProps[index] ?? {}
      const amount = numberValue(edge['amount_sum']) ?? numberValue(edge['amount_usd_sum']) ?? 0
      const terminal = index === pathAddresses.length - 2
      const key = `${src}->${dst}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      flows.push({
        hop: index + 1,
        src,
        dst,
        amount_sum: amount,
        amount_usd_sum: numberValue(edge['amount_usd_sum']),
        tx_count: numberValue(edge['tx_count']),
        first_tx_id: typeof edge['first_tx_id'] === 'string' ? edge['first_tx_id'] : undefined,
        last_tx_id: typeof edge['last_tx_id'] === 'string' ? edge['last_tx_id'] : undefined,
        src_labels: nodeLabels[index],
        dst_labels: nodeLabels[index + 1],
        src_node: pathNodes[index],
        dst_node: pathNodes[index + 1],
        terminal_exchange: terminal,
      })
    }
  }
  return { flows, deposits }
}

async function hydrateDirectEdgeProps(remoteClient: Client, network: string, topologyBackend: TopologyBackend, flows: TraceFlow[], deposits: TraceDeposit[]): Promise<void> {
  const query = directEdgePropsQuery(flows, topologyBackend)
  if (!query) return

  const batch = await callTopologyBatch(remoteClient, network, [query])
  const edgeProps = new Map<string, Record<string, unknown>>()
  for (const row of resultsFor(batch, 'direct_edge_props')) {
    const src = typeof row['src'] === 'string' ? row['src'] : ''
    const dst = typeof row['dst'] === 'string' ? row['dst'] : ''
    if (!src || !dst) continue
    edgeProps.set(edgeKey(src, dst), row)
  }

  for (const flow of flows) {
    const props = edgeProps.get(edgeKey(flow.src, flow.dst))
    if (!props) continue
    flow.amount_sum = numberValue(props['amount_sum']) ?? flow.amount_sum
    flow.amount_usd_sum = numberValue(props['amount_usd_sum'])
    flow.tx_count = numberValue(props['tx_count'])
    flow.first_tx_id = typeof props['first_tx_id'] === 'string' ? props['first_tx_id'] : undefined
    flow.last_tx_id = typeof props['last_tx_id'] === 'string' ? props['last_tx_id'] : undefined
  }

  for (const deposit of deposits) {
    const props = edgeProps.get(edgeKey(deposit.address, deposit.exchangeAddress))
    if (!props) continue
    deposit.amount_sum = numberValue(props['amount_sum'])
    deposit.amount_usd_sum = numberValue(props['amount_usd_sum'])
  }
}

async function collectProbeTrace(
  remoteClient: Client,
  options: Required<Pick<TraceFundsOptions, 'seedAddress' | 'network' | 'maxHops' | 'perAddressLimit' | 'minAmountSum'>>,
  topologyBackend: TopologyBackend,
): Promise<{ flows: TraceFlow[]; deposits: TraceDeposit[]; sourceMatches: SourceMatch[]; reverseLeads: ReverseLead[] }> {
  const forwardBatch = await callTopologyBatch(remoteClient, options.network, [
    topologyBackend === 'puppygraph'
      ? puppyForwardExchangeQuery(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops)
      : forwardExchangeQuery(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops),
  ])
  const forwardRows = rowsMatchingMinimumAmount(resultsFor(forwardBatch, 'forward_exchange_paths'), options.minAmountSum)
  const { flows, deposits } = flowsFromForwardRows(forwardRows)
  await hydrateDirectEdgeProps(remoteClient, options.network, topologyBackend, flows, deposits)
  const uniqueDepositAddresses = [...new Set(deposits.map((deposit) => deposit.address))]

  const sourceMatches: SourceMatch[] = []
  if (uniqueDepositAddresses.length > 0) {
    const backwardBatch = await callTopologyBatch(
      remoteClient,
      options.network,
      uniqueDepositAddresses.slice(0, 20).map((address, index) => (
        topologyBackend === 'puppygraph'
          ? puppyBackwardSourceQuery(`backward_from_deposit_${index + 1}`, address, options.maxHops)
          : backwardSourceQuery(`backward_from_deposit_${index + 1}`, address)
      )),
    )
    for (const query of backwardBatch.facts?.queries ?? []) {
      for (const row of query.results ?? []) {
        const pathAddresses = stringArrayValue(row['addresses']) ?? []
        const pathNodes = Array.isArray(row['path_nodes'])
          ? row['path_nodes'].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node): node is GraphNodeMetadata => Boolean(node))
          : undefined
        const depositAddress = typeof row['deposit_address'] === 'string' ? row['deposit_address'] : pathAddresses[0]
        const sourceExchange = typeof row['source_exchange'] === 'string' ? row['source_exchange'] : pathAddresses[pathAddresses.length - 1]
        if (!depositAddress || !sourceExchange) continue
        const sourceNode = {
          address: sourceExchange,
          labels: stringArrayValue(row['source_display_labels']),
          system_labels: stringArrayValue(row['source_system_labels']) ?? stringArrayValue(row['source_labels']),
          address_type: typeof row['source_address_type'] === 'string' ? row['source_address_type'] : undefined,
          address_subtypes: stringArrayValue(row['source_address_subtypes']),
        }
        sourceMatches.push({
          deposit_address: depositAddress,
          source_exchange: sourceExchange,
          source_labels: stringArrayValue(row['source_labels']),
          sourceNode,
          hops: numberValue(row['hops']) ?? Math.max(pathAddresses.length - 1, 0),
          path: pathAddresses,
          pathNodes,
        })
      }
    }
  }

  const reverseLeads: ReverseLead[] = []
  if (uniqueDepositAddresses.length > 0) {
    const reverseBatch = await callTopologyBatch(remoteClient, options.network, [reverseLeadsQuery(uniqueDepositAddresses, topologyBackend)])
    for (const row of resultsFor(reverseBatch, 'reverse_1hop')) {
      const address = typeof row['address'] === 'string' ? row['address'] : ''
      const depositAddress = typeof row['deposit_address'] === 'string' ? row['deposit_address'] : ''
      if (!address || !depositAddress) continue
      const labels = stringArrayValue(row['display_labels']) ?? stringArrayValue(row['labels']) ?? []
      const degreeIn = numberValue(row['degree_in']) ?? 0
      const degreeOut = numberValue(row['degree_out']) ?? 0
      const totalVolume = numberValue(row['total_volume_usd']) ?? 0
      const reason = labels.length > 0 ? 'labeled_entity' : degreeIn > 50 ? 'fan_in_hub' : degreeOut > 50 ? 'fan_out_hub' : totalVolume > 100000 ? 'high_volume_sender' : ''
      if (!reason) continue
      reverseLeads.push({
        address,
        labels,
        node: {
          address,
          labels,
          system_labels: stringArrayValue(row['system_labels']),
          address_type: typeof row['address_type'] === 'string' ? row['address_type'] : undefined,
          address_subtypes: stringArrayValue(row['address_subtypes']),
        },
        degree_in: degreeIn,
        degree_out: degreeOut,
        total_volume_usd: totalVolume,
        deposit_address: depositAddress,
        amount_usd: numberValue(row['amount_usd']),
        reason,
      })
    }
  }

  return { flows, deposits, sourceMatches, reverseLeads }
}

function buildAliases(seedAddress: string, deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[]): AliasTracker {
  const aliases = new AliasTracker()
  aliases.assign(seedAddress, 'V')
  for (const deposit of deposits) {
    for (const address of deposit.path.slice(1, -2)) aliases.assign(address, 'I')
    aliases.assign(deposit.address, 'D')
    aliases.assign(deposit.exchangeAddress, 'E')
  }
  for (const source of sourceMatches) {
    aliases.assign(source.source_exchange, 'X')
    for (const address of source.path.slice(1, -1)) aliases.assign(address, 'I')
  }
  for (const lead of reverseLeads) aliases.assign(lead.address, 'L')
  return aliases
}

function buildGraph(seedAddress: string, network: string, flows: TraceFlow[], deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[]): Record<string, unknown> {
  type NodeAccumulator = {
    in: number
    out: number
    labels: string[]
    systemLabels: string[]
    addressType?: string
    addressSubtypes: string[]
    roles: Set<string>
  }

  const totals = new Map<string, NodeAccumulator>()
  const ensure = (address: string) => {
    if (!totals.has(address)) {
      totals.set(address, {
        in: 0,
        out: 0,
        labels: [],
        systemLabels: [],
        addressSubtypes: [],
        roles: new Set(address === seedAddress ? ['seed'] : []),
      })
    }
    return totals.get(address)!
  }
  const mergeNode = (address: string, metadata?: GraphNodeMetadata, role?: string, systemLabelsFallback?: string[]) => {
    const node = ensure(address)
    node.labels = uniqueStrings([...node.labels, ...(metadata?.labels ?? [])])
    node.systemLabels = uniqueStrings([...node.systemLabels, ...(metadata?.system_labels ?? []), ...(systemLabelsFallback ?? [])])
    if (metadata?.address_type) node.addressType = metadata.address_type
    node.addressSubtypes = uniqueStrings([...node.addressSubtypes, ...(metadata?.address_subtypes ?? [])])
    if (role) node.roles.add(role)
    return node
  }

  for (const flow of flows) {
    const src = mergeNode(flow.src, flow.src_node, undefined, flow.src_labels)
    src.out += flow.amount_usd_sum ?? flow.amount_sum
    const dst = mergeNode(flow.dst, flow.dst_node, undefined, flow.dst_labels)
    dst.in += flow.amount_usd_sum ?? flow.amount_sum
    if (isExchangeFlow(flow)) dst.roles.add('exchange')
  }
  for (const deposit of deposits) {
    for (const node of deposit.pathNodes ?? []) mergeNode(node.address, node)
    mergeNode(deposit.address, deposit.pathNodes?.find((node) => node.address === deposit.address), 'deposit_candidate')
    mergeNode(deposit.exchangeAddress, deposit.exchangeNode, 'exchange', deposit.exchangeLabels)
  }
  for (const source of sourceMatches) {
    for (const node of source.pathNodes ?? []) mergeNode(node.address, node)
    mergeNode(source.source_exchange, source.sourceNode, 'exchange', source.source_labels)
  }
  for (const lead of reverseLeads) {
    mergeNode(lead.address, lead.node ?? { address: lead.address, labels: lead.labels }, 'lead')
    const deposit = ensure(lead.deposit_address)
    deposit.in += lead.amount_usd ?? 0
  }
  const sourceMatchEdges = sourceMatches.flatMap((source) => {
    const path = source.path.length >= 2 ? source.path : [source.deposit_address, source.source_exchange]
    const edges: Array<Record<string, unknown>> = []
    for (let index = path.length - 1; index > 0; index -= 1) {
      edges.push({
        source: path[index],
        target: path[index - 1],
        edge_type: 'flows_to',
        usd_amount: 0,
        amount_sum: 0,
        tx_count: 0,
        direction: 'traceback',
      })
    }
    return edges
  })

  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...totals.entries()].map(([address, data]) => ({
      id: address,
      address,
      node_type: 'address',
      labels: uniqueStrings(data.labels),
      ...(data.systemLabels.length > 0 ? { system_labels: uniqueStrings(data.systemLabels) } : {}),
      ...(data.addressType ? { address_type: data.addressType } : {}),
      ...(data.addressSubtypes.length > 0 ? { address_subtypes: uniqueStrings(data.addressSubtypes) } : {}),
      ...(data.roles.size > 0 ? { roles: [...data.roles] } : {}),
      flow_in_usd: data.in,
      flow_out_usd: data.out,
    })),
    edges: [
      ...flows.map((flow) => ({
        source: flow.src,
        target: flow.dst,
        edge_type: 'flows_to',
        usd_amount: flow.amount_usd_sum ?? flow.amount_sum,
        amount_sum: flow.amount_sum,
        tx_count: flow.tx_count ?? 0,
        first_tx_id: flow.first_tx_id,
        last_tx_id: flow.last_tx_id,
        terminal_exchange: flow.terminal_exchange,
      })),
      ...sourceMatchEdges,
      ...reverseLeads.map((lead) => ({
        source: lead.address,
        target: lead.deposit_address,
        edge_type: 'flows_to',
        usd_amount: lead.amount_usd ?? 0,
        amount_sum: lead.amount_usd ?? 0,
        tx_count: 0,
        direction: 'reverse_1hop_lead',
      })),
    ],
    flows,
    deposits,
    source_matches: sourceMatches,
    reverse_leads: reverseLeads,
    edge_anchors: [],
    metadata: {
      seed_address: seedAddress,
      network,
      generated_at: new Date().toISOString(),
    },
  })
}

function buildMarkdownReport(seedAddress: string, network: string, flows: TraceFlow[], deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[], aliases: AliasTracker, graphPath: string, schemaPath: string): string {
  const lines = [
    `# Trace Funds: ${seedAddress}`,
    '',
    `Network: \`${network}\``,
    `Schema: \`${schemaPath}\``,
    `Graph: \`${graphPath}\``,
    '',
    '## Probe Summary',
    '',
    `- Exchange endpoint(s): ${[...new Set(deposits.map((deposit) => aliases.alias(deposit.exchangeAddress) ?? deposit.exchangeAddress))].join(', ') || 'none'}`,
    `- Deposit candidate(s): ${[...new Set(deposits.map((deposit) => aliases.alias(deposit.address) ?? deposit.address))].join(', ') || 'none'}`,
    `- Traceback source exchange path(s): ${sourceMatches.length}`,
    `- Reverse 1-hop lead(s): ${reverseLeads.length}`,
    '',
    '## Flow Table',
    '',
    '| Hop | Source | Destination | amount_sum | amount_usd_sum | tx_count | first_tx_id | terminal_exchange |',
    '|---:|---|---|---:|---:|---:|---|---|',
    ...flows.map((flow) => [
      `| ${flow.hop}`,
      `\`${flow.src}\``,
      `\`${flow.dst}\``,
      flow.amount_sum,
      flow.amount_usd_sum ?? '',
      flow.tx_count ?? '',
      flow.first_tx_id ? `\`${flow.first_tx_id}\`` : '',
      flow.terminal_exchange ? 'yes' : 'no',
    ].join(' | ') + ' |'),
    '',
    '## Mermaid',
    '',
    '```mermaid',
    'flowchart LR',
    ...flows.map((flow, index) =>
      `  n${index}["${flow.src.slice(0, 8)}..."] -->|"amount_sum ${flow.amount_sum}${flow.terminal_exchange ? '; exchange endpoint' : ''}"| m${index}["${flow.dst.slice(0, 8)}..."]`
    ),
    '```',
  ]
  return lines.join('\n') + '\n'
}

function probeEvidence(seedAddress: string, network: string, schemaPath: string, aliases: AliasTracker, flows: TraceFlow[], deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[]): Record<string, unknown> {
  return {
    schema: 'chain-insights.probe_evidence.v1',
    source: 'track_funds',
    network,
    seed_address: seedAddress,
    schema_ref: schemaPath,
    address_map: aliases.addressMap(),
    fund_flows: [
      ...deposits.map((deposit, index) => ({
        id: `F${index + 1}`,
        type: 'deposit',
        path: deposit.path.map((address) => aliases.alias(address) ?? address),
        deposit: aliases.alias(deposit.address),
        exchange: aliases.alias(deposit.exchangeAddress),
        amount_sum: deposit.amount_sum,
        amount_usd_sum: deposit.amount_usd_sum,
        hops: deposit.hops,
      })),
      ...sourceMatches.map((source, index) => ({
        id: `S${index + 1}`,
        type: 'source',
        path: [...source.path].reverse().map((address) => aliases.alias(address) ?? address),
        source_exchange: aliases.alias(source.source_exchange),
        deposit: aliases.alias(source.deposit_address),
        hops: source.hops,
      })),
    ],
    reverse_leads: reverseLeads.map((lead) => ({
      alias: aliases.alias(lead.address),
      address: lead.address,
      reason: lead.reason,
      labels: lead.labels,
      deposit: aliases.alias(lead.deposit_address),
      amount_usd: lead.amount_usd,
    })),
    outgoing_flows: flows.map((flow) => ({
      hop: flow.hop,
      src: aliases.alias(flow.src) ?? flow.src,
      dst: aliases.alias(flow.dst) ?? flow.dst,
      amount_sum: flow.amount_sum,
      amount_usd_sum: flow.amount_usd_sum,
      tx_count: flow.tx_count,
      first_tx_id: flow.first_tx_id,
      last_tx_id: flow.last_tx_id,
      terminal_exchange: flow.terminal_exchange,
    })),
  }
}

function tableCsv(flows: TraceFlow[]): string {
  const rows = ['hop,src,dst,amount_sum,amount_usd_sum,tx_count,first_tx_id,last_tx_id,terminal_exchange']
  for (const flow of flows) {
    rows.push([
      flow.hop,
      flow.src,
      flow.dst,
      flow.amount_sum,
      flow.amount_usd_sum ?? '',
      flow.tx_count ?? '',
      flow.first_tx_id ?? '',
      flow.last_tx_id ?? '',
      flow.terminal_exchange ? 'true' : 'false',
    ].map((value) => JSON.stringify(String(value))).join(','))
  }
  return rows.join('\n') + '\n'
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildTableHtml(seedAddress: string, network: string, flows: TraceFlow[], deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[]): string {
  const headers = [
    'hop',
    'src',
    'dst',
    'amount_sum',
    'amount_usd_sum',
    'tx_count',
    'first_tx_id',
    'last_tx_id',
    'terminal_exchange_display',
  ] as const
  const headerLabels: Record<typeof headers[number], string> = {
    hop: 'Hop',
    src: 'Source',
    dst: 'Destination',
    amount_sum: 'amount_sum',
    amount_usd_sum: 'amount_usd_sum',
    tx_count: 'tx_count',
    first_tx_id: 'first_tx_id',
    last_tx_id: 'last_tx_id',
    terminal_exchange_display: 'terminal_exchange',
  }
  const rows = flows.map((flow) => {
    const values: Record<string, unknown> = {
      ...flow,
      terminal_exchange_display: flow.terminal_exchange ? 'yes' : 'no',
    }
    return `<tr>${headers.map((header) => `<td>${htmlEscape(values[header])}</td>`).join('')}</tr>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trace Funds Table - ${htmlEscape(seedAddress)}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  .meta { display: grid; gap: 6px; margin: 0 0 20px; color: rgba(244,242,234,.72); font-size: 13px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
  .pill { border: 1px solid rgba(242,221,166,.25); background: rgba(242,221,166,.08); border-radius: 999px; padding: 6px 10px; font-size: 12px; color: #f2dda6; }
  .table-wrap { overflow: auto; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #10131b; }
  table { border-collapse: collapse; width: 100%; min-width: 1180px; font-size: 12px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; z-index: 1; }
  td { color: rgba(244,242,234,.86); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  tr:hover td { background: rgba(242,221,166,.045); }
</style>
</head>
<body>
<main>
  <h1>Trace Funds Table</h1>
  <div class="meta">
    <div>Network: <strong>${htmlEscape(network)}</strong></div>
    <div>Seed: <strong>${htmlEscape(seedAddress)}</strong></div>
    <div>Generated: <strong>${htmlEscape(new Date().toISOString())}</strong></div>
  </div>
  <div class="summary">
    <span class="pill">${flows.length} FLOWS_TO edges</span>
    <span class="pill">${deposits.length} deposit candidates</span>
    <span class="pill">${sourceMatches.length} traceback source paths</span>
    <span class="pill">${reverseLeads.length} reverse 1-hop leads</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(headerLabels[header])}</th>`).join('')}</tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>
`
}

function summarize(seedAddress: string, network: string, flows: TraceFlow[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[], aliases: AliasTracker, files: TraceFundsResult['files'], continuation: TraceFundsResult['continuation']): string {
  const totalAmount = flows.reduce((sum, flow) => sum + flow.amount_sum, 0)
  const byHop = new Map<number, number>()
  for (const flow of flows) byHop.set(flow.hop, (byHop.get(flow.hop) ?? 0) + 1)
  const depositCount = continuation.depositAddresses.length
  const exchangeCount = continuation.exchangeAddresses.length
  return [
    `Trace complete for ${network}:${seedAddress}`,
    '',
    `Facts: ${flows.length} FLOWS_TO edge(s), sum of traced edge amount_sum values ${Number(totalAmount.toFixed(8))}.`,
    `By hop: ${[...byHop.entries()].map(([hop, count]) => `hop ${hop}: ${count}`).join(', ') || 'none'}.`,
    `Exchange endpoints reached: ${exchangeCount}. Deposit candidate address(es): ${depositCount}.`,
    `Traceback source path(s): ${sourceMatches.length}. Reverse 1-hop lead(s): ${reverseLeads.length}.`,
    '',
    'Files written:',
    `- schema: ${files.schema}`,
    `- compact evidence JSON: ${files.compactEvidence}`,
    `- graph JSON: ${files.graph}`,
    `- graph HTML: ${files.graphHtml}`,
    `- table CSV: ${files.table}`,
    `- table HTML: ${files.tableHtml}`,
    `- report: ${files.report}`,
    '',
    `Continuation hint: ${continuation.hint}`,
    continuation.depositAddresses.length > 0
      ? `Deposit candidates: ${continuation.depositAddresses.map((address) => aliases.alias(address) ?? address).join(', ')}`
      : 'Deposit candidates: none reached in this bounded trace.',
    continuation.nextHopAddresses.length > 0
      ? `Next addresses: ${continuation.nextHopAddresses.join(', ')}`
      : 'Next addresses: none found in this trace.',
  ].join('\n')
}

export async function runFundFlowProbe(
  remoteClient: Client,
  _config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceFundsOptions,
): Promise<TraceFundsResult> {
  const seedAddress = options.seedAddress.trim()
  const network = options.network.trim()
  if (!seedAddress) throw new Error('seed_address is required')
  if (!network) throw new Error('network is required')

  const maxHops = clampInt(options.maxHops, 3, 1, 5)
  const perAddressLimit = clampInt(options.perAddressLimit, 5, 1, 10)
  const minAmountSum = Math.max(0, options.minAmountSum ?? 0)
  const paths = workspaceOutputPaths()
  await ensureDirs(paths)

  const topologyBackend = await topologyBackendFor(remoteClient, network)
  const schemaResult = await loadOrCaptureTopologySchema(remoteClient, paths, network, topologyBackend)
  const { flows, deposits, sourceMatches, reverseLeads } = await collectProbeTrace(remoteClient, { seedAddress, network, maxHops, perAddressLimit, minAmountSum }, topologyBackend)
  const aliases = buildAliases(seedAddress, deposits, sourceMatches, reverseLeads)
  const slug = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_${sanitizeSegment(seedAddress.slice(0, 16))}`
  const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads)
  const graph = buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads)

  const compactPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`)
  const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`)
  const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`)
  const tablePath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`)
  const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`)
  const reportPath = path.join(paths.reportsRoot, `${slug}.trace-report.md`)
  const { generateInlineGraphHtml } = await import('../viz/html-generator.js')

  await writeFile(compactPath, JSON.stringify(compact, null, 2) + '\n', { mode: 0o600 })
  await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n', { mode: 0o600 })
  await writeFile(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 0o600 })
  await writeFile(tablePath, tableCsv(flows), { mode: 0o600 })
  await writeFile(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 0o600 })
  await writeFile(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 0o600 })

  if (options.caseId) {
    const { EvidenceStore } = await import('../cases/index.js')
    await EvidenceStore.append(options.caseId, {
      source: 'track_funds',
      queryParams: `network=${network} seed_address=${seedAddress} max_hops=${maxHops} per_address_limit=${perAddressLimit} min_amount_sum=${minAmountSum}`,
      content: JSON.stringify({
        schema: 'chain-insights.evidence_pointer.v1',
        source: 'track_funds',
        network,
        seed_address: seedAddress,
        address_map: aliases.compactAddressMap(),
        files: {
          compactEvidence: compactPath,
          graph: graphPath,
          graphHtml: graphHtmlPath,
          table: tablePath,
          tableHtml: tableHtmlPath,
          report: reportPath,
        },
        facts: {
          flow_count: flows.length,
          deposit_candidates: [...new Set(deposits.map((deposit) => aliases.alias(deposit.address) ?? deposit.address))],
          exchange_endpoints: [...new Set(deposits.map((deposit) => aliases.alias(deposit.exchangeAddress) ?? deposit.exchangeAddress))],
          traceback_source_paths: sourceMatches.length,
          reverse_leads: reverseLeads.length,
        },
      }, null, 2),
    })
  }

  const depositAddresses = [...new Set(deposits.map((deposit) => deposit.address))]
  const exchangeAddresses = [...new Set(deposits.map((deposit) => deposit.exchangeAddress))]
  const leaves: string[] = []
  const continuation = {
    nextHopAddresses: leaves.slice(0, 20),
    depositAddresses,
    exchangeAddresses,
    hint: depositAddresses.length > 0
      ? `Found ${depositAddresses.length} deposit candidate(s), defined as the address one hop before an Exchange-labeled node. Do not continue through exchange nodes.`
      : leaves.length > 0
        ? `No exchange endpoint reached yet. Continue from ${leaves.length} non-exchange leaf destination(s) with the same tool, or raise the result budget if the current trace stopped early.`
        : 'No exchange endpoint or non-exchange leaf destinations found; inspect graph/report files or lower min_amount_sum.',
  }
  const files = {
    schema: schemaResult.filePath,
    compactEvidence: compactPath,
    graph: graphPath,
    graphHtml: graphHtmlPath,
    table: tablePath,
    tableHtml: tableHtmlPath,
    report: reportPath,
  }

  return {
    summaryText: summarize(seedAddress, network, flows, sourceMatches, reverseLeads, aliases, files, continuation),
    compactEvidence: compact,
    graphData: graph,
    files,
    continuation,
    addressMap: aliases.compactAddressMap(),
  }
}
