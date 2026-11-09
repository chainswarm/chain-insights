/**
 * aml_exchange_deposit_check: is this address an exchange deposit, of which
 * exchange, and into which hot wallet was it swept?
 *
 * A local tool of the proxy. It sends one graph_query_batch with two reads on
 * USE topology, both anchored on the address:
 *
 *   node    the address: its node labels, its label words and `cex_role`;
 *   swept   its `SWEPT` links: each hot wallet it swept into, with the sweep
 *           count, the USD sum, the paths and the first and last sweep.
 *
 * `SWEPT` (layer `cex_sweeps`) is drawn only from an address the deposit rule
 * judged a deposit, and `cex_role` comes from the exchange label's subtype. The
 * graph judges, this tool only reads. The exchange is named from the lookup
 * file (src/mcp/exchange-registry.ts): the hot wallet it swept into, else a
 * label word.
 */

import { ANSWER_HINT } from './answer-hint.js'
import { DexRegistryError, normalizeDexNetwork } from './dex-registry.js'
import {
  exchangeOfLabels,
  exchangeOfWallet,
  type ExchangeEntry,
  type LoadedExchangeRegistry,
} from './exchange-registry.js'
import { EXCHANGE_OPENING_RULE } from './exchange-tool.js'
import { CEX_ROLES } from './graph-schema.js'
import { isEpochMs, utcText } from './timestamp-text.js'
import { membersOf, refusalOf, type GraphAnswer, type Member } from './token-lookup.js'

export const AML_EXCHANGE_DEPOSIT_CHECK_TOOL = 'aml_exchange_deposit_check' as const
export const AML_EXCHANGE_DEPOSIT_CHECK_SCHEMA =
  'chain-insights.aml-exchange-deposit-check.v1' as const
export const AML_EXCHANGE_DEPOSIT_CHECK_TITLE = 'Exchange deposit check'
export const AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION =
  'Checks one address: is it a deposit address of a centralized exchange (Binance, Bitget, Bybit, Coinbase, Gate, KuCoin, MEXC, OKX, ...), ' +
  'of which exchange, and into which hot wallet was it swept, how many times, by which path and when. ' +
  'It reads the SWEPT links of the address and its cex_role (deposit, hot_wallet, cold_wallet or withdrawal) on the graph, anchored on the address: ' +
  'two reads in one batch, billed as any read. Use it when a trail reaches an address that may be an exchange wallet, or when the user asks where money entered an exchange. ' +
  `${EXCHANGE_OPENING_RULE}`
export const AML_EXCHANGE_DEPOSIT_CHECK_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const AML_EXCHANGE_DEPOSIT_CHECK_ARGS = ['network', 'address'] as const

/** The most hot wallets one deposit's read returns. */
export const SWEPT_LIMIT = 20

export type CexRole = (typeof CEX_ROLES)[number]

export interface Sweep {
  hot_wallet: string
  /** The exchange the hot wallet is listed for, or null when the lookup lists it for none. */
  hot_wallet_exchange: string | null
  hot_wallet_role: string | null
  sweep_count: number | null
  amount_usd_sum: number | null
  paths: string[]
  first_seen: number | null
  first_seen_utc: string | null
  last_seen: number | null
  last_seen_utc: string | null
}

export interface AmlExchangeDepositCheckResult {
  schema: typeof AML_EXCHANGE_DEPOSIT_CHECK_SCHEMA
  tool: typeof AML_EXCHANGE_DEPOSIT_CHECK_TOOL
  network: string
  address: string
  /** false when the graph holds no node for the address. */
  found: boolean
  /** true when the address carries cex_role deposit or has a SWEPT link. */
  is_deposit: boolean
  cex_role: CexRole | null
  /** The exchange id, from the hot wallet it swept into, else from its label words. */
  exchange: string | null
  exchange_display: string | null
  labels: string[]
  swept: Sweep[]
  hint: string
}

export interface ExchangeDepositCheckDependencies {
  loadExchangeRegistry: (network: string) => Promise<LoadedExchangeRegistry>
  graphQueryBatch: (args: {
    network: string
    queries: Array<{ id: string; query: string }>
  }) => Promise<GraphAnswer>
  unavailable?: () => Promise<string | undefined> | string | undefined
  describeFailure: (err: unknown) => string
}

export type AmlExchangeDepositCheckToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

const ADDRESS_INPUT = /^0x[0-9a-fA-F]{40}$/
const ADDRESS_READ = /^0x[0-9a-f]{40}$/

