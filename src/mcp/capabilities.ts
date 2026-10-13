import type { InvestigatorConfig } from '../config/schema.js'
import { applyMcpAuthHeaders, resolveGraphMcpEndpoint } from './client.js'

export interface NetworkTopologyLayer {
  enabled: boolean
  coverage?: {
    from_block?: number
    to_block?: number
    from_timestamp?: string
    to_timestamp?: string
    chain_tip_block?: number
    blocks_behind_tip?: number
    /** Lowest height among the raw-data lanes that have started. Above it an empty answer may mean "not indexed yet". */
    complete_through_block?: number
  }
}

export interface NetworkLayerCapability {
  enabled: boolean
  live?: NetworkTopologyLayer
  archive?: NetworkTopologyLayer
  /** The relationships a facts layer serves, when the server lists them. */
  relationships?: string[]
}

/**
 * A block the server publishes about one layer's limits. The mirror repeats it
 * exactly as it came: the members named below are the ones known today, and
 * any other member the server adds is kept. Read a limit from the block, never
 * from a number written elsewhere.
 */
export type NetworkAdmissionBlock = Record<string, unknown>

/** `USE chain`: the lookups, the ceilings and the slots of the chain layer. */
export interface ChainAdmission extends NetworkAdmissionBlock {
  enabled: boolean
  /** ok, or the reason the layer is off or behind. */
  status?: string
  rules_version?: string
  grammar?: string
  /** The labels of `USE chain`, such as Transaction, Block, Head and Address. */
  lookups?: string[]
  ceiling_seconds?: Record<string, number>
  slots?: number
  past_slots?: number
  slots_per_caller?: number
  calls_per_second_per_caller?: number
  batch_max?: number
  call_gas?: number
  head_ttl_ms?: number
  max_head_age_seconds?: number
  /** How many blocks below the tip a past `Address` read (`at_block`) must be. Read it here, never write it down. */
  at_block_min_depth?: number
}

/** `USE topology`: the shape rules, when the server publishes them. */
export interface TopologyAdmission extends NetworkAdmissionBlock {
  rules_version?: string
  max_hops_per_path?: number
  max_limit?: number
  slots?: number
}

/** `USE facts`: the read contract, when the server publishes it. */
export interface FactsAdmission extends NetworkAdmissionBlock {
  rules_version?: string
  window_days?: number
  max_rows?: number
  max_hops?: number
}

export interface NetworkCapability {
  network: string
  display_name?: string
  status: string
  default?: boolean
  /** The layers as the server sent them. Absent when the server sent none. */
  layers?: Record<string, NetworkLayerCapability>
  tools: Record<string, string>
  /** The three layer blocks below are repeated exactly as sent, and absent when not sent. */
  chain_admission?: ChainAdmission
  topology_admission?: TopologyAdmission
  facts_admission?: FactsAdmission
  coverage?: {
    from_block?: number
    to_block?: number
    from_timestamp?: string
    to_timestamp?: string
    chain_tip_block?: number
    blocks_behind_tip?: number
    /** Lowest height among the raw-data lanes that have started. Above it an empty answer may mean "not indexed yet". */
    complete_through_block?: number
  }
  freshness?: {
    last_processed_at?: string
    last_successful_sync_at?: string
    max_data_age_seconds?: number
    last_processing_duration_seconds?: number
    /** The chain node's own head block, and how old that reading is. */
    chain_head_block?: number
    chain_head_age_seconds?: number
    warehouse_blocks_behind_head?: number
    graph_blocks_behind_head?: number
  }
  lane_progress?: NetworkLaneProgress[]
  graph_progress?: NetworkGraphProgress
}

/** One writer lane's committed height. null: the lane has not started. */
export interface NetworkLaneProgress {
  lane: string
  height: number | null
}

/** How far each block layer of the topology graph reaches, and their lowest. */
export interface NetworkGraphProgress {
  complete_through_block: number
  layers: { layer: string; position: number }[]
}

export interface NetworkCapabilitiesDocument {
  schema: 'chain-insights.network-capabilities.v1'
  networks: NetworkCapability[]
}

const AVAILABLE_TOOLS_PER_LINE = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function advertisedTools(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const tools: Record<string, string> = {}
  for (const [name, status] of Object.entries(raw)) {
    if (name.trim() !== '' && typeof status === 'string') tools[name] = status
  }
  return tools
}

function advertisedLaneProgress(raw: unknown): NetworkLaneProgress[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const lanes: NetworkLaneProgress[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.lane !== 'string' || entry.lane.trim() === '') continue
    if (typeof entry.height === 'number') lanes.push({ lane: entry.lane, height: entry.height })
    else if (entry.height === null) lanes.push({ lane: entry.lane, height: null })
  }
  return lanes
}

