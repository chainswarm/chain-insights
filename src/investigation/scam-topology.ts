import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'

export type ScamTopologyScope = 'history' | 'incident' | 'compare'
export type ScamTopologyGraphScope = 'history' | 'incident'
export type ScamTopologyScopeMembership = 'history_only' | 'incident_only' | 'overlap'

export interface ScamTopologyOptions {
  network: string
  victimAddresses?: string | string[]
  scammerAddresses?: string | string[]
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  scope?: ScamTopologyScope
  sinceTimestampMs?: number
}

export type ScamTopologySeedRole = 'victim' | 'scammer'

export interface ScamTopologyLabelCandidate {
  address: string
  label: string
  address_type: 'SCAM'
  address_subtype: 'scam_seed' | 'laundering_intermediate' | 'exchange_deposit_candidate'
  trust_level: 'blacklisted' | 'candidate'
  risk_level: 'critical' | 'high'
  confidence_score: number
  promotion_status: 'promote_confirmed' | 'review_required'
  source: 'scam_topology'
  evidence: Array<Record<string, unknown>>
}

export interface ScamTopologyCaseRole {
  address: string
  role:
    | ScamTopologySeedRole
    | 'laundering_intermediate'
    | 'exchange_deposit_candidate'
    | 'exchange_endpoint'
    | 'context_boundary'
    | 'continue_from_address'
  seed_address?: string
  seed_role?: ScamTopologySeedRole
}

export type ScamTopologyEdgeRelation = 'seed_outflow' | 'traversal_edge' | 'terminal_exchange' | 'context_boundary'

export interface ScamTopologyTopologyEdge {
  relation: ScamTopologyEdgeRelation
  src: string
  dst: string
  hop: number
  graph_scope: ScamTopologyGraphScope
  topology_graph: 'archive_topology' | 'live_topology'
  scope_membership?: ScamTopologyScopeMembership
  graph_scopes?: ScamTopologyGraphScope[]
  seed_address?: string
  seed_role?: ScamTopologySeedRole
  amount_sum?: number
  amount_usd_sum?: number
  tx_count?: number
  first_seen_timestamp?: number
  last_seen_timestamp?: number
  first_tx_id?: string
  last_tx_id?: string
  src_labels: string[]
  dst_labels: string[]
  src_is_exchange: boolean
  dst_is_exchange: boolean
}

export interface ScamTopologyInfrastructureFlow {
  relation: never
  src: string
  dst: string
}

export interface ScamTopologyResult {
  summaryText: string
  structuredContent: {
    schema: 'chain-insights.result.v1'
    tool: 'scam_topology'
    facts: {
      network: string
      victim_addresses: string[]
      scammer_addresses: string[]
      scope: ScamTopologyScope
      since_timestamp_ms?: number
      topology_graphs: Array<'archive_topology' | 'live_topology'>
      topology_edges: ScamTopologyTopologyEdge[]
      intermediaries: string[]
      terminal_points: Array<Record<string, unknown>>
      investigation_hints: Array<Record<string, unknown>>
      label_candidates: ScamTopologyLabelCandidate[]
      case_roles: ScamTopologyCaseRole[]
      safety_decisions: Array<Record<string, unknown>>
      infrastructure_anchors: string[]
      infrastructure_flows: ScamTopologyInfrastructureFlow[]
      runs: Array<Record<string, unknown>>
    }
    hint: string
  }
  graphData: Record<string, unknown>
}

type RemoteToolResult = {
  content?: ContentBlock[]
  isError?: boolean
}

type ParsedGraphBatch = {
  facts?: {
    queries?: Array<{
      id?: string
      ok?: boolean
      results?: Array<Record<string, unknown>>
      error?: string
    }>
  }
}

type Seed = {
  address: string
  role: ScamTopologySeedRole
}

type FrontierEntry = {
  address: string
  seedAddress: string
  seedRole: ScamTopologySeedRole
}

type TraversalRun = {
  graphScope: ScamTopologyGraphScope
  topologyGraph: 'archive_topology' | 'live_topology'
  edges: ScamTopologyTopologyEdge[]
}

const SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS = 600
const SCAM_TOPOLOGY_MAX_BATCH_QUERIES = 20

