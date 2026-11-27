/**
 * aml_address_risk: who is this address, and how risky is it?
 *
 * A local tool of the proxy. It sends one graph_query_batch with three reads
 * on USE topology, all anchored on the address:
 *
 *   node  the address: its node labels and its card (identity, roles,
 *         behaviour, evidence, judgements, categories, case_judgements,
 *         sources, card_version), the risk
 *         model's `risk_level` and `risk_score`, and its exchange role;
 *   in    its senders: the newest FLOWED_TO links into it worth 1 USD or more,
 *         with each sender's own card words (identities included) and model
 *         level;
 *   out   its receivers: the same, out of it.
 *
 * The risk word is the higher of what the labels prove (rules) and what the
 * risk model predicts (model), computed by src/mcp/risk-word.ts from the card
 * entries and the card dictionary: the next words
 * (registry/address-card-next.json) for a card resolved with them, the frozen
 * words (registry/address-card.json) for every other card. The partners' words are computed by the
 * same rule from their own rows, and never change the address's word.
 *
 * The tool states, the host judges: the answer holds facts and measures, no
 * summary, no advice and no verdict. The only prose is each reason's fixed
 * plain sentence from the card dictionary.
 *
 * `addressRiskQueries` and `addressRiskFromMembers` are the address answer of
 * every risk tool: a tool that names many addresses batches their reads under
 * a prefix each, and builds each answer with the same code.
 */

import { cardDictionariesOf, type LoadedAddressCard } from './address-card.js'
import { DexRegistryError, normalizeDexNetwork } from './dex-registry.js'
import {
  exchangeOfLabels,
  exchangeOfWallet,
  type ExchangeEntry,
  type LoadedExchangeRegistry,
} from './exchange-registry.js'
import { exposedOf, type ExposedBlock } from './exposed.js'
import { exchangeRoleRead } from './graph-schema.js'
import {
  CARD_CATEGORIES,
  cardWordOf,
  caseJudgementReasonOf,
  categoryOfWord,
  levelRank,
  modelReasonOf,
  modelScoreOf,
  modelWordOf,
  readsNextWords,
  JUDGEMENT_WORD_SHOWN,
  reasonOf,
  riskOf,
  riskWordRank,
  rulesWordOf,
  splitCardEntry,
  splitCaseJudgement,
  holdsNextWords,
  isCardDictionaries,
  wordsFor,
  type CardDictionaries,
  type CardWords,
  type ModelWord,
  type Reason,
  type RiskWord,
  type SetBy,
} from './risk-word.js'
import {
  addressOrNull,
  isRecord,
  memberAnswered,
  memberRefusal,
  memberRows,
  numberOrNull,
  strings,
  textOrNull,
  utcOrNull,
} from './row-values.js'
import { membersOf, refusalOf, type GraphAnswer, type Member } from './token-lookup.js'

export const AML_ADDRESS_RISK_TOOL = 'aml_address_risk' as const
export const AML_ADDRESS_RISK_SCHEMA = 'chain-insights.aml-address-risk.v2' as const
export const AML_ADDRESS_RISK_TITLE = 'Address risk'

/** How a host reads the answer: the one text every host reads, in the tool description. */
export const ADDRESS_RISK_READING_RULE =
  'The tool states facts and measures; you write the judgement: say which reasons you rely on, ' +
  'say when the word comes from the model alone (set_by model) that it is a prediction, never call an address safe, ' +
  'and name a part listed in not_read as not read.'

export const AML_ADDRESS_RISK_DESCRIPTION =
  'Answers who one address is and how risky it is: its identity, wallet roles and behaviour, its risk word with every reason, ' +
  'the risk model level and score, the partners it exchanged money with (1 USD or more, the 25 newest each way) that carry a risk word of medium or above, ' +
  'and the exchange wallets its money came from or reached. Three reads anchored on the address, in two calls (the node first), billed as any read. ' +
  'risk.word is the higher of what labels prove (rules_word) and what the risk model predicts (model_word); critical comes only from a label. ' +
  'risk.score is the model number from 0 to 1, or null: a label never makes a number. ' +
  'unscored means neither labels nor the model speak about the address: it is not low and not safe. ' +
  'A risky partner is listed beside the word and never changes it. ' +
  'exposed, when present, is a grade below proof: one block per scam kind the address sits near (band, steps, the way of addresses), never evidence against the address, and it never changes the word. ' +
  'A hub (the zero address or the dead address, whatever its link count, or an address with more than 50,000 money links, such as a pool manager) has its counterparties not ranked: exposure.hub is true, counterparties_read is 0, and not_read names counterparties; ask about one counterparty, or one token, instead. ' +
  `${ADDRESS_RISK_READING_RULE} ` +
  'Write every address in full, all 42 characters. Pass surroundings: true for the nodes and money links behind the answer, to draw.'

