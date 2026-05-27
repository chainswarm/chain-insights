import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'

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

type StakeSubjectRole = 'address' | 'coldkey' | 'hotkey'
type StakeTopologyGraph = 'live_topology' | 'archive_topology'

export interface StakeInsightsOptions {
  network: string
  address?: string
  coldkey?: string
  hotkey?: string
  netuid?: number
  startTimestampMs?: number
  endTimestampMs?: number
  startBlock?: number
  endBlock?: number
  depth?: number
  maxHops?: number
}

export interface StakeInsightsResult {
  summaryText: string
  structuredContent: {
    schema: 'chain-insights.result.v1'
    tool: 'stake_insights'
    facts: Record<string, unknown>
    hint: string
  }
  graphData: Record<string, unknown>
}

type QueryFailure = {
  id: string
  error: string
}

type StakeRelationship = {
  coldkey: string
  hotkey: string
  netuid?: number
  amount?: number
  source_role?: string
  destination_role?: string
  stake_added_amount?: number
  stake_removed_amount?: number
  stake_moved_in_amount?: number
  stake_moved_out_amount?: number
  net_stake_change?: number
  stake_event_count?: number
  first_seen_timestamp?: number
  last_seen_timestamp?: number
  first_activity_timestamp?: number
  last_activity_timestamp?: number
  first_tx_id?: string
  last_tx_id?: string
  active_days?: number
  granularity?: string
  source_stake_rows?: number
  source_backend?: string
  topology_graph: StakeTopologyGraph
}

const STAKE_INSIGHTS_QUERY_TIMEOUT_SECONDS = 120
const STAKE_INSIGHTS_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

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

function nonZeroNumber(value: unknown): number | undefined {
  const parsed = numberValue(value)
  return parsed !== undefined && parsed !== 0 ? parsed : undefined
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function resolveSubject(options: StakeInsightsOptions): { role: StakeSubjectRole; address: string } {
  const candidates = [
    ['address', options.address] as const,
    ['coldkey', options.coldkey] as const,
    ['hotkey', options.hotkey] as const,
  ].filter((entry): entry is readonly [StakeSubjectRole, string] => !!entry[1]?.trim())

  if (candidates.length !== 1) {
    throw new Error('Provide exactly one of address, coldkey, or hotkey')
  }

  return { role: candidates[0][0], address: candidates[0][1].trim() }
}

function validateOptions(options: StakeInsightsOptions): {
  network: string
  subject: { role: StakeSubjectRole; address: string }
  depth: number
} {
  const network = options.network.trim()
  if (!network) throw new Error('network is required')
  if (options.startBlock !== undefined || options.endBlock !== undefined) {
    throw new Error('Block windows are not available on the current stake graph surface; use start_timestamp_ms/end_timestamp_ms')
  }

  return {
    network,
    subject: resolveSubject(options),
    depth: clampInt(options.depth ?? options.maxHops, 1, 1, 3),
  }
}

function subjectPredicate(subject: { role: StakeSubjectRole; address: string }): string {
  const address = escapeCypherString(subject.address)
  if (subject.role === 'coldkey') return `coldkey.address = "${address}"`
  if (subject.role === 'hotkey') return `hotkey.address = "${address}"`
  return `(coldkey.address = "${address}" OR hotkey.address = "${address}")`
}

function stakeRelationshipQuery(
  topologyGraph: StakeTopologyGraph,
  subject: { role: StakeSubjectRole; address: string },
  options: StakeInsightsOptions,
  depth: number,
): { id: string; query: string } {
  const predicates = [subjectPredicate(subject)]
  if (options.netuid !== undefined) predicates.push(`stake.netuid = ${Math.trunc(options.netuid)}`)
  if (options.startTimestampMs !== undefined) predicates.push(`stake.last_activity_timestamp >= ${Math.trunc(options.startTimestampMs)}`)
  if (options.endTimestampMs !== undefined) predicates.push(`stake.first_activity_timestamp <= ${Math.trunc(options.endTimestampMs)}`)
  const limit = Math.min(500, Math.max(50, depth * 100))

  return {
    id: topologyGraph === 'live_topology' ? 'live_stake_relationships' : 'archive_stake_relationships',
    query: [
      `USE ${topologyGraph}`,
      'MATCH (coldkey:Address)-[stake:STAKES_IN]->(hotkey:Address)',
      `WHERE ${predicates.join(' AND ')}`,
      [
        'RETURN coldkey.address AS coldkey',
        'hotkey.address AS hotkey',
        'stake.netuid AS netuid',
        'stake.amount AS amount',
        'stake.source_role AS source_role',
        'stake.destination_role AS destination_role',
        'stake.stake_added_amount AS stake_added_amount',
        'stake.stake_removed_amount AS stake_removed_amount',
        'stake.stake_moved_in_amount AS stake_moved_in_amount',
        'stake.stake_moved_out_amount AS stake_moved_out_amount',
        'stake.net_stake_change AS net_stake_change',
        'stake.stake_event_count AS stake_event_count',
        'stake.first_seen_timestamp AS first_seen_timestamp',
        'stake.last_seen_timestamp AS last_seen_timestamp',
        'stake.first_activity_timestamp AS first_activity_timestamp',
        'stake.last_activity_timestamp AS last_activity_timestamp',
        'stake.first_tx_id AS first_tx_id',
        'stake.last_tx_id AS last_tx_id',
        'stake.active_days AS active_days',
        'stake.granularity AS granularity',
        'stake.source_stake_rows AS source_stake_rows',
        'stake.source_backend AS source_backend',
        `"${topologyGraph}" AS topology_graph`,
      ].join(', '),
      'ORDER BY stake.amount DESC',
      `LIMIT ${limit}`,
    ].join(' '),
  }
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
        queries,
        per_query_timeout_seconds: STAKE_INSIGHTS_QUERY_TIMEOUT_SECONDS,
      },
    },
    undefined,
    {
      timeout: STAKE_INSIGHTS_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: STAKE_INSIGHTS_REQUEST_TIMEOUT_MS,
    },
  ) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function topologyGraphForQueryId(id: string): StakeTopologyGraph {
  return id.startsWith('archive_') ? 'archive_topology' : 'live_topology'
}

