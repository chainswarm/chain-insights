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

type ExposureSubjectRole = 'owner' | 'counterparty' | 'account'
type ExposureSide = 'long' | 'short' | 'stake' | 'unstake' | 'mixed' | 'unknown'
type ExposureDirection = 'long' | 'short' | 'mixed' | 'flat' | 'unknown'
type InstrumentType = 'subnet' | 'perp' | 'spot' | 'vault' | 'staking' | 'other'
type PricingStatus = 'priced' | 'unpriced' | 'partial'
type ExitPressure = 'low' | 'medium' | 'high' | 'unknown'

export interface ExposureProfileOptions {
  network: string
  account?: string
  owner?: string
  counterparty?: string
  venue?: string
  instrument?: string
  instrumentType?: string
  startTimestampMs?: number
  endTimestampMs?: number
  limit?: number
}

export interface ExposureProfileResult {
  summaryText: string
  structuredContent: {
    schema: 'chain-insights.exposure_profile.v1'
    tool: 'exposure_profile'
    subject: {
      network: string
      account: string
      role: ExposureSubjectRole
    }
    summary: {
      exposure_count: number
      venues: string[]
      instruments: string[]
      net_direction: ExposureDirection
      first_activity_timestamp?: number
      last_activity_timestamp?: number
    }
    exposures: PublicExposure[]
    caveats: string[]
  }
  graphData: Record<string, unknown>
}

type ValidatedOptions = {
  network: string
  subject: {
    role: ExposureSubjectRole
    account: string
  }
  venue?: string
  instrument?: string
  instrumentType?: string
  startTimestampMs?: number
  endTimestampMs?: number
  limit: number
}

type PublicExposure = {
  venue: string
  instrument: {
    id: string
    display_name: string
    type: InstrumentType
    lifecycle_id?: string
  }
  position: {
    side: ExposureSide
    quantity?: string
    quantity_unit?: string
    notional?: string
    quote_unit?: string
    pricing_status: PricingStatus
  }
  changes: {
    opened?: string
    closed?: string
    increased?: string
    reduced?: string
    net_change?: string
  }
  carry?: {
    received?: string
    paid?: string
    quote_unit?: string
  }
  risk?: {
    liquidation_distance?: string
    exit_pressure?: ExitPressure
  }
  activity: {
    first_seen_timestamp?: number
    last_seen_timestamp?: number
    event_count?: number
  }
  support: PublicSupportEvent[]
}

type PublicSupportEvent = {
  event_time?: number
  block_height?: number
  tx_id?: string
  order_id?: string
  trade_id?: string
  fill_id?: string
  action: string
  amount?: string
  price?: string
}

const EXPOSURE_PROFILE_QUERY_TIMEOUT_SECONDS = 10
const EXPOSURE_PROFILE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const INTERNAL_FIELD_NAMES = new Set([
  'source_backend',
  'evidence_relationship_type',
  'topology_graph',
  'source_view',
  'source_adapter',
  'query_id',
  'relationship_type',
])

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
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
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

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as T
}

function normalizeInstrumentType(value: unknown): InstrumentType {
  const normalized = stringValue(value)?.toLowerCase()
  switch (normalized) {
    case 'subnet':
    case 'perp':
    case 'spot':
    case 'vault':
    case 'staking':
    case 'other':
      return normalized
    default:
      return 'other'
  }
}

function normalizePricingStatus(value: unknown): PricingStatus {
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === 'priced' || normalized === 'partial') return normalized
  return 'unpriced'
}

function normalizeSide(value: unknown): ExposureSide {
  const normalized = stringValue(value)?.toLowerCase()
  switch (normalized) {
    case 'long':
    case 'short':
    case 'stake':
    case 'unstake':
    case 'mixed':
    case 'unknown':
      return normalized
    default:
      return 'unknown'
  }
}

function normalizeExitPressure(value: unknown): ExitPressure | undefined {
  const normalized = stringValue(value)?.toLowerCase()
  switch (normalized) {
    case 'low':
    case 'medium':
    case 'high':
    case 'unknown':
      return normalized
    default:
      return undefined
  }
}

function resolveSubject(options: ExposureProfileOptions): { role: ExposureSubjectRole; account: string } {
  const candidates = [
    ['account', options.account] as const,
    ['owner', options.owner] as const,
    ['counterparty', options.counterparty] as const,
  ].filter((entry): entry is readonly [ExposureSubjectRole, string] => !!entry[1]?.trim())

  if (candidates.length !== 1) {
    throw new Error('Provide exactly one of account, owner, or counterparty')
  }

  return { role: candidates[0][0], account: candidates[0][1].trim() }
}

