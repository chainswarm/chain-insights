import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { runFundFlowProbe, type TraceFundsResult } from './trace-funds.js'

export interface ScamTopologyOptions {
  network: string
  victimAddresses?: string | string[]
  scammerAddresses?: string | string[]
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
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
  role: ScamTopologySeedRole | 'laundering_intermediate' | 'exchange_deposit_candidate' | 'exchange_endpoint' | 'reverse_lead'
  seed_address?: string
  seed_role?: ScamTopologySeedRole
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

type ScamTopologyRun = {
  seedRole: ScamTopologySeedRole
  address: string
  result: TraceFundsResult
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

type ScamTopologyInfrastructureRelation = 'seed_funding_input' | 'seed_sweep' | 'anchor_fan_in' | 'anchor_fan_out'

export interface ScamTopologyInfrastructureFlow {
  relation: ScamTopologyInfrastructureRelation
  src: string
  dst: string
  amount_sum?: number
  amount_usd_sum?: number
  tx_count?: number
  first_tx_id?: string
  last_tx_id?: string
  src_labels?: string[]
  dst_labels?: string[]
  seed_address?: string
  seed_role?: ScamTopologySeedRole
  anchor_address?: string
}

const SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS = 600
const INFRASTRUCTURE_ANCHOR_LIMIT = 40

function parseAddressList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return [...new Set(raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))]
}

function graphArray(graphData: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = graphData[key]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
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
      per_query_timeout_seconds: SCAM_TOPOLOGY_GRAPH_QUERY_TIMEOUT_SECONDS,
    },
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function addressPredicate(variableName: string, addresses: string[]): string {
  return addresses
    .map((address) => `${variableName}.address = "${escapeCypherString(address)}"`)
    .join(' OR ')
}

function flowProjection(relation: ScamTopologyInfrastructureRelation, sourceVariable = 'src', targetVariable = 'dst'): string {
  return [
    `"${relation}" AS relation`,
    `${sourceVariable}.address AS src`,
    `${targetVariable}.address AS dst`,
    `${sourceVariable}.labels AS src_labels`,
    `${targetVariable}.labels AS dst_labels`,
    `r.amount_sum AS amount_sum`,
    `r.amount_usd_sum AS amount_usd_sum`,
    `r.tx_count AS tx_count`,
    `r.first_tx_id AS first_tx_id`,
    `r.last_tx_id AS last_tx_id`,
  ].join(', ')
}

function seedIncidentQueries(run: ScamTopologyRun, index: number, limit: number): Array<{ id: string; query: string }> {
  const address = escapeCypherString(run.address)
  return [
    {
      id: `seed_in_${index}`,
      query: [
        `MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address: "${address}"})`,
        'WHERE src.address <> dst.address',
        `RETURN ${flowProjection('seed_funding_input')}, dst.address AS anchor_address`,
        'ORDER BY r.amount_sum DESC',
        `LIMIT ${limit}`,
      ].join(' '),
    },
    {
      id: `seed_out_${index}`,
      query: [
        `MATCH (src:Address {address: "${address}"})-[r:FLOWS_TO]->(dst:Address)`,
        'WHERE src.address <> dst.address',
        `RETURN ${flowProjection('seed_sweep')}, src.address AS anchor_address`,
        'ORDER BY r.amount_sum DESC',
        `LIMIT ${limit}`,
      ].join(' '),
    },
  ]
}

