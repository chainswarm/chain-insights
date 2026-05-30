import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { runFundFlowProbe, type TraceFundsResult } from './trace-funds.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

export { scamTopology, type ScamTopologyOptions, type ScamTopologyResult } from './scam-topology.js'
export { stakeInsights, type StakeInsightsOptions, type StakeInsightsResult } from './stake-insights.js'

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

type QueryFailure = {
  id: string
  error: string
}

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 120
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

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

function collectQueryFailure(failures: QueryFailure[], id: string, error: string | undefined): void {
  failures.push({ id, error: error || 'unknown error' })
}

function optionalResultsFor(batch: ParsedGraphBatch, id: string, failures: QueryFailure[]): Array<Record<string, unknown>> {
  const query = batch.facts?.queries?.find((entry) => entry.id === id)
  if (!query) return []
  if (query.ok === false) {
    collectQueryFailure(failures, id, query.error)
    return []
  }
  return query.results ?? []
}

function optionalResultsWithPrefix(batch: ParsedGraphBatch, prefix: string, failures: QueryFailure[]): Array<Record<string, unknown>> {
  return (batch.facts?.queries ?? [])
    .filter((entry) => entry.id?.startsWith(prefix))
    .flatMap((entry) => {
      if (entry.ok === false) {
        collectQueryFailure(failures, entry.id ?? prefix, entry.error)
        return []
      }
      return entry.results ?? []
    })
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
  const partialQueryFailures: QueryFailure[] = []
  const profile: Record<string, unknown> = {
    address,
    ...(optionalResultsFor(batch, 'address_profile', partialQueryFailures)[0] ?? {}),
    ...(optionalResultsFor(batch, 'address_feature', partialQueryFailures)[0] ?? {}),
    ...(optionalResultsFor(batch, 'address_risk_score', partialQueryFailures)[0] ?? {}),
  }
  const outflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_outflows_', partialQueryFailures))
  const inflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_inflows_', partialQueryFailures))
  const connections = compareAddress ? optionalResultsFor(batch, 'connection_probe', partialQueryFailures) : []
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
  if (partialQueryFailures.length > 0) {
    lines.push('', 'Partial query failures', partialQueryFailures.map((failure) => `- ${failure.id}: ${failure.error}`).join('\n'))
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
        partial_query_errors: partialQueryFailures.length > 0 ? partialQueryFailures : undefined,
      },
    },
    graphData,
  }
}

type TraceSeedRole = 'victim' | 'suspect' | 'deposit'
type TraceToolName = 'trace_victim_funds' | 'trace_suspect_funds' | 'trace_deposit_sources'
type TraceRole =
  | 'seed_victim'
  | 'seed_suspect'
  | 'seed_deposit'
  | 'candidate_victim'
  | 'candidate_suspect'
  | 'candidate_intermediate'
  | 'candidate_deposit'
  | 'exchange'
  | 'unknown'

export interface TraceVictimFundsOptions {
  victimAddresses: string | string[]
  knownSuspectAddresses?: string | string[]
  network: string
  caseId?: string
  incidentTimestampMs?: number
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
}

export interface TraceSuspectFundsOptions {
  suspectAddresses: string | string[]
  network: string
  caseId?: string
  incidentTimestampMs?: number
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
}

export interface TraceDepositSourcesOptions {
  depositAddresses: string | string[]
  network: string
  caseId?: string
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
}

type TraceToolResult = {
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}

