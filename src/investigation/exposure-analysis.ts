import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { exposureProfile, type ExposureProfileOptions, type ExposureProfileResult } from './exposure-profile.js'
import { writeExposureArtifacts } from './exposure-report.js'

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

type Exposure = ExposureProfileResult['structuredContent']['exposures'][number]
type ExposureSubject = ExposureProfileResult['structuredContent']['subject']
type ExposureToolName =
  | 'exposure_quality'
  | 'exposure_carry'
  | 'exposure_crowding'
  | 'exposure_exit_pressure'
  | 'exposure_correlation'
  | 'exposure_explain'

type ExposureToolResult<T extends Record<string, unknown>> = {
  summaryText: string
  structuredContent: T & {
    schema: `chain-insights.${ExposureToolName}.v1`
    tool: ExposureToolName
    caveats: string[]
  }
}

export interface ExposureInsightOptions extends ExposureProfileOptions {
  candidateAccounts?: string | string[]
  market?: string
  positionId?: string
}

type MarketSearchOptions = {
  network: string
  instrument: string
  venue?: string
  instrumentType?: string
  startTimestampMs?: number
  endTimestampMs?: number
  limit: number
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const QUERY_TIMEOUT_SECONDS = 10

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
  const result = await remoteClient.callTool(
    {
      name: 'graph_query_batch',
      arguments: {
        network,
        queries,
        per_query_timeout_seconds: QUERY_TIMEOUT_SECONDS,
      },
    },
    undefined,
    {
      timeout: REQUEST_TIMEOUT_MS,
      maxTotalTimeout: REQUEST_TIMEOUT_MS,
    },
  ) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseGraphBatchResult(result)
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

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value as number)))
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as T
}

function candidateList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function hasSubject(options: ExposureInsightOptions): boolean {
  return [options.account, options.owner, options.counterparty].filter((value) => !!value?.trim()).length === 1
}

async function loadSubjectProfile(remoteClient: Client, options: ExposureInsightOptions): Promise<ExposureProfileResult> {
  return exposureProfile(remoteClient, {
    ...options,
    instrument: options.instrument ?? options.market,
    limit: clampLimit(options.limit),
    writeArtifacts: false,
  })
}

function marketPredicates(options: MarketSearchOptions): string[] {
  const instrument = escapeCypherString(options.instrument)
  const predicates = [
    `(instrument.display_id = "${instrument}" OR instrument.id = "${instrument}" OR exposure.instrument_display_id = "${instrument}" OR exposure.instrument_id = "${instrument}")`,
  ]
  if (options.venue) predicates.push(`exposure.venue = "${escapeCypherString(options.venue)}"`)
  if (options.instrumentType) predicates.push(`instrument.type = "${escapeCypherString(options.instrumentType)}"`)
  if (options.startTimestampMs !== undefined) predicates.push(`exposure.last_activity_timestamp >= ${Math.trunc(options.startTimestampMs)}`)
  if (options.endTimestampMs !== undefined) predicates.push(`exposure.first_activity_timestamp <= ${Math.trunc(options.endTimestampMs)}`)
  return predicates
}

function marketExposureQuery(topologyGraph: 'live_topology' | 'archive_topology', options: MarketSearchOptions): { id: string; query: string } {
  return {
    id: topologyGraph === 'live_topology' ? 'live_market_exposures' : 'archive_market_exposures',
    query: [
      `USE ${topologyGraph}`,
      'MATCH (account:Identity)-[:HAS_EXPOSURE]->(exposure:Exposure)-[:TARGETS_INSTRUMENT]->(instrument:Instrument)',
      `WHERE ${marketPredicates(options).join(' AND ')}`,
      [
        'RETURN account.identity_id AS account_address',
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

function normalizeInstrumentType(value: unknown): Exposure['instrument']['type'] {
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === 'subnet' || normalized === 'perp' || normalized === 'spot' || normalized === 'vault' || normalized === 'staking' || normalized === 'other') return normalized
  return 'other'
}

function normalizeSide(value: unknown): Exposure['position']['side'] {
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === 'long' || normalized === 'short' || normalized === 'stake' || normalized === 'unstake' || normalized === 'mixed' || normalized === 'unknown') return normalized
  return 'unknown'
}

function normalizePricingStatus(value: unknown): Exposure['position']['pricing_status'] {
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === 'priced' || normalized === 'partial') return normalized
  return 'unpriced'
}

function normalizeExitPressure(value: unknown): NonNullable<Exposure['risk']>['exit_pressure'] | undefined {
  const normalized = stringValue(value)?.toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'unknown') return normalized
  return undefined
}