function anchorFanQueries(anchors: string[], limit: number): Array<{ id: string; query: string }> {
  if (anchors.length === 0) return []
  const dstPredicate = addressPredicate('dst', anchors)
  const srcPredicate = addressPredicate('src', anchors)
  return [
    {
      id: 'anchor_fan_in_1',
      query: [
        'MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)',
        `WHERE (${dstPredicate}) AND src.address <> dst.address`,
        `RETURN ${flowProjection('anchor_fan_in')}, dst.address AS anchor_address`,
        'ORDER BY r.amount_sum DESC',
        `LIMIT ${limit}`,
      ].join(' '),
    },
    {
      id: 'anchor_fan_out_1',
      query: [
        'MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)',
        `WHERE (${srcPredicate}) AND src.address <> dst.address`,
        `RETURN ${flowProjection('anchor_fan_out')}, src.address AS anchor_address`,
        'ORDER BY r.amount_sum DESC',
        `LIMIT ${limit}`,
      ].join(' '),
    },
  ]
}

function isExchangeLikeNode(node: Record<string, unknown>): boolean {
  const labels = stringArray(node['labels']).map((label) => label.toLowerCase())
  const roles = stringArray(node['roles']).map((role) => role.toLowerCase())
  return labels.includes('exchange') || roles.includes('exchange') || node['is_exchange'] === true
}

function collectInfrastructureAnchors(runs: ScamTopologyRun[]): string[] {
  const anchors = new Set<string>()
  const exchanges = new Set<string>()

  for (const run of runs) {
    for (const deposit of graphArray(run.result.graphData, 'deposits')) {
      const exchangeAddress = stringValue(deposit['exchangeAddress']) ?? stringValue(deposit['exchange_address'])
      if (exchangeAddress) exchanges.add(exchangeAddress)
    }
    for (const node of graphArray(run.result.graphData, 'nodes')) {
      const address = stringValue(node['address']) ?? stringValue(node['id'])
      if (address && isExchangeLikeNode(node)) exchanges.add(address)
    }
  }

  for (const run of runs) {
    for (const flow of graphArray(run.result.graphData, 'flows')) {
      for (const key of ['src', 'dst']) {
        const address = stringValue(flow[key])
        if (address && address !== run.address && !exchanges.has(address)) anchors.add(address)
      }
    }
    for (const deposit of graphArray(run.result.graphData, 'deposits')) {
      const address = stringValue(deposit['address'])
      if (address && address !== run.address && !exchanges.has(address)) anchors.add(address)
    }
    for (const lead of graphArray(run.result.graphData, 'reverse_leads')) {
      const address = stringValue(lead['address'])
      if (address && address !== run.address && !exchanges.has(address)) anchors.add(address)
    }
  }

  return [...anchors].slice(0, INFRASTRUCTURE_ANCHOR_LIMIT)
}

function infrastructureFlowFromRow(
  row: Record<string, unknown>,
  context?: Pick<ScamTopologyInfrastructureFlow, 'seed_address' | 'seed_role'>,
): ScamTopologyInfrastructureFlow | null {
  const relation = stringValue(row['relation']) as ScamTopologyInfrastructureRelation | undefined
  const src = stringValue(row['src'])
  const dst = stringValue(row['dst'])
  if (!relation || !src || !dst) return null
  return {
    relation,
    src,
    dst,
    amount_sum: numberValue(row['amount_sum']),
    amount_usd_sum: numberValue(row['amount_usd_sum']),
    tx_count: numberValue(row['tx_count']),
    first_tx_id: stringValue(row['first_tx_id']),
    last_tx_id: stringValue(row['last_tx_id']),
    src_labels: stringArray(row['src_labels']),
    dst_labels: stringArray(row['dst_labels']),
    seed_address: context?.seed_address,
    seed_role: context?.seed_role,
    anchor_address: stringValue(row['anchor_address']),
  }
}

function infrastructureFlowKey(flow: ScamTopologyInfrastructureFlow): string {
  return `${flow.relation}\u0000${flow.src}\u0000${flow.dst}`
}