export const AML_ADDRESS_RISK_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const AML_ADDRESS_RISK_ARGS = ['network', 'address', 'surroundings'] as const

/** The partners kept per direction, the newest first. One more is read to know whether more exist. */
export const PARTNER_LIMIT = 25
/** The money floor of a partner link, in USD: a link under it is dust, filtered by the read. */
export const EXPOSURE_FLOOR_USD = 1
/** The most nodes the surroundings carry. */
export const SURROUNDINGS_NODE_LIMIT = 60
/**
 * The addresses that are never a partner: tokens minted from and burned to them.
 * Each is a hub by identity, whatever its link count: see hubOf.
 */
export const ZERO_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
] as const

export type AddressKind = 'account' | 'contract' | 'token' | 'pool' | 'unknown'
export type PartnerDirection = 'sent_to_subject' | 'received_from_subject'
export type NotReadPart = 'senders' | 'receivers' | 'counterparties'

export interface AddressRisk {
  word: RiskWord
  score: number | null
  rules_word: string
  model_word: ModelWord
  set_by: SetBy
  reasons: Reason[]
  /** Card words the dictionary does not hold: listed, they set nothing. */
  unknown_words: string[]
  /** The dictionary version that resolved the card on the graph, or null. */
  card_version: string | null
}

export interface ModelScore {
  level: ModelWord
  score: number | null
  scored: boolean
}

export interface RiskyPartner {
  address: string
  direction: PartnerDirection
  risk_word: RiskWord
  set_by: SetBy
  reasons: Reason[]
  tokens_worth_usd: number | null
  tx_count: number | null
  first_seen_utc: string | null
  last_seen_utc: string | null
}

export interface ExchangeEnd {
  address: string
  direction: PartnerDirection
  /** The exchange id, from the lookup file, else the name on the card. */
  exchange: string | null
  exchange_role: string | null
  tokens_worth_usd: number | null
  first_seen_utc: string | null
  last_seen_utc: string | null
}

export interface Exposure {
  floor_usd: typeof EXPOSURE_FLOOR_USD
  /** True for a hub (a zero address, or more than HUB_DEGREE links): its counterparties are not ranked, and none is read. */
  hub: boolean
  /** The address's link count on its node, when the node carries it. */
  degree_total: number | null
  /** Partner links kept: worth 1 USD or more, not a token contract, not a zero address. */
  counterparties_read: number
  /** Partner links read and dropped: a token contract or a zero address. */
  left_out: number
  /** True when a direction had more partners than PARTNER_LIMIT. */
  truncated: boolean
  with_risk: RiskyPartner[]
  /** Kept partners with at least one judgement (suspect, or pattern on a frozen card) and no word of medium or above. */
  pattern_partners: number
}

export interface NotRead {
  part: NotReadPart
  code: string
  reason: string
}

export interface SurroundingsNode {
  address: string
  role: 'subject' | 'partner' | 'exchange_end'
  kind: AddressKind
  name: string | null
  risk_word: RiskWord
  model_level: ModelWord
}

export interface SurroundingsLink {
  from_address: string
  to_address: string
  link: 'FLOWED_TO'
  tokens_worth_usd: number | null
  first_seen_utc: string | null
  last_seen_utc: string | null
}

export interface Surroundings {
  nodes: SurroundingsNode[]
  links: SurroundingsLink[]
  truncated: boolean
}

