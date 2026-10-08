/**
 * graph_expand, the one dedicated tool of the local proxy, called by the Chain
 * Insights view (ui://chain-insights/view) when the investigator clicks. Its
 * _meta says visibility ["app"], so a host keeps it away from the model: the
 * model writes its own graph_query, and the view draws the rows by their column
 * names.
 *
 * Two forms, told apart by the arguments:
 *
 * - node, {network, address, in_offset?, out_offset?}: one address with up to
 *   250 newest senders and 250 newest receivers, a text summary and
 *   chain-insights.flows.v1 in structuredContent. Composed from at most five
 *   anchored graph_query reads on the topology graph: the node, then its
 *   outgoing and its incoming FLOWS_TO, newest first, two reads a side because
 *   a reply holds at most 200 rows.
 * - link, {network, from, to, day}: the transfers between two known addresses
 *   on one UTC day, newest first, at most 50, a short text summary and
 *   chain-insights.transfers.v1 in structuredContent. One anchored USE facts
 *   graph_query read.
 *
 * Every read goes through the proxy's remote client, the same path and payment
 * wrapping a graph_query call takes, and is billed as a graph_query. Every
 * argument is checked before the first read, so a refused call reaches no graph
 * endpoint and costs nothing.
 */

export const FLOWS_SCHEMA = 'chain-insights.flows.v1'
export const GRAPH_EXPAND_TOOL = 'graph_expand'
export const FLOWS_NETWORK = 'robinhood'

/** How many senders and how many receivers one page shows, at most. */
export const FLOWS_PER_SIDE = 250
/** The view data of one answer: at most this many addresses, the centre included... */
export const FLOWS_MAX_NODES = 500
/**
 * ...and under this many characters of JSON. Hosts drop an app tool result
 * over about 150,000 characters.
 */
export const FLOWS_MAX_CHARS = 140_000
/**
 * The graph endpoint cuts a reply at 200 rows, whatever the LIMIT, so one side
 * of a page is read in reads of at most this many rows.
 */
export const FLOWS_READ_ROWS = 200
/** The text of a node answer holds at most this many lines. */
export const FLOWS_SUMMARY_MAX_LINES = 20
/** Where a graph_expand page may start on each side, at most. */
export const FLOWS_MAX_OFFSET = 10_000

export const TRANSFERS_SCHEMA = 'chain-insights.transfers.v1'
/** A link answer lists at most this many transfers... */
export const TRANSFERS_MAX = 50
/**
 * ...from the rows one read brings back. A facts read takes no ORDER BY and
 * the server cuts a reply at 200 rows, so the read asks for the whole cap and
 * the newest rows are picked here.
 */
export const TRANSFERS_READ_ROWS = 200
/** The text of a link answer names at most this many transfers. */
export const TRANSFERS_SUMMARY_ROWS = 5

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

/** The links of the centre not loaded yet, past the cursor, on each side. */
export type FlowRemaining = { senders: number; receivers: number }

export type FlowView = {
  schema: typeof FLOWS_SCHEMA
  network: string
  center: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  cursor: FlowCursor
  truncated: boolean
  /** Set on every node page. A view that does not know it ignores it. */
  remaining?: FlowRemaining
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

export const INVALID_DAY_TEXT =
  'invalid_day: day must be a calendar date written YYYY-MM-DD (UTC), for example 2026-07-10'
export const BOTH_FORMS_TEXT =
  'invalid_arguments: pass address (with in_offset and out_offset) to expand a node, or from, to and day to list the transfers of a link, not both'

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
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

/**
 * The day as YYYY-MM-DD when it is a real calendar date, or null. Only a day
 * that passes is ever written into a read.
 */
export function normalizeFlowsDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const day = raw.trim()
  if (!DAY_PATTERN.test(day)) return null
  const time = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) return null
  return day
}

/**
 * The one facts read of a link: the transfers from one address to another on
 * one day. A facts read names the pair with one day, takes no ORDER BY and
 * holds at most 200 rows, so the read asks for the whole cap and the order is
 * made in buildTransfersView. Both addresses and the day have passed their
 * checks, so they are written into the read as literals.
 */