function validateOptions(options: ExposureProfileOptions): ValidatedOptions {
  const network = options.network.trim()
  if (!network) throw new Error('network is required')
  return {
    network,
    subject: resolveSubject(options),
    venue: stringValue(options.venue),
    instrument: stringValue(options.instrument),
    instrumentType: stringValue(options.instrumentType),
    startTimestampMs: options.startTimestampMs,
    endTimestampMs: options.endTimestampMs,
    limit: clampInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
  }
}

function subjectPredicate(subject: { role: ExposureSubjectRole; account: string }): string {
  const account = escapeCypherString(subject.account)
  if (subject.role === 'owner') return `exposure.owner_address = "${account}"`
  if (subject.role === 'counterparty') return `exposure.counterparty_address = "${account}"`
  return `(account.address = "${account}" OR exposure.owner_address = "${account}" OR exposure.counterparty_address = "${account}")`
}

function exposureQuery(topologyGraph: 'live_topology' | 'archive_topology', options: ValidatedOptions): { id: string; query: string } {
  const predicates = [subjectPredicate(options.subject)]
  if (options.venue) predicates.push(`exposure.venue = "${escapeCypherString(options.venue)}"`)
  if (options.instrument) {
    const instrument = escapeCypherString(options.instrument)
    predicates.push(`(instrument.display_id = "${instrument}" OR instrument.id = "${instrument}" OR exposure.instrument_display_id = "${instrument}" OR exposure.instrument_id = "${instrument}")`)
  }
  if (options.instrumentType) predicates.push(`instrument.type = "${escapeCypherString(options.instrumentType)}"`)
  if (options.startTimestampMs !== undefined) predicates.push(`exposure.last_activity_timestamp >= ${Math.trunc(options.startTimestampMs)}`)
  if (options.endTimestampMs !== undefined) predicates.push(`exposure.first_activity_timestamp <= ${Math.trunc(options.endTimestampMs)}`)

  return {
    id: topologyGraph === 'live_topology' ? 'live_exposures' : 'archive_exposures',
    query: [
      `USE ${topologyGraph}`,
      'MATCH (account:Address)-[:HAS_EXPOSURE]->(exposure:Exposure)-[:TARGETS_INSTRUMENT]->(instrument:Instrument)',
      `WHERE ${predicates.join(' AND ')}`,
      [
        'RETURN account.address AS account_address',
        'exposure.owner_address AS owner_address',
        'exposure.counterparty_address AS counterparty_address',
        'exposure.venue AS venue',
        'instrument.id AS instrument_id',
        'instrument.display_id AS instrument_display_id',
        'instrument.type AS instrument_type',
        'instrument.lifecycle_id AS instrument_lifecycle_id',
        'exposure.side AS side',
        'exposure.quantity AS quantity',
        'exposure.quantity_unit AS quantity_unit',
        'exposure.notional AS notional',
        'exposure.quote_unit AS quote_unit',
        'exposure.pricing_status AS pricing_status',
        'exposure.opened AS opened',
        'exposure.closed AS closed',
        'exposure.increased AS increased',
        'exposure.reduced AS reduced',
        'exposure.net_change AS net_change',
        'exposure.carry_received AS carry_received',
        'exposure.carry_paid AS carry_paid',
        'exposure.liquidation_distance AS liquidation_distance',
        'exposure.exit_pressure AS exit_pressure',
        'exposure.event_count AS event_count',
        'exposure.first_activity_timestamp AS first_activity_timestamp',
        'exposure.last_activity_timestamp AS last_activity_timestamp',
        'exposure.support_events AS support_events',
      ].join(', '),
      'ORDER BY exposure.last_activity_timestamp DESC',
      `LIMIT ${options.limit}`,
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
        per_query_timeout_seconds: EXPOSURE_PROFILE_QUERY_TIMEOUT_SECONDS,
      },
    },
    undefined,
    {
      timeout: EXPOSURE_PROFILE_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: EXPOSURE_PROFILE_REQUEST_TIMEOUT_MS,
    },
  ) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
}

function collectRows(batch: ParsedGraphBatch): { rows: Array<Record<string, unknown>>; failedQueryCount: number } {
  const rowsByExposure = new Map<string, Record<string, unknown>>()
  let failedQueryCount = 0
  for (const query of batch.facts?.queries ?? []) {
    if (query.ok === false) {
      failedQueryCount += 1
      continue
    }
    for (const row of query.results ?? []) {
      const key = exposureRowKey(row)
      const existing = rowsByExposure.get(key)
      if (!existing || shouldReplaceExposureRow(existing, row)) {
        rowsByExposure.set(key, row)
      }
    }
  }
  return { rows: [...rowsByExposure.values()], failedQueryCount }
}

function exposureRowKey(row: Record<string, unknown>): string {
  return [
    stringValue(row['account_address']) ?? '',
    stringValue(row['venue']) ?? '',
    stringValue(row['instrument_id']) ?? stringValue(row['instrument_display_id']) ?? '',
    stringValue(row['counterparty_address']) ?? '',
  ].join('\u001f')
}

