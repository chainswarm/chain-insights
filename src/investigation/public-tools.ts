import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { runFundFlowProbe, type TraceFundsResult } from './trace-funds.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'

export { scamTopology, type ScamTopologyOptions, type ScamTopologyResult } from './scam-topology.js'

type RemoteToolResult = {
  content?: ContentBlock[]
  isError?: boolean
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

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 30

export interface AddressRiskOptions {
  address: string
  network: string
  compareAddress?: string
}

export interface TrackFundsOptions {
  trustedAddresses: string | string[]
  untrustedAddresses?: string | string[]
  network: string
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
}

function escapeCypherString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
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

function resultsFor(batch: ParsedGraphBatch, id: string): Array<Record<string, unknown>> {
  const query = batch.facts?.queries?.find((entry) => entry.id === id)
  if (!query) return []
  if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`)
  return query.results ?? []
}

function resultsWithPrefix(batch: ParsedGraphBatch, prefix: string): Array<Record<string, unknown>> {
  return (batch.facts?.queries ?? [])
    .filter((entry) => entry.id?.startsWith(prefix))
    .flatMap((entry) => {
      if (entry.ok === false) throw new Error(entry.error || `Query failed: ${entry.id}`)
      return entry.results ?? []
    })
}

async function callGraphBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedGraphBatch> {
  const result = await remoteClient.callTool({
    name: 'graph_query_batch',
    arguments: {
      network,
      queries: queries.map((query) => ({
        ...query,
        query: topologyGraphQuery(query.query),
      })),
      per_query_timeout_seconds: GRAPH_QUERY_BATCH_TIMEOUT_SECONDS,
    },
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function parseAddressList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function graphArray(graphData: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = graphData[key]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function addressProfileQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_profile',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'RETURN a.address AS address, a.labels AS display_labels, a.labels AS system_labels, a.address_type AS address_type, a.address_subtypes AS address_subtypes, a.is_exchange AS is_exchange, a.confluence_score AS confluence_score, a.ml_risk_score AS ml_risk_score, a.ml_risk_level AS ml_risk_level, a.ml_top_drivers AS ml_top_drivers, a.ml_pattern_summary AS ml_pattern_summary, a.risk_score AS risk_score, a.risk_level AS risk_level, a.pattern_flags AS pattern_flags, a.ml_pagerank AS ml_pagerank, a.ml_betweenness AS ml_betweenness, a.ml_community_id AS ml_community_id',
      'LIMIT 1',
    ].join(' '),
  }
}

function addressFeatureQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_feature',
    query: [
      'USE facts',
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[:HAS_FEATURE]->(feature:AddressFeature)`,
      'RETURN feature.degree_in AS degree_in, feature.degree_out AS degree_out, feature.degree_total AS degree_total, feature.tx_in_count AS tx_in_count, feature.tx_out_count AS tx_out_count, feature.tx_total_count AS tx_total_count, feature.total_volume_usd AS total_volume_usd, feature.total_in_usd AS total_in_usd, feature.total_out_usd AS total_out_usd, feature.net_flow_usd AS net_flow_usd, feature.first_activity_timestamp AS first_activity_timestamp, feature.last_activity_timestamp AS last_activity_timestamp, feature.activity_span_days AS activity_span_days, feature.active_days AS active_days',
      'LIMIT 1',
    ].join(' '),
  }
}

function addressRiskScoreQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_risk_score',
    query: [
      'USE facts',
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[:HAS_RISK_SCORE]->(risk:RiskScore)`,
      'RETURN risk.risk_score AS risk_score, risk.window_days AS risk_window_days, risk.processing_date AS risk_processing_date, risk.shap_top_features AS shap_top_features',
      'LIMIT 1',
    ].join(' '),
  }
}

function flowEdgeMap(variableName: string): string {
  return `{amount_sum: ${variableName}.amount_sum, amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`
}

function pathNodeMap(variableName: string): string {
  return `{address: ${variableName}.address, labels: ${variableName}.labels, system_labels: ${variableName}.labels, address_type: ${variableName}.address_type, address_subtypes: ${variableName}.address_subtypes}`
}

function exchangeOutflowQueries(address: string): Array<{ id: string; query: string }> {
  return Array.from({ length: 3 }, (_, index) => exchangeOutflowQueryAtDepth(address, index + 1))
}

function exchangeOutflowQueryAtDepth(address: string, depth: number): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['a', ...intermediateVariables, 'exchange']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'exchange' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Address)`
  }).join('')
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const depositVariable = nodeVariables[nodeVariables.length - 2]!
  const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1]!
  return {
    id: `exchange_outflows_${depth}`,
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})${relationshipChain}`,
      `WHERE a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "outflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, exchange.address_type AS exchange_address_type, exchange.address_subtypes AS exchange_address_subtypes, ${depositVariable}.address AS deposit_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_sum AS amount_sum, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map(pathNodeMap).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      'ORDER BY hops ASC',
      'LIMIT 200',
    ].join(' '),
  }
}

function exchangeInflowQueries(address: string): Array<{ id: string; query: string }> {
  return Array.from({ length: 3 }, (_, index) => exchangeInflowQueryAtDepth(address, index + 1))
}

function exchangeInflowQueryAtDepth(address: string, depth: number): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['exchange', ...intermediateVariables, 'a']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'a' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Address)`
  }).join('')
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const withdrawalVariable = nodeVariables[1]!
  const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1]!
  return {
    id: `exchange_inflows_${depth}`,
    query: [
      `MATCH (exchange:Address)${relationshipChain}`,
      `WHERE a.address = "${escapeCypherString(address)}" AND a <> exchange AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "inflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, exchange.address_type AS exchange_address_type, exchange.address_subtypes AS exchange_address_subtypes, ${withdrawalVariable}.address AS withdrawal_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_sum AS amount_sum, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map(pathNodeMap).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      'ORDER BY hops ASC',
      'LIMIT 200',
    ].join(' '),
  }
}