function advertisedGraphProgress(raw: unknown): NetworkGraphProgress | undefined {
  if (!isRecord(raw) || typeof raw.complete_through_block !== 'number') return undefined
  if (!Array.isArray(raw.layers)) return undefined
  const layers: NetworkGraphProgress['layers'] = []
  for (const entry of raw.layers) {
    if (!isRecord(entry) || typeof entry.layer !== 'string' || typeof entry.position !== 'number')
      continue
    layers.push({ layer: entry.layer, position: entry.position })
  }
  return { complete_through_block: raw.complete_through_block, layers }
}

function advertisedNetwork(raw: unknown): NetworkCapability | null {
  if (!isRecord(raw) || typeof raw.network !== 'string' || raw.network.trim() === '') {
    return null
  }
  const network = raw.network.trim()
  const capability: NetworkCapability = {
    network,
    display_name:
      typeof raw.display_name === 'string' && raw.display_name.trim() !== ''
        ? raw.display_name
        : network,
    status: typeof raw.status === 'string' && raw.status.trim() !== '' ? raw.status : 'live',
    tools: advertisedTools(raw.tools),
  }
  // The layer blocks are the server's own words about its limits. They pass
  // through exactly as sent: nothing is added, no default is invented and no
  // member is dropped. A block the server did not send stays absent.
  if (isRecord(raw.layers)) capability.layers = raw.layers as NetworkCapability['layers']
  if (isRecord(raw.chain_admission)) {
    capability.chain_admission = raw.chain_admission as unknown as ChainAdmission
  }
  if (isRecord(raw.topology_admission)) {
    capability.topology_admission = raw.topology_admission as TopologyAdmission
  }
  if (isRecord(raw.facts_admission)) {
    capability.facts_admission = raw.facts_admission as FactsAdmission
  }
  if (raw.default === true) capability.default = true
  if (raw.default === false) capability.default = false
  if (isRecord(raw.coverage)) capability.coverage = raw.coverage as NetworkCapability['coverage']
  if (isRecord(raw.freshness))
    capability.freshness = raw.freshness as NetworkCapability['freshness']
  const laneProgress = advertisedLaneProgress(raw.lane_progress)
  if (laneProgress) capability.lane_progress = laneProgress
  const graphProgress = advertisedGraphProgress(raw.graph_progress)
  if (graphProgress) capability.graph_progress = graphProgress
  return capability
}

/** Repeat GraphRAG's network list. CIA does not add, drop, or invent names. */
export function mirrorGraphNetworkCapabilities(document: {
  networks: unknown[]
}): NetworkCapabilitiesDocument {
  return {
    schema: 'chain-insights.network-capabilities.v1',
    networks: document.networks
      .map((network) => advertisedNetwork(network))
      .filter((network): network is NetworkCapability => network !== null),
  }
}

function publicNetworkCapabilities(
  document: NetworkCapabilitiesDocument
): NetworkCapabilitiesDocument {
  return mirrorGraphNetworkCapabilities(document)
}

function metadataNetworksUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  url.pathname = '/metadata/networks'
  url.search = ''
  url.hash = ''
  return url
}

export async function fetchNetworkCapabilities(
  config: Pick<InvestigatorConfig, 'graphMcpAuthToken' | 'graphMcpMode' | 'graphMcpEndpoint'>
): Promise<NetworkCapabilitiesDocument> {
  const endpoint = resolveGraphMcpEndpoint(config)
  const request = metadataNetworksUrl(endpoint)
  const headers = new Headers()
  const token = config.graphMcpAuthToken?.trim()
  if (token) {
    applyMcpAuthHeaders(headers, token)
  }
  let response: Response
  try {
    response = await fetch(request, { headers })
  } catch (err) {
    throw new Error(`network capabilities unavailable at ${request}: ${(err as Error).message}`)
  }
  if (!response.ok) {
    throw new Error(`network capabilities unavailable at ${request}: HTTP ${response.status}`)
  }
  const parsed = (await response.json()) as NetworkCapabilitiesDocument
  if (
    parsed.schema !== 'chain-insights.network-capabilities.v1' ||
    !Array.isArray(parsed.networks)
  ) {
    throw new Error('network capabilities response has unsupported schema')
  }
  return publicNetworkCapabilities(parsed)
}

function availableTools(network: NetworkCapability): string[] {
  const tools = Object.entries(network.tools ?? {})
    .filter(([, status]) => status === 'available')
    .map(([name]) => name)
  return tools.sort()
}