export interface AmlAddressRiskResult {
  schema: typeof AML_ADDRESS_RISK_SCHEMA
  tool: typeof AML_ADDRESS_RISK_TOOL
  network: string
  address: string
  /** false when the graph holds no node for the address. */
  found: boolean
  kind: AddressKind
  identity: { word: string; name: string | null } | null
  roles: string[]
  behaviour: string | null
  /**
   * The strongest of the card's categories (malicious, then suspect, then
   * victim), absent when the card has none. `suspect` is shown as `pattern`
   * on a card the frozen dictionary reads.
   */
  category?: string
  /** The type of that category's first case judgement, for example `poisoning`; absent when it has none. */
  type?: string
  /** The role of that category's first case judgement, for example `scammer`; absent when it has none. */
  role?: string
  risk: AddressRisk
  model: ModelScore
  /** Null when the address is not found. */
  exposure: Exposure | null
  exchange_ends: ExchangeEnd[]
  not_read: NotRead[]
  /**
   * Exposed, a grade below proof: one block per scam kind the address sits near.
   * It sets no risk word. Absent when the node has nothing to show.
   */
  exposed?: ExposedBlock[]
  surroundings?: Surroundings
}

export interface AddressRiskDependencies {
  /** The card dictionary: the fresh cache, the public file, or the packaged copy. */
  loadAddressCard: () => Promise<LoadedAddressCard | null>
  /** The next words' dictionary (registry/address-card-next.json), the same way. Without it a card on the next words reads its words as unknown. */
  loadAddressCardNext?: () => Promise<LoadedAddressCard | null>
  loadExchangeRegistry: (network: string) => Promise<LoadedExchangeRegistry>
  graphQueryBatch: (args: {
    network: string
    queries: Array<{ id: string; query: string }>
  }) => Promise<GraphAnswer>
  unavailable?: () => Promise<string | undefined> | string | undefined
  describeFailure: (err: unknown) => string
}

export type AmlAddressRiskToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

/** A full address as a caller may type it: 0x plus 40 hex characters, any case. */
export const ADDRESS_INPUT = /^0x[0-9a-fA-F]{40}$/
const ADDRESS_READ = /^0x[0-9a-f]{40}$/

export function assertReadAddress(address: string): void {
  if (!ADDRESS_READ.test(address)) {
    throw new Error(`address risk: ${JSON.stringify(address)} is not a lowercase 0x address`)
  }
}

/**
 * The node read: the card, the model's level and score, and the exchange role.
 * `extra` adds columns of the node `a` (a token's standard, a pool's sums).
 */
export function addressNodeQuery(address: string, extra: readonly string[] = []): string {
  assertReadAddress(address)
  const more = extra.length > 0 ? `, ${extra.join(', ')}` : ''
  return (
    `USE topology MATCH (a:Address {address: "${address}"}) ` +
    'RETURN labels(a) AS node_labels, a.card_version AS card_version, a.identity AS identity, a.identity_name AS identity_name, ' +
    'a.identities AS identities, a.address_roles AS address_roles, a.behaviour AS behaviour, a.evidence AS evidence, ' +
    'a.judgements AS judgements, a.categories AS categories, a.case_judgements AS case_judgements, a.is_malicious AS is_malicious, ' +
    'a.exposed AS exposed, a.sources AS sources, a.risk_level AS risk_level, a.risk_score AS risk_score, ' +
    `${exchangeRoleRead('a')} AS exchange_role, a.degree_total AS degree_total, a.degree_out AS degree_out${more} LIMIT 1`
  )
}

/**
 * A hub has more links than this. Ranking a hub's money links by amount is
 * what costs (9 s for the zero address, 17.6 s for a pool manager, against
 * under 3.5 s for every other case measured): a hub's partner reads are not
 * sent, and its counterparties are not ranked.
 *
 * `degree_total` counts money links only. A zero address holds far more links
 * of other kinds (every mint and burn of every token), so its count can sit
 * under this bound while its partner reads still time out: a zero address is
 * a hub by identity (hubOf).
 */
export const HUB_DEGREE = 50_000

/** Why an address is a hub: it is a zero address, or its node carries more than HUB_DEGREE links. */
export type HubCause = 'zero_address' | 'degree'

export interface Hub {
  cause: HubCause
  /** The node's link count, or null when the node carries none. */
  degree: number | null
}

