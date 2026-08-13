import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { applyShardMergeToBatchEntries } from '../federation/apply-merge.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { isUnscoredRiskLevel, normalizeRiskLevel, riskSeverityRank } from './risk-level.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'
import { createUsageAccumulator, usageBlock, wrapClientForUsageTracking, type UsageTotals } from '../lib/usage-accumulator.js'

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
      perShard?: Record<string, Array<Record<string, unknown>>>
      ordering?: 'exact' | 'approximate' | 'unordered'
    }>
  }
}

type QueryFailure = {
  id: string
  error: string
}

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export interface AddressRiskOptions {
  address: string
  network: string
  compareAddress?: string
  writeArtifacts?: boolean
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
  return `USE topology ${trimmed}`
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
  const parsed = parseGraphBatchResult(result)
  applyShardMergeToBatchEntries(parsed.facts?.queries, queries)
  return parsed
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
  // risk_score/risk_level are always projected: topology is now the only ML
  // risk source (the retired facts_risk_scores_view never had a risk_level
  // column, so UNSCORED abstention was invisible until this move).
  const riskFields = ', a.risk_score AS live_risk_score, a.risk_level AS live_risk_level'
  // label_risk is the per-label risk overlay graphsync now materializes
  // directly on the node (P2b′): a list of {label, risk_level,
  // updated_timestamp} maps, one per current label row. Missing/empty is "no
  // label-risk signal," never an error -- the retired facts_address_labels_view
  // read is gone; this replaces it entirely.
  const labelRiskField = ', a.label_risk AS label_risk'
  return {
    id: 'address_profile',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      `RETURN a.address AS address, a.network AS network, a.labels AS display_labels, a.labels AS system_labels, a.is_exchange AS is_exchange${riskFields}${labelRiskField}`,
      'LIMIT 1',
    ].join(' '),
  }
}

// Lifetime address features from federated USE topology node-metric
// projections (was: USE facts HAS_FEATURE -> facts_address_features_view,
// the view's last reader — rbmk#447 P3/P5). The federation typed-AST planner
// (rbmk#458) re-derives every projected metric EXACTLY across shards:
// additive props summed over disjoint shard windows, degrees as distinct
// counterparty set unions, first/last activity as min/max of per-shard baked
// endpoints, span from the combined endpoints — oracle-verified.
function addressFeatureQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_feature',
    query: [
      'USE topology',
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'RETURN a.degree_in AS degree_in, a.degree_out AS degree_out, a.degree_total AS degree_total, a.tx_in_count AS tx_in_count, a.tx_out_count AS tx_out_count, a.tx_total_count AS tx_total_count, a.total_volume_usd AS total_volume_usd, a.total_in_usd AS total_in_usd, a.total_out_usd AS total_out_usd, a.net_flow_usd AS net_flow_usd, a.first_activity_timestamp AS first_activity_timestamp, a.last_activity_timestamp AS last_activity_timestamp, a.activity_span_days AS activity_span_days',
      'LIMIT 1',
    ].join(' '),
  }
}

function flowEdgeMap(variableName: string): string {
  return `{amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_seen_timestamp: ${variableName}.first_seen_timestamp, last_seen_timestamp: ${variableName}.last_seen_timestamp, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`
}

function pathNodeMap(variableName: string): string {
  // risk_score/risk_level are always projected: topology is now unconditionally
  // Memgraph-backed, so the :Address slim risk verdict is always available.
  const riskFields = `, risk_score: ${variableName}.risk_score, risk_level: ${variableName}.risk_level`
  return `{address: ${variableName}.address, network: ${variableName}.network, labels: ${variableName}.labels, system_labels: ${variableName}.labels, is_exchange: ${variableName}.is_exchange${riskFields}}`
}

// money-trail enrichment: incident MONEY_TRAIL edges on the subject address
// (either direction), and the TRAIL_ENDS_AT fan-out of whichever seed
// generated the trail -- both are optional-results reads, so a graph with no
// money-trail layer (or a failed query) never fails aml_address_risk itself.
export function moneyTrailIncidentQuery(address: string): string {
  return [
    'USE topology',
    `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[r:MONEY_TRAIL]-()`,
    'RETURN r.edge_class AS edge_class, r.value AS value, r.min_hop AS min_hop, r.seed_count AS seed_count, r.primary_seed AS primary_seed, r.generation AS generation, r.network AS network, r.first_ts AS first_ts, r.last_ts AS last_ts',
    'LIMIT 200',
  ].join(' ')
}

export function moneyTrailEndsQuery(seed: string): string {
  return [
    'USE topology',
    `MATCH (s:Address {address: "${escapeCypherString(seed)}"})-[r:TRAIL_ENDS_AT]->(t:Address)`,
    'RETURN t.address AS address, r.fact_type AS fact_type, r.direction AS direction, r.terminal_role AS terminal_role, r.hop AS hop, r.value AS value, r.generation AS generation',
    'LIMIT 200',
  ].join(' ')
}

// Task 2 (trace fast path): a resolved trace target IS a money-trail seed
// when it has outgoing TRAIL_ENDS_AT edges -- same shape as
// moneyTrailEndsQuery, reused here under a probe-specific name so the
// trace-tool call site reads as "check whether this address is a seed"
// rather than "fetch the ends fan of a known seed" (they happen to be the
// same read).
export function moneyTrailSeedProbeQuery(address: string): string {
  return moneyTrailEndsQuery(address)
}