function parseSupportEvents(value: unknown): Exposure['support'] {
  if (!value) return []
  const normalize = (entry: unknown): Exposure['support'] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
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
    }) as Exposure['support'][number]]
  }
  if (Array.isArray(value)) return value.flatMap(normalize)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.flatMap(normalize) : normalize(parsed)
    } catch {
      return []
    }
  }
  return normalize(value)
}

function exposureFromRow(row: Record<string, unknown>): Exposure {
  const quoteUnit = stringValue(row['quote_unit'])
  const carryReceived = stringValue(row['carry_received'])
  const carryPaid = stringValue(row['carry_paid'])
  const liquidationDistance = stringValue(row['liquidation_distance'])
  const exitPressure = normalizeExitPressure(row['exit_pressure'])
  return compactRecord({
    venue: stringValue(row['venue']) ?? 'Unknown',
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
      pricing_status: normalizePricingStatus(row['pricing_status']),
    }),
    changes: compactRecord({
      opened: stringValue(row['opened']),
      closed: stringValue(row['closed']),
      increased: stringValue(row['increased']),
      reduced: stringValue(row['reduced']),
      net_change: stringValue(row['net_change']),
    }),
    carry: carryReceived !== undefined || carryPaid !== undefined
      ? compactRecord({ received: carryReceived, paid: carryPaid, quote_unit: quoteUnit })
      : undefined,
    risk: liquidationDistance !== undefined || exitPressure !== undefined
      ? compactRecord({ liquidation_distance: liquidationDistance, exit_pressure: exitPressure ?? 'unknown' })
      : undefined,
    activity: compactRecord({
      first_seen_timestamp: numberValue(row['first_activity_timestamp']),
      last_seen_timestamp: numberValue(row['last_activity_timestamp']),
      event_count: numberValue(row['event_count']),
    }),
    support: parseSupportEvents(row['support_events']),
  }) as Exposure
}

function marketRowKey(row: Record<string, unknown>): string {
  return [
    stringValue(row['account_address']) ?? '',
    stringValue(row['venue']) ?? '',
    stringValue(row['instrument_id']) ?? stringValue(row['instrument_display_id']) ?? '',
    stringValue(row['counterparty_address']) ?? '',
    stringValue(row['side']) ?? '',
  ].join('\u001f')
}

function shouldReplaceMarketRow(existing: Record<string, unknown>, candidate: Record<string, unknown>): boolean {
  const existingLastSeen = numberValue(existing['last_activity_timestamp']) ?? 0
  const candidateLastSeen = numberValue(candidate['last_activity_timestamp']) ?? 0
  if (candidateLastSeen !== existingLastSeen) return candidateLastSeen > existingLastSeen
  return (numberValue(candidate['event_count']) ?? 0) >= (numberValue(existing['event_count']) ?? 0)
}