/** True for an address of ZERO_ADDRESSES. */
export function isZeroAddress(address: string): boolean {
  return (ZERO_ADDRESSES as readonly string[]).includes(address.toLowerCase())
}

/**
 * The hub an address is, or null. A zero address is a hub whatever its node
 * says. Any other address is a hub when its node carries more than HUB_DEGREE
 * links; a node whose degree is missing is not a hub.
 */
export function hubOf(address: string, row: Record<string, unknown> | undefined): Hub | null {
  const degree = numberOrNull(row?.degree_total)
  if (isZeroAddress(address)) return { cause: 'zero_address', degree }
  return degree !== null && degree > HUB_DEGREE ? { cause: 'degree', degree } : null
}

/** The not-read entry of a hub's counterparties: what to ask instead. */
export function hubNotRead(hub: Hub): NotRead {
  const why =
    hub.cause === 'zero_address'
      ? 'This is a zero address: tokens are minted from it and burned to it, so it is linked to nearly every holder.'
      : `This address has ${hub.degree} links.`
  return {
    part: 'counterparties',
    code: 'hub',
    reason: `${why} Its counterparties are not ranked: ask about one counterparty, or one token.`,
  }
}

/** A partner read: the newest money links of one direction, one more than kept. */
export function addressPartnerQuery(address: string, direction: 'in' | 'out'): string {
  assertReadAddress(address)
  const anchor = `(a:Address {address: "${address}"})`
  const match =
    direction === 'in'
      ? `(b:Address)-[f:FLOWED_TO]->${anchor}`
      : `${anchor}-[f:FLOWED_TO]->(b:Address)`
  return (
    `USE topology MATCH ${match} WHERE f.amount_usd_sum >= ${EXPOSURE_FLOOR_USD} ` +
    'RETURN b.address AS address, labels(b) AS node_labels, b.identity AS identity, b.identity_name AS identity_name, ' +
    'b.identities AS identities, b.card_version AS card_version, ' +
    'b.evidence AS evidence, b.judgements AS judgements, b.categories AS categories, b.case_judgements AS case_judgements, ' +
    'b.risk_level AS risk_level, ' +
    `${exchangeRoleRead('b')} AS exchange_role, ` +
    'f.amount_usd_sum AS tokens_worth_usd, f.tx_count AS tx_count, ' +
    'f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp ' +
    `ORDER BY f.last_seen_timestamp DESC LIMIT ${PARTNER_LIMIT + 1}`
  )
}

/** The three batch members of one address, their ids under `prefix`: `${prefix}node`, `${prefix}in`, `${prefix}out`. */
export function addressRiskQueries(
  address: string,
  prefix = ''
): Array<{ id: string; query: string }> {
  return [
    { id: `${prefix}node`, query: addressNodeQuery(address) },
    { id: `${prefix}in`, query: addressPartnerQuery(address, 'in') },
    { id: `${prefix}out`, query: addressPartnerQuery(address, 'out') },
  ]
}

const answered = memberAnswered
const rowsOf = memberRows

function notReadOf(part: NotReadPart, id: string, member: Member | undefined): NotRead {
  return { part, ...memberRefusal(id, member) }
}

/**
 * The category of the card as the answer shows it. Read with the next
 * dictionary it is the card's own word; read with the frozen one, `suspect`
 * reads as `pattern`, as a frozen judgement does.
 */
export function categoryShown(category: string, nextWords = false): string {
  return !nextWords && category.toLowerCase() === 'suspect' ? JUDGEMENT_WORD_SHOWN : category
}

/**
 * The card's strongest category of a node row, with the type and role of its
 * first case judgement, each left out when the card has none. Read from
 * `categories` and `case_judgements`.
 */
export function cardClassOf(
  row: Record<string, unknown>,
  nextWords = false
): Pick<AmlAddressRiskResult, 'category' | 'type' | 'role'> {
  const categories = strings(row.categories).map((category) => category.toLowerCase())
  const judgements = strings(row.case_judgements)
    .map(splitCaseJudgement)
    .filter((judgement) => judgement !== null)
  const category =
    CARD_CATEGORIES.find((known) => categories.includes(known)) ?? categories[0] ?? null
  if (category === null) return {}
  const first = judgements.find((judgement) => judgement.category === category)
  return {
    category: categoryShown(category, nextWords),
    ...(first?.type ? { type: first.type } : {}),
    ...(first?.role ? { role: first.role } : {}),
  }
}