// Precomputed MONEY_TRAIL corridor from a confirmed seed: bounded to 6 hops
// (min_hop is a property baked onto the edge by the walk engine, not a
// variable-length path depth) and excludes peripheral-only continuation --
// peripheral is the "touched funds" floor (see MONEY_TRAIL_CLASS_RANK), not
// a real trail hop, so it never extends the fast-path corridor.
export function moneyTrailCorridorQuery(seed: string): string {
  return [
    'USE topology',
    `MATCH (s:Address {address: "${escapeCypherString(seed)}"})-[r:MONEY_TRAIL]->(t:Address)`,
    'WHERE r.min_hop <= 6 AND r.edge_class <> "peripheral"',
    'RETURN t.address AS address, r.edge_class AS edge_class, r.value AS value, r.min_hop AS min_hop, r.seed_count AS seed_count, r.primary_seed AS primary_seed, r.generation AS generation, r.network AS network',
    'ORDER BY r.min_hop ASC',
    'LIMIT 200',
  ].join(' ')
}

export interface MoneyTrailBlock {
  on_trail: true
  class: string
  min_hop: number
  primary_seed: string
  generation: number
  nearest_trail_end?: { address: string; fact_type: string; value: string }
}

const MONEY_TRAIL_CLASS_RANK: Record<string, number> = { transport: 3, holding: 2, peripheral: 1 }

export function buildMoneyTrailBlock(
  incidentRows: Array<Record<string, unknown>>,
  endRows: Array<Record<string, unknown>>,
): MoneyTrailBlock | undefined {
  if (incidentRows.length === 0) return undefined

  const winningClassRank = Math.max(
    ...incidentRows.map((row) => MONEY_TRAIL_CLASS_RANK[firstString(row['edge_class']) ?? ''] ?? 0),
  )
  const winningClass = Object.entries(MONEY_TRAIL_CLASS_RANK).find(([, rank]) => rank === winningClassRank)?.[0]
    ?? firstString(incidentRows[0]?.['edge_class']) ?? 'peripheral'
  const rowsOfWinningClass = incidentRows.filter((row) => firstString(row['edge_class']) === winningClass)
  const bestRow = rowsOfWinningClass.reduce((best, row) => {
    const rowHop = numberValue(row['min_hop']) ?? Number.POSITIVE_INFINITY
    const bestHop = numberValue(best['min_hop']) ?? Number.POSITIVE_INFINITY
    return rowHop < bestHop ? row : best
  }, rowsOfWinningClass[0]!)

  const nearestEnd = endRows.reduce<Record<string, unknown> | undefined>((best, row) => {
    const rowValue = numberValue(row['value']) ?? Number.NEGATIVE_INFINITY
    const bestValue = best ? numberValue(best['value']) ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY
    return !best || rowValue > bestValue ? row : best
  }, undefined)

  return {
    on_trail: true,
    class: winningClass,
    min_hop: numberValue(bestRow['min_hop']) ?? 0,
    primary_seed: firstString(bestRow['primary_seed']) ?? '',
    generation: numberValue(bestRow['generation']) ?? 0,
    ...(nearestEnd
      ? {
          nearest_trail_end: {
            address: firstString(nearestEnd['address']) ?? '',
            fact_type: firstString(nearestEnd['fact_type']) ?? '',
            value: String(nearestEnd['value'] ?? ''),
          },
        }
      : {}),
  }
}

export function moneyTrailSummarySentence(block: MoneyTrailBlock): string {
  return block.class === 'peripheral'
    ? `This address touched money-trail funds (${block.class}, min hop ${block.min_hop}).`
    : `This address sits on a money trail (${block.class}, min hop ${block.min_hop}).`
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
      `WHERE a.address <> exchange.address AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "outflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${depositVariable}.address AS deposit_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => pathNodeMap(nodeVariable)).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
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
      `WHERE a.address = "${escapeCypherString(address)}" AND a.address <> exchange.address AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "inflow" AS direction, exchange.address AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${withdrawalVariable}.address AS withdrawal_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.address`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => pathNodeMap(nodeVariable)).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
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

// Address-grain has no separate identity-resolution lookup: existence of the
// compare_address is checked directly against :Address, distinct from the
// primary address_profile query so both existence checks can run in one batch.
function compareAddressExistsQuery(address: string): { id: string; query: string } {
  return {
    id: 'compare_address_exists',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'RETURN a.address AS address',
      'LIMIT 1',
    ].join(' '),
  }
}

// R2/R3 seed pre-flight (address grain): before a multi-address trace runs,
// every seed is probed with a cheap indexed :Address existence lookup so a
// made-up or inactive address is REPORTED as unresolved instead of silently
// traced into an empty result. This preserves the pre-revert identity-
// resolution contract's unresolved-seeds surface (structuredContent.unresolved
// + summary.unresolved_count + the Unresolved summary line) with the address
// itself as the graph key -- there is no canonical-key rewrite step anymore.
function seedAddressExistsQuery(id: string, address: string): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'RETURN a.address AS address',
      'LIMIT 1',
    ].join(' '),
  }
}

async function probeSeedAddresses(
  remoteClient: Client,
  network: string,
  inputs: string[],
): Promise<Set<string>> {
  if (inputs.length === 0) return new Set()
  const queries = inputs.map((input, index) => ({
    input,
    ...seedAddressExistsQuery(`seed_address_exists_${index + 1}`, input),
  }))
  const batch = await callGraphBatch(
    remoteClient,
    network,
    queries.map(({ id, query }) => ({ id, query })),
  )
  const failures: QueryFailure[] = []
  const existing = new Set<string>()
  for (const { input, id } of queries) {
    const rows = optionalResultsFor(batch, id, failures)
    // A failed probe (ok:false) treats the seed as unresolved rather than
    // silently tracing it -- same conservative posture the pre-revert
    // identity resolution took on lookup failure.
    if (firstString(rows[0]?.['address'])) existing.add(input)
  }
  return existing
}

// AC11: FLOWS_TO reachability UNIONed over one -[:LINKED]- hop, so an
// investigator surveying an address's exposure also sees exposure carried by
// an address that is only ownership-LINKED to it (LINKED is undirected).
function linkedExposureQueries(address: string): Array<{ id: string; query: string }> {
  return [
    {
      id: 'linked_exposure_direct',
      query: [
        `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[r:FLOWS_TO]-(b:Address)`,
        'WHERE a.address <> b.address',
        `RETURN a.address AS subject_address, b.address AS counterparty_address, b.network AS counterparty_network, "direct" AS exposure_basis, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count`,
        'LIMIT 200',
      ].join(' '),
    },
    {
      id: 'linked_exposure_via_linked',
      query: [
        `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address)`,
        'WHERE owned.address <> b.address AND a.address <> b.address',
        `RETURN a.address AS subject_address, b.address AS counterparty_address, b.network AS counterparty_network, "via_linked" AS exposure_basis, owned.address AS linked_via_address, l.basis AS link_basis, l.confidence AS link_confidence, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count`,
        'LIMIT 200',
      ].join(' '),
    },
  ]
}

// AC5: cross-space LINKED probe. The SS58/H160 split is the :Address.network
// node PROPERTY (bittensor / bittensor_evm) on the single public
// network=bittensor graph -- LINKED is the ownership edge across that space
// boundary (FLOWS_TO stays within one space), so this runs on the topology
// graph with no network switch. LINKED is served on the topology graph
// only.
function crossSpaceLinkedQuery(address: string): { id: string; query: string } {
  return {
    id: 'cross_space_linked',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})-[l:LINKED]-(b:Address)`,
      'WHERE a.network <> b.network',
      'RETURN a.address AS address, a.network AS network, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence, l.source_event AS source_event, l.declared_owner AS declared_owner',
      'LIMIT 50',
    ].join(' '),
  }
}