function shouldReplaceExposureRow(existing: Record<string, unknown>, candidate: Record<string, unknown>): boolean {
  const existingLastSeen = numberValue(existing['last_activity_timestamp']) ?? 0
  const candidateLastSeen = numberValue(candidate['last_activity_timestamp']) ?? 0
  if (candidateLastSeen !== existingLastSeen) return candidateLastSeen > existingLastSeen

  const existingEvents = numberValue(existing['event_count']) ?? 0
  const candidateEvents = numberValue(candidate['event_count']) ?? 0
  return candidateEvents > existingEvents
}

function parseSupportEvents(value: unknown): PublicSupportEvent[] {
  if (Array.isArray(value)) return value.flatMap((entry) => normalizeSupportEvent(entry))
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed)) return parsed.flatMap((entry) => normalizeSupportEvent(entry))
      return normalizeSupportEvent(parsed)
    } catch {
      return []
    }
  }
  return []
}

function normalizeSupportEvent(value: unknown): PublicSupportEvent[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const row = value as Record<string, unknown>
  const action = stringValue(row['action'])
  if (!action) return []
  return [compactRecord({
    event_time: numberValue(row['event_time']),
    block_height: numberValue(row['block_height']),
    tx_id: stringValue(row['tx_id']),
    order_id: stringValue(row['order_id']),
    trade_id: stringValue(row['trade_id']),
    fill_id: stringValue(row['fill_id']),
    action,
    amount: stringValue(row['amount']),
    price: stringValue(row['price']),
  })]
}

function publicExposureFromRow(row: Record<string, unknown>): PublicExposure {
  const venue = stringValue(row['venue']) ?? 'Unknown'
  const pricingStatus = normalizePricingStatus(row['pricing_status'])
  const quoteUnit = stringValue(row['quote_unit'])
  const carryReceived = stringValue(row['carry_received'])
  const carryPaid = stringValue(row['carry_paid'])
  const liquidationDistance = stringValue(row['liquidation_distance'])
  const exitPressure = normalizeExitPressure(row['exit_pressure'])

  return compactRecord({
    venue,
    instrument: compactRecord({
      id: stringValue(row['instrument_id']) ?? stringValue(row['instrument_display_id']) ?? 'unknown',
      display_name: stringValue(row['instrument_display_id']) ?? stringValue(row['instrument_id']) ?? 'Unknown instrument',
      type: normalizeInstrumentType(row['instrument_type']),
      lifecycle_id: stringValue(row['instrument_lifecycle_id']),
    }),
    position: compactRecord({
      side: normalizeSide(row['side']),
      quantity: stringValue(row['quantity']),
      quantity_unit: stringValue(row['quantity_unit']),
      notional: stringValue(row['notional']),
      quote_unit: quoteUnit,
      pricing_status: pricingStatus,
    }),
    changes: compactRecord({
      opened: stringValue(row['opened']),
      closed: stringValue(row['closed']),
      increased: stringValue(row['increased']),
      reduced: stringValue(row['reduced']),
      net_change: stringValue(row['net_change']),
    }),
    carry: carryReceived !== undefined || carryPaid !== undefined
      ? compactRecord({
          received: carryReceived,
          paid: carryPaid,
          quote_unit: quoteUnit,
        })
      : undefined,
    risk: liquidationDistance !== undefined || exitPressure !== undefined
      ? compactRecord({
          liquidation_distance: liquidationDistance,
          exit_pressure: exitPressure ?? 'unknown',
        })
      : undefined,
    activity: compactRecord({
      first_seen_timestamp: numberValue(row['first_activity_timestamp']),
      last_seen_timestamp: numberValue(row['last_activity_timestamp']),
      event_count: numberValue(row['event_count']),
    }),
    support: parseSupportEvents(row['support_events']),
  })
}

function caveatsFor(exposures: PublicExposure[], failedQueryCount: number): string[] {
  const caveats = new Set<string>()
  for (const exposure of exposures) {
    if (
      exposure.venue === 'Bittensor'
      && exposure.position.pricing_status === 'unpriced'
      && !exposure.position.quantity_unit
      && !exposure.position.quote_unit
    ) {
      caveats.add('Bittensor exposure quantity is unpriced because the source unit resolver has not proven a base or quote unit for this exposure.')
    }
    if (!exposure.instrument.lifecycle_id && exposure.instrument.type === 'subnet') {
      caveats.add('Subnet display identifiers can be reused across lifecycles; this result omits lifecycle identity when the source does not prove it.')
    }
  }
  if (failedQueryCount > 0) caveats.add('Some exposure data was unavailable during this query; results may be partial.')
  return [...caveats]
}