export function transfersReadFor(from: string, to: string, day: string): string {
  return (
    `USE facts MATCH (a:Address {address: "${from}"})-[t:TRANSFER]->(b:Address {address: "${to}"}) ` +
    `WHERE t.block_date = "${day}" ` +
    'RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.amount AS amount, ' +
    `t.asset_symbol AS asset_symbol, t.amount_usd AS amount_usd LIMIT ${TRANSFERS_READ_ROWS}`
  )
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

/** One anchored read of a page, with the SKIP and LIMIT it carries. */
export type FlowsRead = { id: 'node' | 'out' | 'in'; query: string; skip: number; limit: number }

/**
 * The anchored reads of one page: the node, then the receivers, then the
 * senders. Each side asks for one row more than it shows: the extra row says
 * another page exists. A reply holds at most FLOWS_READ_ROWS rows, so a side
 * is read in chunks on the same order, each starting where the last one ends.
 */
export function flowsReadsFor(address: string, inOffset: number, outOffset: number): FlowsRead[] {
  const side = (id: 'out' | 'in', offset: number, match: string): FlowsRead[] => {
    const reads: FlowsRead[] = []
    for (let done = 0; done < FLOWS_PER_SIDE + 1; done += FLOWS_READ_ROWS) {
      const skip = offset + done
      const limit = Math.min(FLOWS_READ_ROWS, FLOWS_PER_SIDE + 1 - done)
      reads.push({
        id,
        query: `USE topology MATCH ${match} RETURN ${PARTY_FIELDS}${PAGE_ORDER}${skip > 0 ? ` SKIP ${skip}` : ''} LIMIT ${limit}`,
        skip,
        limit,
      })
    }
    return reads
  }
  return [
    {
      id: 'node',
      query: `USE topology MATCH (b:Address {address: '${address}'}) RETURN ${NODE_FIELDS} LIMIT 1`,
      skip: 0,
      limit: 1,
    },
    ...side('out', outOffset, `(a:Address {address: '${address}'})-[f:FLOWS_TO]->(b:Address)`),
    ...side('in', inOffset, `(b:Address)-[f:FLOWS_TO]->(a:Address {address: '${address}'})`),
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
  const cursor = {
    in_offset: page.inOffset + senders.length,
    out_offset: page.outOffset + receivers.length,
  }
  const view: FlowView = {
    schema: FLOWS_SCHEMA,
    network,
    center: center.address,
    nodes: [center],
    edges: [],
    cursor,
    truncated,
    remaining: {
      senders: Math.max(0, center.degree_in - cursor.in_offset),
      receivers: Math.max(0, center.degree_out - cursor.out_offset),
    },
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
 * How many senders and receivers stay after `drops` of the oldest links go,
 * one at a time from the longer side, the senders first on a tie.
 */
function keptAfterDrops(senders: number, receivers: number, drops: number): [number, number] {
  let s = senders
  let r = receivers
  for (let left = Math.min(drops, s + r); left > 0; left -= 1) {
    if (s >= r) s -= 1
    else r -= 1
  }
  return [s, r]
}

/**
 * flows.v1 from one page: the centre first, then the senders and the
 * receivers, each newest first, at most FLOWS_PER_SIDE a side. When the view
 * data would hold more than FLOWS_MAX_NODES addresses or reach FLOWS_MAX_CHARS
 * characters, the oldest links go first, the view is marked truncated, and the
 * cursor still says where the next page starts.
 *
 * Each dropped link only makes the view smaller, so the fewest drops that fit
 * are found by halving: about ten views are measured for a full page, not one
 * per dropped link.
 */
export function buildFlowView(network: string, page: FlowsPage): FlowView {
  const overflow = page.senders.length > FLOWS_PER_SIDE || page.receivers.length > FLOWS_PER_SIDE
  const senders = page.senders.slice(0, FLOWS_PER_SIDE)
  const receivers = page.receivers.slice(0, FLOWS_PER_SIDE)
  const viewAfter = (drops: number) => {
    const [s, r] = keptAfterDrops(senders.length, receivers.length, drops)
    return assembleFlowView(
      network,
      page,
      senders.slice(0, s),
      receivers.slice(0, r),
      overflow || drops > 0
    )
  }
  // Dropping every link is the floor: that view is answered even when it does
  // not fit.
  let low = 0
  let high = senders.length + receivers.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (fitsFlowBudget(viewAfter(mid))) high = mid
    else low = mid + 1
  }
  return viewAfter(low)
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
 * The text of a node answer: the centre, its role and lifetime totals, then
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

/** Where this page sits, and that the picture loads the rest when an address is clicked. */
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
    'More senders and receivers load when an address in the picture is double-clicked.',
  ]
}

export type TransferRow = {
  tx_id: string
  block_timestamp: number | null
  amount: number | string | null
  asset_symbol: string | null
  amount_usd: number | null
}

export type TransfersView = {
  schema: typeof TRANSFERS_SCHEMA
  network: string
  from: string
  to: string
  day: string
  transfers: TransferRow[]
  truncated: boolean
}

/** A finite number, or a decimal string read as one, or null. */
function flowsNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function transferOf(row: Row): TransferRow {
  const amount =
    typeof row.amount === 'number' && Number.isFinite(row.amount)
      ? row.amount
      : typeof row.amount === 'string' && row.amount.trim() !== ''
        ? row.amount
        : null
  return {
    tx_id: typeof row.tx_id === 'string' ? row.tx_id : '',
    block_timestamp: flowsNumberOrNull(row.block_timestamp),
    amount,
    asset_symbol:
      typeof row.asset_symbol === 'string' && row.asset_symbol !== '' ? row.asset_symbol : null,
    amount_usd: flowsNumberOrNull(row.amount_usd),
  }
}

/**
 * chain-insights.transfers.v1 from the rows of one facts read: newest first,
 * at most TRANSFERS_MAX, truncated when more rows than that came back. The
 * facts layer takes no ORDER BY, so the order is made here.
 */
export function buildTransfersView(
  network: string,
  from: string,
  to: string,
  day: string,
  rows: Row[]
): TransfersView {
  const newestFirst = rows
    .map(transferOf)
    .sort((a, b) => (b.block_timestamp ?? -Infinity) - (a.block_timestamp ?? -Infinity))
  return {
    schema: TRANSFERS_SCHEMA,
    network,
    from,
    to,
    day,
    transfers: newestFirst.slice(0, TRANSFERS_MAX),
    truncated: newestFirst.length > TRANSFERS_MAX,
  }
}

function transferLine(transfer: TransferRow): string {
  const time =
    transfer.block_timestamp === null
      ? 'at an unknown time'
      : `${new Date(transfer.block_timestamp).toISOString().slice(0, 19).replace('T', ' ')} UTC`
  const amount = transfer.amount === null ? 'an unknown amount' : String(transfer.amount)
  const asset = transfer.asset_symbol ? ` ${transfer.asset_symbol}` : ''
  const usd = transfer.amount_usd === null ? 'no USD price' : formatFlowsUsd(transfer.amount_usd)
  return `- ${time}, ${amount}${asset}, ${usd}, tx ${transfer.tx_id}`
}

/** The short text of a link answer: the pair, the day, the count and the newest few transfers. */
export function transfersSummary(view: TransfersView): string {
  const head = `Transfers from ${view.from} to ${view.to} on ${view.day} (UTC) on ${view.network}`
  if (view.transfers.length === 0) return `${head}: none.`
  const count = view.truncated
    ? `the newest ${view.transfers.length}, and the day holds more`
    : `${view.transfers.length}`
  const lines = [
    `${head}: ${count}, newest first.`,
    ...view.transfers.slice(0, TRANSFERS_SUMMARY_ROWS).map(transferLine),
  ]
  const rest = view.transfers.length - TRANSFERS_SUMMARY_ROWS
  if (rest > 0) lines.push(`- and ${rest} more in the picture.`)
  return lines.join('\n')
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

/** The endpoint says it cut the reply short (facts.query.truncated). */
function cutByEndpoint(answer: GraphQueryAnswer): boolean {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const query = isRecord(facts) ? facts.query : undefined
  return isRecord(query) && query.truncated === true
}

function rowsOf(answer: GraphQueryAnswer): Row[] | null {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const query = isRecord(facts) ? facts.query : undefined
  const results = isRecord(query) ? query.results : undefined
  return Array.isArray(results) ? results.filter(isRecord) : null
}

type Checked<T> = T | { error: string }

function checkNetwork(args: Record<string, unknown>): Checked<string> {
  const rawNetwork = typeof args.network === 'string' ? args.network.trim().toLowerCase() : ''
  if (!rawNetwork) return { error: 'invalid_network: network is required; pass robinhood' }
  if (rawNetwork !== FLOWS_NETWORK) {
    return {
      error: `invalid_network: graph_expand reads the robinhood graph only; got "${String(args.network).trim()}"`,
    }
  }
  return FLOWS_NETWORK
}

/** The address of a node or of one end of a link; `name` says which end in a link refusal. */
function checkAddress(raw: unknown, name?: string): Checked<string> {
  const address = normalizeFlowsAddress(raw)
  if (address) return address
  return {
    error: name
      ? INVALID_ADDRESS_TEXT.replace('invalid_address:', `invalid_address (${name}):`)
      : INVALID_ADDRESS_TEXT,
  }
}

function checkDay(raw: unknown): Checked<string> {
  const day = normalizeFlowsDay(raw)
  return day ?? { error: INVALID_DAY_TEXT }
}

function checkOffset(value: unknown): Checked<number> {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { error: OFFSET_NEGATIVE_TEXT }
  }
  if (value > FLOWS_MAX_OFFSET) return { error: OFFSET_TOO_LARGE_TEXT }
  return value
}

/**
 * Read and answer one node page. The reads run one after another: the node
 * first, so an address the graph does not hold costs one read; then the
 * receivers and the senders, the chunks of a side joined in order. A chunk that
 * comes back short, and not cut by the endpoint, ends its side, so the next
 * chunk of that side is not read or billed. The first read that does not
 * answer ends the call.
 */
async function runNode(
  deps: FlowsDependencies,
  network: string,
  address: string,
  inOffset: number,
  outOffset: number
): Promise<FlowsToolResult> {
  const unavailable = deps.unavailable?.()
  if (unavailable) return errorResult(unavailable)
  const rows: Record<FlowsRead['id'], Row[]> = { node: [], out: [], in: [] }
  const ended = new Set<FlowsRead['id']>()
  for (const read of flowsReadsFor(address, inOffset, outOffset)) {
    if (ended.has(read.id)) continue
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
    rows[read.id].push(...found)
    if (read.id === 'node' && found.length === 0) {
      return errorResult(`${address} is not in the ${network} topology graph`)
    }
    if (found.length < read.limit && !cutByEndpoint(answer)) ended.add(read.id)
  }
  const view = buildFlowView(network, {
    center: rows.node[0] ?? {},
    senders: rows.in,
    receivers: rows.out,
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

/** Read and answer the transfers of one link on one day: a single facts read. */
async function runLink(
  deps: FlowsDependencies,
  network: string,
  from: string,
  to: string,
  day: string
): Promise<FlowsToolResult> {
  const unavailable = deps.unavailable?.()
  if (unavailable) return errorResult(unavailable)
  let answer: GraphQueryAnswer
  try {
    answer = await deps.graphQuery({ network, query: transfersReadFor(from, to, day) })
  } catch (err) {
    return errorResult(deps.describeFailure(err))
  }
  if (answer.isError === true) return errorResult(refusalText(answer))
  const rows = rowsOf(answer)
  if (!rows) {
    return errorResult(
      'graph_query_failed: the graph endpoint answered without chain-insights.result.v1 rows'
    )
  }
  const view = buildTransfersView(network, from, to, day, rows)
  return {
    content: [{ type: 'text', text: transfersSummary(view) }],
    structuredContent: view as unknown as Record<string, unknown>,
    isError: false,
  }
}

function given(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined && record[key] !== null)
}

/**
 * graph_expand, the node form {network, address, in_offset?, out_offset?} or the
 * link form {network, from, to, day}. Every argument is checked before the
 * first read.
 */
export async function handleGraphExpand(
  args: unknown,
  deps: FlowsDependencies
): Promise<FlowsToolResult> {
  const record = isRecord(args) ? args : {}
  const network = checkNetwork(record)
  if (typeof network !== 'string') return errorResult(network.error)

  const isLink = given(record, ['from', 'to', 'day'])
  if (isLink && given(record, ['address', 'in_offset', 'out_offset']))
    return errorResult(BOTH_FORMS_TEXT)

  if (isLink) {
    const from = checkAddress(record.from, 'from')
    if (typeof from !== 'string') return errorResult(from.error)
    const to = checkAddress(record.to, 'to')
    if (typeof to !== 'string') return errorResult(to.error)
    const day = checkDay(record.day)
    if (typeof day !== 'string') return errorResult(day.error)
    return runLink(deps, network, from, to, day)
  }

  const address = checkAddress(record.address)
  if (typeof address !== 'string') return errorResult(address.error)
  const inOffset = checkOffset(record.in_offset)
  if (typeof inOffset !== 'number') return errorResult(inOffset.error)
  const outOffset = checkOffset(record.out_offset)
  if (typeof outOffset !== 'number') return errorResult(outOffset.error)
  return runNode(deps, network, address, inOffset, outOffset)
}

export const GRAPH_EXPAND_TITLE = 'Expand a node or a link in the picture'

export const GRAPH_EXPAND_DESCRIPTION =
  'Expand an open Chain Insights picture. Called by the view when the investigator clicks, never by the model. ' +
  'A node, {network, address, in_offset?, out_offset?}, loads the newest senders and receivers of one address ' +
  '(up to 250 a side, from the offsets); billed as at most five graph_query topology reads. A link, {network, from, to, day}, ' +
  'lists the transfers between two addresses on one UTC day (YYYY-MM-DD), newest first, at most 50; billed as ' +
  'one graph_query facts read. Read-only; an argument refused before a read costs nothing.'