function parseAddressList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return [...new Set(raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))]
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.map(String).map((entry) => entry.trim()).filter(Boolean)
      } catch {
        // Fall back to comma splitting below.
      }
    }
    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
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

async function callGraphBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedGraphBatch> {
  const result = await remoteClient.callTool({
    name: 'graph_query_batch',
    arguments: {
      network,
      queries,
      per_query_timeout_seconds: SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS,
    },
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function graphForScope(graphScope: ScamTopologyGraphScope): 'archive_topology' | 'live_topology' {
  return graphScope === 'history' ? 'archive_topology' : 'live_topology'
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

function hasExchangeLabel(labels: string[]): boolean {
  return labels.some((label) => label.toLowerCase() === 'exchange' || label.toLowerCase().includes('exchange'))
}

function isExchangeEndpoint(labels: string[], isExchange: unknown, roles: string[]): boolean {
  return isExchangeFlag(isExchange) || hasExchangeLabel(labels) || roles.some((role) => role.toLowerCase().includes('exchange'))
}

function addressPredicate(addresses: string[]): string {
  return addresses
    .map((address) => `src.address = "${escapeCypherString(address)}"`)
    .join(' OR ')
}

function traversalProjection(): string {
  return [
    'src.address AS src',
    'dst.address AS dst',
    'src.labels AS src_labels',
    'dst.labels AS dst_labels',
    'src.roles AS src_roles',
    'dst.roles AS dst_roles',
    'src.is_exchange AS src_is_exchange',
    'dst.is_exchange AS dst_is_exchange',
    'r.amount_sum AS amount_sum',
    'r.amount_usd_sum AS amount_usd_sum',
    'r.tx_count AS tx_count',
    'r.first_seen_timestamp AS first_seen_timestamp',
    'r.last_seen_timestamp AS last_seen_timestamp',
    'r.first_tx_id AS first_tx_id',
    'r.last_tx_id AS last_tx_id',
  ].join(', ')
}

function frontierQuery(
  graphScope: ScamTopologyGraphScope,
  sourceAddress: string,
  hop: number,
  sourceIndex: number | undefined,
  perAddressLimit: number,
  minAmountSum: number | undefined,
  sinceTimestampMs: number | undefined,
): { id: string; query: string } {
  const where = [
    `(${addressPredicate([sourceAddress])})`,
    'src.address <> dst.address',
  ]
  if (minAmountSum !== undefined) where.push(`r.amount_sum >= ${minAmountSum}`)
  if (graphScope === 'incident' && sinceTimestampMs !== undefined) {
    where.push(`r.last_seen_timestamp >= ${sinceTimestampMs}`)
  }

  return {
    id: sourceIndex === undefined ? `${graphScope}_hop_${hop}` : `${graphScope}_hop_${hop}_source_${sourceIndex}`,
    query: [
      `USE ${graphForScope(graphScope)}`,
      'MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)',
      `WHERE ${where.join(' AND ')}`,
      `RETURN ${traversalProjection()}`,
      'ORDER BY r.amount_sum DESC',
      `LIMIT ${perAddressLimit}`,
    ].join(' '),
  }
}

function edgeFromRow(
  row: Record<string, unknown>,
  graphScope: ScamTopologyGraphScope,
  hop: number,
  context: FrontierEntry,
): ScamTopologyTopologyEdge | null {
  const src = stringValue(row['src']) ?? stringValue(row['from_address'])
  const dst = stringValue(row['dst']) ?? stringValue(row['to_address'])
  if (!src || !dst || src === dst) return null

  const srcLabels = stringArray(row['src_labels'])
  const dstLabels = stringArray(row['dst_labels'])
  const srcRoles = stringArray(row['src_roles'])
  const dstRoles = stringArray(row['dst_roles'])
  const srcIsExchange = isExchangeEndpoint(srcLabels, row['src_is_exchange'], srcRoles)
  const dstIsExchange = isExchangeEndpoint(dstLabels, row['dst_is_exchange'], dstRoles)
  const genericLabeledBoundary = dstLabels.length > 0 && !dstIsExchange
  const relation: ScamTopologyEdgeRelation = dstIsExchange
    ? 'terminal_exchange'
    : genericLabeledBoundary
      ? 'context_boundary'
      : hop === 1
        ? 'seed_outflow'
        : 'traversal_edge'

  return {
    relation,
    src,
    dst,
    hop,
    graph_scope: graphScope,
    topology_graph: graphForScope(graphScope),
    seed_address: context.seedAddress,
    seed_role: context.seedRole,
    amount_sum: numberValue(row['amount_sum']),
    amount_usd_sum: numberValue(row['amount_usd_sum']),
    tx_count: numberValue(row['tx_count']),
    first_seen_timestamp: numberValue(row['first_seen_timestamp']),
    last_seen_timestamp: numberValue(row['last_seen_timestamp']),
    first_tx_id: stringValue(row['first_tx_id']),
    last_tx_id: stringValue(row['last_tx_id']),
    src_labels: srcLabels,
    dst_labels: dstLabels,
    src_is_exchange: srcIsExchange,
    dst_is_exchange: dstIsExchange,
  }
}

function edgeKey(edge: Pick<ScamTopologyTopologyEdge, 'src' | 'dst' | 'graph_scope' | 'seed_address' | 'seed_role'>): string {
  return `${edge.graph_scope}\u0000${edge.seed_role ?? ''}\u0000${edge.seed_address ?? ''}\u0000${edge.src}\u0000${edge.dst}`
}

function mergedEdgeKey(edge: Pick<ScamTopologyTopologyEdge, 'src' | 'dst' | 'seed_address' | 'seed_role'>): string {
  return `${edge.seed_role ?? ''}\u0000${edge.seed_address ?? ''}\u0000${edge.src}\u0000${edge.dst}`
}

function frontierKey(entry: FrontierEntry): string {
  return `${entry.seedRole}\u0000${entry.seedAddress}\u0000${entry.address}`
}

async function runDirectedTraversal(
  remoteClient: Client,
  network: string,
  seeds: Seed[],
  graphScope: ScamTopologyGraphScope,
  maxHops: number,
  perAddressLimit: number,
  minAmountSum: number | undefined,
  sinceTimestampMs: number | undefined,
): Promise<TraversalRun> {
  const edgesByKey = new Map<string, ScamTopologyTopologyEdge>()
  let frontier: FrontierEntry[] = seeds.map((seed) => ({
    address: seed.address,
    seedAddress: seed.address,
    seedRole: seed.role,
  }))
  const visited = new Set(frontier.map(frontierKey))

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const frontierByAddress = new Map<string, FrontierEntry[]>()
    for (const entry of frontier) {
      const entries = frontierByAddress.get(entry.address) ?? []
      entries.push(entry)
      frontierByAddress.set(entry.address, entries)
    }
    const frontierAddresses = [...frontierByAddress.keys()]
    const queries = frontierAddresses.map((address, index) => frontierQuery(
      graphScope,
      address,
      hop,
      frontierAddresses.length === 1 ? undefined : index + 1,
      perAddressLimit,
      minAmountSum,
      sinceTimestampMs,
    ))
    const nextByKey = new Map<string, FrontierEntry>()

    for (const queryChunk of chunks(queries, SCAM_TOPOLOGY_MAX_BATCH_QUERIES)) {
      const batch = await callGraphBatch(remoteClient, network, queryChunk)
      for (const queryResult of batch.facts?.queries ?? []) {
        if (queryResult.ok === false) throw new Error(queryResult.error || `Query failed: ${queryResult.id}`)
        for (const row of queryResult.results ?? []) {
          const src = stringValue(row['src']) ?? stringValue(row['from_address'])
          if (!src) continue
          const contexts = frontierByAddress.get(src) ?? []
          for (const context of contexts) {
            const edge = edgeFromRow(row, graphScope, hop, context)
            if (!edge || edgesByKey.has(edgeKey(edge))) continue
            edgesByKey.set(edgeKey(edge), edge)

            if (edge.relation === 'terminal_exchange' || edge.relation === 'context_boundary') continue
            const nextEntry: FrontierEntry = {
              address: edge.dst,
              seedAddress: context.seedAddress,
              seedRole: context.seedRole,
            }
            const key = frontierKey(nextEntry)
            if (!visited.has(key)) {
              visited.add(key)
              nextByKey.set(key, nextEntry)
            }
          }
        }
      }
    }

    frontier = [...nextByKey.values()]
  }

  return {
    graphScope,
    topologyGraph: graphForScope(graphScope),
    edges: [...edgesByKey.values()],
  }
}

function mergeCompareRuns(history: TraversalRun, incident: TraversalRun): ScamTopologyTopologyEdge[] {
  const buckets = new Map<string, { history?: ScamTopologyTopologyEdge; incident?: ScamTopologyTopologyEdge }>()
  for (const edge of history.edges) {
    const bucket = buckets.get(mergedEdgeKey(edge)) ?? {}
    bucket.history = edge
    buckets.set(mergedEdgeKey(edge), bucket)
  }
  for (const edge of incident.edges) {
    const bucket = buckets.get(mergedEdgeKey(edge)) ?? {}
    bucket.incident = edge
    buckets.set(mergedEdgeKey(edge), bucket)
  }

  return [...buckets.values()].map((bucket) => {
    const base = bucket.incident ?? bucket.history
    if (!base) throw new Error('empty compare bucket')
    const graphScopes: ScamTopologyGraphScope[] = [
      ...(bucket.history ? ['history' as const] : []),
      ...(bucket.incident ? ['incident' as const] : []),
    ]
    const scopeMembership: ScamTopologyScopeMembership = bucket.history && bucket.incident
      ? 'overlap'
      : bucket.history
        ? 'history_only'
        : 'incident_only'
    const relation: ScamTopologyEdgeRelation = bucket.history?.relation === 'terminal_exchange' || bucket.incident?.relation === 'terminal_exchange'
      ? 'terminal_exchange'
      : bucket.history?.relation === 'context_boundary' || bucket.incident?.relation === 'context_boundary'
        ? 'context_boundary'
        : base.relation

    return {
      ...base,
      relation,
      scope_membership: scopeMembership,
      graph_scopes: graphScopes,
    }
  })
}

function candidateKey(candidate: Pick<ScamTopologyLabelCandidate, 'address' | 'address_subtype'>): string {
  return `${candidate.address}\u0000${candidate.address_subtype}`
}

function mergeCandidate(
  candidates: Map<string, ScamTopologyLabelCandidate>,
  candidate: ScamTopologyLabelCandidate,
): void {
  const key = candidateKey(candidate)
  const existing = candidates.get(key)
  if (!existing) {
    candidates.set(key, candidate)
    return
  }

  existing.confidence_score = Math.max(existing.confidence_score, candidate.confidence_score)
  existing.evidence.push(...candidate.evidence)
  if (candidate.promotion_status === 'promote_confirmed') {
    existing.promotion_status = 'promote_confirmed'
    existing.trust_level = 'blacklisted'
    existing.risk_level = 'critical'
  }
}

function labelForSubtype(subtype: ScamTopologyLabelCandidate['address_subtype']): string {
  switch (subtype) {
    case 'scam_seed':
      return 'Known scam seed'
    case 'laundering_intermediate':
      return 'Scam laundering intermediate'
    case 'exchange_deposit_candidate':
      return 'Scam exchange deposit candidate'
  }
}

function makeCandidate(
  address: string,
  subtype: ScamTopologyLabelCandidate['address_subtype'],
  evidence: Record<string, unknown>,
  confidence: number,
  promotionStatus: ScamTopologyLabelCandidate['promotion_status'],
): ScamTopologyLabelCandidate {
  return {
    address,
    label: labelForSubtype(subtype),
    address_type: 'SCAM',
    address_subtype: subtype,
    trust_level: promotionStatus === 'promote_confirmed' ? 'blacklisted' : 'candidate',
    risk_level: promotionStatus === 'promote_confirmed' ? 'critical' : 'high',
    confidence_score: confidence,
    promotion_status: promotionStatus,
    source: 'scam_topology',
    evidence: [evidence],
  }
}

function addRole(rolesByAddress: Map<string, Set<string>>, address: string, role: string): void {
  if (!address) return
  const roles = rolesByAddress.get(address) ?? new Set<string>()
  roles.add(role)
  rolesByAddress.set(address, roles)
}

function pushCaseRole(caseRoles: ScamTopologyCaseRole[], role: ScamTopologyCaseRole): void {
  if (caseRoles.some((entry) => (
    entry.address === role.address &&
    entry.role === role.role &&
    entry.seed_address === role.seed_address &&
    entry.seed_role === role.seed_role
  ))) return
  caseRoles.push(role)
}

function pushSafetyDecision(safetyDecisions: Array<Record<string, unknown>>, decision: Record<string, unknown>): void {
  if (safetyDecisions.some((entry) => JSON.stringify(entry) === JSON.stringify(decision))) return
  safetyDecisions.push(decision)
}

function edgeEvidence(edge: ScamTopologyTopologyEdge, reason: string): Record<string, unknown> {
  return {
    seed_address: edge.seed_address,
    seed_role: edge.seed_role,
    graph_scope: edge.graph_scope,
    scope_membership: edge.scope_membership,
    hop: edge.hop,
    src: edge.src,
    dst: edge.dst,
    amount_sum: edge.amount_sum,
    amount_usd_sum: edge.amount_usd_sum,
    tx_count: edge.tx_count,
    reason,
  }
}

function classifyTopology(
  seeds: Seed[],
  edges: ScamTopologyTopologyEdge[],
): {
  labelCandidates: ScamTopologyLabelCandidate[]
  caseRoles: ScamTopologyCaseRole[]
  safetyDecisions: Array<Record<string, unknown>>
  rolesByAddress: Map<string, Set<string>>
  intermediaries: string[]
  terminalPoints: Array<Record<string, unknown>>
  investigationHints: Array<Record<string, unknown>>
} {
  const candidates = new Map<string, ScamTopologyLabelCandidate>()
  const caseRoles: ScamTopologyCaseRole[] = []
  const safetyDecisions: Array<Record<string, unknown>> = []
  const rolesByAddress = new Map<string, Set<string>>()
  const seedAddresses = new Set(seeds.map((seed) => seed.address))
  const victimAddresses = new Set(seeds.filter((seed) => seed.role === 'victim').map((seed) => seed.address))
  const exchangeDepositAddresses = new Set(edges
    .filter((edge) => edge.relation === 'terminal_exchange')
    .map((edge) => edge.src)
    .filter((address) => !seedAddresses.has(address) && !victimAddresses.has(address)))
  const terminalPoints: Array<Record<string, unknown>> = []
  const investigationHints: Array<Record<string, unknown>> = []

  for (const seed of seeds) {
    pushCaseRole(caseRoles, { address: seed.address, role: seed.role })
    addRole(rolesByAddress, seed.address, seed.role)
    if (seed.role === 'victim') {
      pushSafetyDecision(safetyDecisions, {
        address: seed.address,
        decision: 'do_not_label_victim_seed',
        reason: 'Victim/source addresses are protected case roles, not risky actors by default.',
      })
    } else {
      mergeCandidate(candidates, makeCandidate(
        seed.address,
        'scam_seed',
        {
          seed_address: seed.address,
          seed_role: seed.role,
          reason: 'Operator supplied this address as a known scammer seed.',
        },
        1,
        'promote_confirmed',
      ))
    }
  }

  for (const edge of edges) {
    if (edge.relation === 'terminal_exchange') {
      pushCaseRole(caseRoles, {
        address: edge.dst,
        role: 'exchange_endpoint',
        seed_address: edge.seed_address,
        seed_role: edge.seed_role,
      })
      addRole(rolesByAddress, edge.dst, 'exchange_endpoint')
      terminalPoints.push({
        address: edge.dst,
        terminal_type: 'exchange_endpoint',
        source_address: edge.src,
        seed_address: edge.seed_address,
        graph_scope: edge.graph_scope,
        scope_membership: edge.scope_membership,
      })
      pushSafetyDecision(safetyDecisions, {
        address: edge.dst,
        decision: 'do_not_label_exchange_endpoint',
        reason: 'Exchange endpoints are terminal service context, not scam label candidates.',
        seed_address: edge.seed_address,
      })

      if (!seedAddresses.has(edge.src) && !victimAddresses.has(edge.src)) {
        pushCaseRole(caseRoles, {
          address: edge.src,
          role: 'exchange_deposit_candidate',
          seed_address: edge.seed_address,
          seed_role: edge.seed_role,
        })
        addRole(rolesByAddress, edge.src, 'exchange_deposit_candidate')
        mergeCandidate(candidates, makeCandidate(
          edge.src,
          'exchange_deposit_candidate',
          edgeEvidence(edge, 'Address is the penultimate hop before an exchange endpoint.'),
          edge.seed_role === 'scammer' ? 0.8 : 0.68,
          'review_required',
        ))
      }
      continue
    }

    if (edge.relation === 'context_boundary') {
      pushCaseRole(caseRoles, {
        address: edge.dst,
        role: 'context_boundary',
        seed_address: edge.seed_address,
        seed_role: edge.seed_role,
      })
      addRole(rolesByAddress, edge.dst, 'context_boundary')
      terminalPoints.push({
        address: edge.dst,
        terminal_type: 'context_boundary',
        source_address: edge.src,
        labels: edge.dst_labels,
        seed_address: edge.seed_address,
        graph_scope: edge.graph_scope,
        scope_membership: edge.scope_membership,
      })
      investigationHints.push({
        address: edge.dst,
        hint_type: 'generic_labeled_context',
        labels: edge.dst_labels,
        reason: 'Non-exchange labels are context hints only and stop automatic scam traversal.',
        seed_address: edge.seed_address,
      })
      pushSafetyDecision(safetyDecisions, {
        address: edge.dst,
        decision: 'context_only_generic_labeled_node',
        reason: 'Generic non-exchange labels are not hard-coded scam infrastructure classes.',
        labels: edge.dst_labels,
        seed_address: edge.seed_address,
      })
      continue
    }

    if (seedAddresses.has(edge.dst) || victimAddresses.has(edge.dst) || exchangeDepositAddresses.has(edge.dst)) continue
    pushCaseRole(caseRoles, {
      address: edge.dst,
      role: 'laundering_intermediate',
      seed_address: edge.seed_address,
      seed_role: edge.seed_role,
    })
    addRole(rolesByAddress, edge.dst, 'laundering_intermediate')
    mergeCandidate(candidates, makeCandidate(
      edge.dst,
      'laundering_intermediate',
      edgeEvidence(edge, 'Address appears on an outward path from a known scam topology seed.'),
      edge.seed_role === 'scammer' ? 0.85 : 0.72,
      'review_required',
    ))
  }

  const labelCandidates = [...candidates.values()]
    .sort((a, b) => b.confidence_score - a.confidence_score || a.address.localeCompare(b.address))
  return {
    labelCandidates,
    caseRoles,
    safetyDecisions,
    rolesByAddress,
    intermediaries: [...new Set(caseRoles
      .filter((role) => role.role === 'laundering_intermediate')
      .map((role) => role.address))],
    terminalPoints,
    investigationHints,
  }
}

function mergeLabels(existing: unknown, next: string[]): string[] {
  return [...new Set([...stringArray(existing), ...next])]
}

function buildGraph(
  seeds: Seed[],
  edges: ScamTopologyTopologyEdge[],
  rolesByAddress: Map<string, Set<string>>,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const nodesById = new Map<string, Record<string, unknown>>()

  for (const seed of seeds) {
    nodesById.set(seed.address, {
      id: seed.address,
      address: seed.address,
      node_type: 'address',
      roles: [...(rolesByAddress.get(seed.address) ?? new Set([seed.role]))],
    })
  }

  for (const edge of edges) {
    const src = nodesById.get(edge.src) ?? { id: edge.src, address: edge.src, node_type: 'address' }
    const dst = nodesById.get(edge.dst) ?? { id: edge.dst, address: edge.dst, node_type: 'address' }
    nodesById.set(edge.src, {
      ...src,
      labels: mergeLabels(src['labels'], edge.src_labels),
      roles: [...new Set([...stringArray(src['roles']), ...[...(rolesByAddress.get(edge.src) ?? [])]])],
      is_exchange: edge.src_is_exchange || src['is_exchange'] === true,
    })
    nodesById.set(edge.dst, {
      ...dst,
      labels: mergeLabels(dst['labels'], edge.dst_labels),
      roles: [...new Set([...stringArray(dst['roles']), ...[...(rolesByAddress.get(edge.dst) ?? [])]])],
      is_exchange: edge.dst_is_exchange || dst['is_exchange'] === true,
    })
  }

  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...nodesById.values()],
    edges: edges.map((edge) => ({
      source: edge.src,
      target: edge.dst,
      edge_type: 'flows_to',
      relation: edge.relation,
      direction: 'outward_scam_topology',
      hop: edge.hop,
      graph_scope: edge.graph_scope,
      topology_graph: edge.topology_graph,
      scope_membership: edge.scope_membership,
      seed_address: edge.seed_address,
      seed_role: edge.seed_role,
      amount_sum: edge.amount_sum,
      amount_usd_sum: edge.amount_usd_sum,
      tx_count: edge.tx_count,
      first_tx_id: edge.first_tx_id,
      last_tx_id: edge.last_tx_id,
      terminal_exchange: edge.relation === 'terminal_exchange',
      context_boundary: edge.relation === 'context_boundary',
    })),
    flows: edges.map((edge) => ({
      hop: edge.hop,
      src: edge.src,
      dst: edge.dst,
      relation: edge.relation,
      graph_scope: edge.graph_scope,
      scope_membership: edge.scope_membership,
      seed_address: edge.seed_address,
      seed_role: edge.seed_role,
      amount_sum: edge.amount_sum,
      amount_usd_sum: edge.amount_usd_sum,
      tx_count: edge.tx_count,
      terminal_exchange: edge.relation === 'terminal_exchange',
    })),
    topology_edges: edges,
    infrastructure_flows: [],
    deposits: edges
      .filter((edge) => edge.relation === 'terminal_exchange')
      .map((edge) => ({
        address: edge.src,
        exchangeAddress: edge.dst,
        seed_role: edge.seed_role,
        seed_address: edge.seed_address,
        amount_sum: edge.amount_sum,
        amount_usd_sum: edge.amount_usd_sum,
        hops: edge.hop,
      })),
    reverse_leads: [],
    edge_anchors: [],
    scam_topology: facts,
    metadata: {
      source: 'scam_topology',
      generated_at: new Date().toISOString(),
    },
  })
}