/** The kind of an address from its node labels: Pool wins over Token over Contract over Account. */
export function kindOf(nodeLabels: readonly string[]): AddressKind {
  if (nodeLabels.includes('Pool')) return 'pool'
  if (nodeLabels.includes('Token')) return 'token'
  if (nodeLabels.includes('Contract')) return 'contract'
  if (nodeLabels.includes('Account')) return 'account'
  return 'unknown'
}

/**
 * The reasons and the word of one row: the top identity, every other identity
 * word that carries a level, the entries of evidence and judgements, each case
 * judgement and category no entry gave a reason for, and the model level. The
 * dictionary is the one the card was resolved with (wordsFor): the next words
 * for a card on them, the frozen words otherwise. Each entry is read by it,
 * whatever list it came from.
 */
export function rowRisk(
  row: Record<string, unknown> | undefined,
  dictionaryWords: CardWords
): Omit<AddressRisk, 'card_version'> {
  const dictionary = wordsFor(row, dictionaryWords)
  const readNext = readsNextWords(row, dictionaryWords)
  const nextWords = holdsNextWords(
    row,
    isCardDictionaries(dictionaryWords) ? dictionaryWords.nextVersion : undefined
  )
  const reasons: Reason[] = []
  const unknown: string[] = []
  // The categories an entry already gave a reason for: a case judgement of one adds nothing.
  const covered = new Set<string>()
  const take = (entry: string, keep: (reason: Reason) => boolean = () => true) => {
    const reason = reasonOf(entry, dictionary, readNext)
    if (reason) {
      const item = cardWordOf(entry, dictionary)
      const category = item ? categoryOfWord(item) : null
      if (category) covered.add(category)
      if (keep(reason)) reasons.push(reason)
    } else {
      const { word } = splitCardEntry(entry)
      if (word !== '' && !unknown.includes(word)) unknown.push(word)
    }
  }
  const identity = textOrNull(row?.identity)
  if (identity) take(identity)
  // A mixer that is not the top identity still raises the word.
  for (const word of strings(row?.identities)) {
    if (word.toLowerCase() === identity?.toLowerCase()) continue
    take(word, (reason) => reason.level !== 'none')
  }
  for (const entry of strings(row?.evidence)) take(entry)
  for (const entry of strings(row?.judgements)) take(entry)
  // On a card of the next words: a case judgement, then a bare category, of a
  // category no entry spoke for. An older card has neither field.
  const cases = (nextWords ? strings(row?.case_judgements) : [])
    .map(splitCaseJudgement)
    .filter((judgement) => judgement !== null)
  const bare = (nextWords ? strings(row?.categories) : []).map((category) => ({
    category: category.trim().toLowerCase(),
    type: null,
    role: null,
    case: null,
  }))
  for (const judgement of [...cases, ...bare]) {
    if (judgement.category === '' || covered.has(judgement.category)) continue
    const reason = caseJudgementReasonOf(judgement, dictionary, readNext)
    if (reason) {
      covered.add(judgement.category)
      reasons.push(reason)
    } else if (!unknown.includes(judgement.category)) {
      unknown.push(judgement.category)
    }
  }
  const modelWord = modelWordOf(row?.risk_level)
  const risk = riskOf({
    rulesWord: rulesWordOf(reasons),
    modelWord,
    score: modelScoreOf(row?.risk_score),
  })
  if (modelWord !== 'not_scored' && (risk.set_by === 'model' || risk.set_by === 'both')) {
    reasons.push(modelReasonOf(modelWord))
  }
  return { ...risk, reasons, unknown_words: unknown }
}

/** A partner row, as the answer reads it. */
interface Partner {
  address: string
  direction: PartnerDirection
  row: Record<string, unknown>
  kind: AddressKind
  risk: Omit<AddressRisk, 'card_version'>
  exchange: { exchange: string | null; exchange_role: string | null } | null
}