// ── Pairwise route evidence ──
// Directed shortest route between two KNOWN identity endpoints. The topology
// graph is native Memgraph Cypher, so the route uses native `*BFS 1..N`
// (BFS = fewest-hop directed route within the depth bound) between both
// anchored endpoints. Exchange intermediates on a returned route are DISCLOSED
// in the evidence, never silently filtered out.

export const CONNECTION_ROUTE_DEPTH_BOUND = 4

export function shouldIncludeRouteQueries(
  compareAddress: string | undefined,
): boolean {
  // Native traversal (*BFS) always fires when a compare address is given:
  // topology is unconditionally Memgraph-native.
  return Boolean(compareAddress)
}

export function connectionRouteQueries(
  address: string,
  compareAddress: string,
): Array<{ id: string; query: string }> {
  const routeQuery = (fromAddress: string, toAddress: string): string =>
    [
      `MATCH p = (src:Address {address: "${escapeCypherString(fromAddress)}"})`,
      `-[:FLOWS_TO *BFS 1..${CONNECTION_ROUTE_DEPTH_BOUND}]->`,
      `(dst:Address {address: "${escapeCypherString(toAddress)}"}) RETURN p LIMIT 1`,
    ].join('')
  return [
    { id: 'connection_route_outbound', query: routeQuery(address, compareAddress) },
    { id: 'connection_route_inbound', query: routeQuery(compareAddress, address) },
  ]
}

export interface RouteEvidenceSide {
  hops: number
  identities: string[]
  exchange_intermediates: string[]
  amount_usd_sum_total: number
}

function collectOrdered(
  value: unknown,
  matches: (candidate: Record<string, unknown>) => boolean,
): Array<Record<string, unknown>> {
  const collected: Array<Record<string, unknown>> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry)
      return
    }
    if (node && typeof node === 'object') {
      const candidate = node as Record<string, unknown>
      if (matches(candidate)) collected.push(candidate)
      for (const nested of Object.values(candidate)) walk(nested)
    }
  }
  walk(value)
  return collected
}

// is_exchange on topology nodes is a MARKER, not a boolean: it usually
// carries the exchange name (e.g. "binance"). Treat explicit falsy
// encodings as not-exchange (a bare non-null check would falsely disclose
// nodes serialized as false/"false"/0), and any other non-empty value as
// exchange. isExchangeFlag() is NOT reused here — it is boolean-only and
// would miss name-valued markers.
export function isExchangeMarker(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'null'
  }
  return value === true
}

// Shape-tolerant hydrated-path reader: walks the returned path value for
// ordered address nodes and FLOWS_TO edge amounts without pinning the
// backend's exact path envelope.
export function routeFromPathValue(value: unknown): RouteEvidenceSide | null {
  if (!value || typeof value !== 'object') return null
  const nodes = collectOrdered(value, (candidate) => typeof candidate['address'] === 'string')
  if (nodes.length < 2) return null
  const edges = collectOrdered(
    value,
    (candidate) => typeof candidate['amount_usd_sum'] === 'number' && !('address' in candidate),
  )
  const identities = nodes.map((node) => String(node['address']))
  const exchangeIntermediates = nodes
    .slice(1, -1)
    .filter((node) => isExchangeMarker(node['is_exchange']))
    .map((node) => String(node['address']))
  return {
    // Hop count is a structural property of the node sequence — never
    // derived from edge-object detection, which keys on numeric
    // amount_usd_sum and would under-report on partially hydrated edges.
    hops: nodes.length - 1,
    identities,
    exchange_intermediates: exchangeIntermediates,
    amount_usd_sum_total: edges.reduce((total, edge) => total + Number(edge['amount_usd_sum']), 0),
  }
}

