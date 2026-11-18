/**
 * aml_exchange_deposit_check: is this address an exchange deposit, of which
 * exchange, and into which hot wallet was it swept?
 *
 * A local tool of the proxy. It sends one graph_query_batch with six reads on
 * USE topology, all anchored on the address:
 *
 *   node      the address: its node labels, its label words and `cex_role`;
 *   swept     its `SWEPT` links: each hot wallet it swept into, with the sweep
 *             count, the USD sum, the paths and the first and last sweep;
 *   paid_by   how many addresses paid it, and how many of them are exchange
 *             wallets;
 *   paid      how many addresses it paid, and how many of them are exchange
 *             wallets;
 *   swapped   on how many DEX pools it swapped;
 *   approved  how many spenders it approved.
 *
 * The last four are the behaviour of the address, as counts: what a host needs
 * to say why an address does or does not look like a deposit, without a guess.
 * A behaviour read that fails leaves its counts null; the check still answers.
 *
 * `SWEPT` (layer `cex_sweeps`) is drawn only from an address the deposit rule
 * judged a deposit, and `cex_role` comes from the exchange label's subtype. The
 * graph judges, this tool only reads.
 *
 * The exchange model's own guess rides beside them on the node (graph sync
 * layer `inferred`): `inferred_exchange_role`, an `ml:exchange-roles:<model>:
 * <basis>` entry in `inferred_sources`, and the time it was written. It is
 * never a label and never a SWEPT link. A sourced mark always wins; an
 * address with only the guess is answered as inferred, with the model, and
 * `is_deposit` stays false. The exchange is named from the lookup
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
/**
 * What the graph's deposit rule holds an address to, in the words every host
 * reads. The rule judges; a host that re-judges from payer counts or volume
 * invents a rule ("a real deposit has many payers") and gets the reason wrong.
 */
/** How a deposit address behaves: the answer to "what makes an address a deposit address". Every result carries it as deposit_profile. */
export const EXCHANGE_DEPOSIT_BEHAVIOUR =
  "A deposit address is one customer's: everything it sends goes to the wallets of one exchange (a sweep into a hot wallet), few outside addresses ever pay it, it never swaps on a DEX, and it is no token, pool, router or smart account."

export const EXCHANGE_DEPOSIT_PROFILE =
  `${EXCHANGE_DEPOSIT_BEHAVIOUR} ` +
  'The graph judges that, never you: the verdict is is_deposit, cex_role and swept. Give behaviour and does_not_fit_deposit as the facts behind it, and never set a threshold of your own for payers, volume or sweeps. ' +
  'With no deposit mark an address is not shown to be a deposit, whoever says it is one; with found false it has no activity on the network, and the claim is unproven there.'

/** The one rule for an inferred answer, in the description every host reads and in the skill. */
export const EXCHANGE_INFERRED_RULE =
  "An answer with inferred: true is the exchange model's prediction, not a listed source: report the address as inferred by the model, with its version (inferred_model), never as a confirmed exchange address."

export const AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION =
  'Checks one address: is it a deposit address of a centralized exchange (Binance, Bitget, Bybit, Coinbase, Gate, KuCoin, MEXC, OKX, ...), ' +
  'of which exchange, and into which hot wallet was it swept, how many times, by which path and when. ' +
  'It reads the SWEPT links of the address and its cex_role (deposit, hot_wallet, cold_wallet or withdrawal) on the graph, and its behaviour as counts ' +
  '(how many addresses paid it, how many it paid, how many of each are exchange wallets, the DEX pools it swapped on, the spenders it approved), anchored on the address: ' +
  'six reads in one batch, billed as any read. Use it when a trail reaches an address that may be an exchange wallet, when the user asks where money entered an exchange, ' +
  'or when someone says an address is an exchange deposit: a claim is never proof, the answer of this tool is. ' +
  `${EXCHANGE_DEPOSIT_PROFILE} ${EXCHANGE_INFERRED_RULE} ${EXCHANGE_OPENING_RULE}`
export const AML_EXCHANGE_DEPOSIT_CHECK_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const AML_EXCHANGE_DEPOSIT_CHECK_ARGS = ['network', 'address'] as const

/** The most hot wallets one deposit's read returns. */
export const SWEPT_LIMIT = 20

