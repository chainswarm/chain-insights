/**
 * The money-flow view tools of the local proxy: money_flows and graph_expand.
 *
 * money_flows answers one robinhood address with its most recent senders and
 * receivers: a short text the model reads, and chain-insights.flows.v1 in
 * structuredContent, which the Chain Insights view (ui://chain-insights/view)
 * draws. graph_expand is the same answer for the next page of one address. The
 * view calls it when the investigator clicks an address; its _meta says
 * visibility ["app"], so a host keeps it away from the model.
 *
 * Both tools are composed on the client PC from three anchored graph_query
 * reads (the node, its outgoing FLOWS_TO and its incoming FLOWS_TO, newest
 * first), sent through the proxy's remote client, the same path and payment
 * wrapping a graph_query call takes. Each read is billed as a graph_query.
 * Every argument is checked before the first read, so a refused call reaches
 * no graph endpoint and costs nothing.
 */

export const FLOWS_SCHEMA = 'chain-insights.flows.v1'
export const MONEY_FLOWS_TOOL = 'money_flows'
export const GRAPH_EXPAND_TOOL = 'graph_expand'
export const FLOWS_NETWORK = 'robinhood'

/** How many senders and how many receivers one page shows. */
export const FLOWS_PER_SIDE = 12
/** The view data of one answer: at most this many addresses... */
export const FLOWS_MAX_NODES = 60
/** ...and under this many characters of JSON. */
export const FLOWS_MAX_CHARS = 40_000
/** The text the model reads holds at most this many lines. */
export const FLOWS_SUMMARY_MAX_LINES = 20
/** Where a graph_expand page may start on each side, at most. */
export const FLOWS_MAX_OFFSET = 10_000

export type FlowNode = {
  address: string
  role: string
  labels: string[]
  total_in_usd: number
  total_out_usd: number
  degree_in: number
  degree_out: number
}

export type FlowEdge = {
  from: string
  to: string
  usd: number
  tx_count: number
  first_seen_ms: number
  last_seen_ms: number
}

export type FlowCursor = { in_offset: number; out_offset: number }

export type FlowView = {
  schema: typeof FLOWS_SCHEMA
  network: string
  center: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  cursor: FlowCursor
  truncated: boolean
}

type Row = Record<string, unknown>

export type FlowsPage = {
  center: Row
  senders: Row[]
  receivers: Row[]
  inOffset: number
  outOffset: number
}

/** One graph_query answer as the remote client returns it. */
export type GraphQueryAnswer = {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type FlowsToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

export type FlowsDependencies = {
  /** One graph_query call through the proxy's remote client. */
  graphQuery: (args: { network: string; query: string }) => Promise<GraphQueryAnswer>
  /** The text of a call that threw (payment required, transport failure). */
  describeFailure: (err: unknown) => string
  /** Why no read can run (the graph endpoint is not connected), checked after the arguments. */
  unavailable?: () => string | undefined
  now?: () => Date
}

export const INVALID_ADDRESS_TEXT =
  'invalid_address: a full 0x address of 40 hexadecimal characters is needed, for example 0x04911a118f11c75667e4d0dfb8e640af5a353550'
export const OFFSET_TOO_LARGE_TEXT = `invalid_offset: in_offset and out_offset must each be at most ${FLOWS_MAX_OFFSET}`
export const OFFSET_NEGATIVE_TEXT =
  'invalid_offset: in_offset and out_offset must each be a whole number, 0 or more'

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/
const CODE_PREFIX = /^([a-z][a-z0-9_]*):\s*/

/**
 * The address lower-cased, or null when it is not 0x and 40 hexadecimal
 * characters. Only an address that passes is ever written into a read, so the
 * reads can carry it as a literal.
 */
export function normalizeFlowsAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const address = raw.trim().toLowerCase()
  return ADDRESS_PATTERN.test(address) ? address : null
}

