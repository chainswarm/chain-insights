import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { activityWindowPredicates, runFundFlowProbe, type TraceActivityWindow, type TraceFundsResult, type TopologyScope, DEFAULT_TOPOLOGY_SCOPE } from './trace-funds.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { isUnscoredRiskLevel, normalizeRiskLevel, riskSeverityRank } from './risk-level.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

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

const GRAPH_QUERY_BATCH_TIMEOUT_SECONDS = 10
const GRAPH_QUERY_BATCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
// The AC12 archive-retry hint is a best-effort nicety, not part of the trace
// itself: bound it tightly so a hung/slow capabilities call can never stall
// (let alone fail) the actual trace/risk result.
const ARCHIVE_HINT_CAPABILITY_TIMEOUT_MS = 5000

export interface AddressRiskOptions {
  address: string
  network: string
  compareAddress?: string
  writeArtifacts?: boolean
  topologyScope?: TopologyScope
}

export interface TrackFundsOptions {
  trustedAddresses: string | string[]
  untrustedAddresses?: string | string[]
  network: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  topologyScope?: TopologyScope
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

function topologyGraphQuery(query: string, scope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE): string {
  const trimmed = query.trim()
  if (/^USE\s+/i.test(trimmed)) return trimmed
  return `USE ${scope} ${trimmed}`
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
  topologyScope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE,
): Promise<ParsedGraphBatch> {
  const result = await remoteClient.callTool(
    {
      name: 'graph_query_batch',
      arguments: {
        network,
        queries: queries.map((query) => ({
          ...query,
          query: topologyGraphQuery(query.query, topologyScope),
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

// Best-effort archive_topology availability check for the AC12 observability
// hint (retry with archive when a live_topology call finds nothing). Never
// throws: a failed/unsupported capabilities call just means no hint is shown.
async function archiveTopologyAvailable(remoteClient: Client, network: string): Promise<boolean> {
  try {
    const result = await remoteClient.callTool(
      { name: 'network_capabilities', arguments: {} },
      undefined,
      { timeout: ARCHIVE_HINT_CAPABILITY_TIMEOUT_MS, maxTotalTimeout: ARCHIVE_HINT_CAPABILITY_TIMEOUT_MS },
    ) as RemoteToolResult
    if (result.isError) return false
    const text = textFromToolResult(result).trim()
    if (!text) return false
    const parsed = JSON.parse(text) as {
      networks?: Array<{ network?: string; layers?: { topology?: { archive?: { enabled?: boolean } } } }>
      facts?: { capabilities?: { networks?: Array<{ network?: string; layers?: { topology?: { archive?: { enabled?: boolean } } } }> } }
    }
    const networks = parsed.facts?.capabilities?.networks ?? parsed.networks
    const entry = networks?.find((candidate) => candidate.network === network)
    return entry?.layers?.topology?.archive?.enabled === true
  } catch {
    return false
  }
}

// Appends the AC12 archive-retry hint to a trace/risk warnings array when the
// call ran on live_topology, found nothing, and archive_topology is available.
async function archiveRetryHint(
  remoteClient: Client,
  network: string,
  topologyScope: TopologyScope,
  foundNothing: boolean,
): Promise<string[]> {
  if (topologyScope !== 'live_topology' || !foundNothing) return []
  const archiveAvailable = await archiveTopologyAvailable(remoteClient, network)
  return archiveAvailable
    ? ['No results on live_topology; archive_topology is available for this network and covers full history -- retry with topology_scope=archive_topology.']
    : []
}

function parseAddressList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const CANONICAL_HEX_FORM_PATTERN = /^0x[0-9a-fA-F]+$/

function memberFormOf(input: string, network: string): string {
  const prefix = `${network}:`
  return input.startsWith(prefix) ? input.slice(prefix.length) : input
}

function canonicalIdentityKeyFor(network: string, memberForm: string): string | undefined {
  if (!CANONICAL_HEX_FORM_PATTERN.test(memberForm)) return undefined
  return `${network}:${memberForm.toLowerCase()}`
}

function memberAddressResolutionQuery(id: string, memberForm: string): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (m:Address {address: "${escapeCypherString(memberForm)}"})<-[:HAS_ADDRESS]-(i:Identity)`,
      'RETURN i.identity_id AS identity_id',
      'LIMIT 1',
    ].join(' '),
  }
}

// canonicalIdentityKeyFor() recognizes the CANONICAL FORM (0x...) but does not
// verify the identity actually exists in the graph. A made-up 0x address would
// otherwise be treated as "resolved" and traced, in violation of R2/R3.
// This confirms existence for candidates that already look canonical.
function identityExistenceQuery(id: string, identityId: string): { id: string; query: string } {
  return {
    id,
    query: [
      `MATCH (i:Identity {identity_id: "${escapeCypherString(identityId)}"})`,
      'RETURN i.identity_id AS identity_id',
      'LIMIT 1',
    ].join(' '),
  }
}

function identityMemberAddressesQuery(identityKeys: string[]): { id: string; query: string } {
  const predicates = identityKeys.map((identityKey) => `i.identity_id = "${escapeCypherString(identityKey)}"`)
  return {
    id: 'identity_member_addresses',
    query: [
      'MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address)',
      `WHERE ${predicates.join(' OR ')}`,
      'RETURN i.identity_id AS identity_id, collect(m.address) AS member_addresses',
      `LIMIT ${identityKeys.length}`,
    ].join(' '),
  }
}

/**
 * Resolve public tool address inputs to canonical identity keys.
 *
 * Inputs already in canonical 0x form (with or without the network prefix)
 * are derived locally as `<network>:<lowercase 0x form>`. Any other member
 * form (for example an SS58 substrate address) is resolved through the
 * indexed `(:Address {address})<-[:HAS_ADDRESS]-(:Identity)` lookup.
 * Inputs the graph cannot resolve are passed through unchanged.
 */
// Resolves each raw input to its canonical identity_id via the graph's Address
// node: (:Identity)-[:HAS_ADDRESS]->(:Address {address: $raw}). Inputs that do
// not resolve (no matching Address/Identity in the active topology) are
// OMITTED from the returned map -- callers must not fall back to treating the
// raw input as an identity_id (network:<raw address> is never a valid
// identity_id; identities are keyed network:<canonical form>). Use
// resolved.has(input) to distinguish "resolved to X" from "did not resolve".
export async function resolveIdentityKeys(
  remoteClient: Client,
  network: string,
  inputs: string[],
  topologyScope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const pendingAddressLookup: string[] = []
  const pendingCanonicalCandidate = new Map<string, string>()
  for (const input of [...new Set(inputs.map((value) => value.trim()).filter(Boolean))]) {
    const canonical = canonicalIdentityKeyFor(network, memberFormOf(input, network))
    if (canonical) pendingCanonicalCandidate.set(input, canonical)
    else pendingAddressLookup.push(input)
  }
  if (pendingAddressLookup.length === 0 && pendingCanonicalCandidate.size === 0) return resolved

  const addressQueries = pendingAddressLookup.map((input, index) => ({
    input,
    ...memberAddressResolutionQuery(`resolve_member_address_${index + 1}`, memberFormOf(input, network)),
  }))
  const canonicalInputs = [...pendingCanonicalCandidate.keys()]
  const existenceQueries = canonicalInputs.map((input, index) => ({
    input,
    ...identityExistenceQuery(`resolve_identity_exists_${index + 1}`, pendingCanonicalCandidate.get(input)!),
  }))
  const batch = await callGraphBatch(
    remoteClient,
    network,
    [...addressQueries, ...existenceQueries].map(({ id, query }) => ({ id, query })),
    topologyScope,
  )
  const failures: QueryFailure[] = []
  for (const { input, id } of addressQueries) {
    const rows = optionalResultsFor(batch, id, failures)
    const identityId = firstString(rows[0]?.['identity_id'])
    if (identityId) resolved.set(input, identityId)
  }
  for (const { input, id } of existenceQueries) {
    const rows = optionalResultsFor(batch, id, failures)
    const identityId = firstString(rows[0]?.['identity_id'])
    if (identityId) resolved.set(input, identityId)
  }
  return resolved
}

type IdentityDisplayInfo = {
  canonical_identity_key: string
  address: string
  member_addresses: string[]
}

function collectIdentityKeys(value: unknown, network: string, keys = new Set<string>()): Set<string> {
  const prefix = `${network}:`
  if (typeof value === 'string') {
    if (value.startsWith(prefix)) keys.add(value)
    return keys
  }
  if (Array.isArray(value)) {
    for (const item of value) collectIdentityKeys(item, network, keys)
    return keys
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectIdentityKeys(item, network, keys)
  }
  return keys
}

async function identityDisplayMap(
  remoteClient: Client,
  network: string,
  identityKeys: string[],
  preferredByIdentity = new Map<string, string>(),
  topologyScope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE,
): Promise<Map<string, IdentityDisplayInfo>> {
  const uniqueKeys = [...new Set(identityKeys.filter((key) => key.startsWith(`${network}:`)))]
  const memberRows = new Map<string, string[]>()
  if (uniqueKeys.length > 0) {
    try {
      const batch = await callGraphBatch(remoteClient, network, [identityMemberAddressesQuery(uniqueKeys)], topologyScope)
      for (const row of optionalResultsFor(batch, 'identity_member_addresses', [])) {
        const identityKey = firstString(row['identity_id'])
        if (!identityKey) continue
        memberRows.set(identityKey, stringArrayValue(row['member_addresses']) ?? [])
      }
    } catch {
      // Publicization is best-effort. Tool execution should not fail only
      // because member-address decoration was unavailable.
    }
  }

  return new Map(uniqueKeys.map((identityKey) => {
    const preferred = preferredByIdentity.get(identityKey)
    const members = memberRows.get(identityKey) ?? []
    const address = preferred ? memberFormOf(preferred, network) : members[0] ?? memberFormOf(identityKey, network)
    return [identityKey, {
      canonical_identity_key: identityKey,
      address,
      member_addresses: members,
    }]
  }))
}

function replaceIdentityKeysDeep(value: unknown, displayByIdentity: Map<string, IdentityDisplayInfo>): unknown {
  if (typeof value === 'string') return replaceIdentityKeysInText(value, displayByIdentity)
  if (Array.isArray(value)) return value.map((item) => replaceIdentityKeysDeep(item, displayByIdentity))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceIdentityKeysDeep(entry, displayByIdentity)]),
  )
}

function replaceIdentityKeysInText(value: string, displayByIdentity: Map<string, IdentityDisplayInfo>): string {
  return [...displayByIdentity.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((text, [identityKey, info]) => text.replaceAll(identityKey, info.address), value)
}

function identityResolution(displayByIdentity: Map<string, IdentityDisplayInfo>): IdentityDisplayInfo[] {
  return [...displayByIdentity.values()]
    .sort((a, b) => a.address.localeCompare(b.address))
}

async function publicizeIdentityResult<T extends {
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}>(
  remoteClient: Client,
  network: string,
  result: T,
  preferredByIdentity = new Map<string, string>(),
  topologyScope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE,
): Promise<T> {
  const identityKeys = [
    ...collectIdentityKeys(result.summaryText, network),
    ...collectIdentityKeys(result.structuredContent, network),
    ...collectIdentityKeys(result.graphData, network),
  ]
  const displayByIdentity = await identityDisplayMap(remoteClient, network, identityKeys, preferredByIdentity, topologyScope)
  if (displayByIdentity.size === 0) return result
  return {
    ...result,
    summaryText: replaceIdentityKeysInText(result.summaryText, displayByIdentity),
    structuredContent: {
      ...(replaceIdentityKeysDeep(result.structuredContent, displayByIdentity) as Record<string, unknown>),
      identity_resolution: identityResolution(displayByIdentity),
    },
    graphData: replaceIdentityKeysDeep(result.graphData, displayByIdentity) as Record<string, unknown>,
  }
}

function graphArray(graphData: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = graphData[key]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function addressProfileQuery(address: string, topologyScope: TopologyScope): { id: string; query: string } {
  // risk_score/risk_level are a live_topology-only "slim live risk verdict" on
  // :Identity (see ops/memgql/README.md); the archive_topology StarRocks
  // mapping never defines them, so projecting them there hard-errors the
  // whole query instead of nulling gracefully. Real risk scores for archive
  // come from the separate USE facts query (addressRiskScoreQuery).
  const riskFields = topologyScope === 'archive_topology' ? '' : ', a.risk_score AS live_risk_score, a.risk_level AS live_risk_level'
  return {
    id: 'address_profile',
    query: [
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})`,
      `RETURN a.identity_id AS address, a.labels AS display_labels, a.labels AS system_labels, a.is_exchange AS is_exchange${riskFields}`,
      'LIMIT 1',
    ].join(' '),
  }
}

function memberAddressesQuery(address: string): { id: string; query: string } {
  // No collect(): MemGQL translates collect() to MySQL's JSON_ARRAYAGG, which
  // StarRocks rejects (memgraph/memgraph#4178, upstream, unfixed as of 0.6.3).
  // Return one row per member address and aggregate client-side instead.
  return {
    id: 'member_addresses',
    query: [
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_ADDRESS]->(m:Address)`,
      'RETURN m.address AS member_address',
      'LIMIT 50',
    ].join(' '),
  }
}

function addressFeatureQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_feature',
    query: [
      'USE facts',
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_FEATURE]->(feature:AddressFeature)`,
      'RETURN feature.degree_in AS degree_in, feature.degree_out AS degree_out, feature.degree_total AS degree_total, feature.tx_in_count AS tx_in_count, feature.tx_out_count AS tx_out_count, feature.tx_total_count AS tx_total_count, feature.total_volume_usd AS total_volume_usd, feature.total_in_usd AS total_in_usd, feature.total_out_usd AS total_out_usd, feature.net_flow_usd AS net_flow_usd, feature.first_activity_timestamp AS first_activity_timestamp, feature.last_activity_timestamp AS last_activity_timestamp, feature.activity_span_days AS activity_span_days',
      'LIMIT 1',
    ].join(' '),
  }
}

function addressRiskScoreQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_risk_score',
    query: [
      'USE facts',
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_RISK_SCORE]->(risk:RiskScore)`,
      'RETURN risk.risk_score AS ml_risk_score, risk.risk_level AS ml_risk_level, risk.window_days AS risk_window_days, risk.processing_date AS risk_processing_date, risk.xgboost_model_version AS xgboost_model_version, risk.gnn_model_version AS gnn_model_version, risk.shap_top_features AS shap_top_features',
      'LIMIT 1',
    ].join(' '),
  }
}

function addressLabelRiskQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_label_risk',
    query: [
      'USE facts',
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[:HAS_LABEL]->(label:AddressLabel)`,
      'RETURN label.label AS label, label.risk_level AS risk_level, label.trust_level AS trust_level, label.confidence_score AS confidence_score, label.source AS source, label.entity_type AS entity_type, label.updated_timestamp AS updated_timestamp',
      // Deterministic subset: an unordered LIMIT let the surfaced labels —
      // and therefore the derived risk level — flap between runs for
      // label-heavy identities.
      'ORDER BY label.updated_timestamp DESC',
      'LIMIT 10',
    ].join(' '),
  }
}

function flowEdgeMap(variableName: string): string {
  return `{amount_usd_sum: ${variableName}.amount_usd_sum, tx_count: ${variableName}.tx_count, first_seen_timestamp: ${variableName}.first_seen_timestamp, last_seen_timestamp: ${variableName}.last_seen_timestamp, first_tx_id: ${variableName}.first_tx_id, last_tx_id: ${variableName}.last_tx_id}`
}

function pathNodeMap(variableName: string, topologyScope: TopologyScope): string {
  // See addressProfileQuery: risk_score/risk_level aren't in the archive_topology
  // Identity mapping, so they must be omitted from path_nodes on that scope.
  const riskFields = topologyScope === 'archive_topology' ? '' : `, risk_score: ${variableName}.risk_score, risk_level: ${variableName}.risk_level`
  return `{address: ${variableName}.identity_id, labels: ${variableName}.labels, system_labels: ${variableName}.labels, is_exchange: ${variableName}.is_exchange${riskFields}}`
}

function exchangeOutflowQueries(address: string, topologyScope: TopologyScope): Array<{ id: string; query: string }> {
  return Array.from({ length: 3 }, (_, index) => exchangeOutflowQueryAtDepth(address, index + 1, topologyScope))
}

function exchangeOutflowQueryAtDepth(address: string, depth: number, topologyScope: TopologyScope): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['a', ...intermediateVariables, 'exchange']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'exchange' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Identity)`
  }).join('')
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const depositVariable = nodeVariables[nodeVariables.length - 2]!
  const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1]!
  return {
    id: `exchange_outflows_${depth}`,
    query: [
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})${relationshipChain}`,
      `WHERE a.identity_id <> exchange.identity_id AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "outflow" AS direction, exchange.identity_id AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${depositVariable}.identity_id AS deposit_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => pathNodeMap(nodeVariable, topologyScope)).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      'ORDER BY hops ASC',
      'LIMIT 200',
    ].join(' '),
  }
}

function exchangeInflowQueries(address: string, topologyScope: TopologyScope): Array<{ id: string; query: string }> {
  return Array.from({ length: 3 }, (_, index) => exchangeInflowQueryAtDepth(address, index + 1, topologyScope))
}

function exchangeInflowQueryAtDepth(address: string, depth: number, topologyScope: TopologyScope): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['exchange', ...intermediateVariables, 'a']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'a' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Identity)`
  }).join('')
  const intermediatePredicates = intermediateVariables.map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const withdrawalVariable = nodeVariables[1]!
  const terminalEdgeVariable = edgeVariables[edgeVariables.length - 1]!
  return {
    id: `exchange_inflows_${depth}`,
    query: [
      `MATCH (exchange:Identity)${relationshipChain}`,
      `WHERE a.identity_id = "${escapeCypherString(address)}" AND a.identity_id <> exchange.identity_id AND exchange.is_exchange IS NOT NULL${intermediatePredicates.length > 0 ? ` AND ${intermediatePredicates.join(' AND ')}` : ''}`,
      `RETURN "inflow" AS direction, exchange.identity_id AS exchange_address, exchange.labels AS exchange_display_labels, exchange.labels AS exchange_system_labels, ${withdrawalVariable}.identity_id AS withdrawal_address, ${depth} AS hops, ${terminalEdgeVariable}.amount_usd_sum AS amount_usd_sum, ${terminalEdgeVariable}.tx_count AS tx_count, ${terminalEdgeVariable}.first_seen_timestamp AS first_seen_timestamp, ${terminalEdgeVariable}.last_seen_timestamp AS last_seen_timestamp, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => pathNodeMap(nodeVariable, topologyScope)).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      'ORDER BY hops ASC',
      'LIMIT 200',
    ].join(' '),
  }
}

function connectionProbeQuery(address: string, compareAddress: string): { id: string; query: string } {
  return {
    id: 'connection_probe',
    query: [
      `MATCH (a:Identity {identity_id: "${escapeCypherString(address)}"})-[r:FLOWS_TO]-(b:Identity {identity_id: "${escapeCypherString(compareAddress)}"})`,
      'RETURN [a.identity_id, b.identity_id] AS addresses, 1 AS hops',
      'LIMIT 5',
    ].join(' '),
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
  const shapDrivers = stringArrayValue(profile['shap_top_features'])
  if (shapDrivers?.length) drivers.push(`Top model features: ${shapDrivers.join(', ')}`)

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
  if (numberValue(profile['ml_risk_score']) !== undefined) {
    sources.push({
      family: 'ml_risk_score',
      layer: 'facts',
      view: 'facts_risk_scores_view',
      xgboost_model_version: profile['xgboost_model_version'],
      gnn_model_version: profile['gnn_model_version'],
      processing_date: profile['risk_processing_date'],
      window_days: profile['risk_window_days'],
    })
  }
  if (labelRows.length > 0) {
    sources.push({
      family: 'label_risk',
      layer: 'facts',
      view: 'facts_address_labels_view',
      labels: labelRows.map((row) => ({
        label: row['label'],
        risk_level: row['risk_level'],
        trust_level: row['trust_level'],
        confidence_score: row['confidence_score'],
        source: row['source'],
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
  const mlRiskScore = firstNumber(profile['ml_risk_score'])
  // UNSCORED is the model's explicit abstention (calibrated-scoring release):
  // the score exists for transparency but carries no stance — deriving a
  // severity band from it would silently launder an abstention into a
  // confident verdict (typically "low"). Fall back to labels/exchange
  // exposure and say so.
  const mlAbstained = isUnscoredRiskLevel(profile['ml_risk_level'])
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
  const inputAddress = options.address.trim()
  const network = options.network.trim()
  const compareInput = options.compareAddress?.trim() ?? ''
  const topologyScope = options.topologyScope ?? DEFAULT_TOPOLOGY_SCOPE
  if (!inputAddress) throw new Error('address is required')
  if (!network) throw new Error('network is required')
  const resolvedKeys = await resolveIdentityKeys(remoteClient, network, [inputAddress, ...(compareInput ? [compareInput] : [])], topologyScope)
  if (!resolvedKeys.has(inputAddress)) {
    return {
      summaryText: `Address risk for ${network}:${inputAddress}\n\nUnresolved: no Identity/Address found for "${inputAddress}" in ${topologyScope}. The address may not have on-chain activity in this network or topology scope; try topology_scope=archive_topology for full history.`,
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'aml_address_risk',
        facts: {
          subject: { network, addresses: [inputAddress], topology_scope: topologyScope },
          unresolved: [inputAddress],
        },
      },
      graphData: { schema: 'chain-insights.graph.v1', nodes: [], edges: [], flows: [], edge_anchors: [], metadata: { address: inputAddress, network, generated_at: new Date().toISOString() } },
    }
  }
  const address = resolvedKeys.get(inputAddress)!
  const compareUnresolved = compareInput !== '' && !resolvedKeys.has(compareInput)
  const compareAddress = compareInput && !compareUnresolved ? resolvedKeys.get(compareInput)! : ''
  const preferredByIdentity = new Map<string, string>([
    [address, inputAddress],
    ...(compareAddress ? [[compareAddress, compareInput] as [string, string]] : []),
  ])

  const queries = [
    addressProfileQuery(address, topologyScope),
    memberAddressesQuery(address),
    addressFeatureQuery(address),
    addressRiskScoreQuery(address),
    addressLabelRiskQuery(address),
    ...exchangeOutflowQueries(address, topologyScope),
    ...exchangeInflowQueries(address, topologyScope),
    ...(compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{ id: 'connection_probe', query: 'MATCH (n:Identity {identity_id: "__chain_insights_noop__"}) RETURN n.identity_id AS noop LIMIT 0' }]),
  ]
  const batch = await callGraphBatch(remoteClient, network, queries, topologyScope)
  const partialQueryFailures: QueryFailure[] = []
  const memberAddressRows = optionalResultsFor(batch, 'member_addresses', partialQueryFailures)
  const memberAddressesFromRows = memberAddressRows.map((row) => firstString(row['member_address'])).filter((value): value is string => Boolean(value))
  const profile: Record<string, unknown> = {
    address,
    ...(optionalResultsFor(batch, 'address_profile', partialQueryFailures)[0] ?? {}),
    ...(memberAddressesFromRows.length > 0 ? { member_addresses: memberAddressesFromRows } : {}),
    ...(optionalResultsFor(batch, 'address_feature', partialQueryFailures)[0] ?? {}),
    ...(optionalResultsFor(batch, 'address_risk_score', partialQueryFailures)[0] ?? {}),
  }
  const labelRows = optionalResultsFor(batch, 'address_label_risk', partialQueryFailures)
  const outflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_outflows_', partialQueryFailures))
  const inflows = enrichExchangeRows(optionalResultsWithPrefix(batch, 'exchange_inflows_', partialQueryFailures))
  const connections = compareAddress ? optionalResultsFor(batch, 'connection_probe', partialQueryFailures) : []
  const exchangeRows = [...outflows, ...inflows]
  const graphData = buildRiskGraph(address, profile, exchangeRows, network)
  const risk = riskAssessment(profile, labelRows, exchangeRows)
  const memberAddresses = stringArrayValue(profile['member_addresses']) ?? []
  const liveRiskScore = numberValue(profile['live_risk_score'])
  const liveRiskLevel = firstString(profile['live_risk_level'])
  const liveNodeVerdict = liveRiskScore !== undefined || liveRiskLevel
    ? {
        ...(liveRiskScore !== undefined ? { risk_score: liveRiskScore } : {}),
        ...(liveRiskLevel ? { risk_level: liveRiskLevel } : {}),
        source: 'live_topology_node',
      }
    : undefined

  const lines = [
    `Address risk for ${network}:${address}`,
    '',
    `Risk: ${risk['level']} (${formatRiskScore(risk['score'])})`,
    `Confidence: ${risk['confidence']}`,
    `Recommendation: ${risk['recommendation']}`,
    ...(liveNodeVerdict ? [`Live node triage: ${liveRiskLevel ?? 'unknown'} (${formatRiskScore(liveRiskScore)})`] : []),
    `Member addresses: ${memberAddresses.join(', ') || 'unknown'}.`,
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
  if (compareUnresolved) {
    lines.push('', `Unresolved compare_address: no Identity/Address found for "${compareInput}" in ${topologyScope}; comparison skipped.`)
  }
  if (partialQueryFailures.length > 0) {
    lines.push('', 'Partial query failures', partialQueryFailures.map((failure) => `- ${failure.id}: ${failure.error}`).join('\n'))
  }
  const summaryText = lines.join('\n')
  const baseResult = {
    summaryText,
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'aml_address_risk',
      facts: {
        subject: {
          network,
          addresses: compareAddress ? [address, compareAddress] : [address],
          ...(memberAddresses.length > 0 ? { member_addresses: memberAddresses } : {}),
          topology_scope: topologyScope,
        },
        risk: {
          ...risk,
          ...(liveNodeVerdict ? { live_node: liveNodeVerdict } : {}),
        },
        exchange_behavior: {
          outflows,
          inflows,
        },
        connection: compareAddress ? { compare_address: compareAddress, paths: connections } : undefined,
        unresolved: compareUnresolved ? [compareInput] : undefined,
        partial_query_errors: partialQueryFailures.length > 0 ? partialQueryFailures : undefined,
      },
      artifacts: statelessArtifacts(),
      evidence: [{
        evidence_type: 'tool_summary',
        summary: `aml_address_risk ${address} completed for ${network}`,
      }],
    },
    graphData,
  }
  const publicResult = await publicizeIdentityResult(remoteClient, network, baseResult, preferredByIdentity, topologyScope)
  const publicSubject = publicResult.structuredContent.facts as Record<string, unknown> | undefined
  const publicSubjectAddresses = (publicSubject?.subject as Record<string, unknown> | undefined)?.addresses
  const publicSubjectAddress = Array.isArray(publicSubjectAddresses) && typeof publicSubjectAddresses[0] === 'string'
    ? publicSubjectAddresses[0]
    : memberFormOf(inputAddress, network)
  const publicCompareAddress = Array.isArray(publicSubjectAddresses) && typeof publicSubjectAddresses[1] === 'string'
    ? publicSubjectAddresses[1]
    : compareAddress
  const artifacts = options.writeArtifacts ? await writeAddressRiskArtifacts(
    network,
    publicSubjectAddress,
    publicCompareAddress,
    publicResult.graphData,
    exchangeRows,
    publicResult.summaryText,
  ) : statelessArtifacts()
  const evidence = artifactEvidence(artifacts)

  return {
    summaryText: publicResult.summaryText,
    structuredContent: {
      ...publicResult.structuredContent,
      artifacts,
      evidence: [...evidence, {
        evidence_type: 'tool_summary',
        summary: `aml_address_risk ${inputAddress} completed for ${network}`,
      }],
    },
    graphData: publicResult.graphData,
  }
}

type TraceSeedRole = 'victim' | 'suspect' | 'deposit'
type TraceToolName = 'aml_trace_victim_funds' | 'aml_trace_suspect_funds' | 'aml_trace_deposit_sources'
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
  incidentTimestampMs?: number
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  writeArtifacts?: boolean
  topologyScope?: TopologyScope
}

export interface TraceSuspectFundsOptions {
  suspectAddresses: string | string[]
  network: string
  incidentTimestampMs?: number
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  writeArtifacts?: boolean
  topologyScope?: TopologyScope
}

export interface TraceDepositSourcesOptions {
  depositAddresses: string | string[]
  network: string
  timeRange?: { from_ms?: number; to_ms?: number }
  maxHops?: number
  minAmountSum?: number
  writeArtifacts?: boolean
  topologyScope?: TopologyScope
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

function traceActivityWindow(incidentTimestampMs: number | undefined, timeRange: { from_ms?: number; to_ms?: number } | undefined): TraceActivityWindow | undefined {
  const fromMs = timeRange?.from_ms ?? incidentTimestampMs
  if (fromMs === undefined) return undefined
  return { fromMs, ...(timeRange?.to_ms !== undefined ? { toMs: timeRange.to_ms } : {}) }
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
  if (!Object.values(run.files).some((value) => value.length > 0)) {
    return {
      artifacts_written: false,
      artifact_mode: 'stateless',
    }
  }
  return {
    graph_json: run.files.graph,
    graph_html: run.files.graphHtml,
    table_json: run.files.compactEvidence,
    flows_csv: run.files.table,
    table_html: run.files.tableHtml,
    report_md: run.files.report,
  }
}

function traceArtifactSummary(artifacts: Record<string, string>): string {
  return [
    'Files written:',
    `- compact evidence JSON: ${artifacts['table_json'] ?? ''}`,
    `- graph JSON: ${artifacts['graph_json'] ?? ''}`,
    `- graph HTML: ${artifacts['graph_html'] ?? ''}`,
    `- flows CSV: ${artifacts['flows_csv'] ?? ''}`,
    `- table HTML: ${artifacts['table_html'] ?? ''}`,
    `- report: ${artifacts['report_md'] ?? ''}`,
  ].join('\n')
}

function stripTraceFileSections(summaryText: string): string {
  const lines = summaryText.split('\n')
  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === 'Files written: disabled by stateless proxy mode.') {
      if (lines[index + 1] === '') index += 1
      continue
    }
    if (line === 'Files written:') {
      index += 1
      while (index < lines.length && lines[index]?.startsWith('- ')) {
        index += 1
      }
      if (lines[index] !== '') {
        index -= 1
      }
      continue
    }
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

function withTraceArtifactSummary(summaryText: string, artifacts: Record<string, string>): string {
  const cleaned = stripTraceFileSections(summaryText)
  return [
    cleaned,
    '',
    traceArtifactSummary(artifacts),
  ].filter((part) => part.length > 0).join('\n')
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

function traceEdgesForCsv(structuredContent: Record<string, unknown>): Array<Record<string, unknown>> {
  const edges = structuredContent['edges']
  return Array.isArray(edges)
    ? edges.filter((edge): edge is Record<string, unknown> => typeof edge === 'object' && edge !== null && !Array.isArray(edge))
    : []
}

function buildTraceTableHtml(tool: string, network: string, result: TraceToolResult): string {
  const headers = ['edge_id', 'from_address', 'to_address', 'amount_usd_sum', 'tx_count', 'first_tx_id', 'last_tx_id'] as const
  const body = traceEdgesForCsv(result.structuredContent).map((row) => {
    const rowValues = headers.map((header) => row[header] ?? '')
    return `<tr>${rowValues.map((value) => `<td>${htmlEscape(toCsvValue(value))}</td>`).join('')}</tr>`
  }).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(tool)} Trace Table</title>
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
  <h1>${htmlEscape(tool)} Trace Table</h1>
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

async function writeTraceArtifacts(tool: TraceToolName, network: string, result: TraceToolResult): Promise<{ artifacts: Record<string, string>; summaryText: string }> {
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
  const artifacts = {
    graph_json: graphPath,
    graph_html: graphHtmlPath,
    table_json: tableJsonPath,
    flows_csv: csvPath,
    table_html: tableHtmlPath,
    report_md: reportPath,
  }
  const existingEvidence = Array.isArray(result.structuredContent['evidence'])
    ? result.structuredContent['evidence'].filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : []
  const structuredForArtifact = {
    ...result.structuredContent,
    artifacts,
    evidence: [
      ...existingEvidence.filter((entry) => entry['evidence_type'] !== 'artifact_pointer'),
      ...artifactEvidence(artifacts),
    ],
  }
  const summaryText = withTraceArtifactSummary(result.summaryText, artifacts)
  const { generateInlineGraphHtml } = await import('../viz/html-generator.js')
  const csvHeaders = ['edge_id', 'from_address', 'to_address', 'amount_usd_sum', 'tx_count', 'first_tx_id', 'last_tx_id']
  const csv = [
    csvHeaders.join(','),
    ...traceEdgesForCsv(result.structuredContent).map((row) => csvHeaders
      .map((header) => JSON.stringify(String(row[header] ?? '')))
      .join(',')),
  ].join('\n') + '\n'
  await writeFile(graphPath, JSON.stringify(result.graphData, null, 2) + '\n', { mode: 0o600 })
  await writeFile(tableJsonPath, JSON.stringify(structuredForArtifact, null, 2) + '\n', { mode: 0o600 })
  await writeFile(csvPath, csv, { mode: 0o600 })
  await writeFile(tableHtmlPath, buildTraceTableHtml(tool, network, result), { mode: 0o600 })
  await writeFile(reportPath, summaryText + '\n', { mode: 0o600 })
  await writeFile(graphHtmlPath, generateInlineGraphHtml(result.graphData), { mode: 0o600 })
  return { artifacts, summaryText }
}

async function publicizeTraceResult(
  remoteClient: Client,
  network: string,
  result: TraceToolResult,
  preferredByIdentity: Map<string, string>,
  writeArtifacts: boolean,
  topologyScope: TopologyScope = DEFAULT_TOPOLOGY_SCOPE,
): Promise<TraceToolResult> {
  const publicResult = await publicizeIdentityResult(remoteClient, network, result, preferredByIdentity, topologyScope)
  if (!writeArtifacts) return publicResult
  const tool = typeof publicResult.structuredContent['tool'] === 'string'
    ? publicResult.structuredContent['tool'] as TraceToolName
    : 'aml_trace_victim_funds'
  const { artifacts, summaryText } = await writeTraceArtifacts(tool, network, publicResult)
  const existingEvidence = Array.isArray(publicResult.structuredContent['evidence'])
    ? publicResult.structuredContent['evidence'].filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : []
  return {
    ...publicResult,
    summaryText,
    structuredContent: {
      ...publicResult.structuredContent,
      artifacts,
      evidence: [
        ...existingEvidence.filter((entry) => entry['evidence_type'] !== 'artifact_pointer'),
        ...artifactEvidence(artifacts),
      ],
    },
  }
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
  tool: Extract<TraceToolName, 'aml_trace_victim_funds' | 'aml_trace_suspect_funds'>,
  seedRole: Extract<TraceSeedRole, 'victim' | 'suspect'>,
  network: string,
  runs: TraceRun[],
  options: {
    incidentTimestampMs?: number
    timeRange?: { from_ms?: number; to_ms?: number }
    activityWindow?: TraceActivityWindow
    maxHops?: number
    unresolved?: string[]
    topologyScope?: TopologyScope
    archiveHint?: string[]
    } = {},
): { summaryText: string; structuredContent: Record<string, unknown>; graphData: Record<string, unknown> } {
  const graphData = normalizeTraceGraphData(runs, network)
  const flows = graphRecords(graphData, 'flows')
  const deposits = graphRecords(graphData, 'deposits')
  const sourceMatches = graphRecords(graphData, 'source_matches')
  const reverseLeads = graphRecords(graphData, 'reverse_leads')
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
    ? ['aml_trace_deposit_sources', 'aml_address_risk']
    : ['aml_address_risk', 'graph_query_batch']

  const structuredContent = {
    schema: 'chain-insights.trace.v1',
    tool,
    network,
    input: {
      addresses: runs.map((run) => run.address),
      seed_role: seedRole,
      ...(options.incidentTimestampMs !== undefined ? { incident_timestamp_ms: options.incidentTimestampMs } : {}),
      ...(options.timeRange ? { time_range: options.timeRange } : {}),
      time_filter: options.activityWindow
        ? { from_ms: options.activityWindow.fromMs, ...(options.activityWindow.toMs !== undefined ? { to_ms: options.activityWindow.toMs } : {}) }
        : 'none',
      max_hops: options.maxHops ?? 3,
      topology_scope: options.topologyScope ?? DEFAULT_TOPOLOGY_SCOPE,
    },
    summary: {
      seed_count: runs.length,
      unresolved_count: options.unresolved?.length ?? 0,
      path_count: paths.length,
      edge_count: edges.length,
      candidate_suspect_count: seedRole === 'suspect' ? runs.length : 0,
      candidate_intermediate_count: [...addresses.values()].filter((entry) => entry.roles.has('candidate_intermediate')).length,
      candidate_deposit_count: depositAddresses.length,
      exchange_count: exchangeAddresses.length,
    },
    unresolved: options.unresolved ?? [],
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
    deposit_funding: {
      source_exchange_paths: sourceMatches.map((match) => ({
        deposit_address: match['deposit_address'],
        source_exchange: match['source_exchange'],
        source_labels: match['source_labels'],
        hops: match['hops'],
        path: match['path'],
        reason: 'Deposit candidate upstream cluster is exchange-funded (topology-grain CEX-to-CEX structure).',
      })),
      reverse_leads: reverseLeads.map((lead) => ({
        address: lead['address'],
        deposit_address: lead['deposit_address'],
        labels: lead['labels'],
        amount_usd: lead['amount_usd'],
        reason: lead['reason'],
      })),
    },
    candidate_labels: candidateLabels,
    artifacts,
    evidence: [
      ...artifactEvidenceEntries,
    ],
    continuation: {
      candidate_deposit_addresses: depositAddresses,
      candidate_suspect_addresses: seedRole === 'suspect' ? runs.map((run) => run.address) : [],
      candidate_victim_addresses: [],
      recommended_next_tools: recommendedNextTools,
      ...(sourceMatches.length > 0 ? { deposit_funding_note: 'One or more deposit candidates are exchange-funded upstream; consider aml_trace_deposit_sources on those deposits.' } : {}),
    },
    warnings: [
      ...(depositAddresses.length === 0 ? ['No exchange deposit candidates were connected in the queried topology.'] : []),
      ...(options.unresolved && options.unresolved.length > 0 ? [`${options.unresolved.length} input address(es) did not resolve to a known Identity and were not traced: ${options.unresolved.join(', ')}.`] : []),
      ...runs.flatMap((run) => run.result.tracebackWarnings ?? []),
      ...(options.archiveHint ?? []),
    ],
  }

  return {
    summaryText: [
      `${seedRole === 'victim' ? 'Trace victim funds' : 'Trace suspect funds'} complete for ${network}`,
      ...(options.unresolved && options.unresolved.length > 0
        ? [`Unresolved (no matching Identity/Address): ${options.unresolved.join(', ')}`]
        : []),
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
  const victimInputs = parseAddressList(options.victimAddresses)
  const knownSuspects = parseAddressList(options.knownSuspectAddresses)
  if (!network) throw new Error('network is required')
  if (victimInputs.length < 1) throw new Error('victim_addresses must contain at least 1 address')
  if (victimInputs.length > 5) throw new Error('victim_addresses cannot exceed 5 addresses')
  if (knownSuspects.length > 5) throw new Error('known_suspect_addresses cannot exceed 5 addresses')
  const topologyScope = options.topologyScope ?? DEFAULT_TOPOLOGY_SCOPE
  const resolvedVictims = await resolveIdentityKeys(remoteClient, network, victimInputs, topologyScope)
  const unresolvedVictims = victimInputs.filter((input) => !resolvedVictims.has(input))
  const victims = [...new Set(victimInputs.filter((input) => resolvedVictims.has(input)).map((input) => resolvedVictims.get(input)!))]
  const preferredByIdentity = new Map(victimInputs.filter((input) => resolvedVictims.has(input)).map((input) => [resolvedVictims.get(input)!, input] as [string, string]))
  const activityWindow = traceActivityWindow(options.incidentTimestampMs, options.timeRange)

  const runs: TraceRun[] = []
  for (const address of victims) {
    runs.push({
      role: 'victim',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
        activityWindow,
        includeDepositTraceback: true,
        evidenceSource: 'aml_trace_victim_funds',
        writeArtifacts: false,
        topologyScope,
      }),
    })
  }
  const foundNothing = runs.length > 0 && runs.every((run) => graphRecords(run.result.graphData, 'flows').length === 0)
  const archiveHint = await archiveRetryHint(remoteClient, network, topologyScope, foundNothing)
  const result = traceResultFromFundRuns('aml_trace_victim_funds', 'victim', network, runs, {
    incidentTimestampMs: options.incidentTimestampMs,
    timeRange: options.timeRange,
    activityWindow,
    maxHops: options.maxHops,
    unresolved: unresolvedVictims,
    topologyScope,
    archiveHint,
  })
  return publicizeTraceResult(remoteClient, network, result, preferredByIdentity, options.writeArtifacts !== false, topologyScope)
}

export async function traceSuspectFunds(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceSuspectFundsOptions,
): Promise<TraceToolResult> {
  const network = options.network.trim()
  const suspectInputs = parseAddressList(options.suspectAddresses)
  if (!network) throw new Error('network is required')
  if (suspectInputs.length < 1) throw new Error('suspect_addresses must contain at least 1 address')
  if (suspectInputs.length > 5) throw new Error('suspect_addresses cannot exceed 5 addresses')
  const topologyScope = options.topologyScope ?? DEFAULT_TOPOLOGY_SCOPE
  const resolvedSuspects = await resolveIdentityKeys(remoteClient, network, suspectInputs, topologyScope)
  const unresolvedSuspects = suspectInputs.filter((input) => !resolvedSuspects.has(input))
  const suspects = [...new Set(suspectInputs.filter((input) => resolvedSuspects.has(input)).map((input) => resolvedSuspects.get(input)!))]
  const preferredByIdentity = new Map(suspectInputs.filter((input) => resolvedSuspects.has(input)).map((input) => [resolvedSuspects.get(input)!, input] as [string, string]))
  const activityWindow = traceActivityWindow(options.incidentTimestampMs, options.timeRange)

  const runs: TraceRun[] = []
  for (const address of suspects) {
    runs.push({
      role: 'suspect',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
        activityWindow,
        includeDepositTraceback: true,
        evidenceSource: 'aml_trace_suspect_funds',
        writeArtifacts: false,
        topologyScope,
      }),
    })
  }
  const foundNothing = runs.length > 0 && runs.every((run) => graphRecords(run.result.graphData, 'flows').length === 0)
  const archiveHint = await archiveRetryHint(remoteClient, network, topologyScope, foundNothing)
  const result = traceResultFromFundRuns('aml_trace_suspect_funds', 'suspect', network, runs, {
    incidentTimestampMs: options.incidentTimestampMs,
    timeRange: options.timeRange,
    activityWindow,
    maxHops: options.maxHops,
    unresolved: unresolvedSuspects,
    topologyScope,
    archiveHint,
  })
  return publicizeTraceResult(remoteClient, network, result, preferredByIdentity, options.writeArtifacts !== false, topologyScope)
}

const REVERSE_DEPOSIT_SOURCES_LIMIT = 500

function reverseDepositSourceQueryAtDepth(
  depositAddresses: string[],
  depth: number,
  minAmountSum: number,
  window: TraceActivityWindow | undefined,
  topologyScope: TopologyScope,
): { id: string; query: string } {
  const intermediateVariables = Array.from({ length: Math.max(depth - 1, 0) }, (_, index) => `n${index + 1}`)
  const nodeVariables = ['source', ...intermediateVariables, 'deposit']
  const edgeVariables = Array.from({ length: depth }, (_, index) => `r${index + 1}`)
  const relationshipChain = edgeVariables.map((edgeVariable, index) => {
    const targetVariable = index === edgeVariables.length - 1 ? 'deposit' : intermediateVariables[index]!
    return `-[${edgeVariable}:FLOWS_TO]->(${targetVariable}:Identity)`
  }).join('')
  const depositPredicates = depositAddresses.map((address) => `deposit.identity_id = "${escapeCypherString(address)}"`)
  const nonExchangePredicates = ['source', ...intermediateVariables, 'deposit'].map((nodeVariable) => `${nodeVariable}.is_exchange IS NULL`)
  const amountPredicates = minAmountSum > 0 ? edgeVariables.map((edgeVariable) => `${edgeVariable}.amount_usd_sum >= ${minAmountSum}`) : []
  const windowPredicates = activityWindowPredicates(edgeVariables, window)
  return {
    id: `reverse_deposit_sources_${depth}`,
    query: [
      `MATCH (source:Identity)${relationshipChain}`,
      `WHERE (${depositPredicates.join(' OR ')}) AND source.identity_id <> deposit.identity_id AND ${[...nonExchangePredicates, ...amountPredicates, ...windowPredicates].join(' AND ')}`,
      `RETURN DISTINCT source.identity_id AS source_address, source.is_exchange AS source_is_exchange, deposit.identity_id AS deposit_address, deposit.is_exchange AS deposit_is_exchange, ${depth} AS hop, [${nodeVariables.map((nodeVariable) => `${nodeVariable}.identity_id`).join(', ')}] AS addresses, [${nodeVariables.map((nodeVariable) => pathNodeMap(nodeVariable, topologyScope)).join(', ')}] AS path_nodes, [${edgeVariables.map(flowEdgeMap).join(', ')}] AS edge_props`,
      `LIMIT ${REVERSE_DEPOSIT_SOURCES_LIMIT}`,
    ].join(' '),
  }
}

function rowNodeIsExchange(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isExchangeFlag(record['is_exchange']) ||
    hasExactExchangeLabel(stringArrayValue(record['labels'])) ||
    hasExactExchangeLabel(stringArrayValue(record['system_labels']))
}

function reverseDepositSourceRowUsesExchange(row: Record<string, unknown>): boolean {
  if (isExchangeFlag(row['source_is_exchange']) || isExchangeFlag(row['deposit_is_exchange'])) return true
  if (!Array.isArray(row['path_nodes'])) return false
  return row['path_nodes'].some(rowNodeIsExchange)
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function traceDepositSources(
  remoteClient: Client,
  _config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TraceDepositSourcesOptions,
): Promise<TraceToolResult> {
  const network = options.network.trim()
  const depositInputs = parseAddressList(options.depositAddresses)
  if (!network) throw new Error('network is required')
  if (depositInputs.length < 1) throw new Error('deposit_addresses must contain at least 1 address')
  if (depositInputs.length > 5) throw new Error('deposit_addresses cannot exceed 5 addresses')
  const topologyScope = options.topologyScope ?? DEFAULT_TOPOLOGY_SCOPE
  const resolvedDeposits = await resolveIdentityKeys(remoteClient, network, depositInputs, topologyScope)
  const unresolvedDeposits = depositInputs.filter((input) => !resolvedDeposits.has(input))
  const deposits = [...new Set(depositInputs.filter((input) => resolvedDeposits.has(input)).map((input) => resolvedDeposits.get(input)!))]
  const preferredByIdentity = new Map(depositInputs.filter((input) => resolvedDeposits.has(input)).map((input) => [resolvedDeposits.get(input)!, input] as [string, string]))
  const maxHops = clampInt(options.maxHops, 2, 1, 5)
  const minAmountSum = Math.max(0, options.minAmountSum ?? 0)
  const window = traceActivityWindow(undefined, options.timeRange)

  const batch = deposits.length > 0
    ? await callGraphBatch(
        remoteClient,
        network,
        Array.from({ length: maxHops }, (_, index) => reverseDepositSourceQueryAtDepth(deposits, index + 1, minAmountSum, window, topologyScope)),
        topologyScope,
      )
    : { facts: { queries: [] } }
  const failures: QueryFailure[] = []
  const rows: Array<Record<string, unknown>> = optionalResultsWithPrefix(batch, 'reverse_deposit_sources_', failures)
    .filter((row) => !reverseDepositSourceRowUsesExchange(row))
    .map((row, index) => ({
      ...row,
      path_id: `p${index + 1}`,
    }))
  const truncationWarnings = (batch.facts?.queries ?? [])
    .filter((entry) => entry.id?.startsWith('reverse_deposit_sources_') && (entry.results?.length ?? 0) >= REVERSE_DEPOSIT_SOURCES_LIMIT)
    .map((entry) => `${entry.id} hit the ${REVERSE_DEPOSIT_SOURCES_LIMIT}-row limit; results may be truncated.`)
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
      amount_usd_sum: edge['amount_usd_sum'],
      tx_count: edge['tx_count'],
      first_tx_id: edge['first_tx_id'],
      last_tx_id: edge['last_tx_id'],
      direction: 'traceback',
    })),
    flows: edges.map((edge, index) => ({
      hop: index + 1,
      src: edge['from_address'],
      dst: edge['to_address'],
      amount_usd_sum: edge['amount_usd_sum'] ?? 0,
      terminal_exchange: false,
    })),
    edge_anchors: [],
    metadata: {
      network,
      deposit_addresses: deposits,
      generated_at: new Date().toISOString(),
    },
  })
  const archiveHint = await archiveRetryHint(remoteClient, network, topologyScope, edges.length === 0)
  const summaryText = [
    `Trace deposit sources complete for ${network}`,
    ...(unresolvedDeposits.length > 0 ? [`Unresolved (no matching Identity/Address): ${unresolvedDeposits.join(', ')}`] : []),
    '',
    `Deposit seeds: ${deposits.join(', ') || 'none resolved'}`,
    `Reverse path(s): ${paths.length}`,
    `Shared upstream convergence: ${convergence.length}`,
  ].join('\n')
  const result = {
    summaryText,
    structuredContent: {
      schema: 'chain-insights.trace.v1',
      tool: 'aml_trace_deposit_sources',
      network,
      input: {
        addresses: deposits,
        seed_role: 'deposit',
        ...(options.timeRange ? { time_range: options.timeRange } : {}),
        ...(minAmountSum > 0 ? { min_amount_sum: minAmountSum } : {}),
        time_filter: window
          ? { from_ms: window.fromMs, ...(window.toMs !== undefined ? { to_ms: window.toMs } : {}) }
          : 'none',
        max_hops: maxHops,
        topology_scope: topologyScope,
      },
      summary: {
        seed_count: deposits.length,
        unresolved_count: unresolvedDeposits.length,
        path_count: paths.length,
        edge_count: edges.length,
        candidate_suspect_count: sourceToPathIds.size,
        candidate_intermediate_count: 0,
        candidate_deposit_count: deposits.length,
        exchange_count: 0,
      },
      unresolved: unresolvedDeposits,
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
      artifacts: statelessArtifacts(),
      evidence: failures.length > 0 ? [{ evidence_type: 'query_summary', summary: `partial query failures: ${failures.length}` }] : [],
      continuation: {
        candidate_deposit_addresses: deposits,
        candidate_suspect_addresses: candidateSuspects,
        candidate_victim_addresses: [],
        recommended_next_tools: candidateSuspects.length > 0
          ? ['aml_trace_suspect_funds', 'aml_address_risk']
          : ['aml_address_risk', 'graph_query_batch'],
      },
      warnings: [
        ...(paths.length === 0 ? ['No upstream sources were connected in the queried topology.'] : []),
        ...(unresolvedDeposits.length > 0 ? [`${unresolvedDeposits.length} input address(es) did not resolve to a known Identity and were not traced: ${unresolvedDeposits.join(', ')}.`] : []),
        ...truncationWarnings,
        ...archiveHint,
      ],
    },
    graphData,
  }
  return publicizeTraceResult(remoteClient, network, result, preferredByIdentity, options.writeArtifacts !== false, topologyScope)
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
  const trustedInputs = parseAddressList(options.trustedAddresses)
  const untrustedInputs = parseAddressList(options.untrustedAddresses)
  if (!network) throw new Error('network is required')
  if (trustedInputs.length < 1) throw new Error('trusted_addresses must contain at least 1 address')
  if (trustedInputs.length > 5) throw new Error('trusted_addresses cannot exceed 5 addresses')
  if (untrustedInputs.length > 5) throw new Error('untrusted_addresses cannot exceed 5 addresses')
  const resolvedTrackInputs = await resolveIdentityKeys(remoteClient, network, [...trustedInputs, ...untrustedInputs])
  const trusted = [...new Set(trustedInputs.map((input) => resolvedTrackInputs.get(input) ?? input))]
  const untrusted = [...new Set(untrustedInputs.map((input) => resolvedTrackInputs.get(input) ?? input))]
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