function collectRelationships(batch: ParsedGraphBatch): {
  live: StakeRelationship[]
  archive: StakeRelationship[]
  failures: QueryFailure[]
  evidence: Array<Record<string, unknown>>
} {
  const failures: QueryFailure[] = []
  const evidence: Array<Record<string, unknown>> = []
  const live: StakeRelationship[] = []
  const archive: StakeRelationship[] = []

  for (const query of batch.facts?.queries ?? []) {
    const id = query.id ?? 'unknown'
    const topologyGraph = topologyGraphForQueryId(id)
    if (query.ok === false) {
      failures.push({ id, error: query.error || 'unknown error' })
      evidence.push({ id, topology_graph: topologyGraph, ok: false, row_count: 0, error: query.error || 'unknown error' })
      continue
    }

    const rows = (query.results ?? []).map((row) => normalizeRelationship(row, topologyGraph))
    if (topologyGraph === 'live_topology') live.push(...rows)
    else archive.push(...rows)
    evidence.push({
      id,
      topology_graph: topologyGraph,
      ok: true,
      row_count: rows.length,
      source_backends: [...new Set(rows.map((row) => row.source_backend).filter(Boolean))],
    })
  }

  return { live, archive, failures, evidence }
}

function normalizeRelationship(row: Record<string, unknown>, topologyGraph: StakeTopologyGraph): StakeRelationship {
  return {
    coldkey: String(row['coldkey'] ?? ''),
    hotkey: String(row['hotkey'] ?? ''),
    netuid: numberValue(row['netuid']),
    amount: numberValue(row['amount']),
    source_role: stringValue(row['source_role']),
    destination_role: stringValue(row['destination_role']),
    stake_added_amount: numberValue(row['stake_added_amount']),
    stake_removed_amount: numberValue(row['stake_removed_amount']),
    stake_moved_in_amount: numberValue(row['stake_moved_in_amount']),
    stake_moved_out_amount: numberValue(row['stake_moved_out_amount']),
    net_stake_change: numberValue(row['net_stake_change']),
    stake_event_count: numberValue(row['stake_event_count']),
    first_seen_timestamp: numberValue(row['first_seen_timestamp']),
    last_seen_timestamp: numberValue(row['last_seen_timestamp']),
    first_activity_timestamp: numberValue(row['first_activity_timestamp']),
    last_activity_timestamp: numberValue(row['last_activity_timestamp']),
    first_tx_id: stringValue(row['first_tx_id']),
    last_tx_id: stringValue(row['last_tx_id']),
    active_days: numberValue(row['active_days']),
    granularity: stringValue(row['granularity']),
    source_stake_rows: numberValue(row['source_stake_rows']),
    source_backend: stringValue(row['source_backend']) ?? (topologyGraph === 'live_topology' ? 'memgraph_live' : 'starrocks_archive'),
    topology_graph: topologyGraph,
  }
}