async function loadMarketExposures(remoteClient: Client, options: MarketSearchOptions): Promise<{ exposures: Exposure[]; failedQueryCount: number }> {
  const batch = await callGraphBatch(remoteClient, options.network, [
    marketExposureQuery('live_topology', options),
    marketExposureQuery('archive_topology', options),
  ])
  const rowsByKey = new Map<string, Record<string, unknown>>()
  let failedQueryCount = 0
  for (const query of batch.facts?.queries ?? []) {
    if (query.ok === false) {
      failedQueryCount += 1
      continue
    }
    for (const row of query.results ?? []) {
      const key = marketRowKey(row)
      const existing = rowsByKey.get(key)
      if (!existing || shouldReplaceMarketRow(existing, row)) rowsByKey.set(key, row)
    }
  }
  return { exposures: [...rowsByKey.values()].map(exposureFromRow), failedQueryCount }
}

function firstTimestamp(exposures: Exposure[]): number | undefined {
  const values = exposures.map((exposure) => exposure.activity.first_seen_timestamp).filter((value): value is number => value !== undefined)
  return values.length ? Math.min(...values) : undefined
}

function lastTimestamp(exposures: Exposure[]): number | undefined {
  const values = exposures.map((exposure) => exposure.activity.last_seen_timestamp).filter((value): value is number => value !== undefined)
  return values.length ? Math.max(...values) : undefined
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (value ?? 0), 0)
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function confidenceFromCoverage(exposures: Exposure[], caveats: string[]): 'high' | 'medium' | 'low' {
  const eventCount = sum(exposures.map((exposure) => exposure.activity.event_count))
  if (exposures.length === 0 || caveats.length >= 3 || eventCount < 10) return 'low'
  if (caveats.length > 0 || eventCount < 50) return 'medium'
  return 'high'
}

function baseCaveats(exposures: Exposure[], failedQueryCount = 0): string[] {
  const caveats = new Set<string>()
  if (failedQueryCount > 0) caveats.add('Some exposure data was unavailable during this query; results may be partial.')
  if (exposures.length === 0) caveats.add('No matching exposure rows were available for this query window.')
  if (exposures.some((exposure) => exposure.position.pricing_status !== 'priced')) {
    caveats.add('Some exposure rows are unpriced or partially priced; notional, carry, and quality metrics may be incomplete.')
  }
  if (exposures.some((exposure) => exposure.instrument.type === 'subnet' && !exposure.instrument.lifecycle_id)) {
    caveats.add('Subnet display identifiers can be reused across lifecycles; lifecycle identity is missing for at least one row.')
  }
  return [...caveats]
}

function profileSubject(profile: ExposureProfileResult): ExposureSubject {
  return profile.structuredContent.subject
}

function subjectLine(subject: ExposureSubject): string {
  return `${subject.network}:${subject.account} (${subject.role})`
}

function requireInstrument(options: ExposureInsightOptions): string {
  const instrument = options.instrument ?? options.market
  if (!instrument?.trim()) throw new Error('instrument or market is required')
  return instrument.trim()
}

function qualityClassification(qualityScore: number): string {
  if (qualityScore >= 75) return 'disciplined'
  if (qualityScore >= 55) return 'mixed'
  if (qualityScore >= 35) return 'fragile'
  return 'noisy'
}

function artifactSubject(options: ExposureInsightOptions): string {
  return options.account ?? options.owner ?? options.counterparty ?? options.instrument ?? options.market ?? 'subject'
}

async function maybeWriteArtifacts(
  toolName: ExposureToolName,
  options: ExposureInsightOptions,
  result: ExposureToolResult<Record<string, unknown>>,
): Promise<void> {
  if (!options.writeArtifacts) return
  await writeExposureArtifacts({
    toolName,
    network: options.network,
    subject: artifactSubject(options),
    summaryText: result.summaryText,
    structuredContent: result.structuredContent,
  })
}