async function collectLiveScamInfrastructure(
  remoteClient: Client,
  network: string,
  runs: ScamTopologyRun[],
  perAddressLimitOption: number | undefined,
): Promise<{ anchors: string[]; flows: ScamTopologyInfrastructureFlow[] }> {
  const perAddressLimit = clampInt(perAddressLimitOption, 5, 1, 10)
  const seedLimit = Math.max(25, perAddressLimit * 25)
  const fanLimit = Math.min(1000, Math.max(200, perAddressLimit * 100))
  const anchors = collectInfrastructureAnchors(runs)
  const queryContexts = new Map<string, Pick<ScamTopologyInfrastructureFlow, 'seed_address' | 'seed_role'>>()
  const queries: Array<{ id: string; query: string }> = []

  runs.forEach((run, index) => {
    const queryIndex = index + 1
    for (const query of seedIncidentQueries(run, queryIndex, seedLimit)) {
      queries.push(query)
      queryContexts.set(query.id, { seed_address: run.address, seed_role: run.seedRole })
    }
  })
  queries.push(...anchorFanQueries(anchors, fanLimit))

  if (queries.length === 0) return { anchors, flows: [] }

  const batch = await callGraphBatch(remoteClient, network, queries)
  const flowsByKey = new Map<string, ScamTopologyInfrastructureFlow>()
  for (const query of batch.facts?.queries ?? []) {
    if (query.ok === false) throw new Error(query.error || `Query failed: ${query.id}`)
    const context = query.id ? queryContexts.get(query.id) : undefined
    for (const row of query.results ?? []) {
      const flow = infrastructureFlowFromRow(row, context)
      if (flow) flowsByKey.set(infrastructureFlowKey(flow), flow)
    }
  }

  return { anchors, flows: [...flowsByKey.values()] }
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

function addRole(rolesByAddress: Map<string, Set<string>>, address: string, role: string): void {
  if (!address) return
  const roles = rolesByAddress.get(address) ?? new Set<string>()
  roles.add(role)
  rolesByAddress.set(address, roles)
}

function buildEvidence(
  run: ScamTopologyRun,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    seed_address: run.address,
    seed_role: run.seedRole,
    network_source: 'track_funds',
    ...fields,
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

function classifyRun(
  run: ScamTopologyRun,
  candidates: Map<string, ScamTopologyLabelCandidate>,
  caseRoles: ScamTopologyCaseRole[],
  safetyDecisions: Array<Record<string, unknown>>,
  rolesByAddress: Map<string, Set<string>>,
): void {
  caseRoles.push({ address: run.address, role: run.seedRole })
  addRole(rolesByAddress, run.address, run.seedRole)

  if (run.seedRole === 'victim') {
    safetyDecisions.push({
      address: run.address,
      decision: 'do_not_label_victim_seed',
      reason: 'Victim/source addresses are not risky actors by default.',
    })
  } else {
    mergeCandidate(candidates, makeCandidate(
      run.address,
      'scam_seed',
      buildEvidence(run, {
        role: 'scammer',
        reason: 'Operator supplied this address as a known scammer seed.',
      }),
      1,
      'promote_confirmed',
    ))
  }

  for (const deposit of graphArray(run.result.graphData, 'deposits')) {
    const depositAddress = stringValue(deposit['address'])
    const exchangeAddress = stringValue(deposit['exchangeAddress']) ?? stringValue(deposit['exchange_address'])
    const path = stringArray(deposit['path'])
    const hopCount = numberValue(deposit['hops']) ?? Math.max(path.length - 1, 0)
    const amountSum = numberValue(deposit['amount_sum'])
    const amountUsdSum = numberValue(deposit['amount_usd_sum'])

    if (exchangeAddress) {
      addRole(rolesByAddress, exchangeAddress, 'exchange')
      caseRoles.push({
        address: exchangeAddress,
        role: 'exchange_endpoint',
        seed_address: run.address,
        seed_role: run.seedRole,
      })
      safetyDecisions.push({
        address: exchangeAddress,
        decision: 'do_not_label_exchange_endpoint',
        reason: 'Exchange/service endpoints are terminal service context, not automatically scam actors.',
        seed_address: run.address,
      })
    }

    for (const intermediate of path.slice(1, -2)) {
      if (!intermediate || intermediate === run.address || intermediate === exchangeAddress) continue
      addRole(rolesByAddress, intermediate, 'laundering_intermediate')
      caseRoles.push({
        address: intermediate,
        role: 'laundering_intermediate',
        seed_address: run.address,
        seed_role: run.seedRole,
      })
      mergeCandidate(candidates, makeCandidate(
        intermediate,
        'laundering_intermediate',
        buildEvidence(run, {
          path_addresses: path,
          endpoint_address: exchangeAddress,
          endpoint_type: exchangeAddress ? 'exchange' : undefined,
          hop_count: hopCount,
          amount_sum: amountSum,
          amount_usd_sum: amountUsdSum,
          reason: 'Address appears as an intermediate laundering hop in a known scam topology.',
        }),
        run.seedRole === 'scammer' ? 0.85 : 0.72,
        'review_required',
      ))
    }

    if (depositAddress && depositAddress !== run.address && depositAddress !== exchangeAddress) {
      addRole(rolesByAddress, depositAddress, 'deposit_candidate')
      caseRoles.push({
        address: depositAddress,
        role: 'exchange_deposit_candidate',
        seed_address: run.address,
        seed_role: run.seedRole,
      })
      mergeCandidate(candidates, makeCandidate(
        depositAddress,
        'exchange_deposit_candidate',
        buildEvidence(run, {
          path_addresses: path,
          endpoint_address: exchangeAddress,
          endpoint_type: exchangeAddress ? 'exchange' : undefined,
          hop_count: hopCount,
          amount_sum: amountSum,
          amount_usd_sum: amountUsdSum,
          reason: 'Address is the penultimate hop before an exchange/service endpoint.',
        }),
        run.seedRole === 'scammer' ? 0.8 : 0.68,
        'review_required',
      ))
    }
  }

  for (const lead of graphArray(run.result.graphData, 'reverse_leads')) {
    const address = stringValue(lead['address'])
    if (!address) continue
    addRole(rolesByAddress, address, 'reverse_lead')
    caseRoles.push({
      address,
      role: 'reverse_lead',
      seed_address: run.address,
      seed_role: run.seedRole,
    })
    safetyDecisions.push({
      address,
      decision: 'context_only_reverse_lead',
      reason: 'Reverse leads are useful context but are not automatically risky labels.',
      seed_address: run.address,
      deposit_address: lead['deposit_address'],
    })
  }
}

function addFlowRoles(rolesByAddress: Map<string, Set<string>>, flow: ScamTopologyInfrastructureFlow): void {
  switch (flow.relation) {
    case 'seed_funding_input':
      addRole(rolesByAddress, flow.src, 'funding_source')
      addRole(rolesByAddress, flow.dst, 'seed')
      return
    case 'seed_sweep':
      addRole(rolesByAddress, flow.src, 'seed')
      addRole(rolesByAddress, flow.dst, 'sweep_recipient')
      return
    case 'anchor_fan_in':
      addRole(rolesByAddress, flow.src, 'fan_in_context')
      addRole(rolesByAddress, flow.dst, 'infrastructure_anchor')
      return
    case 'anchor_fan_out':
      addRole(rolesByAddress, flow.src, 'infrastructure_anchor')
      addRole(rolesByAddress, flow.dst, 'fan_out_context')
      return
  }
}

function mergeInfrastructureNode(
  nodesById: Map<string, Record<string, unknown>>,
  address: string,
  labels: string[] | undefined,
  rolesByAddress: Map<string, Set<string>>,
): void {
  const existing = nodesById.get(address) ?? { id: address, address, node_type: 'address' }
  nodesById.set(address, {
    ...existing,
    labels: [...new Set([...stringArray(existing['labels']), ...(labels ?? [])])],
    roles: [...new Set([...stringArray(existing['roles']), ...[...(rolesByAddress.get(address) ?? [])]])],
  })
}

function buildGraph(runs: ScamTopologyRun[], infrastructureFlows: ScamTopologyInfrastructureFlow[], rolesByAddress: Map<string, Set<string>>, facts: Record<string, unknown>): Record<string, unknown> {
  const nodesById = new Map<string, Record<string, unknown>>()

  for (const run of runs) {
    for (const node of graphArray(run.result.graphData, 'nodes')) {
      const id = stringValue(node['id']) ?? stringValue(node['address'])
      if (!id) continue
      const existing = nodesById.get(id) ?? { ...node }
      const roles = new Set([...stringArray(existing['roles']), ...stringArray(node['roles'])])
      for (const role of rolesByAddress.get(id) ?? []) roles.add(role)
      nodesById.set(id, { ...existing, ...node, roles: [...roles] })
    }
  }

  for (const [address, roles] of rolesByAddress.entries()) {
    const existing = nodesById.get(address) ?? { id: address, address, node_type: 'address' }
    nodesById.set(address, {
      ...existing,
      roles: [...new Set([...stringArray(existing['roles']), ...roles])],
    })
  }

  for (const flow of infrastructureFlows) {
    mergeInfrastructureNode(nodesById, flow.src, flow.src_labels, rolesByAddress)
    mergeInfrastructureNode(nodesById, flow.dst, flow.dst_labels, rolesByAddress)
  }

  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...nodesById.values()],
    edges: [
      ...runs.flatMap((run) => graphArray(run.result.graphData, 'edges')),
      ...infrastructureFlows.map((flow) => ({
        source: flow.src,
        target: flow.dst,
        edge_type: 'flows_to',
        relation: flow.relation,
        direction: 'scam_infrastructure_context',
        amount_sum: flow.amount_sum,
        amount_usd_sum: flow.amount_usd_sum,
        tx_count: flow.tx_count,
        first_tx_id: flow.first_tx_id,
        last_tx_id: flow.last_tx_id,
        seed_address: flow.seed_address,
        seed_role: flow.seed_role,
        anchor_address: flow.anchor_address,
      })),
    ],
    flows: runs.flatMap((run) => Array.isArray(run.result.graphData.flows) ? run.result.graphData.flows : []),
    infrastructure_flows: infrastructureFlows,
    deposits: runs.flatMap((run) => graphArray(run.result.graphData, 'deposits').map((deposit) => ({ ...deposit, seed_role: run.seedRole, seed_address: run.address }))),
    reverse_leads: runs.flatMap((run) => graphArray(run.result.graphData, 'reverse_leads').map((lead) => ({ ...lead, seed_role: run.seedRole, seed_address: run.address }))),
    edge_anchors: [],
    scam_topology: facts,
    metadata: {
      source: 'scam_topology',
      generated_at: new Date().toISOString(),
    },
  })
}