function isTokenContract(nodeLabels: readonly string[]): boolean {
  return nodeLabels.includes('Token') && !nodeLabels.includes('Pool')
}

/** The exchange of a partner that is an exchange wallet, or null when it is none. */
function exchangeOfPartner(
  address: string,
  row: Record<string, unknown>,
  nodeLabels: readonly string[],
  exchangeRows: ExchangeEntry[]
): Partner['exchange'] {
  const identity = textOrNull(row.identity)?.toLowerCase()
  const role = textOrNull(row.exchange_role)?.toLowerCase() ?? null
  if (identity !== 'exchange' && role === null && !nodeLabels.includes('Exchange')) return null
  const name = textOrNull(row.identity_name)
  const listed =
    exchangeOfWallet(address, exchangeRows)?.entry ??
    (name ? exchangeOfLabels([name], exchangeRows) : null)
  return { exchange: listed?.exchange ?? name, exchange_role: role }
}

/** The partners of one direction, the token contracts and zero addresses dropped and counted. */
function partnersOf(
  member: Member | undefined,
  direction: PartnerDirection,
  dictionary: CardWords,
  exchangeRows: ExchangeEntry[]
): { partners: Partner[]; leftOut: number; truncated: boolean } {
  const rows = rowsOf(member)
  const partners: Partner[] = []
  let leftOut = 0
  for (const row of rows.slice(0, PARTNER_LIMIT)) {
    const address = addressOrNull(row.address)
    if (!address) continue
    const nodeLabels = strings(row.node_labels)
    if (isTokenContract(nodeLabels) || isZeroAddress(address)) {
      leftOut += 1
      continue
    }
    partners.push({
      address,
      direction,
      row,
      kind: kindOf(nodeLabels),
      risk: rowRisk(row, dictionary),
      exchange: exchangeOfPartner(address, row, nodeLabels, exchangeRows),
    })
  }
  return { partners, leftOut, truncated: rows.length > PARTNER_LIMIT }
}

function riskyPartnerOf(partner: Partner): RiskyPartner {
  return {
    address: partner.address,
    direction: partner.direction,
    risk_word: partner.risk.word,
    set_by: partner.risk.set_by,
    reasons: partner.risk.reasons,
    tokens_worth_usd: numberOrNull(partner.row.tokens_worth_usd),
    tx_count: numberOrNull(partner.row.tx_count),
    first_seen_utc: utcOrNull(partner.row.first_seen_timestamp),
    last_seen_utc: utcOrNull(partner.row.last_seen_timestamp),
  }
}

const MEDIUM_RANK = levelRank('medium')
const wordRank = riskWordRank

/** The nodes and money links behind the answer, from the rows already read. */
function surroundingsOf(subject: SurroundingsNode, partners: Partner[], truncated: boolean): Surroundings {
  const nodes: SurroundingsNode[] = [subject]
  const listed = new Set([subject.address])
  let capped = false
  for (const partner of partners) {
    if (listed.has(partner.address)) continue
    if (nodes.length >= SURROUNDINGS_NODE_LIMIT) {
      capped = true
      continue
    }
    listed.add(partner.address)
    nodes.push({
      address: partner.address,
      role: partner.exchange ? 'exchange_end' : 'partner',
      kind: partner.kind,
      name: partner.exchange?.exchange ?? textOrNull(partner.row.identity_name),
      risk_word: partner.risk.word,
      model_level: partner.risk.model_word,
    })
  }
  const links: SurroundingsLink[] = []
  for (const partner of partners) {
    if (!listed.has(partner.address)) continue
    const sent = partner.direction === 'sent_to_subject'
    links.push({
      from_address: sent ? partner.address : subject.address,
      to_address: sent ? subject.address : partner.address,
      link: 'FLOWED_TO',
      tokens_worth_usd: numberOrNull(partner.row.tokens_worth_usd),
      first_seen_utc: utcOrNull(partner.row.first_seen_timestamp),
      last_seen_utc: utcOrNull(partner.row.last_seen_timestamp),
    })
  }
  return { nodes, links, truncated: truncated || capped }
}

/**
 * The address answer built from its batch members, or why it cannot be. Only
 * a node read that did not answer is a failure; a partner read that did not
 * answer is named in not_read and the answer still stands.
 */