function availableToolLines(network: NetworkCapability): string[] {
  const tools = availableTools(network)
  if (tools.length === 0) return ['none']
  const lines: string[] = []
  for (let index = 0; index < tools.length; index += AVAILABLE_TOOLS_PER_LINE) {
    lines.push(tools.slice(index, index + AVAILABLE_TOOLS_PER_LINE).join(', '))
  }
  return lines
}

function shortDate(value?: string): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function datasetLabel(network: NetworkCapability): string {
  const coverage = network.coverage
  if (!coverage) return 'unknown'
  const blockRange =
    coverage.from_block !== undefined && coverage.to_block !== undefined
      ? `${coverage.from_block}..${coverage.to_block}`
      : 'blocks unknown'
  const dateRange =
    coverage.from_timestamp && coverage.to_timestamp
      ? `${shortDate(coverage.from_timestamp)}..${shortDate(coverage.to_timestamp)}`
      : ''
  if (blockRange === 'blocks unknown' && dateRange === '') return 'unknown'
  if (blockRange === 'blocks unknown') return dateRange
  if (dateRange === '') return blockRange
  return `${blockRange} / ${dateRange}`
}

function displayName(network: NetworkCapability): string {
  return network.display_name || network.network
}

function statusLabel(network: NetworkCapability): string {
  return network.default ? `${network.status} (default)` : network.status
}

function formatTable(headers: string[], rows: string[][], minimumWidths: number[]): string {
  const widths = headers.map((header, index) =>
    Math.max(
      minimumWidths[index] ?? 0,
      header.length,
      ...rows.map((row) => row[index]?.length ?? 0)
    )
  )
  const row = (values: string[]) =>
    values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  return [row(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(row)].join(
    '\n'
  )
}

export function formatNetworkOverview(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const rows = document.networks.map((network) => [
    displayName(network),
    statusLabel(network),
    datasetLabel(network),
  ])
  return formatTable(['Network', 'Status', 'Dataset'], rows, [14, 10, 38])
}

export function formatNetworkCapabilities(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const networkRows = document.networks.flatMap((network) => {
    const toolLines = availableToolLines(network)
    return toolLines.map((toolLine, index) => [
      index === 0 ? displayName(network) : '',
      index === 0 ? datasetLabel(network) : '',
      toolLine,
    ])
  })
  return formatTable(['Network', 'Dataset', 'Chain Insights tools'], networkRows, [14, 38, 64])
}

export function findNetworkCapability(
  document: NetworkCapabilitiesDocument,
  name: string
): NetworkCapability | undefined {
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName) return undefined
  return document.networks.find((network) =>
    [network.network, network.display_name].some(
      (candidate) => candidate?.trim().toLowerCase() === normalizedName
    )
  )
}

/** The writer lanes a customer sees, in screen order, by their plain names. */
const KNOWN_LANES: readonly (readonly [string, string])[] = [
  ['core_transfers_source_head', 'receipts'],
  ['core_transfers_internal_follow', 'traces'],
  ['core_dex_follow', 'dex'],
  ['core_bridge_follow', 'bridge'],
  ['core_smart_account_follow', 'smart accounts'],
]

/** The evidence worker's lane. It has its own table and never joins Indexing. */
const EVIDENCE_LANE = 'evidence_sync'

/** The plain name a lane prints as. An unknown lane prints as sent. */
export function laneDisplayName(lane: string): string {
  if (lane === EVIDENCE_LANE) return 'evidence'
  return KNOWN_LANES.find(([name]) => name === lane)?.[1] ?? lane
}

/** A graph layer prints as sent: it is the link kind a query names. */
export function layerDisplayName(layer: string): string {
  return layer
}