function summarize(
  network: string,
  scope: ScamTopologyScope,
  victimAddresses: string[],
  scammerAddresses: string[],
  candidates: ScamTopologyLabelCandidate[],
  safetyDecisions: Array<Record<string, unknown>>,
  topologyEdges: ScamTopologyTopologyEdge[],
  terminalPoints: Array<Record<string, unknown>>,
): string {
  const confirmed = candidates.filter((candidate) => candidate.promotion_status === 'promote_confirmed').length
  const review = candidates.filter((candidate) => candidate.promotion_status === 'review_required').length
  return [
    `Scam topology complete for ${network}`,
    '',
    `Scope: ${scope}`,
    `Victim/source seed(s): ${victimAddresses.join(', ') || 'none'}`,
    `Known scammer seed(s): ${scammerAddresses.join(', ') || 'none'}`,
    `Topology edges: ${topologyEdges.length}.`,
    `Terminal points: ${terminalPoints.length}.`,
    `Label candidates: ${candidates.length} (${confirmed} promote_confirmed, ${review} review_required).`,
    `Safety decisions: ${safetyDecisions.length}.`,
    '',
    'Policy: victims, exchange endpoints, and generic labeled context nodes are not automatically risky labels.',
  ].join('\n')
}

function validateScope(value: unknown): ScamTopologyScope {
  const scope = value ?? 'incident'
  if (scope === 'history' || scope === 'incident' || scope === 'compare') return scope
  throw new Error('scope must be one of: history, incident, compare')
}