export function addressRiskFromMembers(
  network: string,
  address: string,
  members: Map<string, Member>,
  dictionary: CardWords,
  exchangeRows: ExchangeEntry[],
  prefix = '',
  options: {
    surroundings?: boolean
    /** The partner reads were not sent for a hub: build the hub answer when the node is one. */
    hubGuard?: boolean
  } = {}
): { result: AmlAddressRiskResult } | { failure: string } {
  const nodeId = `${prefix}node`
  const node = members.get(nodeId)
  if (!answered(node)) {
    if (!node) return { failure: `the ${nodeId} read is missing from the batch answer` }
    return {
      failure:
        typeof node.error === 'string' && node.error.trim() !== ''
          ? node.error
          : `the ${nodeId} read did not answer`,
    }
  }
  const nodeRow = rowsOf(node)[0]
  const base = {
    schema: AML_ADDRESS_RISK_SCHEMA,
    tool: AML_ADDRESS_RISK_TOOL,
    network,
    address,
  }
  if (!nodeRow) {
    const result: AmlAddressRiskResult = {
      ...base,
      found: false,
      kind: 'unknown',
      identity: null,
      roles: [],
      behaviour: null,
      risk: {
        word: 'unscored',
        score: null,
        rules_word: 'none',
        model_word: 'not_scored',
        set_by: 'none',
        reasons: [],
        unknown_words: [],
        card_version: null,
      },
      model: { level: 'not_scored', score: null, scored: false },
      exposure: null,
      exchange_ends: [],
      not_read: [],
      ...(options.surroundings === true
        ? {
            surroundings: {
              nodes: [
                {
                  address,
                  role: 'subject' as const,
                  kind: 'unknown' as const,
                  name: null,
                  risk_word: 'unscored' as const,
                  model_level: 'not_scored' as const,
                },
              ],
              links: [],
              truncated: false,
            },
          }
        : {}),
    }
    return { result }
  }

  const risk = rowRisk(nodeRow, dictionary)
  const kind = kindOf(strings(nodeRow.node_labels))
  const identityWord = textOrNull(nodeRow.identity)
  const identityName = textOrNull(nodeRow.identity_name)

  const notRead: NotRead[] = []
  const degree = numberOrNull(nodeRow.degree_total)
  const hub = options.hubGuard === true ? hubOf(address, nodeRow) : null
  if (hub !== null) notRead.push(hubNotRead(hub))
  const directions: Array<{ id: string; part: NotReadPart; direction: PartnerDirection }> =
    hub !== null
      ? []
      : [
          { id: `${prefix}in`, part: 'senders', direction: 'sent_to_subject' },
          { id: `${prefix}out`, part: 'receivers', direction: 'received_from_subject' },
        ]
  const partners: Partner[] = []
  let leftOut = 0
  let truncated = false
  for (const { id, part, direction } of directions) {
    const member = members.get(id)
    if (!answered(member)) {
      notRead.push(notReadOf(part, id, member))
      continue
    }
    const read = partnersOf(member, direction, dictionary, exchangeRows)
    partners.push(...read.partners)
    leftOut += read.leftOut
    truncated ||= read.truncated
  }

  const exchangeEnds: ExchangeEnd[] = partners
    .filter((partner) => partner.exchange !== null)
    .map((partner) => ({
      address: partner.address,
      direction: partner.direction,
      exchange: partner.exchange!.exchange,
      exchange_role: partner.exchange!.exchange_role,
      tokens_worth_usd: numberOrNull(partner.row.tokens_worth_usd),
      first_seen_utc: utcOrNull(partner.row.first_seen_timestamp),
      last_seen_utc: utcOrNull(partner.row.last_seen_timestamp),
    }))

  const result: AmlAddressRiskResult = {
    ...base,
    found: true,
    kind,
    identity: identityWord ? { word: identityWord, name: identityName } : null,
    roles: strings(nodeRow.address_roles),
    behaviour: textOrNull(nodeRow.behaviour),
    ...cardClassOf(nodeRow, readsNextWords(nodeRow, dictionary)),
    risk: { ...risk, card_version: textOrNull(nodeRow.card_version) },
    model: { level: risk.model_word, score: risk.score, scored: risk.model_word !== 'not_scored' },
    exposure: {
      floor_usd: EXPOSURE_FLOOR_USD,
      hub: hub !== null,
      degree_total: degree,
      counterparties_read: partners.length,
      left_out: leftOut,
      truncated,
      with_risk: partners
        .filter((partner) => wordRank(partner.risk.word) >= MEDIUM_RANK)
        .map(riskyPartnerOf),
      pattern_partners: partners.filter(
        (partner) =>
          wordRank(partner.risk.word) < MEDIUM_RANK &&
          partner.risk.reasons.some((reason) => reason.question === 'judgement')
      ).length,
    },
    exchange_ends: exchangeEnds,
    not_read: notRead,
  }
  const exposed = exposedOf(nodeRow.exposed, wordsFor(nodeRow, dictionary))
  if (exposed.length > 0) result.exposed = exposed
  if (options.surroundings === true) {
    result.surroundings = surroundingsOf(
      {
        address,
        role: 'subject',
        kind,
        name: identityName,
        risk_word: risk.word,
        model_level: risk.model_word,
      },
      partners,
      truncated
    )
  }
  return { result }
}