function assertReadAddress(address: string): void {
  if (!ADDRESS_READ.test(address)) {
    throw new Error(
      `exchange deposit check: ${JSON.stringify(address)} is not a lowercase 0x address`
    )
  }
}

/** The node read: the address, its marks and its cex_role. */
export function depositNodeQuery(address: string): string {
  assertReadAddress(address)
  return (
    `USE topology MATCH (a:Address {address: "${address}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.labels AS labels, a.cex_role AS cex_role LIMIT 1'
  )
}

/** The swept read: each hot wallet the address swept into. */
export function depositSweptQuery(address: string): string {
  assertReadAddress(address)
  return (
    `USE topology MATCH (a:Address {address: "${address}"})-[s:SWEPT]->(h:Address) ` +
    'RETURN h.address AS hot_wallet, h.labels AS hot_wallet_labels, h.cex_role AS hot_wallet_role, ' +
    's.sweep_count AS sweep_count, s.amount_usd_sum AS amount_usd_sum, s.paths AS paths, ' +
    `s.first_seen_timestamp AS first_seen_timestamp, s.last_seen_timestamp AS last_seen_timestamp LIMIT ${SWEPT_LIMIT}`
  )
}

/** The one batch the tool sends: members `node` and `swept`. */
export function depositCheckQueries(
  address: string
): Array<{ id: 'node' | 'swept'; query: string }> {
  return [
    { id: 'node', query: depositNodeQuery(address) },
    { id: 'swept', query: depositSweptQuery(address) },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const addressOrNull = (value: unknown): string | null =>
  typeof value === 'string' && ADDRESS_INPUT.test(value.trim()) ? value.trim().toLowerCase() : null

const utcOrNull = (ms: number | null): string | null => (isEpochMs(ms) ? utcText(ms) : null)

function cexRoleOf(value: unknown): CexRole | null {
  const role = textOrNull(value)?.toLowerCase()
  return (CEX_ROLES as readonly string[]).includes(role ?? '') ? (role as CexRole) : null
}

const answered = (member: Member | undefined): boolean =>
  member?.ok === true && Array.isArray(member.results)

const rowsOf = (member: Member | undefined): Array<Record<string, unknown>> =>
  answered(member) ? (member!.results as unknown[]).filter(isRecord) : []

function memberFailure(id: string, member: Member | undefined): string {
  if (!member) return `the ${id} read is missing from the batch answer`
  return typeof member.error === 'string' && member.error.trim() !== ''
    ? member.error
    : `the ${id} read did not answer`
}

/** The check built from the two batch members and the lookup rows, or why it cannot be. */
export function depositCheckFromMembers(
  network: string,
  address: string,
  members: Map<string, Member>,
  rows: ExchangeEntry[]
): { result: AmlExchangeDepositCheckResult } | { failure: string } {
  const node = members.get('node')
  const swept = members.get('swept')
  if (!answered(node)) return { failure: memberFailure('node', node) }
  if (!answered(swept)) return { failure: memberFailure('swept', swept) }

  const nodeRow = rowsOf(node)[0]
  const labels = strings(nodeRow?.labels)
  const sweeps: Sweep[] = []
  let exchange: ExchangeEntry | null = null
  for (const row of rowsOf(swept)) {
    const hot = addressOrNull(row.hot_wallet)
    if (!hot) continue
    const listed =
      exchangeOfWallet(hot, rows)?.entry ?? exchangeOfLabels(strings(row.hot_wallet_labels), rows)
    exchange ??= listed
    const first = numberOrNull(row.first_seen_timestamp)
    const last = numberOrNull(row.last_seen_timestamp)
    sweeps.push({
      hot_wallet: hot,
      hot_wallet_exchange: listed?.exchange ?? null,
      hot_wallet_role: textOrNull(row.hot_wallet_role),
      sweep_count: numberOrNull(row.sweep_count),
      amount_usd_sum: numberOrNull(row.amount_usd_sum),
      paths: strings(row.paths),
      first_seen: first,
      first_seen_utc: utcOrNull(first),
      last_seen: last,
      last_seen_utc: utcOrNull(last),
    })
  }
  sweeps.sort((a, b) => (b.sweep_count ?? 0) - (a.sweep_count ?? 0))
  exchange ??= exchangeOfLabels(labels, rows) ?? exchangeOfWallet(address, rows)?.entry ?? null
  const role = cexRoleOf(nodeRow?.cex_role)
  const found = nodeRow !== undefined || sweeps.length > 0
  const result = {
    schema: AML_EXCHANGE_DEPOSIT_CHECK_SCHEMA,
    tool: AML_EXCHANGE_DEPOSIT_CHECK_TOOL,
    network,
    address,
    found,
    is_deposit: role === 'deposit' || sweeps.length > 0,
    cex_role: role ?? (sweeps.length > 0 ? ('deposit' as const) : null),
    exchange: exchange?.exchange ?? null,
    exchange_display: exchange?.display ?? null,
    labels,
    swept: sweeps,
  }
  return { result: { ...result, hint: hintFor(result) } }
}

function hintFor(result: Omit<AmlExchangeDepositCheckResult, 'hint'>): string {
  const { address, network } = result
  const name = result.exchange_display ?? 'its exchange (name it from labels)'
  if (!result.found) {
    return (
      `${ANSWER_HINT} ${address} is not in the Chain Insights Graph of ${network}: no flow touches it. ` +
      'Say so in one line, and check the network and the address with the user.'
    )
  }
  if (result.is_deposit) {
    const top = result.swept[0]
    const into = top
      ? ` It swept ${top.sweep_count ?? 'an unknown number of'} times into the hot wallet ${top.hot_wallet}` +
        (result.swept.length > 1
          ? `, and into ${result.swept.length - 1} more hot wallets (swept lists them)`
          : '') +
        '.'
      : ' The graph holds no SWEPT link of it yet: its sweeps are not drawn.'
    return (
      `${ANSWER_HINT} Say: "${address} is a deposit address of ${name} on ${network}."${into} ` +
      'This is where the money entered the exchange: the exchange can name the customer behind the deposit. ' +
      EXCHANGE_OPENING_RULE
    )
  }
  if (result.cex_role) {
    return (
      `${ANSWER_HINT} Say: "${address} is a ${result.cex_role.replace('_', ' ')} of ${name} on ${network}, not a deposit address." ` +
      'A trail that reaches it has entered the exchange: end the trail there.'
    )
  }
  return (
    `${ANSWER_HINT} ${address} carries no deposit mark: no SWEPT link and no cex_role. ` +
    'Say that the graph shows no sweep of it into a proven exchange hot wallet. That is not proof the address belongs to no exchange; ' +
    'its labels and its links say what else it is.'
  )
}

function errorResult(text: string): AmlExchangeDepositCheckToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: AmlExchangeDepositCheckResult): AmlExchangeDepositCheckToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** aml_exchange_deposit_check, {network, address}. Every argument is checked before a read is sent. */
export async function handleAmlExchangeDepositCheck(
  args: unknown,
  deps: ExchangeDepositCheckDependencies
): Promise<AmlExchangeDepositCheckToolResult> {
  const record = isRecord(args) ? args : {}
  let network: string
  try {
    network = normalizeDexNetwork(record.network)
  } catch (err) {
    return errorResult(
      err instanceof DexRegistryError ? err.message : `invalid_network: ${(err as Error).message}`
    )
  }
  const raw = typeof record.address === 'string' ? record.address.trim() : ''
  if (!ADDRESS_INPUT.test(raw)) {
    return errorResult(
      'invalid_address: address is required: 0x plus 40 hex characters. ' +
        'An exchange name is not an address: call meta_exchange_lookup for its wallets.'
    )
  }
  const address = raw.toLowerCase()

  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    return errorResult(
      `No exchange deposit read was sent: ${unavailable} There is no answer yet, which is not "no deposit": try again later.`
    )
  }

  let rows: ExchangeEntry[] = []
  try {
    rows = (await deps.loadExchangeRegistry(network)).document.rows
  } catch {
    // The lookup only names the exchange; the graph read still answers.
  }

  let answer: GraphAnswer
  try {
    answer = await deps.graphQueryBatch({ network, queries: depositCheckQueries(address) })
  } catch (err) {
    return errorResult(
      `The exchange deposit read failed: ${deps.describeFailure(err)} This is not "no deposit": send the same check again once.`
    )
  }
  const members = membersOf(answer)
  if (members.size === 0) {
    const text = answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
    return errorResult(`The exchange deposit read failed: ${text} This is not "no deposit".`)
  }
  const check = depositCheckFromMembers(network, address, members, rows)
  if ('failure' in check) {
    return errorResult(
      `The exchange deposit read failed: ${check.failure} This is not "no deposit": send the same check again once.`
    )
  }
  return textResult(check.result)
}