function connectionProbeQuery(address: string, compareAddress: string): { id: string; query: string } {
  return {
    id: 'connection_probe',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[r:FLOWS_TO]-(b:Address {address: "${escapeCypherString(compareAddress)}"})`,
      'RETURN [a.address, b.address] AS addresses, 1 AS hops',
      'LIMIT 5',
    ].join(' '),
  }
}

function formatExchangeRows(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const direction = String(row['direction'] ?? 'flow')
    const exchange = String(row['exchange_address'] ?? '')
    const amount = row['amount_sum'] ?? row['amount_usd_sum'] ?? ''
    const hops = row['hops'] ?? ''
    return `- ${direction}: ${exchange} (${hops} hop(s), amount ${amount})`
  })
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = numberValue(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function riskLevelFromScore(score: number): string {
  if (score >= 0.85) return 'critical'
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function riskRecommendation(level: string): string {
  if (level === 'critical' || level === 'high') return 'Escalate for manual review.'
  if (level === 'medium') return 'Review exchange exposure and counterparties before clearing.'
  return 'No stored risk signal found; continue with normal monitoring.'
}

function riskDrivers(profile: Record<string, unknown>, exchangeRows: Array<Record<string, unknown>>): string[] {
  const drivers: string[] = []
  const storedDrivers = stringArrayValue(profile['ml_top_drivers'])
  if (storedDrivers?.length) drivers.push(...storedDrivers)

  const patternFlags = stringArrayValue(profile['pattern_flags'])
  if (patternFlags?.length) drivers.push(`Pattern flags: ${patternFlags.join(', ')}`)

  const outflowCount = exchangeRows.filter((row) => row['direction'] === 'outflow').length
  const inflowCount = exchangeRows.filter((row) => row['direction'] === 'inflow').length
  if (outflowCount > 0) drivers.push(`Forward bounded search reached ${outflowCount} exchange path(s).`)
  if (inflowCount > 0) drivers.push(`Backward bounded search found ${inflowCount} source exchange path(s).`)

  return [...new Set(drivers)]
}

function terminalEdgeProperties(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
  return edgeProps[edgeProps.length - 1]
}

function enrichExchangeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const terminal = terminalEdgeProperties(row)
    if (!terminal) return row
    return {
      ...row,
      amount_sum: row['amount_sum'] ?? terminal['amount_sum'],
      amount_usd_sum: row['amount_usd_sum'] ?? terminal['amount_usd_sum'],
      tx_count: row['tx_count'] ?? terminal['tx_count'],
      first_tx_id: row['first_tx_id'] ?? terminal['first_tx_id'],
      last_tx_id: row['last_tx_id'] ?? terminal['last_tx_id'],
    }
  })
}

function riskAssessment(profile: Record<string, unknown>, exchangeRows: Array<Record<string, unknown>>): Record<string, unknown> {
  const storedScore = firstNumber(profile['confluence_score'], profile['ml_risk_score'], profile['risk_score'])
  const score = storedScore ?? (exchangeRows.length > 0 ? 0.4 : 0)
  const level = firstString(profile['ml_risk_level'], profile['risk_level']) ?? riskLevelFromScore(score)
  const drivers = riskDrivers(profile, exchangeRows)
  return {
    level,
    score,
    confidence: storedScore !== undefined || firstString(profile['ml_risk_level'], profile['risk_level']) ? 'high' : exchangeRows.length > 0 ? 'medium' : 'low',
    recommendation: riskRecommendation(level),
    drivers,
  }
}

function formatRiskScore(score: unknown): string {
  const parsed = numberValue(score)
  if (parsed === undefined) return String(score ?? 'unknown')
  return Number.isInteger(parsed) ? parsed.toString() : parsed.toFixed(2)
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return [value]
  return undefined
}

function restoreSystemLabels(graph: Record<string, unknown>, rawNodes: Array<Record<string, unknown>>): Record<string, unknown> {
  if (!Array.isArray(graph['nodes'])) return graph
  const labelsByAddress = new Map(rawNodes
    .map((node) => [typeof node['address'] === 'string' ? node['address'] : typeof node['id'] === 'string' ? node['id'] : '', stringArrayValue(node['system_labels'])] as const)
    .filter((entry): entry is readonly [string, string[]] => Boolean(entry[0]) && Array.isArray(entry[1]) && entry[1].length > 0))
  return {
    ...graph,
    nodes: graph['nodes'].map((node) => {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return node
      const record = node as Record<string, unknown>
      const address = typeof record['address'] === 'string' ? record['address'] : typeof record['id'] === 'string' ? record['id'] : ''
      const systemLabels = labelsByAddress.get(address)
      return systemLabels ? { ...record, system_labels: systemLabels } : record
    }),
  }
}

function buildRiskGraph(address: string, profile: Record<string, unknown>, rows: Array<Record<string, unknown>>, network: string): Record<string, unknown> {
  const nodes = new Map<string, Record<string, unknown>>()
  nodes.set(address, {
    id: address,
    address,
    node_type: 'address',
    labels: stringArrayValue(profile['display_labels']) ?? [],
    ...(stringArrayValue(profile['system_labels']) ? { system_labels: stringArrayValue(profile['system_labels']) } : {}),
    ...(typeof profile['address_type'] === 'string' ? { address_type: profile['address_type'] } : {}),
    ...(stringArrayValue(profile['address_subtypes']) ? { address_subtypes: stringArrayValue(profile['address_subtypes']) } : {}),
    roles: ['subject'],
  })
  const edges: Array<Record<string, unknown>> = []
  const mergeNode = (entry: string, metadata?: Record<string, unknown>) => {
    const existing = nodes.get(entry) ?? { id: entry, address: entry, node_type: 'address', labels: [] }
    const labels = stringArrayValue(metadata?.['labels']) ?? existing['labels']
    const systemLabels = stringArrayValue(metadata?.['system_labels']) ?? existing['system_labels']
    const addressType = typeof metadata?.['address_type'] === 'string' ? metadata['address_type'] : existing['address_type']
    const addressSubtypes = stringArrayValue(metadata?.['address_subtypes']) ?? existing['address_subtypes']
    nodes.set(entry, {
      ...existing,
      labels,
      ...(systemLabels ? { system_labels: systemLabels } : {}),
      ...(addressType ? { address_type: addressType } : {}),
      ...(addressSubtypes ? { address_subtypes: addressSubtypes } : {}),
    })
  }
  for (const row of rows) {
    const rawPath = Array.isArray(row['path']) ? row['path'] : row['addresses']
    const path = Array.isArray(rawPath) ? rawPath.map(String) : []
    const pathNodes = Array.isArray(row['path_nodes']) ? row['path_nodes'] as Array<Record<string, unknown>> : []
    for (let index = 0; index < path.length; index += 1) {
      const entry = path[index]!
      mergeNode(entry, pathNodes[index])
    }
    const exchange = typeof row['exchange_address'] === 'string' ? row['exchange_address'] : ''
    if (exchange) {
      const displayLabels = stringArrayValue(row['exchange_display_labels']) ?? []
      const systemLabels = stringArrayValue(row['exchange_system_labels']) ?? stringArrayValue(row['exchange_labels']) ?? []
      nodes.set(exchange, {
        id: exchange,
        address: exchange,
        node_type: 'address',
        labels: displayLabels,
        ...(systemLabels.length > 0 ? { system_labels: systemLabels } : {}),
        ...(typeof row['exchange_address_type'] === 'string' ? { address_type: row['exchange_address_type'] } : {}),
        ...(stringArrayValue(row['exchange_address_subtypes']) ? { address_subtypes: stringArrayValue(row['exchange_address_subtypes']) } : {}),
        roles: ['exchange'],
      })
    }
    for (let index = 0; index < path.length - 1; index += 1) {
      const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
      const edge = edgeProps[index] ?? row
      edges.push({
        source: path[index],
        target: path[index + 1],
        edge_type: 'flows_to',
        usd_amount: edge['amount_usd_sum'] ?? edge['amount_sum'] ?? 0,
        amount_sum: edge['amount_sum'] ?? 0,
        tx_count: edge['tx_count'] ?? 0,
        first_tx_id: edge['first_tx_id'],
        last_tx_id: edge['last_tx_id'],
        direction: row['direction'],
      })
    }
  }
  const rawNodes = [...nodes.values()]
  return restoreSystemLabels(normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: rawNodes,
    edges,
    flows: [],
    edge_anchors: [],
    metadata: { address, network, generated_at: new Date().toISOString() },
  }), rawNodes)
}

export async function addressRisk(remoteClient: Client, options: AddressRiskOptions): Promise<{
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}> {
  const address = options.address.trim()
  const network = options.network.trim()
  const compareAddress = options.compareAddress?.trim() ?? ''
  if (!address) throw new Error('address is required')
  if (!network) throw new Error('network is required')

  const queries = [
    addressProfileQuery(address),
    addressFeatureQuery(address),
    addressRiskScoreQuery(address),
    ...exchangeOutflowQueries(address),
    ...exchangeInflowQueries(address),
    ...(compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{ id: 'connection_probe', query: 'MATCH (n:Address {address: "__chain_insights_noop__"}) RETURN n.address AS noop LIMIT 0' }]),
  ]
  const batch = await callGraphBatch(remoteClient, network, queries)
  const profile: Record<string, unknown> = {
    address,
    ...(resultsFor(batch, 'address_profile')[0] ?? {}),
    ...(resultsFor(batch, 'address_feature')[0] ?? {}),
    ...(resultsFor(batch, 'address_risk_score')[0] ?? {}),
  }
  const outflows = enrichExchangeRows(resultsWithPrefix(batch, 'exchange_outflows_'))
  const inflows = enrichExchangeRows(resultsWithPrefix(batch, 'exchange_inflows_'))
  const connections = compareAddress ? resultsFor(batch, 'connection_probe') : []
  const exchangeRows = [...outflows, ...inflows]
  const graphData = buildRiskGraph(address, profile, exchangeRows, network)
  const risk = riskAssessment(profile, exchangeRows)

  const lines = [
    `Address risk for ${network}:${address}`,
    '',
    `Risk: ${risk['level']} (${formatRiskScore(risk['score'])})`,
    `Confidence: ${risk['confidence']}`,
    `Recommendation: ${risk['recommendation']}`,
    `Graph degree: in ${profile['degree_in'] ?? 'unknown'}, out ${profile['degree_out'] ?? 'unknown'}.`,
    '',
    'Exchange behavior',
    exchangeRows.length > 0 ? formatExchangeRows(exchangeRows).join('\n') : '- No exchange inflow/outflow paths found in bounded search.',
  ]
  if (Array.isArray(risk['drivers']) && risk['drivers'].length > 0) {
    lines.push('', 'Risk drivers', risk['drivers'].map((driver) => `- ${driver}`).join('\n'))
  }
  if (compareAddress) {
    lines.push('', `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : 'Connection paths found: 0')
  }

  return {
    summaryText: lines.join('\n'),
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'address_risk',
      facts: {
        subject: { network, addresses: compareAddress ? [address, compareAddress] : [address] },
        risk,
        exchange_behavior: {
          outflows,
          inflows,
        },
        connection: compareAddress ? { compare_address: compareAddress, paths: connections } : undefined,
      },
    },
    graphData,
  }
}