type TraceRunRole = 'victim' | 'suspect'
type TraceRun = { role: TraceRunRole; address: string; result: TraceFundsResult }
type TraceAddressAccumulator = {
  address: string
  roles: Set<TraceRole>
  labels: string[]
  is_exchange?: boolean
  confidence: 'low' | 'medium' | 'high'
  rationale: string[]
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function graphRecords(graphData: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = graphData[key]
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

function normalizeTraceGraphData(runs: TraceRun[], network: string): Record<string, unknown> {
  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: runs.flatMap((run) => graphRecords(run.result.graphData, 'nodes')),
    edges: runs.flatMap((run) => graphRecords(run.result.graphData, 'edges')),
    flows: runs.flatMap((run) => graphRecords(run.result.graphData, 'flows')),
    deposits: runs.flatMap((run) => graphRecords(run.result.graphData, 'deposits').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    source_matches: runs.flatMap((run) => graphRecords(run.result.graphData, 'source_matches').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    reverse_leads: runs.flatMap((run) => graphRecords(run.result.graphData, 'reverse_leads').map((item) => ({ ...item, run_role: run.role, run_address: run.address }))),
    edge_anchors: [],
    metadata: {
      network,
      generated_at: new Date().toISOString(),
      trace_tools: true,
    },
  })
}

function traceArtifactPointersFromRun(run: TraceFundsResult | undefined): Record<string, unknown> {
  if (!run) return {}
  return {
    graph_json: run.files.graph,
    graph_html: run.files.graphHtml,
    table_json: run.files.compactEvidence,
    flows_csv: run.files.table,
    table_html: run.files.tableHtml,
    report_md: run.files.report,
  }
}

function artifactEvidence(artifacts: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.entries(artifacts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([kind, filePath]) => ({
      evidence_type: 'artifact_pointer',
      path: filePath,
      summary: `${kind} artifact`,
    }))
}

function traceAddressRoleForSeed(seedRole: TraceSeedRole): TraceRole {
  if (seedRole === 'victim') return 'seed_victim'
  if (seedRole === 'suspect') return 'seed_suspect'
  return 'seed_deposit'
}

function addTraceAddress(
  addresses: Map<string, TraceAddressAccumulator>,
  address: string,
  role: TraceRole,
  rationale: string,
  labels: string[] = [],
): void {
  if (!address) return
  const existing = addresses.get(address)
  if (existing) {
    existing.roles.add(role)
    existing.labels = uniqueStrings([...existing.labels, ...labels])
    if (role === 'exchange') existing.is_exchange = true
    if (!existing.rationale.includes(rationale)) existing.rationale.push(rationale)
    return
  }
  addresses.set(address, {
    address,
    roles: new Set([role]),
    labels,
    is_exchange: role === 'exchange' ? true : undefined,
    confidence: role.startsWith('seed_') || role === 'exchange' ? 'high' : 'medium',
    rationale: [rationale],
  })
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`
}

function traceResultFromFundRuns(
  tool: Extract<TraceToolName, 'trace_victim_funds' | 'trace_suspect_funds'>,
  seedRole: Extract<TraceSeedRole, 'victim' | 'suspect'>,
  network: string,
  runs: TraceRun[],
  options: {
    incidentTimestampMs?: number
    timeRange?: { from_ms?: number; to_ms?: number }
    maxHops?: number
    caseId?: string
  } = {},
): { summaryText: string; structuredContent: Record<string, unknown>; graphData: Record<string, unknown> } {
  const graphData = normalizeTraceGraphData(runs, network)
  const flows = graphRecords(graphData, 'flows')
  const deposits = graphRecords(graphData, 'deposits')
  const addresses = new Map<string, TraceAddressAccumulator>()
  for (const run of runs) {
    addTraceAddress(addresses, run.address, traceAddressRoleForSeed(seedRole), `${seedRole} seed provided by caller`)
  }

  const edgeIdsByPair = new Map<string, string>()
  const edges = flows.map((flow, index) => {
    const src = typeof flow['src'] === 'string' ? flow['src'] : ''
    const dst = typeof flow['dst'] === 'string' ? flow['dst'] : ''
    const edgeId = `e${index + 1}`
    edgeIdsByPair.set(edgeKey(src, dst), edgeId)
    const terminalExchange = flow['terminal_exchange'] === true
    addTraceAddress(addresses, src, runs.some((run) => run.address === src) ? traceAddressRoleForSeed(seedRole) : 'candidate_intermediate', 'Address appears in traced FLOWS_TO path')
    addTraceAddress(addresses, dst, terminalExchange ? 'exchange' : 'candidate_intermediate', terminalExchange ? 'Terminal exchange endpoint reached' : 'Address appears in traced FLOWS_TO path')
    return {
      edge_id: edgeId,
      from_address: src,
      to_address: dst,
      edge_type: 'FLOWS_TO',
      amount_sum: numberValue(flow['amount_sum']),
      amount_usd_sum: numberValue(flow['amount_usd_sum']),
      tx_count: numberValue(flow['tx_count']),
      first_tx_id: typeof flow['first_tx_id'] === 'string' ? flow['first_tx_id'] : undefined,
      last_tx_id: typeof flow['last_tx_id'] === 'string' ? flow['last_tx_id'] : undefined,
    }
  }).filter((edge) => edge.from_address && edge.to_address)

  const paths = deposits.map((deposit, index) => {
    const depositAddress = typeof deposit['address'] === 'string'
      ? deposit['address']
      : typeof deposit['deposit_address'] === 'string' ? deposit['deposit_address'] : ''
    const exchangeAddress = typeof deposit['exchangeAddress'] === 'string'
      ? deposit['exchangeAddress']
      : typeof deposit['exchange_address'] === 'string' ? deposit['exchange_address'] : ''
    const pathAddresses = stringArrayValue(deposit['path']) ?? [
      typeof deposit['run_address'] === 'string' ? deposit['run_address'] : runs[0]?.address ?? '',
      depositAddress,
      exchangeAddress,
    ].filter(Boolean)
    addTraceAddress(addresses, depositAddress, 'candidate_deposit', 'Penultimate address before an exchange endpoint')
    if (exchangeAddress) addTraceAddress(addresses, exchangeAddress, 'exchange', 'Exchange endpoint reached')
    const edgeIds: string[] = []
    for (let offset = 0; offset < pathAddresses.length - 1; offset += 1) {
      const id = edgeIdsByPair.get(edgeKey(pathAddresses[offset]!, pathAddresses[offset + 1]!))
      if (id) edgeIds.push(id)
    }
    return {
      path_id: `p${index + 1}`,
      direction: 'forward',
      source: pathAddresses[0] ?? '',
      target: exchangeAddress || depositAddress,
      addresses: pathAddresses,
      edge_ids: edgeIds,
      hops: numberValue(deposit['hops']) ?? Math.max(pathAddresses.length - 1, 0),
      terminal_role: exchangeAddress ? 'exchange' : 'deposit',
      amount_sum: numberValue(deposit['amount_sum']),
      amount_usd_sum: numberValue(deposit['amount_usd_sum']),
    }
  })

  const depositAddresses = uniqueStrings(deposits.map((deposit) => (
    typeof deposit['address'] === 'string' ? deposit['address'] : typeof deposit['deposit_address'] === 'string' ? deposit['deposit_address'] : undefined
  )))
  const exchangeAddresses = uniqueStrings(deposits.map((deposit) => (
    typeof deposit['exchangeAddress'] === 'string' ? deposit['exchangeAddress'] : typeof deposit['exchange_address'] === 'string' ? deposit['exchange_address'] : undefined
  )))
  const convergence = [...new Map(depositAddresses.map((address) => {
    const pathIds = paths.filter((path) => path.addresses.includes(address)).map((path) => path.path_id)
    return [address, {
      address,
      role: 'candidate_deposit',
      path_ids: pathIds,
      reason: pathIds.length > 1 ? 'Multiple traced paths converge into this deposit candidate.' : 'Single traced path reached this deposit candidate.',
    }]
  })).values()].filter((entry) => entry.path_ids.length > 1)
  const candidateLabels = depositAddresses.map((address) => ({
    address,
    candidate_label: 'candidate_deposit',
    confidence: 'medium',
    evidence_path_ids: paths.filter((path) => path.addresses.includes(address)).map((path) => path.path_id),
    reason: 'Penultimate address before an exchange endpoint in bounded FLOWS_TO trace.',
    promote_to_core_label: false,
  }))
  const runArtifacts = runs.map((run, index) => ({
    run_id: `run_${index + 1}`,
    role: run.role,
    address: run.address,
    ...traceArtifactPointersFromRun(run.result),
  }))
  const artifacts = {
    ...traceArtifactPointersFromRun(runs[0]?.result),
    runs: runArtifacts,
  }
  const artifactEvidenceEntries = runs.flatMap((run) => artifactEvidence(traceArtifactPointersFromRun(run.result))
    .map((entry) => ({ ...entry, run_role: run.role, address: run.address })))
  const recommendedNextTools = depositAddresses.length > 0
    ? ['trace_deposit_sources', 'address_risk']
    : ['address_risk', 'graph_query_batch']

  const structuredContent = {
    schema: 'chain-insights.trace.v1',
    tool,
    network,
    input: {
      addresses: runs.map((run) => run.address),
      seed_role: seedRole,
      ...(options.incidentTimestampMs !== undefined ? { incident_timestamp_ms: options.incidentTimestampMs } : {}),
      ...(options.timeRange ? { time_range: options.timeRange } : {}),
      max_hops: options.maxHops ?? 3,
    },
    summary: {
      seed_count: runs.length,
      path_count: paths.length,
      edge_count: edges.length,
      candidate_suspect_count: seedRole === 'suspect' ? runs.length : 0,
      candidate_intermediate_count: [...addresses.values()].filter((entry) => entry.roles.has('candidate_intermediate')).length,
      candidate_deposit_count: depositAddresses.length,
      exchange_count: exchangeAddresses.length,
    },
    addresses: [...addresses.values()].map((entry) => ({
      address: entry.address,
      roles: [...entry.roles],
      ...(entry.labels.length > 0 ? { labels: entry.labels } : {}),
      ...(entry.is_exchange !== undefined ? { is_exchange: entry.is_exchange } : {}),
      confidence: entry.confidence,
      rationale: entry.rationale,
    })),
    edges,
    paths,
    convergence,
    exchange_exposure: deposits.map((deposit) => ({
      deposit_address: typeof deposit['address'] === 'string' ? deposit['address'] : deposit['deposit_address'],
      exchange_address: typeof deposit['exchangeAddress'] === 'string' ? deposit['exchangeAddress'] : deposit['exchange_address'],
      path_ids: paths.filter((path) => path.addresses.includes(String(deposit['address'] ?? deposit['deposit_address'] ?? ''))).map((path) => path.path_id),
    })),
    candidate_labels: candidateLabels,
    artifacts,
    evidence: [
      ...artifactEvidenceEntries,
      ...(options.caseId ? [{ evidence_type: 'case_pointer', summary: `case_id=${options.caseId}` }] : []),
    ],
    continuation: {
      candidate_deposit_addresses: depositAddresses,
      candidate_suspect_addresses: seedRole === 'suspect' ? runs.map((run) => run.address) : [],
      candidate_victim_addresses: [],
      recommended_next_tools: recommendedNextTools,
    },
    warnings: depositAddresses.length === 0 ? ['No exchange deposit candidates were connected in the queried topology.'] : [],
  }

  return {
    summaryText: [
      `${seedRole === 'victim' ? 'Trace victim funds' : 'Trace suspect funds'} complete for ${network}`,
      '',
      ...runs.map((run) => `## ${run.role}: ${run.address}\n${run.result.summaryText}`),
    ].join('\n'),
    structuredContent,
    graphData,
  }
}