const NODE_FIELDS =
  'b.address AS address, b.labels AS labels, b.is_exchange AS is_exchange, ' +
  'b.is_sanctioned AS is_sanctioned, b.is_scam AS is_scam, b.is_victim AS is_victim, b:Pool AS pool, ' +
  'b.total_in_usd AS total_in_usd, b.total_out_usd AS total_out_usd, b.degree_in AS degree_in, b.degree_out AS degree_out'
const PARTY_FIELDS =
  NODE_FIELDS +
  ', f.amount_usd_sum AS usd, f.tx_count AS tx_count, ' +
  'f.first_seen_timestamp AS first_seen, f.last_seen_timestamp AS last_seen'
// Newest link first, the address breaking a tie, so a page and the next one
// never share or skip a link.
const PAGE_ORDER = ' ORDER BY f.last_seen_timestamp DESC, b.address'

export type FlowsRead = { id: 'node' | 'out' | 'in'; query: string }

/**
 * The three anchored reads of one page. Each side asks for one row more than
 * it shows: the extra row says another page exists.
 */
export function flowsReadsFor(address: string, inOffset: number, outOffset: number): FlowsRead[] {
  const page = (offset: number) =>
    `${PAGE_ORDER}${offset > 0 ? ` SKIP ${offset}` : ''} LIMIT ${FLOWS_PER_SIDE + 1}`
  return [
    {
      id: 'node',
      query: `USE topology MATCH (b:Address {address: '${address}'}) RETURN ${NODE_FIELDS} LIMIT 1`,
    },
    {
      id: 'out',
      query: `USE topology MATCH (a:Address {address: '${address}'})-[f:FLOWS_TO]->(b:Address) RETURN ${PARTY_FIELDS}${page(outOffset)}`,
    },
    {
      id: 'in',
      query: `USE topology MATCH (b:Address)-[f:FLOWS_TO]->(a:Address {address: '${address}'}) RETURN ${PARTY_FIELDS}${page(inOffset)}`,
    },
  ]
}

/** The role word of an address, first match wins. */
export function flowsRole(row: Row): string {
  if (row.is_exchange === true) return 'exchange'
  if (row.is_sanctioned === true) return 'sanctioned'
  if (row.is_scam === true) return 'scam'
  if (row.is_victim === true) return 'victim'
  if (row.pool === true) return 'pool'
  return 'other'
}

function flowsFloat(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function flowsInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
}

function flowsNodeOf(row: Row): FlowNode {
  const labels = Array.isArray(row.labels)
    ? row.labels.filter((label): label is string => typeof label === 'string')
    : []
  return {
    address: typeof row.address === 'string' ? row.address : '',
    role: flowsRole(row),
    labels,
    total_in_usd: flowsFloat(row.total_in_usd),
    total_out_usd: flowsFloat(row.total_out_usd),
    degree_in: flowsInt(row.degree_in),
    degree_out: flowsInt(row.degree_out),
  }
}

function assembleFlowView(
  network: string,
  page: FlowsPage,
  senders: Row[],
  receivers: Row[],
  truncated: boolean
): FlowView {
  const center = flowsNodeOf(page.center)
  const view: FlowView = {
    schema: FLOWS_SCHEMA,
    network,
    center: center.address,
    nodes: [center],
    edges: [],
    cursor: {
      in_offset: page.inOffset + senders.length,
      out_offset: page.outOffset + receivers.length,
    },
    truncated,
  }
  const seen = new Set([center.address])
  const add = (row: Row, incoming: boolean) => {
    const node = flowsNodeOf(row)
    if (!seen.has(node.address)) {
      seen.add(node.address)
      view.nodes.push(node)
    }
    view.edges.push({
      from: incoming ? node.address : center.address,
      to: incoming ? center.address : node.address,
      usd: flowsFloat(row.usd),
      tx_count: flowsInt(row.tx_count),
      first_seen_ms: flowsInt(row.first_seen),
      last_seen_ms: flowsInt(row.last_seen),
    })
  }
  for (const row of senders) add(row, true)
  for (const row of receivers) add(row, false)
  return view
}