export async function trackFunds(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TrackFundsOptions,
): Promise<{
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}> {
  const network = options.network.trim()
  const trusted = parseAddressList(options.trustedAddresses)
  const untrusted = parseAddressList(options.untrustedAddresses)
  if (!network) throw new Error('network is required')
  if (trusted.length < 1) throw new Error('trusted_addresses must contain at least 1 address')
  if (trusted.length > 5) throw new Error('trusted_addresses cannot exceed 5 addresses')
  if (untrusted.length > 5) throw new Error('untrusted_addresses cannot exceed 5 addresses')
  const overlap = trusted.filter((address) => untrusted.includes(address))
  if (overlap.length > 0) throw new Error(`Address(es) appear in both trusted and untrusted lists: ${overlap.join(', ')}`)

  const runs: Array<{ role: 'trusted' | 'untrusted'; address: string; result: TraceFundsResult }> = []
  for (const address of trusted) {
    runs.push({
      role: 'trusted',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
      }),
    })
  }
  for (const address of untrusted) {
    runs.push({
      role: 'untrusted',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
      }),
    })
  }

  const graphData = normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: runs.flatMap((run) => Array.isArray(run.result.graphData.nodes) ? run.result.graphData.nodes : []),
    edges: runs.flatMap((run) => Array.isArray(run.result.graphData.edges) ? run.result.graphData.edges : []),
    flows: runs.flatMap((run) => Array.isArray(run.result.graphData.flows) ? run.result.graphData.flows : []),
    deposits: runs.flatMap((run) => graphArray(run.result.graphData, 'deposits').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    source_matches: runs.flatMap((run) => graphArray(run.result.graphData, 'source_matches').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    reverse_leads: runs.flatMap((run) => graphArray(run.result.graphData, 'reverse_leads').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    edge_anchors: [],
    metadata: { network, trusted_addresses: trusted, untrusted_addresses: untrusted, generated_at: new Date().toISOString() },
  })

  return {
    summaryText: [
      `Track funds complete for ${network}`,
      '',
      `Trusted addresses: ${trusted.join(', ')}`,
      `Untrusted addresses: ${untrusted.join(', ') || 'none'}`,
      '',
      ...runs.map((run) => `## ${run.role}: ${run.address}\n${run.result.summaryText}`),
    ].join('\n'),
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'track_funds',
      facts: {
        network,
        trusted_addresses: trusted,
        untrusted_addresses: untrusted,
        runs: runs.map((run) => ({
          role: run.role,
          address: run.address,
          files: run.result.files,
          continuation: run.result.continuation,
          address_map: run.result.addressMap,
        })),
      },
    },
    graphData,
  }
}