export async function exposureQuality(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: ExposureSubject
  summary: Record<string, unknown>
  components: Record<string, unknown>
  flags: string[]
  evidence: Exposure['support']
}>> {
  const profile = await loadSubjectProfile(remoteClient, options)
  const exposures = profile.structuredContent.exposures
  const caveats = [...profile.structuredContent.caveats]
  const eventCount = sum(exposures.map((exposure) => exposure.activity.event_count))
  const pricedCount = exposures.filter((exposure) => exposure.position.pricing_status === 'priced').length
  const carryRows = exposures.filter((exposure) => exposure.carry?.paid !== undefined || exposure.carry?.received !== undefined).length
  const riskRows = exposures.filter((exposure) => exposure.risk?.liquidation_distance !== undefined || exposure.risk?.exit_pressure !== undefined).length
  const positiveNet = exposures.filter((exposure) => (numberValue(exposure.changes.net_change) ?? 0) > 0).length
  const negativeNet = exposures.filter((exposure) => (numberValue(exposure.changes.net_change) ?? 0) < 0).length
  const sampleScore = Math.min(35, eventCount)
  const pricingScore = ratio(pricedCount, exposures.length) * 20
  const balanceScore = exposures.length === 0 ? 0 : (1 - Math.abs(positiveNet - negativeNet) / exposures.length) * 15
  const riskCoverageScore = ratio(riskRows, exposures.length) * 15
  const carryCoverageScore = ratio(carryRows, exposures.length) * 15
  const qualityScore = score(sampleScore + pricingScore + balanceScore + riskCoverageScore + carryCoverageScore)
  if (eventCount < 50) caveats.push('Sample size is below the 50-event threshold for stronger quality claims.')
  const flags = [
    eventCount < 50 ? 'small_sample' : undefined,
    pricedCount < exposures.length ? 'pricing_gap' : undefined,
    riskRows === 0 ? 'risk_gap' : undefined,
    carryRows === 0 ? 'carry_gap' : undefined,
  ].filter((value): value is string => !!value)
  const subject = profileSubject(profile)
  const structuredContent = {
    schema: 'chain-insights.exposure_quality.v1' as const,
    tool: 'exposure_quality' as const,
    subject,
    summary: {
      classification: qualityClassification(qualityScore),
      score: qualityScore,
      confidence: confidenceFromCoverage(exposures, caveats),
      exposure_count: exposures.length,
      event_count: eventCount,
      first_activity_timestamp: firstTimestamp(exposures),
      last_activity_timestamp: lastTimestamp(exposures),
    },
    components: {
      sample_score: score(sampleScore),
      pricing_coverage_ratio: ratio(pricedCount, exposures.length),
      carry_coverage_ratio: ratio(carryRows, exposures.length),
      risk_coverage_ratio: ratio(riskRows, exposures.length),
      positive_net_exposures: positiveNet,
      negative_net_exposures: negativeNet,
    },
    flags,
    evidence: exposures.flatMap((exposure) => exposure.support).slice(0, 10),
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure quality for ${subjectLine(subject)}`,
      `Classification: ${structuredContent.summary.classification}`,
      `Score: ${qualityScore}/100 (${structuredContent.summary.confidence} confidence)`,
      `Exposures: ${exposures.length}, events: ${eventCount}`,
      flags.length ? `Flags: ${flags.join(', ')}` : 'Flags: none',
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_quality', options, result)
  return result
}

export async function exposureCarry(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: ExposureSubject
  summary: Record<string, unknown>
  venues: Array<Record<string, unknown>>
  evidence: Exposure['support']
}>> {
  const profile = await loadSubjectProfile(remoteClient, options)
  const exposures = profile.structuredContent.exposures
  const caveats = [...profile.structuredContent.caveats]
  const received = sum(exposures.map((exposure) => numberValue(exposure.carry?.received)))
  const paid = sum(exposures.map((exposure) => numberValue(exposure.carry?.paid)))
  const net = received - paid
  const byVenue = new Map<string, { received: number; paid: number; rows: number }>()
  for (const exposure of exposures) {
    const row = byVenue.get(exposure.venue) ?? { received: 0, paid: 0, rows: 0 }
    row.received += numberValue(exposure.carry?.received) ?? 0
    row.paid += numberValue(exposure.carry?.paid) ?? 0
    row.rows += 1
    byVenue.set(exposure.venue, row)
  }
  if (exposures.every((exposure) => exposure.carry === undefined)) {
    caveats.push('No carry rows were available; this can mean the venue adapter has not indexed funding, fees, emissions, or dividends yet.')
  }
  const subject = profileSubject(profile)
  const structuredContent = {
    schema: 'chain-insights.exposure_carry.v1' as const,
    tool: 'exposure_carry' as const,
    subject,
    summary: {
      net_carry: String(net),
      carry_received: String(received),
      carry_paid: String(paid),
      confidence: confidenceFromCoverage(exposures, caveats),
      exposure_count: exposures.length,
    },
    venues: [...byVenue.entries()].map(([venue, row]) => ({
      venue,
      net_carry: String(row.received - row.paid),
      carry_received: String(row.received),
      carry_paid: String(row.paid),
      exposure_count: row.rows,
    })),
    evidence: exposures.flatMap((exposure) => exposure.support).slice(0, 10),
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure carry for ${subjectLine(subject)}`,
      `Net carry: ${structuredContent.summary.net_carry}`,
      `Received: ${structuredContent.summary.carry_received}, paid: ${structuredContent.summary.carry_paid}`,
      `Confidence: ${structuredContent.summary.confidence}`,
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_carry', options, result)
  return result
}

export async function exposureCrowding(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: Record<string, unknown>
  summary: Record<string, unknown>
  sides: Array<Record<string, unknown>>
  top_exposures: Array<Record<string, unknown>>
}>> {
  const instrument = requireInstrument(options)
  const { exposures, failedQueryCount } = await loadMarketExposures(remoteClient, {
    network: options.network,
    instrument,
    venue: options.venue,
    instrumentType: options.instrumentType,
    startTimestampMs: options.startTimestampMs,
    endTimestampMs: options.endTimestampMs,
    limit: clampLimit(options.limit),
  })
  const caveats = baseCaveats(exposures, failedQueryCount)
  const bySide = new Map<string, { count: number; notional: number; quantity: number }>()
  for (const exposure of exposures) {
    const side = exposure.position.side
    const row = bySide.get(side) ?? { count: 0, notional: 0, quantity: 0 }
    row.count += 1
    row.notional += numberValue(exposure.position.notional) ?? 0
    row.quantity += Math.abs(numberValue(exposure.position.quantity) ?? 0)
    bySide.set(side, row)
  }
  const sortedSides = [...bySide.entries()].sort((a, b) => b[1].count - a[1].count)
  const leadingSide = sortedSides[0]?.[0] ?? 'unknown'
  const leadingCount = sortedSides[0]?.[1].count ?? 0
  const crowdingRatio = ratio(leadingCount, exposures.length)
  const subject = {
    network: options.network,
    instrument,
    venue: options.venue,
  }
  const structuredContent = {
    schema: 'chain-insights.exposure_crowding.v1' as const,
    tool: 'exposure_crowding' as const,
    subject,
    summary: {
      exposure_count: exposures.length,
      leading_side: leadingSide,
      crowding_ratio: crowdingRatio,
      crowding_level: crowdingRatio >= 0.75 ? 'high' : crowdingRatio >= 0.5 ? 'medium' : exposures.length > 0 ? 'low' : 'unknown',
      confidence: confidenceFromCoverage(exposures, caveats),
      first_activity_timestamp: firstTimestamp(exposures),
      last_activity_timestamp: lastTimestamp(exposures),
    },
    sides: sortedSides.map(([side, row]) => ({
      side,
      exposure_count: row.count,
      notional: String(row.notional),
      quantity: String(row.quantity),
    })),
    top_exposures: exposures.slice(0, 10).map((exposure) => ({
      venue: exposure.venue,
      instrument: exposure.instrument.display_name,
      side: exposure.position.side,
      quantity: exposure.position.quantity,
      notional: exposure.position.notional,
      last_seen_timestamp: exposure.activity.last_seen_timestamp,
    })),
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure crowding for ${options.network}:${instrument}`,
      `Level: ${structuredContent.summary.crowding_level}`,
      `Leading side: ${leadingSide} (${Math.round(crowdingRatio * 100)}%)`,
      `Exposures: ${exposures.length}`,
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_crowding', options, result)
  return result
}

export async function exposureExitPressure(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: Record<string, unknown>
  summary: Record<string, unknown>
  pressure_bands: Array<Record<string, unknown>>
  evidence: Exposure['support']
}>> {
  const useMarket = !hasSubject(options)
  const loaded = useMarket
    ? await loadMarketExposures(remoteClient, {
        network: options.network,
        instrument: requireInstrument(options),
        venue: options.venue,
        instrumentType: options.instrumentType,
        startTimestampMs: options.startTimestampMs,
        endTimestampMs: options.endTimestampMs,
        limit: clampLimit(options.limit),
      })
    : { exposures: (await loadSubjectProfile(remoteClient, options)).structuredContent.exposures, failedQueryCount: 0 }
  const exposures = loaded.exposures
  const caveats = baseCaveats(exposures, loaded.failedQueryCount)
  const bands = new Map<string, number>()
  for (const exposure of exposures) {
    const band = exposure.risk?.exit_pressure ?? 'unknown'
    bands.set(band, (bands.get(band) ?? 0) + 1)
  }
  const high = bands.get('high') ?? 0
  const medium = bands.get('medium') ?? 0
  const pressureScore = score(ratio(high * 2 + medium, Math.max(exposures.length * 2, 1)) * 100)
  if (exposures.every((exposure) => exposure.risk === undefined)) caveats.push('No exit-risk rows were available; liquidation, slippage, funding pain, or unstake pressure may not be indexed yet.')
  const subject = useMarket
    ? { network: options.network, instrument: requireInstrument(options), venue: options.venue }
    : { network: options.network, account: options.account ?? options.owner ?? options.counterparty }
  const structuredContent = {
    schema: 'chain-insights.exposure_exit_pressure.v1' as const,
    tool: 'exposure_exit_pressure' as const,
    subject,
    summary: {
      pressure_score: pressureScore,
      pressure_level: pressureScore >= 70 ? 'high' : pressureScore >= 35 ? 'medium' : exposures.length > 0 ? 'low' : 'unknown',
      exposure_count: exposures.length,
      confidence: confidenceFromCoverage(exposures, caveats),
    },
    pressure_bands: [...bands.entries()].map(([band, count]) => ({ band, exposure_count: count })),
    evidence: exposures.flatMap((exposure) => exposure.support).slice(0, 10),
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure exit pressure for ${String(subject['network'])}:${String(subject['account'] ?? subject['instrument'])}`,
      `Level: ${structuredContent.summary.pressure_level}`,
      `Score: ${pressureScore}/100`,
      `Exposures: ${exposures.length}`,
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_exit_pressure', options, result)
  return result
}

export async function exposureCorrelation(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: ExposureSubject
  summary: Record<string, unknown>
  relationships: Array<Record<string, unknown>>
}>> {
  const primary = await loadSubjectProfile(remoteClient, options)
  const primaryExposures = primary.structuredContent.exposures
  const candidates = candidateList(options.candidateAccounts)
  const caveats = [...primary.structuredContent.caveats]
  if (candidates.length === 0) caveats.push('No candidate accounts were supplied; correlation v1 requires explicit candidates for deterministic scoring.')
  const relationships: Array<Record<string, unknown>> = []
  const primaryInstruments = new Set(primaryExposures.map((exposure) => exposure.instrument.id))
  for (const candidate of candidates.slice(0, 10)) {
    const candidateProfile = await exposureProfile(remoteClient, {
      network: options.network,
      account: candidate,
      venue: options.venue,
      instrument: options.instrument ?? options.market,
      instrumentType: options.instrumentType,
      startTimestampMs: options.startTimestampMs,
      endTimestampMs: options.endTimestampMs,
      limit: clampLimit(options.limit),
    })
    const candidateExposures = candidateProfile.structuredContent.exposures
    const candidateInstruments = new Set(candidateExposures.map((exposure) => exposure.instrument.id))
    const overlap = [...primaryInstruments].filter((instrument) => candidateInstruments.has(instrument))
    const overlapRatio = ratio(overlap.length, Math.max(primaryInstruments.size, candidateInstruments.size, 1))
    relationships.push({
      account: candidate,
      overlap_ratio: overlapRatio,
      overlapping_instruments: overlap,
      confidence: overlap.length >= 3 ? 'medium' : overlap.length > 0 ? 'low' : 'none',
      warning: overlap.length > 0 ? 'Overlap is behavioral correlation, not proof of shared control or copy trading.' : undefined,
    })
  }
  const subject = profileSubject(primary)
  const structuredContent = {
    schema: 'chain-insights.exposure_correlation.v1' as const,
    tool: 'exposure_correlation' as const,
    subject,
    summary: {
      candidate_count: candidates.length,
      relationship_count: relationships.filter((row) => Number(row['overlap_ratio']) > 0).length,
      confidence: confidenceFromCoverage(primaryExposures, caveats),
    },
    relationships,
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure correlation for ${subjectLine(subject)}`,
      `Candidates: ${candidates.length}`,
      `Relationships with overlap: ${structuredContent.summary.relationship_count}`,
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_correlation', options, result)
  return result
}

export async function exposureExplain(
  remoteClient: Client,
  options: ExposureInsightOptions,
): Promise<ExposureToolResult<{
  subject: ExposureSubject
  summary: Record<string, unknown>
  lifecycle: Record<string, unknown>
  evidence: Exposure['support']
}>> {
  const profile = await loadSubjectProfile(remoteClient, {
    ...options,
    instrument: options.instrument ?? options.market,
    limit: clampLimit(options.limit ?? 25),
  })
  const exposures = profile.structuredContent.exposures
  const caveats = [...profile.structuredContent.caveats]
  if (!options.instrument && !options.market) caveats.push('No instrument was supplied; explanation uses the most recent matching exposure rows.')
  const selected = exposures[0]
  const subject = profileSubject(profile)
  const evidence = exposures.flatMap((exposure) => exposure.support).slice(0, 20)
  const structuredContent = {
    schema: 'chain-insights.exposure_explain.v1' as const,
    tool: 'exposure_explain' as const,
    subject,
    summary: {
      exposure_count: exposures.length,
      explained_instrument: selected?.instrument.display_name,
      side: selected?.position.side,
      first_activity_timestamp: firstTimestamp(exposures),
      last_activity_timestamp: lastTimestamp(exposures),
      confidence: confidenceFromCoverage(exposures, caveats),
    },
    lifecycle: compactRecord({
      venue: selected?.venue,
      instrument: selected?.instrument,
      position: selected?.position,
      changes: selected?.changes,
      carry: selected?.carry,
      risk: selected?.risk,
      activity: selected?.activity,
      position_id: options.positionId,
    }),
    evidence,
    caveats,
  }
  const result = {
    summaryText: [
      `Exposure explanation for ${subjectLine(subject)}`,
      selected ? `Instrument: ${selected.instrument.display_name}` : 'Instrument: unavailable',
      selected ? `Position: ${selected.position.side} ${selected.position.quantity ?? selected.changes.net_change ?? 'unknown'}` : 'Position: unavailable',
      `Evidence events: ${evidence.length}`,
    ].join('\n'),
    structuredContent,
  }
  await maybeWriteArtifacts('exposure_explain', options, result)
  return result
}