function firstTimestamp(rows: StakeRelationship[]): number | undefined {
  const timestamps = rows.map((row) => row.first_activity_timestamp).filter((value): value is number => value !== undefined)
  return timestamps.length > 0 ? Math.min(...timestamps) : undefined
}

function lastTimestamp(rows: StakeRelationship[]): number | undefined {
  const timestamps = rows.map((row) => row.last_activity_timestamp).filter((value): value is number => value !== undefined)
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined
}

function sum(rows: StakeRelationship[], selector: (row: StakeRelationship) => number | undefined): number {
  return rows.reduce((total, row) => total + (selector(row) ?? 0), 0)
}

function stakeTotals(rows: StakeRelationship[]): Record<string, unknown> {
  const totalStaked = sum(rows, (row) => row.stake_added_amount)
  const totalUnstaked = sum(rows, (row) => row.stake_removed_amount)
  const totalMovedIn = sum(rows, (row) => row.stake_moved_in_amount)
  const totalMovedOut = sum(rows, (row) => row.stake_moved_out_amount)
  const netStaked = rows.some((row) => row.net_stake_change !== undefined)
    ? sum(rows, (row) => row.net_stake_change)
    : sum(rows, (row) => row.amount)

  return {
    amount_unit: 'tao',
    total_staked: totalStaked,
    total_unstaked: totalUnstaked,
    total_moved_in: totalMovedIn,
    total_moved_out: totalMovedOut,
    net_staked: netStaked,
    relationship_count: rows.length,
    first_activity_timestamp: firstTimestamp(rows),
    last_activity_timestamp: lastTimestamp(rows),
  }
}

function movementRows(rows: StakeRelationship[]): Array<Record<string, unknown>> {
  const movements: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const base = {
      coldkey: row.coldkey,
      hotkey: row.hotkey,
      netuid: row.netuid,
      source_backend: row.source_backend,
      first_activity_timestamp: row.first_activity_timestamp,
      last_activity_timestamp: row.last_activity_timestamp,
    }
    const added = nonZeroNumber(row.stake_added_amount)
    if (added !== undefined) movements.push({ ...base, movement_type: 'stake_added', direction: 'coldkey_to_hotkey', amount: added })
    const removed = nonZeroNumber(row.stake_removed_amount)
    if (removed !== undefined) movements.push({ ...base, movement_type: 'stake_removed', direction: 'hotkey_to_coldkey', amount: removed })
    const movedIn = nonZeroNumber(row.stake_moved_in_amount)
    if (movedIn !== undefined) movements.push({ ...base, movement_type: 'stake_moved_in', direction: 'counterparty_to_relationship', amount: movedIn })
    const movedOut = nonZeroNumber(row.stake_moved_out_amount)
    if (movedOut !== undefined) movements.push({ ...base, movement_type: 'stake_moved_out', direction: 'relationship_to_counterparty', amount: movedOut })
  }
  return movements
}

function topCounterparties(
  subject: { role: StakeSubjectRole; address: string },
  rows: StakeRelationship[],
): Array<Record<string, unknown>> {
  const byAddress = new Map<string, { address: string; role: 'coldkey' | 'hotkey'; amount: number; relationship_count: number; stake_event_count: number }>()
  for (const row of rows) {
    const counterparties: Array<{ address: string; role: 'coldkey' | 'hotkey' }> = []
    if (subject.role === 'coldkey') counterparties.push({ address: row.hotkey, role: 'hotkey' })
    else if (subject.role === 'hotkey') counterparties.push({ address: row.coldkey, role: 'coldkey' })
    else {
      if (row.coldkey === subject.address) counterparties.push({ address: row.hotkey, role: 'hotkey' })
      if (row.hotkey === subject.address) counterparties.push({ address: row.coldkey, role: 'coldkey' })
    }

    for (const counterparty of counterparties.filter((entry) => entry.address)) {
      const current = byAddress.get(counterparty.address) ?? {
        address: counterparty.address,
        role: counterparty.role,
        amount: 0,
        relationship_count: 0,
        stake_event_count: 0,
      }
      current.amount += row.amount ?? row.net_stake_change ?? 0
      current.relationship_count += 1
      current.stake_event_count += row.stake_event_count ?? 0
      byAddress.set(counterparty.address, current)
    }
  }

  return [...byAddress.values()]
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
    .slice(0, 10)
}