function summarize(network: string, victimAddresses: string[], scammerAddresses: string[], candidates: ScamTopologyLabelCandidate[], safetyDecisions: Array<Record<string, unknown>>, infrastructureFlows: ScamTopologyInfrastructureFlow[]): string {
  const confirmed = candidates.filter((candidate) => candidate.promotion_status === 'promote_confirmed').length
  const review = candidates.filter((candidate) => candidate.promotion_status === 'review_required').length
  const infrastructureCounts = new Map<ScamTopologyInfrastructureRelation, number>()
  for (const flow of infrastructureFlows) infrastructureCounts.set(flow.relation, (infrastructureCounts.get(flow.relation) ?? 0) + 1)
  return [
    `Scam topology complete for ${network}`,
    '',
    `Victim/source seed(s): ${victimAddresses.join(', ') || 'none'}`,
    `Known scammer seed(s): ${scammerAddresses.join(', ') || 'none'}`,
    `Label candidates: ${candidates.length} (${confirmed} promote_confirmed, ${review} review_required).`,
    `Infrastructure context: ${infrastructureFlows.length} live topology edge(s) (${infrastructureCounts.get('seed_funding_input') ?? 0} funding input, ${infrastructureCounts.get('seed_sweep') ?? 0} seed sweep, ${infrastructureCounts.get('anchor_fan_in') ?? 0} fan-in, ${infrastructureCounts.get('anchor_fan_out') ?? 0} fan-out).`,
    `Safety decisions: ${safetyDecisions.length}.`,
    '',
    'Policy: victims, exchange endpoints, and reverse leads are not automatically risky labels.',
  ].join('\n')
}