function errorResult(text: string): AmlAddressRiskToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: AmlAddressRiskResult): AmlAddressRiskToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** aml_address_risk, {network, address, surroundings?}. Every argument is checked before a read is sent. */
export async function handleAmlAddressRisk(
  args: unknown,
  deps: AddressRiskDependencies
): Promise<AmlAddressRiskToolResult> {
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
        'A name or a ticker is not an address: call meta_token_lookup or meta_exchange_lookup first.'
    )
  }
  if (record.surroundings !== undefined && typeof record.surroundings !== 'boolean') {
    return errorResult('invalid_surroundings: surroundings is true or false.')
  }
  const address = raw.toLowerCase()
  const surroundings = record.surroundings === true

  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    return errorResult(
      `No address risk read was sent: ${unavailable} There is no answer yet, which is not "no risk": try again later.`
    )
  }

  let dictionary: CardDictionaries
  try {
    dictionary = await cardDictionariesOf(deps.loadAddressCard, deps.loadAddressCardNext)
  } catch (err) {
    return errorResult(
      `No address risk read was sent: the address card dictionary did not load (${(err as Error).message}). ` +
        'There is no answer yet, which is not "no risk".'
    )
  }

  let exchangeRows: ExchangeEntry[] = []
  try {
    exchangeRows = (await deps.loadExchangeRegistry(network)).document.rows
  } catch {
    // The lookup only names an exchange; the graph read still answers.
  }

  // Call 1: the node alone (about 50 ms). It says whether the address exists and whether it is a hub.
  const read = async (queries: Array<{ id: string; query: string }>) => {
    let answer: GraphAnswer
    try {
      answer = await deps.graphQueryBatch({ network, queries })
    } catch (err) {
      return { failure: `${deps.describeFailure(err)} This is not "no risk": send the same call again once.` }
    }
    const members = membersOf(answer)
    if (members.size === 0) {
      const text = answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
      return { failure: `${text} This is not "no risk".` }
    }
    return { members }
  }
  const [nodeQuery, ...partnerQueries] = addressRiskQueries(address)
  const first = await read([nodeQuery!])
  if ('failure' in first) return errorResult(`The address risk read failed: ${first.failure}`)
  const members = first.members
  const nodeRow = memberRows(members.get('node'))[0]
  // Call 2: the partner reads, unless the address is not found or is a hub.
  if (nodeRow && hubOf(address, nodeRow) === null) {
    const second = await read(partnerQueries)
    if ('failure' in second) {
      for (const { id } of partnerQueries) members.set(id, { id, ok: false, error: second.failure })
    } else {
      for (const [id, member] of second.members) members.set(id, member)
    }
  }
  const built = addressRiskFromMembers(network, address, members, dictionary, exchangeRows, '', {
    surroundings,
    hubGuard: true,
  })
  if ('failure' in built) {
    return errorResult(
      `The address risk read failed: ${built.failure} This is not "no risk": send the same call again once.`
    )
  }
  return textResult(built.result)
}