export interface RouteEvidence {
  search_strategy: 'any_shortest'
  route_rank_basis: 'hop_count'
  depth_bound: number
  route_found: boolean
  outbound: RouteEvidenceSide | null
  inbound: RouteEvidenceSide | null
}

export function buildRouteEvidence(
  outboundRows: Array<Record<string, unknown>>,
  inboundRows: Array<Record<string, unknown>>,
): RouteEvidence {
  const sideFrom = (rows: Array<Record<string, unknown>>): RouteEvidenceSide | null => {
    const first = rows[0]
    if (!first) return null
    const pathValue = 'p' in first ? first['p'] : Object.values(first)[0]
    return routeFromPathValue(pathValue)
  }
  const outbound = sideFrom(outboundRows)
  const inbound = sideFrom(inboundRows)
  return {
    search_strategy: 'any_shortest',
    route_rank_basis: 'hop_count',
    depth_bound: CONNECTION_ROUTE_DEPTH_BOUND,
    route_found: outbound !== null || inbound !== null,
    outbound,
    inbound,
  }
}

function formatExchangeRows(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const direction = String(row['direction'] ?? 'flow')
    const exchange = String(row['exchange_address'] ?? '')
    const amount = row['amount_usd_sum'] ?? ''
    const hops = row['hops'] ?? ''
    return `- ${direction}: ${exchange} (${hops} hop(s), amount_usd_sum ${amount})`
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

function hasExactExchangeLabel(labels: string[] | undefined): boolean {
  return (labels ?? []).some((label) => label.trim().toLowerCase() === 'exchange')
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

function riskDrivers(
  profile: Record<string, unknown>,
  labelRows: Array<Record<string, unknown>>,
  exchangeRows: Array<Record<string, unknown>>,
): string[] {
  const drivers: string[] = []

  const riskLabels = labelRows
    .map((row) => firstString(row['label']))
    .filter((label): label is string => Boolean(label))
  if (riskLabels.length > 0) drivers.push(`Labels: ${[...new Set(riskLabels)].join('; ')}`)

  const outflowCount = exchangeRows.filter((row) => row['direction'] === 'outflow').length
  const inflowCount = exchangeRows.filter((row) => row['direction'] === 'inflow').length
  if (outflowCount > 0) drivers.push(`Forward bounded search reached ${outflowCount} exchange path(s).`)
  if (inflowCount > 0) drivers.push(`Backward bounded search found ${inflowCount} source exchange path(s).`)

  return [...new Set(drivers)]
}

// Derives the deterministic labelRows subset from the profile row's
// a.label_risk property (topology, P2b′), reproducing the retired
// addressLabelRiskQuery's `ORDER BY label.updated_timestamp DESC LIMIT 10`
// subset byte-for-byte: same sort, same cap. Each entry already carries
// {label, risk_level, updated_timestamp} -- no separate name/level pairing
// is needed. Missing/empty property -> empty array, same as "no labels"
// behaved under the old facts read.
function deriveLabelRows(profile: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = profile['label_risk']
  const rows = Array.isArray(raw) ? raw.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row)) : []
  return [...rows]
    .sort((a, b) => (numberValue(b['updated_timestamp']) ?? 0) - (numberValue(a['updated_timestamp']) ?? 0))
    .slice(0, 10)
}

const RISK_LEVEL_ORDER = ['critical', 'high', 'medium', 'low'] as const

function strongestLabelRiskLevel(labelRows: Array<Record<string, unknown>>): string | undefined {
  const levels = labelRows
    .map((row) => firstString(row['risk_level'])?.toLowerCase())
    .filter((level): level is string => Boolean(level && (RISK_LEVEL_ORDER as readonly string[]).includes(level)))
  if (levels.length === 0) return undefined
  return RISK_LEVEL_ORDER.find((candidate) => levels.includes(candidate))
}

function riskScoreSources(profile: Record<string, unknown>, labelRows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const sources: Array<Record<string, unknown>> = []
  if (numberValue(profile['live_risk_score']) !== undefined) {
    sources.push({
      family: 'ml_risk_score',
      layer: 'topology',
      source: 'address_node',
      fields: ['risk_score', 'risk_level'],
    })
  }
  if (labelRows.length > 0) {
    sources.push({
      family: 'label_risk',
      layer: 'topology',
      source: 'address_node',
      labels: labelRows.map((row) => ({
        label: row['label'],
        risk_level: row['risk_level'],
      })),
    })
  }
  return sources
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
      amount_usd_sum: row['amount_usd_sum'] ?? terminal['amount_usd_sum'],
      tx_count: row['tx_count'] ?? terminal['tx_count'],
      first_seen_timestamp: row['first_seen_timestamp'] ?? terminal['first_seen_timestamp'],
      last_seen_timestamp: row['last_seen_timestamp'] ?? terminal['last_seen_timestamp'],
      first_tx_id: row['first_tx_id'] ?? terminal['first_tx_id'],
      last_tx_id: row['last_tx_id'] ?? terminal['last_tx_id'],
    }
  })
}

const FALLBACK_SHARED_TX_COUNT = 1000
const FALLBACK_SHARED_USD_SUM = 5_000_000
const FALLBACK_SHARED_DAMPING = 0.1
const FALLBACK_VALUE_SATURATION_USD = 1_000_000
const FALLBACK_BASE_SCORE = 0.1
const FALLBACK_MAX_SCORE = 0.6