function firstTimestamp(exposures: PublicExposure[]): number | undefined {
  const timestamps = exposures
    .map((exposure) => exposure.activity.first_seen_timestamp)
    .filter((value): value is number => value !== undefined)
  return timestamps.length > 0 ? Math.min(...timestamps) : undefined
}

function lastTimestamp(exposures: PublicExposure[]): number | undefined {
  const timestamps = exposures
    .map((exposure) => exposure.activity.last_seen_timestamp)
    .filter((value): value is number => value !== undefined)
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined
}

function netDirection(exposures: PublicExposure[]): ExposureDirection {
  if (exposures.length === 0) return 'unknown'
  const sides = new Set(exposures.map((exposure) => exposure.position.side))
  if (sides.size === 1 && sides.has('long')) return 'long'
  if (sides.size === 1 && sides.has('short')) return 'short'
  const numericNet = exposures
    .map((exposure) => numberValue(exposure.changes.net_change))
    .filter((value): value is number => value !== undefined)
  if (numericNet.length > 0 && numericNet.every((value) => value === 0)) return 'flat'
  return 'mixed'
}

function graphData(exposures: PublicExposure[], subject: { network: string; account: string; role: ExposureSubjectRole }): Record<string, unknown> {
  const nodes = new Map<string, Record<string, unknown>>()
  const edges: Array<Record<string, unknown>> = []
  nodes.set(subject.account, { id: subject.account, address: subject.account, node_type: 'account', roles: [subject.role] })

  exposures.forEach((exposure, index) => {
    const exposureId = `exposure:${index}:${exposure.instrument.id}`
    nodes.set(exposureId, { id: exposureId, node_type: 'exposure', venue: exposure.venue, side: exposure.position.side })
    nodes.set(exposure.instrument.id, {
      id: exposure.instrument.id,
      node_type: 'instrument',
      display_name: exposure.instrument.display_name,
      instrument_type: exposure.instrument.type,
    })
    edges.push({ source: subject.account, target: exposureId, edge_type: 'exposure', venue: exposure.venue })
    edges.push({ source: exposureId, target: exposure.instrument.id, edge_type: 'instrument', venue: exposure.venue })
  })

  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...nodes.values()],
    edges,
    flows: [],
    edge_anchors: [],
    metadata: {
      network: subject.network,
      subject_address: subject.account,
      subject_role: subject.role,
      generated_at: new Date().toISOString(),
    },
  })
}

function summaryLines(network: string, subject: { account: string; role: ExposureSubjectRole }, exposures: PublicExposure[], caveats: string[]): string {
  const lines = [
    `Exposure profile for ${network}:${subject.account}`,
    '',
    `Subject role: ${subject.role}`,
    `Exposures: ${exposures.length}`,
  ]
  for (const exposure of exposures.slice(0, 10)) {
    lines.push(`- ${exposure.venue} ${exposure.instrument.display_name}: ${exposure.position.side} ${exposure.position.quantity ?? exposure.changes.net_change ?? 'unknown'}`)
  }
  if (caveats.length > 0) {
    lines.push('', 'Caveats')
    for (const caveat of caveats) lines.push(`- ${caveat}`)
  }
  return lines.join('\n')
}

export async function exposureProfile(
  remoteClient: Client,
  options: ExposureProfileOptions,
): Promise<ExposureProfileResult> {
  const validated = validateOptions(options)
  const batch = await callGraphBatch(remoteClient, validated.network, [
    exposureQuery('live_topology', validated),
    exposureQuery('archive_topology', validated),
  ])
  const { rows, failedQueryCount } = collectRows(batch)
  const exposures = rows.map(publicExposureFromRow)
  const caveats = caveatsFor(exposures, failedQueryCount)
  const venues = [...new Set(exposures.map((exposure) => exposure.venue))]
  const instruments = [...new Set(exposures.map((exposure) => exposure.instrument.display_name))]
  const structuredContent: ExposureProfileResult['structuredContent'] = {
    schema: 'chain-insights.exposure_profile.v1',
    tool: 'exposure_profile',
    subject: {
      network: validated.network,
      account: validated.subject.account,
      role: validated.subject.role,
    },
    summary: compactRecord({
      exposure_count: exposures.length,
      venues,
      instruments,
      net_direction: netDirection(exposures),
      first_activity_timestamp: firstTimestamp(exposures),
      last_activity_timestamp: lastTimestamp(exposures),
    }),
    exposures,
    caveats,
  }

  return {
    summaryText: summaryLines(validated.network, validated.subject, exposures, caveats),
    structuredContent,
    graphData: graphData(exposures, {
      network: validated.network,
      account: validated.subject.account,
      role: validated.subject.role,
    }),
  }
}

export const exposureProfileInternalFieldNames = INTERNAL_FIELD_NAMES