export async function scamTopology(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: ScamTopologyOptions,
): Promise<ScamTopologyResult> {
  const network = options.network.trim()
  const victimAddresses = parseAddressList(options.victimAddresses)
  const scammerAddresses = parseAddressList(options.scammerAddresses)
  if (!network) throw new Error('network is required')
  if (victimAddresses.length + scammerAddresses.length === 0) {
    throw new Error('victim_addresses or scammer_addresses is required')
  }
  if (victimAddresses.length > 5) throw new Error('victim_addresses cannot exceed 5 addresses')
  if (scammerAddresses.length > 5) throw new Error('scammer_addresses cannot exceed 5 addresses')
  const overlap = victimAddresses.filter((address) => scammerAddresses.includes(address))
  if (overlap.length > 0) throw new Error(`Address(es) appear in both victim and scammer lists: ${overlap.join(', ')}`)

  const runs: ScamTopologyRun[] = []
  for (const address of victimAddresses) {
    runs.push({
      seedRole: 'victim',
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
  for (const address of scammerAddresses) {
    runs.push({
      seedRole: 'scammer',
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

  const candidates = new Map<string, ScamTopologyLabelCandidate>()
  const caseRoles: ScamTopologyCaseRole[] = []
  const safetyDecisions: Array<Record<string, unknown>> = []
  const rolesByAddress = new Map<string, Set<string>>()
  for (const run of runs) classifyRun(run, candidates, caseRoles, safetyDecisions, rolesByAddress)
  const infrastructure = await collectLiveScamInfrastructure(remoteClient, network, runs, options.perAddressLimit)
  for (const flow of infrastructure.flows) addFlowRoles(rolesByAddress, flow)

  const labelCandidates = [...candidates.values()].sort((a, b) => b.confidence_score - a.confidence_score || a.address.localeCompare(b.address))
  const facts = {
    network,
    victim_addresses: victimAddresses,
    scammer_addresses: scammerAddresses,
    label_candidates: labelCandidates,
    case_roles: caseRoles,
    safety_decisions: safetyDecisions,
    infrastructure_anchors: infrastructure.anchors,
    infrastructure_flows: infrastructure.flows,
    runs: runs.map((run) => ({
      seed_role: run.seedRole,
      address: run.address,
      files: run.result.files,
      continuation: run.result.continuation,
      address_map: run.result.addressMap,
    })),
  }
  const graphData = buildGraph(runs, infrastructure.flows, rolesByAddress, facts)
  const summaryText = summarize(network, victimAddresses, scammerAddresses, labelCandidates, safetyDecisions, infrastructure.flows)

  if (options.caseId) {
    const { EvidenceStore } = await import('../cases/index.js')
    await EvidenceStore.append(options.caseId, {
      source: 'scam_topology',
      queryParams: `network=${network} victim_addresses=${victimAddresses.join(',')} scammer_addresses=${scammerAddresses.join(',')}`,
      content: JSON.stringify({
        schema: 'chain-insights.scam_topology_evidence.v1',
        source: 'scam_topology',
        network,
        victim_addresses: victimAddresses,
        scammer_addresses: scammerAddresses,
        label_candidates: labelCandidates,
        infrastructure_anchors: infrastructure.anchors,
        infrastructure_flow_count: infrastructure.flows.length,
        safety_decisions: safetyDecisions,
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