export async function traceVictimFunds(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceVictimFundsOptions,
): Promise<TraceToolResult> {
  const network = options.network.trim()
  const victims = parseAddressList(options.victimAddresses)
  const knownSuspects = parseAddressList(options.knownSuspectAddresses)
  if (!network) throw new Error('network is required')
  if (victims.length < 1) throw new Error('victim_addresses must contain at least 1 address')
  if (victims.length > 5) throw new Error('victim_addresses cannot exceed 5 addresses')
  if (knownSuspects.length > 5) throw new Error('known_suspect_addresses cannot exceed 5 addresses')

  const runs: TraceRun[] = []
  for (const address of victims) {
    runs.push({
      role: 'victim',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
        includeDepositTraceback: false,
        evidenceSource: 'trace_victim_funds',
      }),
    })
  }
  return traceResultFromFundRuns('trace_victim_funds', 'victim', network, runs, {
    incidentTimestampMs: options.incidentTimestampMs,
    timeRange: options.timeRange,
    maxHops: options.maxHops,
    caseId: options.caseId,
  })
}

export async function traceSuspectFunds(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceSuspectFundsOptions,
): Promise<TraceToolResult> {
  const network = options.network.trim()
  const suspects = parseAddressList(options.suspectAddresses)
  if (!network) throw new Error('network is required')
  if (suspects.length < 1) throw new Error('suspect_addresses must contain at least 1 address')
  if (suspects.length > 5) throw new Error('suspect_addresses cannot exceed 5 addresses')

  const runs: TraceRun[] = []
  for (const address of suspects) {
    runs.push({
      role: 'suspect',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
        includeDepositTraceback: false,
        evidenceSource: 'trace_suspect_funds',
      }),
    })
  }
  return traceResultFromFundRuns('trace_suspect_funds', 'suspect', network, runs, {
    incidentTimestampMs: options.incidentTimestampMs,
    timeRange: options.timeRange,
    maxHops: options.maxHops,
    caseId: options.caseId,
  })
}