export type CexRole = (typeof CEX_ROLES)[number]

/** The roles the exchange model infers. */
export const INFERRED_EXCHANGE_ROLES = ['deposit', 'hot_wallet'] as const
export type InferredExchangeRole = (typeof INFERRED_EXCHANGE_ROLES)[number]

/**
 * Why the model inferred the role, from the suffix of its source entry:
 * `rule` a deposit behind a listed hot wallet, `rule-p` a deposit behind a hot
 * wallet the model inferred, `p-hub` a hot wallet the model inferred.
 */
export const INFERRED_BASIS = {
  rule: 'listed_hot_wallet',
  'rule-p': 'predicted_hot_wallet',
  'p-hub': 'predicted',
} as const
export type InferredBasis = (typeof INFERRED_BASIS)[keyof typeof INFERRED_BASIS]

/** The prefix of the exchange model's entries in `inferred_sources`. */
export const EXCHANGE_MODEL_SOURCE_PREFIX = 'ml:exchange-roles:'

export interface InferredExchangeMark {
  role: InferredExchangeRole
  model: string
  basis: InferredBasis
  /** ISO time the graph wrote the guess, or null when it carries none. */
  at: string | null
}

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

/** The most links one behaviour read counts: a count equal to it means "this many or more". */
export const BEHAVIOUR_COUNT_CAP = 5000

/**
 * How the address behaves, as counts of its links. A null count is a read that
 * did not answer. The counts take every link, also a dust one: the graph's
 * deposit rule, which ignores dust, is the judge, and these are its evidence.
 */