function fitsFlowBudget(view: FlowView): boolean {
  return view.nodes.length <= FLOWS_MAX_NODES && JSON.stringify(view).length < FLOWS_MAX_CHARS
}

/**
 * flows.v1 from one page: the centre first, then the senders and the
 * receivers, each newest first, at most FLOWS_PER_SIDE a side. When the view
 * data would hold more than FLOWS_MAX_NODES addresses or reach FLOWS_MAX_CHARS
 * characters, the oldest links go first, the view is marked truncated, and the
 * cursor still says where the next page starts.
 */
export function buildFlowView(network: string, page: FlowsPage): FlowView {
  let truncated = page.senders.length > FLOWS_PER_SIDE || page.receivers.length > FLOWS_PER_SIDE
  let senders = page.senders.slice(0, FLOWS_PER_SIDE)
  let receivers = page.receivers.slice(0, FLOWS_PER_SIDE)
  for (;;) {
    const view = assembleFlowView(network, page, senders, receivers, truncated)
    if (fitsFlowBudget(view) || senders.length + receivers.length === 0) return view
    truncated = true
    if (senders.length >= receivers.length) senders = senders.slice(0, -1)
    else receivers = receivers.slice(0, -1)
  }
}

export function formatFlowsUsd(value: number): string {
  if (!(value > 0)) return '$0'
  if (value < 0.01) return 'under $0.01'
  const whole = Math.floor(value)
  const cents = Math.round((value - whole) * 100)
  if (cents === 100) return formatFlowsUsd(whole + 1)
  const grouped = whole.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${grouped}.${String(cents).padStart(2, '0')}`
}

function formatFlowsAge(lastSeenMs: number, now: Date): string {
  if (lastSeenMs <= 0) return 'at an unknown time'
  const date = new Date(lastSeenMs).toISOString().slice(0, 10)
  const days = Math.trunc((now.getTime() - lastSeenMs) / 86_400_000)
  if (days < 1) return `${date} (less than a day ago)`
  if (days === 1) return `${date} (1 day ago)`
  return `${date} (${days} days ago)`
}

/** The role word, with up to three address labels beside it. */
function roleText(node: FlowNode | undefined): string {
  if (!node) return 'other'
  if (node.labels.length === 0) return node.role
  return `${node.role} (${node.labels.slice(0, 3).join(', ')})`
}

function sideLines(title: string, parties: string[]): string[] {
  if (parties.length === 0) return [`${title}, newest first: none.`]
  const lines = [`${title}, newest first (${parties.length}):`]
  // A side with more than six counterparties lists two on a line, so a full
  // page stays within the line budget.
  const perLine = parties.length > 6 ? 2 : 1
  for (let start = 0; start < parties.length; start += perLine) {
    lines.push(`- ${parties.slice(start, start + perLine).join('; ')}`)
  }
  return lines
}

/**
 * The text the model reads: the centre, its role and lifetime totals, then
 * every counterparty of the view with its USD, transaction count and last-seen
 * date and age. At most FLOWS_SUMMARY_MAX_LINES lines.
 */
export function flowsSummary(view: FlowView, now: Date): string {
  const nodes = new Map(view.nodes.map((node) => [node.address, node]))
  const center = nodes.get(view.center)
  const party = (address: string, edge: FlowEdge) =>
    `${address} ${roleText(nodes.get(address))}, ${formatFlowsUsd(edge.usd)} in ${edge.tx_count} tx, last seen ${formatFlowsAge(edge.last_seen_ms, now)}`
  const senders: string[] = []
  const receivers: string[] = []
  for (const edge of view.edges) {
    if (edge.to === view.center) senders.push(party(edge.from, edge))
    else receivers.push(party(edge.to, edge))
  }
  const lines = [
    `Money flows of ${view.center} on ${view.network}: ${roleText(center)}; lifetime ${formatFlowsUsd(center?.total_in_usd ?? 0)} in, ${formatFlowsUsd(center?.total_out_usd ?? 0)} out; ${center?.degree_in ?? 0} senders and ${center?.degree_out ?? 0} receivers in the topology graph.`,
    ...sideLines('Recent senders', senders),
    ...sideLines('Recent receivers', receivers),
  ]
  const body = lines.slice(0, FLOWS_SUMMARY_MAX_LINES - 2)
  const footer = pagingLines(view, senders.length, receivers.length, center)
  return [...body, ...footer].join('\n')
}

/**
 * Where this page sits and how to read the next one. Written for every reader:
 * the model, a terminal (cia mcp call), and a person looking at the picture in
 * Claude Desktop, who clicks an address instead.
 */
function pagingLines(
  view: FlowView,
  shownSenders: number,
  shownReceivers: number,
  center: FlowNode | undefined
): string[] {
  const totalIn = center?.degree_in ?? 0
  const totalOut = center?.degree_out ?? 0
  const { in_offset: nextIn, out_offset: nextOut } = view.cursor
  const range = (shown: number, next: number, total: number) =>
    shown === 0 ? `none of ${total}` : `${next - shown + 1} to ${next} of ${total}`
  const where = `Showing senders ${range(shownSenders, nextIn, totalIn)} and receivers ${range(shownReceivers, nextOut, totalOut)}, newest first.`
  if (!view.truncated && nextIn >= totalIn && nextOut >= totalOut) return [where]
  return [
    where,
    `Next page: money_flows with in_offset=${nextIn} out_offset=${nextOut} (terminal: cia mcp call money_flows network=${view.network} address=${view.center} in_offset=${nextIn} out_offset=${nextOut}); in Claude Desktop, click an address in the picture instead.`,
  ]
}

function errorResult(text: string): FlowsToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function answerText(answer: GraphQueryAnswer): string {
  return (answer.content ?? [])
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * The refusal of a read that did not answer, naming its code first:
 * error_detail.code when the graph endpoint sent its typed refusal, the code
 * its text starts with otherwise, and graph_query_failed when it names none.
 * The view marks the address it was expanding.
 */
export function refusalText(answer: GraphQueryAnswer): string {
  const text = answerText(answer)
  const detail = isRecord(answer.structuredContent)
    ? answer.structuredContent.error_detail
    : undefined
  const detailCode = isRecord(detail) && typeof detail.code === 'string' ? detail.code : ''
  const textCode = CODE_PREFIX.exec(text)?.[1] ?? ''
  const code = detailCode || textCode || 'graph_query_failed'
  const rest = textCode === code ? text.replace(CODE_PREFIX, '') : text
  return rest ? `${code}: ${rest}` : `${code}: the graph endpoint refused the read`
}

function rowsOf(answer: GraphQueryAnswer): Row[] | null {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const query = isRecord(facts) ? facts.query : undefined
  const results = isRecord(query) ? query.results : undefined
  return Array.isArray(results) ? results.filter(isRecord) : null
}

type Checked = { network: string; address: string } | { error: string }

function checkNetworkAndAddress(args: Record<string, unknown>): Checked {
  const rawNetwork = typeof args.network === 'string' ? args.network.trim().toLowerCase() : ''
  if (!rawNetwork) return { error: 'invalid_network: network is required; pass robinhood' }
  if (rawNetwork !== FLOWS_NETWORK) {
    return {
      error: `invalid_network: money flows read the robinhood topology graph only; got "${String(args.network).trim()}"`,
    }
  }
  const address = normalizeFlowsAddress(args.address)
  if (!address) return { error: INVALID_ADDRESS_TEXT }
  return { network: FLOWS_NETWORK, address }
}

function checkOffset(value: unknown): number | { error: string } {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { error: OFFSET_NEGATIVE_TEXT }
  }
  if (value > FLOWS_MAX_OFFSET) return { error: OFFSET_TOO_LARGE_TEXT }
  return value
}

/**
 * Read and answer one page. The reads run one after another: the node first,
 * so an address the graph does not hold costs one read, not three; then the
 * receivers and the senders. The first read that does not answer ends the call.
 */
async function runFlows(
  deps: FlowsDependencies,
  network: string,
  address: string,
  inOffset: number,
  outOffset: number
): Promise<FlowsToolResult> {
  const unavailable = deps.unavailable?.()
  if (unavailable) return errorResult(unavailable)
  const rows: Partial<Record<FlowsRead['id'], Row[]>> = {}
  for (const read of flowsReadsFor(address, inOffset, outOffset)) {
    let answer: GraphQueryAnswer
    try {
      answer = await deps.graphQuery({ network, query: read.query })
    } catch (err) {
      return errorResult(deps.describeFailure(err))
    }
    if (answer.isError === true) return errorResult(refusalText(answer))
    const found = rowsOf(answer)
    if (!found) {
      return errorResult(
        'graph_query_failed: the graph endpoint answered without chain-insights.result.v1 rows'
      )
    }
    rows[read.id] = found
    if (read.id === 'node' && found.length === 0) {
      return errorResult(`${address} is not in the ${network} topology graph`)
    }
  }
  const view = buildFlowView(network, {
    center: rows.node?.[0] ?? {},
    senders: rows.in ?? [],
    receivers: rows.out ?? [],
    inOffset,
    outOffset,
  })
  const now = deps.now ? deps.now() : new Date()
  return {
    content: [{ type: 'text', text: flowsSummary(view, now) }],
    structuredContent: view as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** money_flows {address, network, in_offset?, out_offset?}: one page of one address, the first by default. */
export async function handleMoneyFlows(
  args: unknown,
  deps: FlowsDependencies
): Promise<FlowsToolResult> {
  const record = isRecord(args) ? args : {}
  const checked = checkNetworkAndAddress(record)
  if ('error' in checked) return errorResult(checked.error)
  const inOffset = checkOffset(record.in_offset)
  if (typeof inOffset !== 'number') return errorResult(inOffset.error)
  const outOffset = checkOffset(record.out_offset)
  if (typeof outOffset !== 'number') return errorResult(outOffset.error)
  return runFlows(deps, checked.network, checked.address, inOffset, outOffset)
}

/** graph_expand {network, address, in_offset, out_offset}: the next page of one address. */
export async function handleGraphExpand(
  args: unknown,
  deps: FlowsDependencies
): Promise<FlowsToolResult> {
  const record = isRecord(args) ? args : {}
  const checked = checkNetworkAndAddress(record)
  if ('error' in checked) return errorResult(checked.error)
  const inOffset = checkOffset(record.in_offset)
  if (typeof inOffset !== 'number') return errorResult(inOffset.error)
  const outOffset = checkOffset(record.out_offset)
  if (typeof outOffset !== 'number') return errorResult(outOffset.error)
  return runFlows(deps, checked.network, checked.address, inOffset, outOffset)
}

export const MONEY_FLOWS_DESCRIPTION =
  'Show the most recent money flows around one robinhood address, read from the Chain Insights topology graph: ' +
  'the address with its role and lifetime USD totals, its 12 most recent senders and its 12 most recent receivers, ' +
  'each link with its lifetime USD, transaction count and last-seen time. The answer is a text summary, and an ' +
  'interactive graph in hosts that draw MCP apps. An address not in the graph is an error. Read-only; billed as ' +
  'three graph_query topology reads, or one when the address is not in the graph.'

export const GRAPH_EXPAND_DESCRIPTION =
  'Load the next page of senders and receivers of one address into an open money-flow view. ' +
  'Called by the view when the investigator clicks an address. Read-only; billed as three graph_query ' +
  'topology reads, nothing when it is refused before a read.'

/** The line of the server instructions that tells a model what money_flows answers. */
export const MONEY_FLOWS_INSTRUCTION =
  'Use money_flows to see who sent money to one robinhood address and where it went: its 12 most recent senders and receivers, each with lifetime USD, transaction count and last-seen time.'