/**
 * Score exchange exposure when no ML risk score exists. Topology-grain:
 * log-scaled USD volume across exchange rows, with shared/omnibus edges
 * (high tx_count or USD throughput) dampened, bounded in (0, 0.6] so a
 * fallback can never impersonate a high ML score band.
 */
export function exchangeExposureFallbackScore(exchangeRows: Array<Record<string, unknown>>): number {
  if (exchangeRows.length === 0) return 0
  let weightedUsd = 0
  for (const row of exchangeRows) {
    const usd = numberValue(row['amount_usd_sum']) ?? 0
    const txCount = numberValue(row['tx_count']) ?? 0
    const shared = txCount >= FALLBACK_SHARED_TX_COUNT || usd >= FALLBACK_SHARED_USD_SUM
    weightedUsd += shared ? usd * FALLBACK_SHARED_DAMPING : usd
  }
  const capped = Math.min(weightedUsd, FALLBACK_VALUE_SATURATION_USD)
  const factor = Math.log10(1 + capped) / Math.log10(1 + FALLBACK_VALUE_SATURATION_USD)
  return Math.min(FALLBACK_MAX_SCORE, FALLBACK_BASE_SCORE + (FALLBACK_MAX_SCORE - FALLBACK_BASE_SCORE) * factor)
}