function validateNonNegativeNumber(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
  return value
}

function topologyGraphsForScope(scope: ScamTopologyScope): Array<'archive_topology' | 'live_topology'> {
  if (scope === 'history') return ['archive_topology']
  if (scope === 'incident') return ['live_topology']
  return ['archive_topology', 'live_topology']
}

export async function scamTopology(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: ScamTopologyOptions,
): Promise<ScamTopologyResult> {
  void config
  const network = options.network.trim()
  const victimAddresses = parseAddressList(options.victimAddresses)
  const scammerAddresses = parseAddressList(options.scammerAddresses)
  const scope = validateScope(options.scope)
  const sinceTimestampMs = validateNonNegativeNumber(options.sinceTimestampMs, 'sinceTimestampMs')
  const maxHops = clampInt(options.maxHops, 3, 1, 5)
  const perAddressLimit = clampInt(options.perAddressLimit, 5, 1, 10)
  const minAmountSum = validateNonNegativeNumber(options.minAmountSum, 'minAmountSum')

  if (!network) throw new Error('network is required')
  if (victimAddresses.length + scammerAddresses.length === 0) {
    throw new Error('victim_addresses or scammer_addresses is required')
  }
  if (victimAddresses.length > 5) throw new Error('victim_addresses cannot exceed 5 addresses')
  if (scammerAddresses.length > 5) throw new Error('scammer_addresses cannot exceed 5 addresses')
  const overlap = victimAddresses.filter((address) => scammerAddresses.includes(address))
  if (overlap.length > 0) throw new Error(`Address(es) appear in both victim and scammer lists: ${overlap.join(', ')}`)

  const seeds: Seed[] = [
    ...victimAddresses.map((address) => ({ address, role: 'victim' as const })),
    ...scammerAddresses.map((address) => ({ address, role: 'scammer' as const })),
  ]

  const runs: TraversalRun[] = []
  if (scope === 'history' || scope === 'compare') {
    runs.push(await runDirectedTraversal(remoteClient, network, seeds, 'history', maxHops, perAddressLimit, minAmountSum, sinceTimestampMs))
  }
  if (scope === 'incident' || scope === 'compare') {
    runs.push(await runDirectedTraversal(remoteClient, network, seeds, 'incident', maxHops, perAddressLimit, minAmountSum, sinceTimestampMs))
  }

  const topologyEdges = scope === 'compare'
    ? mergeCompareRuns(
      runs.find((run) => run.graphScope === 'history') ?? { graphScope: 'history', topologyGraph: 'archive_topology', edges: [] },
      runs.find((run) => run.graphScope === 'incident') ?? { graphScope: 'incident', topologyGraph: 'live_topology', edges: [] },
    )
    : runs.flatMap((run) => run.edges)

  const classification = classifyTopology(seeds, topologyEdges)
  const labelCandidates = classification.labelCandidates
  const facts = {
    network,
    victim_addresses: victimAddresses,
    scammer_addresses: scammerAddresses,
    scope,
    ...(sinceTimestampMs !== undefined ? { since_timestamp_ms: sinceTimestampMs } : {}),
    topology_graphs: topologyGraphsForScope(scope),
    topology_edges: topologyEdges,
    intermediaries: classification.intermediaries,
    terminal_points: classification.terminalPoints,
    investigation_hints: classification.investigationHints,
    label_candidates: labelCandidates,
    case_roles: classification.caseRoles,
    safety_decisions: classification.safetyDecisions,
    infrastructure_anchors: [],
    infrastructure_flows: [],
    runs: runs.map((run) => ({
      graph_scope: run.graphScope,
      topology_graph: run.topologyGraph,
      edge_count: run.edges.length,
      max_hops: maxHops,
      per_address_limit: perAddressLimit,
    })),
  }
  const graphData = buildGraph(seeds, topologyEdges, classification.rolesByAddress, facts)
  const summaryText = summarize(network, scope, victimAddresses, scammerAddresses, labelCandidates, classification.safetyDecisions, topologyEdges, classification.terminalPoints)

  if (options.caseId) {
    const { EvidenceStore } = await import('../cases/index.js')
    await EvidenceStore.append(options.caseId, {
      source: 'scam_topology',
      queryParams: [
        `network=${network}`,
        `victim_addresses=${victimAddresses.join(',')}`,
        `scammer_addresses=${scammerAddresses.join(',')}`,
        `scope=${scope}`,
        sinceTimestampMs !== undefined ? `since_timestamp_ms=${sinceTimestampMs}` : '',
      ].filter(Boolean).join(' '),
      content: JSON.stringify({
        schema: 'chain-insights.scam_topology_evidence.v1',
        source: 'scam_topology',
        network,
        victim_addresses: victimAddresses,
        scammer_addresses: scammerAddresses,
        scope,
        since_timestamp_ms: sinceTimestampMs,
        topology_graphs: topologyGraphsForScope(scope),
        topology_edge_count: topologyEdges.length,
        terminal_points: classification.terminalPoints,
        label_candidates: labelCandidates,
        safety_decisions: classification.safetyDecisions,
      }, null, 2),
    })
  }

  return {
    summaryText,
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'scam_topology',
      facts,
      hint: 'Review label_candidates before promoting derived addresses into core_address_labels.',
    },
    graphData,
  }
}