function graphData(rows: StakeRelationship[], subject: { address: string; role: StakeSubjectRole }, network: string): Record<string, unknown> {
  const nodes = new Map<string, Record<string, unknown>>()
  const ensureNode = (address: string, role: string) => {
    const existing = nodes.get(address) ?? { id: address, address, node_type: 'address', labels: [], roles: [] }
    const roles = Array.isArray(existing['roles']) ? existing['roles'].map(String) : []
    nodes.set(address, { ...existing, roles: [...new Set([...roles, role])] })
  }

  ensureNode(subject.address, 'subject')
  const edges = rows.map((row) => {
    ensureNode(row.coldkey, 'coldkey')
    ensureNode(row.hotkey, 'hotkey')
    return {
      source: row.coldkey,
      target: row.hotkey,
      edge_type: 'stakes_in',
      amount: row.amount ?? row.net_stake_change ?? 0,
      netuid: row.netuid,
      source_backend: row.source_backend,
      topology_graph: row.topology_graph,
      first_activity_timestamp: row.first_activity_timestamp,
      last_activity_timestamp: row.last_activity_timestamp,
    }
  })

  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...nodes.values()],
    edges,
    flows: [],
    edge_anchors: [],
    metadata: {
      network,
      subject_address: subject.address,
      subject_role: subject.role,
      generated_at: new Date().toISOString(),
    },
  })
}

function summaryLines(
  network: string,
  subject: { role: StakeSubjectRole; address: string },
  rows: StakeRelationship[],
  totals: Record<string, unknown>,
  failures: QueryFailure[],
): string {
  const lines = [
    `Stake insights for ${network}:${subject.address}`,
    '',
    `Subject role: ${subject.role}`,
    `Relationships: ${rows.length}`,
    `Net staked: ${totals['net_staked'] ?? 0} TAO`,
    `Total staked: ${totals['total_staked'] ?? 0} TAO`,
    `Total unstaked: ${totals['total_unstaked'] ?? 0} TAO`,
    `First activity: ${totals['first_activity_timestamp'] ?? 'unknown'}`,
    `Last activity: ${totals['last_activity_timestamp'] ?? 'unknown'}`,
  ]

  if (rows.length > 0) {
    lines.push('', 'Top staking relationships')
    for (const row of rows.slice(0, 10)) {
      lines.push(`- ${row.coldkey} -> ${row.hotkey} netuid ${row.netuid ?? 'unknown'} amount ${row.amount ?? row.net_stake_change ?? 'unknown'} (${row.source_backend})`)
    }
  } else {
    lines.push('', 'No stake relationships matched the requested filters.')
  }

  if (failures.length > 0) {
    lines.push('', 'Partial query failures', failures.map((failure) => `- ${failure.id}: ${failure.error}`).join('\n'))
  }

  return lines.join('\n')
}

export async function stakeInsights(
  remoteClient: Client,
  options: StakeInsightsOptions,
): Promise<StakeInsightsResult> {
  const { network, subject, depth } = validateOptions(options)
  const batch = await callGraphBatch(remoteClient, network, [
    stakeRelationshipQuery('live_topology', subject, options, depth),
    stakeRelationshipQuery('archive_topology', subject, options, depth),
  ])
  const { live, archive, failures, evidence } = collectRelationships(batch)

  if (live.length === 0 && archive.length === 0 && failures.length > 0) {
    throw new Error(`Stake insights unavailable: ${failures.map((failure) => `${failure.id}: ${failure.error}`).join('; ')}`)
  }

  const rows = live.length > 0 ? live : archive
  const totals = stakeTotals(rows)
  const facts = {
    subject: {
      network,
      address: subject.address,
      role: subject.role,
      netuid: options.netuid,
      start_timestamp_ms: options.startTimestampMs,
      end_timestamp_ms: options.endTimestampMs,
      depth,
    },
    backend_used: [...new Set(rows.map((row) => row.source_backend).filter(Boolean))],
    primary_topology_graph: live.length > 0 ? 'live_topology' : 'archive_topology',
    stake_totals: totals,
    active_relationships: rows,
    stake_movements: movementRows(rows),
    top_counterparties: topCounterparties(subject, rows),
    query_evidence: evidence,
    partial_query_errors: failures.length > 0 ? failures : undefined,
  }

  return {
    summaryText: summaryLines(network, subject, rows, totals, failures),
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'stake_insights',
      facts,
      hint: rows.length > 0
        ? 'Review active_relationships and stake_movements before treating stake behavior as generic money flow.'
        : 'No matching stake relationships were found; confirm the address role, netuid, and time window.',
    },
    graphData: graphData(rows, subject, network),
  }
}