function reverseDepositSourceQueryAtDepth(depositAddresses: string[], depth: number): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['source', ...intermediateVariables, 'deposit']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'deposit' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Address)`
  }).join('')
  const depositPredicates = depositAddresses.map((address) => `deposit.address = "${escapeCypherString(address)}"`)
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  return {
    id: `reverse_deposit_sources_${depth}`,
    query: [
      `MATCH (source:Address)${relationshipChain}`,
      `WHERE (${depositPredicates.join(' OR ')}) AND source.address <> deposit.address${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN DISTINCT source.address AS source_address, deposit.address AS deposit_address, ${depth} AS hop, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      'LIMIT 500',
    ].join(' '),
  }
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildTraceSourceTableHtml(tool: TraceToolName, network: string, rows: Array<Record<string, unknown>>): string {
  const headers = ['path_id', 'source_address', 'deposit_address', 'hop', 'amount_sum', 'first_tx_id'] as const
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${htmlEscape(row[header])}</td>`).join('')}</tr>`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Table</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  .meta { display: grid; gap: 6px; margin: 0 0 20px; color: rgba(244,242,234,.72); font-size: 13px; }
  .table-wrap { overflow: auto; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #10131b; }
  table { border-collapse: collapse; width: 100%; min-width: 980px; font-size: 12px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; z-index: 1; }
  td { color: rgba(244,242,234,.86); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  tr:hover td { background: rgba(242,221,166,.045); }
</style>
</head>
<body>
<main>
  <h1>${htmlEscape(tool)} Table</h1>
  <div class="meta">
    <div>Network: <strong>${htmlEscape(network)}</strong></div>
    <div>Generated: <strong>${htmlEscape(new Date().toISOString())}</strong></div>
    <div>Rows: <strong>${rows.length}</strong></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>
`
}

async function writeTraceSourceArtifacts(tool: TraceToolName, network: string, graphData: Record<string, unknown>, rows: Array<Record<string, unknown>>, summaryText: string): Promise<Record<string, unknown>> {
  const paths = workspaceOutputPaths()
  await Promise.all([
    mkdir(paths.reportsRoot, { recursive: true }),
    mkdir(paths.reportGraphsRoot, { recursive: true }),
    mkdir(paths.reportTablesRoot, { recursive: true }),
  ])
  const slug = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_${tool}`
  const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`)
  const tableJsonPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`)
  const csvPath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`)
  const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`)
  const reportPath = path.join(paths.reportsRoot, `${slug}.trace-report.md`)
  const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`)
  const { generateInlineGraphHtml } = await import('../viz/html-generator.js')
  const csv = [
    'path_id,source_address,deposit_address,hop,amount_sum,first_tx_id',
    ...rows.map((row) => [
      row['path_id'] ?? '',
      row['source_address'] ?? '',
      row['deposit_address'] ?? '',
      row['hop'] ?? '',
      row['amount_sum'] ?? '',
      row['first_tx_id'] ?? '',
    ].map((value) => JSON.stringify(String(value))).join(',')),
  ].join('\n') + '\n'
  await writeFile(graphPath, JSON.stringify(graphData, null, 2) + '\n', { mode: 0o600 })
  await writeFile(tableJsonPath, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 })
  await writeFile(csvPath, csv, { mode: 0o600 })
  await writeFile(tableHtmlPath, buildTraceSourceTableHtml(tool, network, rows), { mode: 0o600 })
  await writeFile(reportPath, summaryText + '\n', { mode: 0o600 })
  await writeFile(graphHtmlPath, generateInlineGraphHtml(graphData), { mode: 0o600 })
  return {
    graph_json: graphPath,
    graph_html: graphHtmlPath,
    table_json: tableJsonPath,
    flows_csv: csvPath,
    table_html: tableHtmlPath,
    report_md: reportPath,
  }
}

export async function traceDepositSources(
  remoteClient: Client,
  _config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceDepositSourcesOptions,
): Promise<TraceToolResult> {
  const network = options.network.trim()
  const deposits = parseAddressList(options.depositAddresses)
  if (!network) throw new Error('network is required')
  if (deposits.length < 1) throw new Error('deposit_addresses must contain at least 1 address')
  if (deposits.length > 5) throw new Error('deposit_addresses cannot exceed 5 addresses')
  const maxHops = clampInt(options.maxHops, 2, 1, 5)

  const batch = await callGraphBatch(
    remoteClient,
    network,
    Array.from({ length: maxHops }, (_, index) => reverseDepositSourceQueryAtDepth(deposits, index + 1)),
  )
  const failures: QueryFailure[] = []
  const rows: Array<Record<string, unknown>> = optionalResultsWithPrefix(batch, 'reverse_deposit_sources_', failures).map((row, index) => ({
    ...row,
    path_id: `p${index + 1}`,
  }))
  const addresses = new Map<string, {
    address: string
    roles: Set<TraceRole>
    labels: string[]
    is_exchange?: boolean
    confidence: 'low' | 'medium' | 'high'
    rationale: string[]
  }>()
  for (const deposit of deposits) addTraceAddress(addresses, deposit, 'seed_deposit', 'Deposit/cashout seed provided by caller')

  const edges: Array<Record<string, unknown>> = []
  const paths: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const sourceAddress = typeof row['source_address'] === 'string' ? row['source_address'] : ''
    const depositAddress = typeof row['deposit_address'] === 'string' ? row['deposit_address'] : ''
    const pathAddresses = stringArrayValue(row['addresses']) ?? [sourceAddress, depositAddress].filter(Boolean)
    addTraceAddress(addresses, sourceAddress, 'candidate_suspect', 'Upstream address funds a suspected deposit/cashout seed')
    addTraceAddress(addresses, depositAddress, 'seed_deposit', 'Deposit/cashout seed provided by caller')
    const edgeProps = Array.isArray(row['edge_props']) ? row['edge_props'] as Array<Record<string, unknown>> : []
    const edgeIds: string[] = []
    for (let index = 0; index < pathAddresses.length - 1; index += 1) {
      const props = edgeProps[index] ?? {}
      const edgeId = `e${edges.length + 1}`
      edgeIds.push(edgeId)
      edges.push({
        edge_id: edgeId,
        from_address: pathAddresses[index],
        to_address: pathAddresses[index + 1],
        edge_type: 'FLOWS_TO',
        amount_sum: numberValue(props['amount_sum']) ?? numberValue(row['amount_sum']),
        amount_usd_sum: numberValue(props['amount_usd_sum']) ?? numberValue(row['amount_usd_sum']),
        tx_count: numberValue(props['tx_count']) ?? numberValue(row['tx_count']),
        first_seen_timestamp: numberValue(props['first_seen_timestamp']) ?? numberValue(row['first_seen_timestamp']),
        last_seen_timestamp: numberValue(props['last_seen_timestamp']) ?? numberValue(row['last_seen_timestamp']),
        first_tx_id: typeof props['first_tx_id'] === 'string' ? props['first_tx_id'] : typeof row['first_tx_id'] === 'string' ? row['first_tx_id'] : undefined,
        last_tx_id: typeof props['last_tx_id'] === 'string' ? props['last_tx_id'] : typeof row['last_tx_id'] === 'string' ? row['last_tx_id'] : undefined,
      })
    }
    paths.push({
      path_id: row['path_id'],
      direction: 'reverse',
      source: depositAddress,
      target: sourceAddress,
      addresses: [...pathAddresses].reverse(),
      edge_ids: [...edgeIds].reverse(),
      hops: numberValue(row['hop']) ?? Math.max(pathAddresses.length - 1, 0),
      terminal_role: 'source',
      amount_sum: numberValue(row['amount_sum']),
      amount_usd_sum: numberValue(row['amount_usd_sum']),
      first_seen_ms: numberValue(row['first_seen_timestamp']),
      last_seen_ms: numberValue(row['last_seen_timestamp']),
    })
  }

  const sourceToPathIds = new Map<string, string[]>()
  const sourceToDeposits = new Map<string, Set<string>>()
  for (const row of rows) {
    const source = typeof row['source_address'] === 'string' ? row['source_address'] : ''
    const deposit = typeof row['deposit_address'] === 'string' ? row['deposit_address'] : ''
    if (!source) continue
    sourceToPathIds.set(source, [...(sourceToPathIds.get(source) ?? []), String(row['path_id'])])
    if (!sourceToDeposits.has(source)) sourceToDeposits.set(source, new Set())
    if (deposit) sourceToDeposits.get(source)!.add(deposit)
  }
  const convergence = [...sourceToPathIds.entries()]
    .filter(([address]) => (sourceToDeposits.get(address)?.size ?? 0) > 1)
    .map(([address, pathIds]) => ({
      address,
      role: 'candidate_suspect',
      path_ids: pathIds,
      reason: 'Same upstream source funds multiple provided deposit/cashout seeds.',
    }))
  const candidateSuspects = convergence.map((entry) => entry.address)
  const candidateLabels = [...sourceToPathIds.keys()].map((address) => ({
    address,
    candidate_label: 'candidate_suspect',
    confidence: candidateSuspects.includes(address) ? 'high' : 'medium',
    evidence_path_ids: sourceToPathIds.get(address) ?? [],
    reason: candidateSuspects.includes(address)
      ? 'Upstream source converges into multiple provided deposit/cashout seeds.'
      : 'Upstream source funds a provided deposit/cashout seed.',
    promote_to_core_label: false,
  }))
  const graphData = normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...addresses.values()].map((entry) => ({
      id: entry.address,
      address: entry.address,
      node_type: 'address',
      roles: [...entry.roles],
      labels: entry.labels,
    })),
    edges: edges.map((edge) => ({
      source: edge['from_address'],
      target: edge['to_address'],
      edge_type: 'flows_to',
      amount_sum: edge['amount_sum'],
      tx_count: edge['tx_count'],
      first_tx_id: edge['first_tx_id'],
      last_tx_id: edge['last_tx_id'],
      direction: 'traceback',
    })),
    flows: edges.map((edge, index) => ({
      hop: index + 1,
      src: edge['from_address'],
      dst: edge['to_address'],
      amount_sum: edge['amount_sum'] ?? 0,
      terminal_exchange: false,
    })),
    edge_anchors: [],
    metadata: {
      network,
      deposit_addresses: deposits,
      generated_at: new Date().toISOString(),
    },
  })
  const summaryText = [
    `Trace deposit sources complete for ${network}`,
    '',
    `Deposit seeds: ${deposits.join(', ')}`,
    `Reverse path(s): ${paths.length}`,
    `Shared upstream convergence: ${convergence.length}`,
  ].join('\n')
  const artifacts = await writeTraceSourceArtifacts('trace_deposit_sources', network, graphData, rows, summaryText)
  const evidence = artifactEvidence(artifacts)
  if (options.caseId) {
    const { EvidenceStore } = await import('../cases/index.js')
    await EvidenceStore.append(options.caseId, {
      source: 'trace_deposit_sources',
      queryParams: `network=${network} deposit_addresses=${deposits.join(',')} max_hops=${maxHops}`,
      content: JSON.stringify({
        schema: 'chain-insights.evidence_pointer.v1',
        source: 'trace_deposit_sources',
        network,
        deposit_addresses: deposits,
        files: artifacts,
        compact_sha256: createHash('sha256').update(JSON.stringify({ rows, convergence })).digest('hex'),
      }, null, 2),
    })
    evidence.push({ evidence_type: 'case_pointer', summary: `case_id=${options.caseId}` })
  }

  return {
    summaryText,
    structuredContent: {
      schema: 'chain-insights.trace.v1',
      tool: 'trace_deposit_sources',
      network,
      input: {
        addresses: deposits,
        seed_role: 'deposit',
        ...(options.timeRange ? { time_range: options.timeRange } : {}),
        max_hops: maxHops,
      },
      summary: {
        seed_count: deposits.length,
        path_count: paths.length,
        edge_count: edges.length,
        candidate_suspect_count: sourceToPathIds.size,
        candidate_intermediate_count: 0,
        candidate_deposit_count: deposits.length,
        exchange_count: 0,
      },
      addresses: [...addresses.values()].map((entry) => ({
        address: entry.address,
        roles: [...entry.roles],
        confidence: entry.confidence,
        rationale: entry.rationale,
      })),
      edges,
      paths,
      convergence,
      exchange_exposure: [],
      candidate_labels: candidateLabels,
      artifacts,
      evidence: [
        ...evidence,
        ...(failures.length > 0 ? [{ evidence_type: 'query_summary', summary: `partial query failures: ${failures.length}` }] : []),
      ],
      continuation: {
        candidate_deposit_addresses: deposits,
        candidate_suspect_addresses: candidateSuspects,
        candidate_victim_addresses: [],
        recommended_next_tools: candidateSuspects.length > 0
          ? ['trace_suspect_funds', 'address_risk']
          : ['address_risk', 'graph_query_batch'],
      },
      warnings: paths.length === 0 ? ['No upstream sources were connected in the queried topology.'] : [],
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
