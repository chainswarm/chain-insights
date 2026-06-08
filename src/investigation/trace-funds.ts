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

export interface TraceFundsOptions {
  seedAddress: string
  network: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  includeDepositTraceback?: boolean
  evidenceSource?: string
  writeArtifacts?: boolean
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
  is_exchange?: boolean
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

interface ParsedGraphBatch {
  facts?: {
    queries?: Array<{
      id?: string
      ok?: boolean
      results?: Array<Record<string, unknown>>
      error?: string
    }>
  }
}

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

const SCHEMA_QUERY_SET = [
  {
    id: 'node_labels',
    query: 'MATCH (n:Address) RETURN "Address" AS node_label, count(n) AS sample_count LIMIT 1',
  },
  {
    id: 'relationship_types',
    query: 'MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN "FLOWS_TO" AS rel_name, count(r) AS sample_count LIMIT 1',
  },
  {
    id: 'address_property_keys',
    query: 'MATCH (n:Address) RETURN "address" AS property_key, count(n) AS sample_count LIMIT 1',
  },
  {
    id: 'flows_to_property_keys',
    query: 'MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN "amount_sum" AS property_key, count(r) AS sample_count LIMIT 1',
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

function parseGraphBatchResult(result: RemoteToolResult): ParsedGraphBatch {
  const text = textFromToolResult(result).trim()
  if (!text) throw new Error('graph_query_batch returned no text content')
  const parsed = JSON.parse(text) as ParsedGraphBatch
  if (!parsed.facts?.queries) throw new Error('graph_query_batch response did not include facts.queries')
  return parsed
}

function topologyGraphQuery(query: string): string {
  const trimmed = query.trim()
  if (/^USE\s+/i.test(trimmed)) return trimmed
  return `USE live_topology ${trimmed}`
}

async function callGraphBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedGraphBatch> {
  const result = await remoteClient.callTool(
    {
      name: 'graph_query_batch',
      arguments: {
        network,
        queries: queries.map((query) => ({
          ...query,
          query: topologyGraphQuery(query.query),
        })),
        per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS,
      },
    },
    undefined,
    {
      timeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS,
    },
  ) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function resultsFor(batch: ParsedGraphBatch, id: string): Array<Record<string, unknown>> {
  const query = batch.facts?.queries?.find((entry) => entry.id === id)
  if (!query) return []
  if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`)
  return query.results ?? []
}

function schemaFromGraphBatch(network: string, batch: ParsedGraphBatch): Record<string, unknown> {
  return {
    schema: 'chain-insights.runtime_graph_schema.v1',
    network,
    source: 'graph_query_batch',
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
      'dst.lifetime_degree_in AS dst_degree_in',
      'dst.lifetime_degree_out AS dst_degree_out',
    ],
  }
}

async function loadOrCaptureTopologySchema(
  remoteClient: Client,
  paths: WorkspaceOutputPaths,
  network: string,
): Promise<{ schema: Record<string, unknown>; filePath: string }> {
  const filePath = path.join(paths.schemaDir, `${sanitizeSegment(network)}.graph-schema.json`)
  try {
    return { schema: JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>, filePath }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const batch = await callGraphBatch(
    remoteClient,
    network,
    SCHEMA_QUERY_SET,
  )
  const schema = schemaFromGraphBatch(network, batch)
  await writeFile(filePath, JSON.stringify(schema, null, 2) + '\n', { mode: 0o600 })
  return { schema, filePath }
}

function flowEdgeMap(variableName: string): string {
  return `{amount_sum: ${variableName}.amount_sum, amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`
}

function pathNodeMap(variableName: string): string {
  return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes, is_exchange: ${variableName}.is_exchange}`
}

function forwardExchangeQueries(address: string, limit: number, minAmountSum: number, maxHops: number): Array<{ id: string; query: string }> {
  return Array.from({ length: maxHops }, (_, index) => forwardExchangeQueryAtDepth(address, limit, minAmountSum, index + 1))
}

function forwardExchangeQueryAtDepth(address: string, limit: number, minAmountSum: number, depth: number): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['s', ...intermediateVariables, 't']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 't' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Address)`
  }).join('')
  const amountPredicates = edgeVariables.map((edgeVariable) => `${edgeVariable}.amount_sum IS NOT NULL${minAmountSum > 0 ? ` AND ${edgeVariable}.amount_sum >= ${minAmountSum}` : ''}`)
  const nonTerminalPredicates = ['s', ...intermediateVariables].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const predicates = ['s <> t', ...nonTerminalPredicates, 't.is_exchange IS NOT NULL', ...amountPredicates]
  const depositVariable = nodeVariables[nodeVariables.length - 2]!
  return {
    id: `forward_exchange_paths_${depth}`,
    query: [
      `MATCH (s:Address {address: "${escapeCypherString(address)}"})${relationshipChain}`,
      `WHERE ${predicates.join(' AND ')}`,
      `RETURN [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(', ')}] AS node_labels, [${nodeVariables.map(pathNodeMap).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props, t.address AS exchange_address, t.labels AS exchange_display_labels, t.labels AS exchange_labels, t.address_type AS exchange_address_type, t.address_subtypes AS exchange_address_subtypes, t.is_exchange AS exchange_is_exchange, ${depositVariable}.address AS deposit_address, ${depositVariable}.is_exchange AS deposit_is_exchange, ${depth} AS hops`,
      'ORDER BY hops ASC',
      `LIMIT ${limit}`,
    ].join(' '),
  }
}

function backwardSourceQueries(idPrefix: string, depositAddress: string, maxHops: number): Array<{ id: string; query: string }> {
  return Array.from({ length: maxHops }, (_, index) => backwardSourceQueryAtDepth(`${idPrefix}_${index + 1}`, depositAddress, index + 1))
}

function backwardSourceQueryAtDepth(id: string, depositAddress: string, depth: number): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['dep', ...intermediateVariables, 'source']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'source' : intermediateVariables[index]!
    return `<-[${edgeVariable}:FLOWS_TO]-(${targetVariable}:Address)`
  }).join('')
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  return {
    id,
    query: [
      `MATCH (dep:Address {address: "${escapeCypherString(depositAddress)}"})`,
      `MATCH (dep)${relationshipChain}`,
      `WHERE source <> dep AND source.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN dep.address AS deposit_address, source.address AS source_exchange, source.labels AS source_display_labels, source.labels AS source_labels, source.address_type AS source_address_type, source.address_subtypes AS source_address_subtypes, ${depth} AS hops, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.labels`).join(', ')}] AS node_labels, [${nodeVariables.map(pathNodeMap).join(', ')}] AS path_nodes`,
      'LIMIT 20',
    ].join(' '),
  }
}

function reverseLeadsQuery(depositAddresses: string[]): { id: string; query: string } {
  const depositPredicates = depositAddresses.map((address) => `deposit.address = "${escapeCypherString(address)}"`)
  return {
    id: 'reverse_1hop',
    query: [
      'MATCH (sender:Address)-[r:FLOWS_TO]->(deposit:Address)',
      `WHERE (${depositPredicates.join(' OR ')}) AND sender.is_exchange IS NULL AND sender.address <> deposit.address`,
      'RETURN DISTINCT sender.address AS address, sender.labels AS display_labels, sender.labels AS system_labels, sender.address_type AS address_type, sender.address_subtypes AS address_subtypes, coalesce(sender.lifetime_degree_in, 0) AS degree_in, coalesce(sender.lifetime_degree_out, 0) AS degree_out, coalesce(sender.total_volume_usd, 0) AS total_volume_usd, deposit.address AS deposit_address, r.amount_usd_sum AS amount_usd',
      'ORDER BY r.amount_usd_sum DESC',
      `LIMIT ${Math.max(50, depositAddresses.length * 50)}`,
    ].join(' '),
  }
}

function edgeKey(src: string, dst: string): string {
  return `${src}\u0000${dst}`
}

function directEdgePropsQuery(flows: TraceFlow[]): { id: string; query: string } | null {
  const pairs = [...new Map(flows.map((flow) => [edgeKey(flow.src, flow.dst), { src: flow.src, dst: flow.dst }])).values()]
  if (pairs.length === 0) return null
  const predicates = pairs.map((pair) =>
    `(a.address = "${escapeCypherString(pair.src)}" AND b.address = "${escapeCypherString(pair.dst)}")`
  )
  return {
    id: 'direct_edge_props',
    query: [
      'MATCH (a:Address)-[r:FLOWS_TO]->(b:Address)',
      `WHERE (${predicates.join(' OR ')})`,
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

function isExchangeFlag(value: unknown): boolean {
  if (value === true) return true
  if (value === false || value === null || value === undefined) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
  }
  if (typeof value === 'number') return value === 1
  return false
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

function hasExactExchangeLabel(labels: string[] | undefined): boolean {
  return (labels ?? []).some((label) => label.trim().toLowerCase() === 'exchange')
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
    is_exchange: isExchangeFlag(record['is_exchange']),
  }
}

function isExchangeFlow(flow: TraceFlow): boolean {
  return flow.terminal_exchange ||
    isExchangeFlag(flow.dst_node?.is_exchange) ||
    hasExactExchangeLabel(flow.dst_labels) ||
    hasExactExchangeLabel(flow.dst_node?.system_labels) ||
    hasExactExchangeLabel(flow.dst_node?.labels)
}

function isExchangeNode(metadata: GraphNodeMetadata | undefined, labels: string[] | undefined): boolean {
  return isExchangeFlag(metadata?.is_exchange) ||
    hasExactExchangeLabel(labels) ||
    hasExactExchangeLabel(metadata?.system_labels) ||
    hasExactExchangeLabel(metadata?.labels)
}

function rowTouchesExchangeBeforeTerminal(pathNodes: Array<GraphNodeMetadata | undefined>, nodeLabels: string[][], pathLength: number): boolean {
  for (let index = 0; index < Math.max(pathLength - 1, 0); index += 1) {
    if (isExchangeNode(pathNodes[index], nodeLabels[index])) return true
  }
  return false
}

function depositFromRow(row: Record<string, unknown>): TraceDeposit | null {
  const pathAddresses = stringArrayValue(row['addresses']) ?? []
  if (pathAddresses.length < 2) return null
  const nodeLabels = Array.isArray(row['node_labels']) ? row['node_labels'].map((labels) => stringArrayValue(labels) ?? []) : []
  const exchangeAddress = typeof row['exchange_address'] === 'string' ? row['exchange_address'] : pathAddresses[pathAddresses.length - 1]
  const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
  const terminalEdge = edgeProps[edgeProps.length - 1] ?? {}
  const pathNodes = Array.isArray(row['path_nodes'])
    ? row['path_nodes'].map((node, index) => nodeMetadataFromValue(node, pathAddresses[index])).filter((node): node is GraphNodeMetadata => Boolean(node))
    : undefined
  const depositIndex = pathAddresses.length - 2
  const depositNode = pathNodes?.find((node) => node.address === pathAddresses[depositIndex]) ?? pathNodes?.[depositIndex]
  if (isExchangeFlag(row['deposit_is_exchange']) || isExchangeNode(depositNode, nodeLabels[depositIndex])) return null
  const exchangeNode = {
    address: exchangeAddress,
    labels: stringArrayValue(row['exchange_display_labels']),
    system_labels: stringArrayValue(row['exchange_system_labels']) ?? stringArrayValue(row['exchange_labels']),
    address_type: typeof row['exchange_address_type'] === 'string' ? row['exchange_address_type'] : undefined,
    address_subtypes: stringArrayValue(row['exchange_address_subtypes']),
    is_exchange: true,
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
    if (rowTouchesExchangeBeforeTerminal(pathNodes, nodeLabels, pathAddresses.length)) continue
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

async function hydrateDirectEdgeProps(remoteClient: Client, network: string, flows: TraceFlow[], deposits: TraceDeposit[]): Promise<void> {
  const query = directEdgePropsQuery(flows)
  if (!query) return

  const batch = await callGraphBatch(remoteClient, network, [query])
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
  options: Required<Pick<TraceFundsOptions, 'seedAddress' | 'network' | 'maxHops' | 'perAddressLimit' | 'minAmountSum'>> & Pick<TraceFundsOptions, 'includeDepositTraceback'>,
): Promise<{ flows: TraceFlow[]; deposits: TraceDeposit[]; sourceMatches: SourceMatch[]; reverseLeads: ReverseLead[] }> {
  const forwardBatch = await callGraphBatch(remoteClient, options.network, [
    ...forwardExchangeQueries(options.seedAddress, Math.max(options.perAddressLimit * 20, 200), options.minAmountSum, options.maxHops),
  ])
  const forwardRows = rowsMatchingMinimumAmount((forwardBatch.facts?.queries ?? [])
    .filter((query) => query.id?.startsWith('forward_exchange_paths_'))
    .flatMap((query) => {
      if (query.ok === false) throw new Error(query.error || `Query failed: ${query.id}`)
      return query.results ?? []
    }), options.minAmountSum)
  const { flows, deposits } = flowsFromForwardRows(forwardRows)
  await hydrateDirectEdgeProps(remoteClient, options.network, flows, deposits)
  const uniqueDepositAddresses = [...new Set(deposits.map((deposit) => deposit.address))]

  const sourceMatches: SourceMatch[] = []
  if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
    const backwardBatch = await callGraphBatch(
      remoteClient,
      options.network,
      uniqueDepositAddresses.slice(0, Math.max(1, Math.floor(20 / options.maxHops))).flatMap((address, index) => backwardSourceQueries(`backward_from_deposit_${index + 1}`, address, options.maxHops)),
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
  if (options.includeDepositTraceback !== false && uniqueDepositAddresses.length > 0) {
    const reverseBatch = await callGraphBatch(remoteClient, options.network, [reverseLeadsQuery(uniqueDepositAddresses)])
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

function probeEvidence(seedAddress: string, network: string, schemaPath: string, aliases: AliasTracker, flows: TraceFlow[], deposits: TraceDeposit[], sourceMatches: SourceMatch[], reverseLeads: ReverseLead[], evidenceSource = 'track_funds'): Record<string, unknown> {
  return {
    schema: 'chain-insights.probe_evidence.v1',
    source: evidenceSource,
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
  const hasFiles = Object.values(files).some((value) => value.length > 0)
  return [
    `Trace complete for ${network}:${seedAddress}`,
    '',
    `Facts: ${flows.length} FLOWS_TO edge(s), sum of traced edge amount_sum values ${Number(totalAmount.toFixed(8))}.`,
    `By hop: ${[...byHop.entries()].map(([hop, count]) => `hop ${hop}: ${count}`).join(', ') || 'none'}.`,
    `Exchange endpoints reached: ${exchangeCount}. Deposit candidate address(es): ${depositCount}.`,
    `Traceback source path(s): ${sourceMatches.length}. Reverse 1-hop lead(s): ${reverseLeads.length}.`,
    '',
    hasFiles
      ? [
          'Files written:',
          `- schema: ${files.schema}`,
          `- compact evidence JSON: ${files.compactEvidence}`,
          `- graph JSON: ${files.graph}`,
          `- graph HTML: ${files.graphHtml}`,
          `- table CSV: ${files.table}`,
          `- table HTML: ${files.tableHtml}`,
          `- report: ${files.report}`,
        ].join('\n')
      : 'Files written: disabled by stateless proxy mode.',
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
  const evidenceSource = options.evidenceSource ?? 'track_funds'
  const writeArtifacts = options.writeArtifacts !== false

  const paths = writeArtifacts ? workspaceOutputPaths() : undefined
  if (paths) await ensureDirs(paths)

  const schemaResult = paths
    ? await loadOrCaptureTopologySchema(remoteClient, paths, network)
    : {
        schema: {
          schema: 'chain-insights.runtime_graph_schema.v1',
          network,
          source: 'stateless_proxy_mode',
        },
        filePath: 'stateless://runtime-schema-not-written',
      }
  const { flows, deposits, sourceMatches, reverseLeads } = await collectProbeTrace(remoteClient, { seedAddress, network, maxHops, perAddressLimit, minAmountSum, includeDepositTraceback: options.includeDepositTraceback })
  const aliases = buildAliases(seedAddress, deposits, sourceMatches, reverseLeads)
  const slug = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_${sanitizeSegment(seedAddress.slice(0, 16))}`
  const compact = probeEvidence(seedAddress, network, schemaResult.filePath, aliases, flows, deposits, sourceMatches, reverseLeads, evidenceSource)
  const graph = buildGraph(seedAddress, network, flows, deposits, sourceMatches, reverseLeads)

  const compactPath = paths ? path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`) : ''
  const graphPath = paths ? path.join(paths.reportGraphsRoot, `${slug}.graph.json`) : ''
  const graphHtmlPath = paths ? path.join(paths.reportsRoot, `${slug}.graph.html`) : ''
  const tablePath = paths ? path.join(paths.reportTablesRoot, `${slug}.flows.csv`) : ''
  const tableHtmlPath = paths ? path.join(paths.reportsRoot, `${slug}.table.html`) : ''
  const reportPath = paths ? path.join(paths.reportsRoot, `${slug}.trace-report.md`) : ''

  if (paths) {
    const { generateInlineGraphHtml } = await import('../viz/html-generator.js')
    await writeFile(compactPath, JSON.stringify(compact, null, 2) + '\n', { mode: 0o600 })
    await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n', { mode: 0o600 })
    await writeFile(graphHtmlPath, generateInlineGraphHtml(graph), { mode: 0o600 })
    await writeFile(tablePath, tableCsv(flows), { mode: 0o600 })
    await writeFile(tableHtmlPath, buildTableHtml(seedAddress, network, flows, deposits, sourceMatches, reverseLeads), { mode: 0o600 })
    await writeFile(reportPath, buildMarkdownReport(seedAddress, network, flows, deposits, sourceMatches, reverseLeads, aliases, graphPath, schemaResult.filePath), { mode: 0o600 })
  }
  const depositAddresses = [...new Set(deposits.map((deposit) => deposit.address))]
  const exchangeAddresses = [...new Set(deposits.map((deposit) => deposit.exchangeAddress))]
  const leaves: string[] = []
  const continuation = {
    nextHopAddresses: leaves.slice(0, 20),
    depositAddresses,
    exchangeAddresses,
    hint: depositAddresses.length > 0
      ? `Found ${depositAddresses.length} deposit candidate(s), defined as the address one hop before an exchange endpoint. Do not continue through exchange nodes.`
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