export interface DepositBehaviour {
  /** Addresses that ever paid it. */
  payers: number | null
  /** Of those, exchange wallets (a hot wallet, or another deposit). */
  payers_exchange: number | null
  /** Addresses it ever paid. */
  receivers: number | null
  /** Of those, exchange wallets. */
  receivers_exchange: number | null
  /** DEX pools it swapped on. */
  dex_pools: number | null
  /** Spenders it approved. */
  approvals: number | null
  /** A count equal to this means "this many or more". */
  count_cap: typeof BEHAVIOUR_COUNT_CAP
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
  /** The behaviour counts; null when the graph holds no node for the address. */
  behaviour: DepositBehaviour | null
  /** What the counts show that a deposit address does not do. Empty for a deposit, and when nothing shows. */
  does_not_fit_deposit: string[]
  /** How any deposit address behaves: the same text in every answer, for a host asked what makes one. */
  deposit_profile: string
  /** Set only when no sourced mark exists and the exchange model inferred a role. */
  inferred?: true
  inferred_role?: InferredExchangeRole
  /** The model version, from its `ml:exchange-roles:` source entry. */
  inferred_model?: string
  inferred_basis?: InferredBasis
  inferred_at?: string | null
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

/** The node read: the address, its marks, its cex_role and the exchange model's inferred role. */
export function depositNodeQuery(address: string): string {
  assertReadAddress(address)
  return (
    `USE topology MATCH (a:Address {address: "${address}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.labels AS labels, a.cex_role AS cex_role, ' +
    'a.inferred_exchange_role AS inferred_exchange_role, a.inferred_sources AS inferred_sources, ' +
    'a.inferred_exchange_role_updated_timestamp AS inferred_exchange_role_updated_timestamp LIMIT 1'
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

/** The behaviour reads: one count row each, over at most BEHAVIOUR_COUNT_CAP links. */
export function depositBehaviourQueries(
  address: string
): Array<{ id: 'paid_by' | 'paid' | 'swapped' | 'approved'; query: string }> {
  assertReadAddress(address)
  const anchor = `(a:Address {address: "${address}"})`
  const exchange = 'sum(CASE WHEN b.is_exchange THEN 1 ELSE 0 END)'
  return [
    {
      id: 'paid_by',
      query:
        `USE topology MATCH ${anchor}<-[:FLOWED_TO]-(b:Address) WITH b LIMIT ${BEHAVIOUR_COUNT_CAP} ` +
        `RETURN count(b) AS payers, ${exchange} AS payers_exchange LIMIT 1`,
    },
    {
      id: 'paid',
      query:
        `USE topology MATCH ${anchor}-[:FLOWED_TO]->(b:Address) WITH b LIMIT ${BEHAVIOUR_COUNT_CAP} ` +
        `RETURN count(b) AS receivers, ${exchange} AS receivers_exchange LIMIT 1`,
    },
    {
      id: 'swapped',
      query:
        `USE topology MATCH ${anchor}-[:SWAPPED]->(b:Address) WITH b LIMIT ${BEHAVIOUR_COUNT_CAP} ` +
        'RETURN count(b) AS dex_pools LIMIT 1',
    },
    {
      id: 'approved',
      query:
        `USE topology MATCH ${anchor}-[:APPROVED]->(b:Address) WITH b LIMIT ${BEHAVIOUR_COUNT_CAP} ` +
        'RETURN count(b) AS approvals LIMIT 1',
    },
  ]
}

/** The one batch the tool sends: members `node`, `swept` and the four behaviour reads. */
export function depositCheckQueries(address: string): Array<{ id: string; query: string }> {
  return [
    { id: 'node', query: depositNodeQuery(address) },
    { id: 'swept', query: depositSweptQuery(address) },
    ...depositBehaviourQueries(address),
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

/**
 * The exchange model's mark of a node row, or null. It needs both the role and
 * an `ml:exchange-roles:<model>:<basis>` source entry: a role with no entry of
 * the exchange model is no inferred mark. The model version may hold hyphens,
 * underscores and colons; the basis is the last part.
 */
export function inferredExchangeOf(
  row: Record<string, unknown> | undefined
): InferredExchangeMark | null {
  const role = textOrNull(row?.inferred_exchange_role)?.toLowerCase()
  if (!(INFERRED_EXCHANGE_ROLES as readonly string[]).includes(role ?? '')) return null
  const marks: Array<{ model: string; basis: InferredBasis; suffix: string }> = []
  for (const source of strings(row?.inferred_sources)) {
    const entry = source.trim()
    if (!entry.startsWith(EXCHANGE_MODEL_SOURCE_PREFIX)) continue
    const rest = entry.slice(EXCHANGE_MODEL_SOURCE_PREFIX.length)
    const cut = rest.lastIndexOf(':')
    if (cut <= 0) continue
    const model = rest.slice(0, cut)
    const suffix = rest.slice(cut + 1)
    if (!Object.prototype.hasOwnProperty.call(INFERRED_BASIS, suffix)) continue
    marks.push({ model, basis: INFERRED_BASIS[suffix as keyof typeof INFERRED_BASIS], suffix })
  }
  // The entry that fits the role first: p-hub names a hot wallet, rule and rule-p a deposit.
  const fits = (suffix: string) => (role === 'hot_wallet') === (suffix === 'p-hub')
  const mark = marks.find((m) => fits(m.suffix)) ?? marks[0]
  if (!mark) return null
  const ms = numberOrNull(row?.inferred_exchange_role_updated_timestamp)
  return {
    role: role as InferredExchangeRole,
    model: mark.model,
    basis: mark.basis,
    at: isEpochMs(ms) ? new Date(ms).toISOString() : null,
  }
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

/** The behaviour counts of the batch members; a member that did not answer leaves its counts null. */
export function behaviourFromMembers(members: Map<string, Member>): DepositBehaviour {
  const count = (id: string, column: string): number | null =>
    numberOrNull(rowsOf(members.get(id))[0]?.[column])
  return {
    payers: count('paid_by', 'payers'),
    payers_exchange: count('paid_by', 'payers_exchange'),
    receivers: count('paid', 'receivers'),
    receivers_exchange: count('paid', 'receivers_exchange'),
    dex_pools: count('swapped', 'dex_pools'),
    approvals: count('approved', 'approvals'),
    count_cap: BEHAVIOUR_COUNT_CAP,
  }
}

/** "5000 or more" at the cap, else the number. */
function countText(count: number): string {
  return count >= BEHAVIOUR_COUNT_CAP ? `${BEHAVIOUR_COUNT_CAP} or more` : String(count)
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many)

/**
 * What the counts show that a deposit address does not do. Only what needs no
 * threshold: a swap, and a payment to an address that is no exchange wallet.
 * How many payers are "few" is the graph rule's to say, never this tool's.
 */
export function doesNotFitDeposit(behaviour: DepositBehaviour): string[] {
  const facts: string[] = []
  if (behaviour.dex_pools !== null && behaviour.dex_pools > 0) {
    facts.push(
      `it swapped on ${countText(behaviour.dex_pools)} DEX ${plural(behaviour.dex_pools, 'pool', 'pools')}`
    )
  }
  if (behaviour.receivers !== null && behaviour.receivers_exchange !== null) {
    const outside = behaviour.receivers - behaviour.receivers_exchange
    if (outside > 0) {
      // A capped receiver count makes the difference a floor too.
      const atCap = behaviour.receivers >= BEHAVIOUR_COUNT_CAP ? ' or more' : ''
      facts.push(
        `it paid ${outside}${atCap} ${plural(outside, 'address that is', 'addresses that are')} no exchange wallet`
      )
    }
  }
  return facts
}

/** The counts as one sentence, the read counts only. */
export function behaviourText(behaviour: DepositBehaviour): string {
  const parts: string[] = []
  if (behaviour.payers !== null) {
    parts.push(
      `${countText(behaviour.payers)} ${plural(behaviour.payers, 'address', 'addresses')} paid it` +
        (behaviour.payers_exchange !== null
          ? ` (${countText(behaviour.payers_exchange)} of them exchange wallets)`
          : '')
    )
  }
  if (behaviour.receivers !== null) {
    parts.push(
      `it paid ${countText(behaviour.receivers)} ${plural(behaviour.receivers, 'address', 'addresses')}` +
        (behaviour.receivers_exchange !== null
          ? ` (${countText(behaviour.receivers_exchange)} of them exchange wallets)`
          : '')
    )
  }
  if (behaviour.dex_pools !== null) {
    parts.push(
      `it swapped on ${countText(behaviour.dex_pools)} DEX ${plural(behaviour.dex_pools, 'pool', 'pools')}`
    )
  }
  if (behaviour.approvals !== null) {
    parts.push(
      `it approved ${countText(behaviour.approvals)} ${plural(behaviour.approvals, 'spender', 'spenders')}`
    )
  }
  return parts.join(', ')
}

/** The check built from the batch members and the lookup rows, or why it cannot be. */
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
  const isDeposit = role === 'deposit' || sweeps.length > 0
  const behaviour = behaviourFromMembers(members)
  // A sourced mark always wins: the guess is read only for an address with none.
  const guess = role === null && sweeps.length === 0 ? inferredExchangeOf(nodeRow) : null
  const result: Omit<AmlExchangeDepositCheckResult, 'hint'> = {
    schema: AML_EXCHANGE_DEPOSIT_CHECK_SCHEMA,
    tool: AML_EXCHANGE_DEPOSIT_CHECK_TOOL,
    network,
    address,
    found,
    is_deposit: isDeposit,
    cex_role: role ?? (sweeps.length > 0 ? ('deposit' as const) : null),
    exchange: exchange?.exchange ?? null,
    exchange_display: exchange?.display ?? null,
    labels,
    swept: sweeps,
    behaviour: found ? behaviour : null,
    does_not_fit_deposit: found && !isDeposit && !role ? doesNotFitDeposit(behaviour) : [],
    deposit_profile: EXCHANGE_DEPOSIT_BEHAVIOUR,
    ...(guess
      ? {
          inferred: true as const,
          inferred_role: guess.role,
          inferred_model: guess.model,
          inferred_basis: guess.basis,
          inferred_at: guess.at,
        }
      : {}),
  }
  return { result: { ...result, hint: `${hintFor(result)} ${PROFILE_HINT}` } }
}

/** Closes every hint: a host asked how a deposit address behaves answers from deposit_profile, not from its own idea of one. */
const PROFILE_HINT =
  'Asked how a deposit address behaves, what makes an address one or what rules one out, answer with deposit_profile.'

/** " once", " 3 times", or "" when the graph gave no count. */
function timesText(count: number | null): string {
  if (count === null) return ''
  return count === 1 ? ' once' : ` ${count} times`
}

function hintFor(result: Omit<AmlExchangeDepositCheckResult, 'hint'>): string {
  const { address, network } = result
  const name = result.exchange_display ?? 'its exchange (name it from labels)'
  if (!result.found) {
    return (
      `${ANSWER_HINT} ${address} is not in the Chain Insights Graph of ${network}: no flow touches it. ` +
      'Say so in one line, and check the network and the address with the user: name no other network yourself, and say nothing about what the check covers. ' +
      'A claim that it is an exchange deposit address is unproven on this network: never repeat it as a fact.'
    )
  }
  if (result.is_deposit) {
    const top = result.swept[0]
    const into = top
      ? ` It swept${timesText(top.sweep_count)} into the hot wallet ${top.hot_wallet}` +
        (result.swept.length > 1
          ? `, and into ${result.swept.length - 1} more hot wallets (swept lists them)`
          : '') +
        '.'
      : ' The graph holds no SWEPT link of it yet: its sweeps are not drawn.'
    return (
      `${ANSWER_HINT} Say: "${address} is a deposit address of ${name} on ${network}."${into} ` +
      'This is where the money entered the exchange: the exchange can name the customer behind the deposit. ' +
      `${behaviourHint(result)}${EXCHANGE_OPENING_RULE}`
    )
  }
  if (result.inferred && result.inferred_role && result.inferred_model) {
    return inferredHint(result, result.inferred_role, result.inferred_model)
  }
  if (result.cex_role) {
    return (
      `${ANSWER_HINT} Say: "${address} is a ${result.cex_role.replace('_', ' ')} of ${name} on ${network}, not a deposit address." ` +
      'A trail that reaches it has entered the exchange: end the trail there.'
    )
  }
  const misfit =
    result.does_not_fit_deposit.length > 0
      ? `What a deposit address does not do, and this one did: ${result.does_not_fit_deposit.join('; ')}. `
      : 'Its counts alone rule nothing out; the missing mark does: the rule of the graph did not judge it a deposit. '
  return (
    `${ANSWER_HINT} ${address} carries no deposit mark: no SWEPT link and no cex_role. ` +
    'Say that the graph shows no sweep of it into a listed exchange hot wallet. That is not proof the address belongs to no exchange; ' +
    `its labels and its links say what else it is. ${behaviourHint(result)}${misfit}` +
    'Give these facts as the reason and no other: set no threshold of your own for payers, volume or sweeps.'
  )
}

/** Why the model holds its guess, in reader words. */
const INFERRED_BASIS_TEXT: Record<InferredBasis, string> = {
  listed_hot_wallet: 'The model placed it behind a listed exchange hot wallet.',
  predicted_hot_wallet: 'The model placed it behind a hot wallet the model itself inferred, which no listed source names either.',
  predicted: 'The model inferred it from how the address moves money.',
}

/** The hint of an address with no sourced mark and the exchange model's guess. */
function inferredHint(
  result: Omit<AmlExchangeDepositCheckResult, 'hint'>,
  role: InferredExchangeRole,
  model: string
): string {
  const { address, network } = result
  const what = role === 'deposit' ? 'an exchange deposit' : 'an exchange hot wallet'
  const basis = result.inferred_basis ? `${INFERRED_BASIS_TEXT[result.inferred_basis]} ` : ''
  const trail =
    role === 'deposit'
      ? 'The graph draws no SWEPT link for it, so no hot wallet is named: name none yourself. '
      : 'A trail that reaches it may have entered an exchange there: say so as inferred, and name no exchange the answer does not name. '
  return (
    `${ANSWER_HINT} Say: "${address} is ${what}, inferred by model ${model}, on ${network}. ` +
    'No listed source names it as an exchange address." ' +
    `${basis}${trail}` +
    'Report it as inferred, never as a confirmed exchange address: is_deposit (false) and cex_role (null) are the sourced verdict, and the guess does not change them. ' +
    `${behaviourHint(result)}` +
    'Give these facts as the reason and no other: set no threshold of your own for payers, volume or sweeps.'
  )
}

/** "Its behaviour: ... . " for a hint, or "" when no count was read. */
function behaviourHint(result: Omit<AmlExchangeDepositCheckResult, 'hint'>): string {
  const text = result.behaviour ? behaviourText(result.behaviour) : ''
  return text === '' ? '' : `Its behaviour, as the graph counts it: ${text}. `
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