export function riskAssessment(
  profile: Record<string, unknown>,
  labelRows: Array<Record<string, unknown>>,
  exchangeRows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const mlRiskScore = firstNumber(profile['live_risk_score'])
  // UNSCORED is the model's explicit abstention (calibrated-scoring release):
  // the score exists for transparency but carries no stance — deriving a
  // severity band from it would silently launder an abstention into a
  // confident verdict (typically "low"). Fall back to labels/exchange
  // exposure and say so.
  const mlAbstained = isUnscoredRiskLevel(profile['live_risk_level'])
  const labelRiskLevel = strongestLabelRiskLevel(labelRows)
  const usableMlScore = mlAbstained ? undefined : mlRiskScore
  const score = usableMlScore ?? exchangeExposureFallbackScore(exchangeRows)
  let level = labelRiskLevel ?? (mlAbstained && exchangeRows.length === 0 ? 'unscored' : riskLevelFromScore(score))
  const drivers = riskDrivers(profile, labelRows, exchangeRows)
  if (mlAbstained) drivers.push('ml_abstained: ML verdict is UNSCORED (insufficient labeled graph context); level derived from labels/exchange exposure only')
  // Labels are curated truth and stay first — but a lower-severity label
  // must never SUPPRESS a more severe usable ML band. Failing toward
  // "looks safe" is the one direction an AML triage tool may not fail.
  const usableMlBand = usableMlScore !== undefined ? riskLevelFromScore(usableMlScore) : undefined
  if (
    labelRiskLevel &&
    usableMlBand &&
    riskSeverityRank(usableMlBand) > riskSeverityRank(labelRiskLevel)
  ) {
    level = usableMlBand
    drivers.push(`ml_label_divergence: usable ML band ${usableMlBand} exceeds strongest label level ${labelRiskLevel}; reporting the more severe band — review the label`)
  }
  return {
    level,
    score,
    ...(mlRiskScore !== undefined ? { ml_risk_score: mlRiskScore } : {}),
    ...(mlAbstained ? { ml_verdict: 'unscored' } : {}),
    confidence: (usableMlScore !== undefined || labelRiskLevel) ? 'high' : exchangeRows.length > 0 ? 'medium' : 'low',
    recommendation: level === 'unscored' ? 'Model abstained and no label/exchange signal found; gather more context before clearing.' : riskRecommendation(level),
    drivers,
    sources: riskScoreSources(profile, labelRows),
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
    ...(stringArrayValue(profile['member_addresses'])?.length ? { member_addresses: stringArrayValue(profile['member_addresses']) } : {}),
    ...(numberValue(profile['live_risk_score']) !== undefined ? { risk_score: numberValue(profile['live_risk_score']) } : {}),
    ...(firstString(profile['live_risk_level']) ? { risk_level: firstString(profile['live_risk_level']) } : {}),
    roles: ['subject'],
  })
  const edges: Array<Record<string, unknown>> = []
  const mergeNode = (entry: string, metadata?: Record<string, unknown>) => {
    const existing = nodes.get(entry) ?? { id: entry, address: entry, node_type: 'address', labels: [] }
    const labels = stringArrayValue(metadata?.['labels']) ?? existing['labels']
    const systemLabels = stringArrayValue(metadata?.['system_labels']) ?? existing['system_labels']
    const memberAddresses = stringArrayValue(metadata?.['member_addresses']) ?? existing['member_addresses']
    const riskScore = numberValue(metadata?.['risk_score']) ?? existing['risk_score']
    const riskLevel = normalizeRiskLevel(firstString(metadata?.['risk_level'])) ?? existing['risk_level']
    nodes.set(entry, {
      ...existing,
      labels,
      ...(systemLabels ? { system_labels: systemLabels } : {}),
      ...(Array.isArray(memberAddresses) && memberAddresses.length > 0 ? { member_addresses: memberAddresses } : {}),
      ...(riskScore !== undefined ? { risk_score: riskScore } : {}),
      ...(riskLevel ? { risk_level: riskLevel } : {}),
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
        usd_amount: edge['amount_usd_sum'] ?? 0,
        amount_usd_sum: edge['amount_usd_sum'] ?? 0,
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
  const compareInput = options.compareAddress?.trim() ?? ''
  if (!address) throw new Error('address is required')
  if (!network) throw new Error('network is required')

  // Every internal graph_query_batch round trip this workflow makes is
  // observed here and totaled into a usage block on the response (never
  // blocks/throws on a backend that doesn't emit billing fields yet).
  const usage = createUsageAccumulator()
  const trackedClient = wrapClientForUsageTracking(remoteClient, usage)

  // Address-grain has no separate resolution step for the SUBJECT address:
  // the input address IS the graph node key. Its existence is inferred
  // post-hoc from the address_profile row (below) instead of the pre-revert
  // pre-flight lookup -- deliberate: it saves a round trip on the hot path.
  // The COMPARE address keeps a pre-flight existence probe, because the
  // connection probe and the *BFS route queries must be SUPPRESSED (not just
  // ignored) when the compare address does not exist -- pre-revert behavior
  // never issued route probes for an unresolved compare input.
  let compareUnresolved = false
  if (compareInput) {
    const compareBatch = await callGraphBatch(trackedClient, network, [compareAddressExistsQuery(compareInput)])
    const compareRows = optionalResultsFor(compareBatch, 'compare_address_exists', [])
    compareUnresolved = !firstString(compareRows[0]?.['address'])
  }
  const compareAddress = compareInput && !compareUnresolved ? compareInput : ''

  const queries = [
    addressProfileQuery(address),
    addressFeatureQuery(address),
    { id: 'money_trail_incident', query: moneyTrailIncidentQuery(address) },
    ...exchangeOutflowQueries(address),
    ...exchangeInflowQueries(address),
    ...(compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{ id: 'connection_probe', query: 'MATCH (n:Address {address: "__chain_insights_noop__"}) RETURN n.address AS noop LIMIT 0' }]),
    // Route evidence is additive: native *BFS traversal always fires for a
    // compare address whose existence probe succeeded (the 1-hop probe above
    // always runs).
    ...(shouldIncludeRouteQueries(compareAddress)
      ? connectionRouteQueries(address, compareAddress)
      : []),
  ]
  const batch = await callGraphBatch(trackedClient, network, queries)
  const partialQueryFailures: QueryFailure[] = []
  // Deliberate post-hoc existence inference (address grain): an empty
  // address_profile result means the subject :Address does not exist ->
  // report unresolved; this replaces the pre-revert identity pre-flight.
  const addressProfileRows = optionalResultsFor(batch, 'address_profile', partialQueryFailures)
  if (addressProfileRows.length === 0) {
    return {
      summaryText: `Address risk for ${network}:${address}\n\nUnresolved: no Address found for "${address}". The address may not have on-chain activity in this network.`,
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'aml_address_risk',
        facts: {
          subject: { network, addresses: [address] },
          unresolved: [address],
          usage: usageBlock(usage),
        },
      },
      graphData: { schema: 'chain-insights.graph.v1', nodes: [], edges: [], flows: [], edge_anchors: [], metadata: { address, network, generated_at: new Date().toISOString() } },
    }
  }
  const profile: Record<string, unknown> = {
    address,
    ...(addressProfileRows[0] ?? {}),
    ...(optionalResultsFor(batch, 'address_feature', partialQueryFailures)[0] ?? {}),
  }
  const labelRows = deriveLabelRows(profile)
  const outflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_outflows_', partialQueryFailures))
  const inflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_inflows_', partialQueryFailures))
  const connections = compareAddress ? optionalResultsFor(batch, 'connection_probe', partialQueryFailures) : []
  const routeEvidence = shouldIncludeRouteQueries(compareAddress)
    ? buildRouteEvidence(
        optionalResultsFor(batch, 'connection_route_outbound', partialQueryFailures),
        optionalResultsFor(batch, 'connection_route_inbound', partialQueryFailures),
      )
    : undefined
  const exchangeRows = [...outflows, ...inflows]
  // A hop-depth exchange_outflows_N/exchange_inflows_N query can fail
  // independently (e.g. the archive-tier query-memory limit on a deep
  // multi-hop search) while other hop depths succeed with zero rows. An
  // empty exchangeRows result must then read as "search incomplete," not
  // "no exchange exposure" -- the two are not the same claim, and an AML
  // tool that silently reports a false-clean verdict on a partial search
  // failure is a real risk (found during MoA review, 2026-07-05).
  const exchangeSearchFailures = partialQueryFailures.filter(
    (failure) => failure.id.startsWith('exchange_outflows_') || failure.id.startsWith('exchange_inflows_'),
  )
  const exchangeSearchComplete = exchangeSearchFailures.length === 0
  // money-trail enrichment (optional): a preliminary block resolves the
  // primary_seed off the incident-only rows, then a second batch call fans
  // out TRAIL_ENDS_AT for that seed so the block can pick the highest-value
  // terminal fact. Both reads are optional-results -- a graph with no
  // money-trail layer never fails the tool.
  const moneyTrailIncidentRows = optionalResultsFor(batch, 'money_trail_incident', partialQueryFailures)
  const preliminaryMoneyTrail = buildMoneyTrailBlock(moneyTrailIncidentRows, [])
  let moneyTrailEndRows: Array<Record<string, unknown>> = []
  if (preliminaryMoneyTrail?.primary_seed) {
    try {
      const endsBatch = await callGraphBatch(trackedClient, network, [
        { id: 'money_trail_ends', query: moneyTrailEndsQuery(preliminaryMoneyTrail.primary_seed) },
      ])
      moneyTrailEndRows = optionalResultsFor(endsBatch, 'money_trail_ends', partialQueryFailures)
    } catch (error) {
      // Degrade, don't fail: a transport/parse error on the second batch call
      // (unlike a query-level ok:false, which optionalResultsFor already
      // absorbs) must not blow up the whole tool -- the incident rows are
      // already in hand, so the block still reports on_trail without
      // nearest_trail_end.
      collectQueryFailure(partialQueryFailures, 'money_trail_ends', error instanceof Error ? error.message : String(error))
    }
  }
  const moneyTrail = buildMoneyTrailBlock(moneyTrailIncidentRows, moneyTrailEndRows)
  const graphData = buildRiskGraph(address, profile, exchangeRows, network)
  const risk = riskAssessment(profile, labelRows, exchangeRows)
  const liveRiskScore = numberValue(profile['live_risk_score'])
  const liveRiskLevel = firstString(profile['live_risk_level'])
  const liveNodeVerdict = liveRiskScore !== undefined || liveRiskLevel
    ? {
        ...(liveRiskScore !== undefined ? { risk_score: liveRiskScore } : {}),
        ...(liveRiskLevel ? { risk_level: liveRiskLevel } : {}),
        source: 'topology_node',
      }
    : undefined

  const lines = [
    `Address risk for ${network}:${address}`,
    '',
    `Risk: ${risk['level']} (${formatRiskScore(risk['score'])})`,
    `Confidence: ${risk['confidence']}`,
    `Recommendation: ${risk['recommendation']}`,
    ...(liveNodeVerdict ? [`Live node triage: ${liveRiskLevel ?? 'unknown'} (${formatRiskScore(liveRiskScore)})`] : []),
    `Graph degree: in ${profile['degree_in'] ?? 'unknown'}, out ${profile['degree_out'] ?? 'unknown'}.`,
    '',
    'Exchange behavior',
    ...(exchangeRows.length > 0
      ? [
          formatExchangeRows(exchangeRows).join('\n'),
          ...(exchangeSearchComplete
            ? []
            : [`(incomplete: ${exchangeSearchFailures.length} other hop-depth quer${exchangeSearchFailures.length === 1 ? 'y' : 'ies'} failed -- there may be more exchange exposure than shown here)`]),
        ]
      : [
          exchangeSearchComplete
            ? '- No exchange inflow/outflow paths found in bounded search.'
            : `- Exchange search incomplete: ${exchangeSearchFailures.length} hop-depth quer${exchangeSearchFailures.length === 1 ? 'y' : 'ies'} failed before returning a result. This is NOT a clean finding -- retry or narrow the search (see Partial query failures below).`,
        ]),
  ]
  if (Array.isArray(risk['drivers']) && risk['drivers'].length > 0) {
    lines.push('', 'Risk drivers', risk['drivers'].map((driver) => `- ${driver}`).join('\n'))
  }
  if (moneyTrail) {
    lines.push('', moneyTrailSummarySentence(moneyTrail))
  }
  if (compareAddress) {
    lines.push('', `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : 'Connection paths found: 0')
  }
  if (compareUnresolved) {
    lines.push('', `Unresolved compare_address: no Address found for "${compareInput}"; comparison skipped.`)
  }
  if (partialQueryFailures.length > 0) {
    lines.push('', 'Partial query failures', partialQueryFailures.map((failure) => `- ${failure.id}: ${failure.error}`).join('\n'))
  }
  const summaryText = lines.join('\n')
  const structuredContent = {
    schema: 'chain-insights.result.v1',
    tool: 'aml_address_risk',
    facts: {
      subject: {
        network,
        addresses: compareAddress ? [address, compareAddress] : [address],
      },
      risk: {
        ...risk,
        ...(liveNodeVerdict ? { live_node: liveNodeVerdict } : {}),
      },
      exchange_behavior: {
        outflows,
        inflows,
        search_status: exchangeSearchComplete ? 'complete' : 'incomplete',
        ...(exchangeSearchComplete ? {} : { failed_query_ids: exchangeSearchFailures.map((failure) => failure.id) }),
      },
      connection: compareAddress
        ? {
            compare_address: compareAddress,
            paths: connections,
            ...(routeEvidence ? { route_evidence: routeEvidence } : {}),
          }
        : undefined,
      money_trail: moneyTrail,
      unresolved: compareUnresolved ? [compareInput] : undefined,
      partial_query_errors: partialQueryFailures.length > 0 ? partialQueryFailures : undefined,
      usage: usageBlock(usage),
    },
  }
  const artifacts = options.writeArtifacts ? await writeAddressRiskArtifacts(
    network,
    address,
    compareAddress,
    graphData,
    exchangeRows,
    summaryText,
  ) : statelessArtifacts()
  const evidence = artifactEvidence(artifacts)

  return {
    summaryText,
    structuredContent: {
      ...structuredContent,
      artifacts,
      evidence: [...evidence, {
        evidence_type: 'tool_summary',
        summary: `aml_address_risk ${address} completed for ${network}`,
      }],
    },
    graphData,
  }
}

function toCsvValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function subjectNodeForExchangeRow(row: Record<string, unknown>, fallbackAddress: string): string {
  return String(
    row['direction'] === 'inflow'
      ? row['withdrawal_address'] ?? row['deposit_address'] ?? fallbackAddress
      : row['deposit_address'] ?? row['withdrawal_address'] ?? fallbackAddress,
  )
}

function buildAddressRiskTableHtml(tool: string, network: string, rows: Array<Record<string, unknown>>, subject: string): string {
  const headers = ['direction', 'exchange_address', 'subject_path_node', 'hops', 'amount_usd_sum', 'tx_count'] as const
  const body = rows.map((row) => {
    const exchangeAddress = String(row['exchange_address'] ?? '')
    const subjectNode = subjectNodeForExchangeRow(row, subject)
    const rowValues = [
      row['direction'] ?? '',
      exchangeAddress,
      subjectNode,
      row['hops'] ?? '',
      row['amount_usd_sum'] ?? '',
      row['tx_count'] ?? '',
    ]
    return `<tr>${rowValues.map((value) => `<td>${htmlEscape(toCsvValue(value))}</td>`).join('')}</tr>`
  }).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Risk Table</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui; background: #0b0d12; color: #f4f2ea; }
  body { margin: 0; background: #0b0d12; color: #f4f2ea; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 650; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; }
  th, td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 10px; text-align: left; }
  th { position: sticky; top: 0; background: #161a24; color: #f2dda6; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${htmlEscape(tool)} Table</h1>
  <div>Network: <strong>${htmlEscape(network)}</strong></div>
  <div>Generated: <strong>${htmlEscape(new Date().toISOString())}</strong></div>
  <table>
    <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</main>
</body>
</html>
`
}

async function writeAddressRiskArtifacts(
  network: string,
  address: string,
  compareAddress: string | undefined,
  graphData: Record<string, unknown>,
  exchangeRows: Array<Record<string, unknown>>,
  summaryText: string,
): Promise<Record<string, string>> {
  const paths = workspaceOutputPaths()
  await Promise.all([
    mkdir(paths.reportsRoot, { recursive: true }),
    mkdir(paths.reportGraphsRoot, { recursive: true }),
    mkdir(paths.reportTablesRoot, { recursive: true }),
  ])
  const safeNetwork = network.replace(/[^A-Za-z0-9._-]+/g, '_')
  const safeAddress = address.replace(/[^A-Za-z0-9._-]+/g, '_')
  const slug = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_aml_address_risk_${safeNetwork}_${safeAddress}`
  const graphPath = path.join(paths.reportGraphsRoot, `${slug}.graph.json`)
  const tableJsonPath = path.join(paths.reportTablesRoot, `${slug}.compact-evidence.json`)
  const csvPath = path.join(paths.reportTablesRoot, `${slug}.flows.csv`)
  const tableHtmlPath = path.join(paths.reportsRoot, `${slug}.table.html`)
  const reportPath = path.join(paths.reportsRoot, `${slug}.aml-address-report.md`)
  const graphHtmlPath = path.join(paths.reportsRoot, `${slug}.graph.html`)
  const { generateInlineGraphHtml } = await import('../viz/html-generator.js')
  const header = [
    'direction',
    'exchange_address',
    'subject_path_node',
    'hops',
    'amount_usd_sum',
    'tx_count',
  ]
  const csv = [
    header.join(','),
    ...exchangeRows.map((row) => {
      const exchangeAddress = String(row['exchange_address'] ?? '')
      const subjectPathNode = subjectNodeForExchangeRow(row, address)
      return [
        row['direction'] ?? '',
        exchangeAddress,
        subjectPathNode,
        row['hops'] ?? '',
        row['amount_usd_sum'] ?? '',
        row['tx_count'] ?? '',
      ].map((value) => JSON.stringify(String(value))).join(',')
    }),
  ].join('\n') + '\n'
  const evidence = {
    schema: 'chain-insights.trace.v1',
    tool: 'aml_address_risk',
    network,
    input: {
      address,
      ...(compareAddress ? { compare_address: compareAddress } : {}),
    },
    profile: {
      exchange_rows: exchangeRows.map((row) => ({
        direction: row['direction'],
        exchange_address: row['exchange_address'],
        subject_node: subjectNodeForExchangeRow(row, address),
        hops: row['hops'],
        amount_usd_sum: row['amount_usd_sum'],
        tx_count: row['tx_count'],
      })),
      report_summary: summaryText,
    },
  }
  await writeFile(graphPath, JSON.stringify(graphData, null, 2) + '\n', { mode: 0o600 })
  await writeFile(tableJsonPath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
  await writeFile(csvPath, csv, { mode: 0o600 })
  await writeFile(tableHtmlPath, buildAddressRiskTableHtml('aml_address_risk', network, exchangeRows, address), { mode: 0o600 })
  await writeFile(graphHtmlPath, generateInlineGraphHtml(graphData), { mode: 0o600 })
  await writeFile(
    reportPath,
    [
      `# Address Risk Report (${network}:${address})`,
      `- Graph JSON: ${graphPath}`,
      `- Table JSON: ${tableJsonPath}`,
      `- CSV: ${csvPath}`,
      `- Report HTML: ${tableHtmlPath}`,
      `- Graph HTML: ${graphHtmlPath}`,
      '',
      summaryText,
    ].join('\n'),
    { mode: 0o600 },
  )

  return {
    graph_json: graphPath,
    graph_html: graphHtmlPath,
    table_json: tableJsonPath,
    flows_csv: csvPath,
    table_html: tableHtmlPath,
    report_md: reportPath,
  }
}


function statelessArtifacts(): Record<string, unknown> {
  return {
    artifacts_written: false,
    artifact_mode: 'stateless',
  }
}

function artifactEvidence(artifacts: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.entries(artifacts)
    .filter((entry): entry is [string, string] => entry[0] !== 'artifact_mode' && typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([kind, filePath]) => ({
      evidence_type: 'artifact_pointer',
      path: filePath,
      summary: `${kind} artifact`,
    }))
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}


// Deterministic query-builder surface for the committed corpus and
// query-with-a-documented-call-contract tests. Reflects the retained
// aml_address_risk/graph query builders after the aml_trace_* cut.
export const queryBuilderContract = {
  topologyGraphQuery,
  addressProfileQuery,
  compareAddressExistsQuery,
  addressFeatureQuery,
  exchangeOutflowQueries,
  exchangeInflowQueries,
  connectionProbeQuery,
  connectionRouteQueries,
  linkedExposureQueries,
  crossSpaceLinkedQuery,
}