/** 87642448 -> "87,642,448", the same on every machine (no locale). */
export function groupThousands(value: number): string {
  const sign = value < 0 ? '-' : ''
  const digits = String(Math.trunc(Math.abs(value)))
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** One row of a progress table. `behind` is absent with no head or no height. */
interface ProgressRow {
  label: string
  height: number | null
  /** Text printed in the height column instead of a number. */
  note?: string
  behind?: number
  slowest: boolean
}

const DETAIL_LABEL_WIDTH = 18
const TABLE_LABEL_WIDTH = 30
const HEIGHT_MIN_WIDTH = 10
const LAG_HEADER = 'behind head'
const SLOWEST_MARK = '◀ slowest'

function progressRows(
  entries: { label: string; height: number | null }[],
  head: number | undefined
): ProgressRow[] {
  const heights = entries
    .map((entry) => entry.height)
    .filter((height): height is number => height !== null)
  const lowest = heights.length > 0 ? Math.min(...heights) : undefined
  // A mark needs something faster beside it: one row, or rows all level, have no slowest.
  const marks = lowest !== undefined && heights.some((height) => height > lowest)
  return entries.map(({ label, height }) => ({
    label,
    height,
    ...(height === null ? { note: 'not started' } : {}),
    ...(height !== null && head !== undefined ? { behind: Math.max(0, head - height) } : {}),
    slowest: marks && height === lowest,
  }))
}

function notReportedRow(label: string): ProgressRow {
  return { label, height: null, note: 'not reported', slowest: false }
}

function formatProgressTables(
  tables: { title: string; rows: ProgressRow[] }[],
  withLag: boolean
): string[] {
  const allRows = tables.flatMap((table) => table.rows)
  const labelWidth = Math.max(
    TABLE_LABEL_WIDTH,
    ...allRows.map((row) => row.label.length + 4),
    ...tables.map((table) => table.title.length + 2)
  )
  const heightWidth = Math.max(
    HEIGHT_MIN_WIDTH,
    ...allRows.map((row) => (row.height === null ? 0 : groupThousands(row.height).length))
  )
  const lagWidth = Math.max(
    LAG_HEADER.length,
    ...allRows.map((row) => (row.behind === undefined ? 0 : groupThousands(row.behind).length))
  )
  const lines: string[] = []
  for (const table of tables) {
    if (lines.length > 0) lines.push('')
    const header = table.title.padEnd(labelWidth) + 'height'
    lines.push(withLag ? header.padEnd(labelWidth + heightWidth + 2) + LAG_HEADER : header)
    for (const row of table.rows) {
      let line = `  ${row.label}`.padEnd(labelWidth)
      if (row.height === null) {
        line += row.note ?? ''
      } else {
        line += groupThousands(row.height).padEnd(heightWidth)
        if (withLag && row.behind !== undefined) {
          line += '  ' + groupThousands(row.behind).padStart(lagWidth)
        }
        if (row.slowest) line += `  ${SLOWEST_MARK}`
      }
      lines.push(line.trimEnd())
    }
  }
  return lines
}

/**
 * `cia network <name>`: how far this network is indexed. The chain node's head
 * comes first; every row reads against it. Known lanes print by plain name,
 * unknown lanes as sent after them, graph layers as sent, and evidence in its
 * own table. `--json` never comes through here.
 */
export function formatNetworkCapability(network: NetworkCapability): string {
  const headBlock = network.freshness?.chain_head_block
  const head = typeof headBlock === 'number' ? headBlock : undefined
  const detail: [string, string][] = [
    ['Network', displayName(network)],
    ['Identifier', network.network],
    ['Status', statusLabel(network)],
  ]
  if (head !== undefined) {
    const age = network.freshness?.chain_head_age_seconds
    const ageText = typeof age === 'number' ? `  (${groupThousands(age)} s old)` : ''
    detail.push(['Blockchain head', `${groupThousands(head)}${ageText}`])
  }

  const lanes = network.lane_progress ?? []
  const known = KNOWN_LANES.flatMap(([name, label]) =>
    lanes.filter((lane) => lane.lane === name).map((lane) => ({ label, height: lane.height }))
  )
  const unknown = lanes
    .filter(
      (lane) => lane.lane !== EVIDENCE_LANE && !KNOWN_LANES.some(([name]) => name === lane.lane)
    )
    .map((lane) => ({ label: laneDisplayName(lane.lane), height: lane.height }))
  const indexing = [...known, ...unknown]
  const layers = (network.graph_progress?.layers ?? []).map((layer) => ({
    label: layerDisplayName(layer.layer),
    height: layer.position,
  }))
  const evidence = lanes
    .filter((lane) => lane.lane === EVIDENCE_LANE)
    .map((lane) => ({ label: laneDisplayName(lane.lane), height: lane.height }))

  const tables = [
    {
      title: 'Indexing',
      rows: indexing.length > 0 ? progressRows(indexing, head) : [notReportedRow('indexing')],
    },
    {
      title: 'Graph',
      rows: layers.length > 0 ? progressRows(layers, head) : [notReportedRow('graph')],
    },
    {
      title: 'Evidence',
      rows: evidence.length > 0 ? progressRows(evidence, head) : [notReportedRow('evidence')],
    },
  ]

  return [
    ...detail.map(([label, value]) => `${label.padEnd(DETAIL_LABEL_WIDTH)}${value}`),
    '',
    ...formatProgressTables(tables, head !== undefined),
  ].join('\n')
}
