/**
 * aml_token_risk: what about this token, or this pool?
 *
 * A local tool of the proxy, built on the address answer of aml_address_risk.
 * At most three graph_query_batch calls, one after another, each of at most 20
 * reads, all on USE topology:
 *
 *   1  the subject: its node (card, model, token facts, pool sums), its money
 *      senders and receivers, its deployment, and, for a pool, its adders,
 *      removers and assets;
 *   2  a token: its providers (two whole-chain reads by asset, first in the
 *      batch, which give its pools, their providers and their adders and
 *      removers at once), its founder (the full address answer), its factory
 *      and the founder's gas wallets. A pool: its tokens and its deployer;
 *   3  a token: the node and the deployment of each of the 10 biggest pools
 *      that has its own address. A pool manager is one row and is not read.
 *
 * The founder is the wallet that sent the deployment (`tx_origin`), never the
 * factory contract every launchpad token shares. The token's word is the
 * highest of the token's own, the founder's and each detailed pool's own; a
 * pool manager, a factory, a gas wallet, an adder and a remover carry their
 * own word or none and never raise it. A part that was not read is named in not_read and never shown as
 * "none found".
 *
 * The tool states, the host judges: no hint, no summary, no verdict. The only
 * prose is each reason's fixed plain sentence from the card dictionary.
 */

import type { AddressCardWord, LoadedAddressCard } from './address-card.js'
import {
  ADDRESS_INPUT,
  SURROUNDINGS_NODE_LIMIT,
  addressNodeQuery,
  addressPartnerQuery,
  addressRiskFromMembers,
  type AddressKind,
  type AddressRisk,
  type AmlAddressRiskResult,
  type ExchangeEnd,
  type Exposure,
  type ModelScore,
  type SurroundingsLink,
  type SurroundingsNode,
} from './address-risk.js'
import {
  DexRegistryError,
  dexManagerOf,
  dexOfAddress,
  normalizeDexNetwork,
  type DexEntry,
  type LoadedRegistry,
} from './dex-registry.js'
import type { ExchangeEntry, LoadedExchangeRegistry } from './exchange-registry.js'
import {
  POOLS_DETAILED,
  POOL_NODE_COLUMNS,
  PROVIDERS_READ_LIMIT,
  deploymentQuery,
  gasWalletsQuery,
  partyOf,
  poolAssetsQuery,
  poolFactsOf,
  poolListingsOf,
  poolPartiesOf,
  poolPartiesQuery,
  timeText,
  tokenProvidersQuery,
  type Party,
  type PoolFacts,
  type PoolListing,
} from './pool-risk.js'
import { riskWordRank, type RiskWord, type SetBy } from './risk-word.js'
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

export const AML_TOKEN_RISK_TOOL = 'aml_token_risk' as const
export const AML_TOKEN_RISK_SCHEMA = 'chain-insights.aml-token-risk.v1' as const
export const AML_TOKEN_RISK_TITLE = 'Token risk'

export const TOKEN_RISK_READING_RULE =
  'The tool states facts and measures; you write the judgement: say which reasons and whose word you rely on, ' +
  'say when a word comes from the model alone (set_by model) that it is a prediction, never call a token or a pool safe, ' +
  'and name a part listed in not_read as not read, never as none found.'

export const AML_TOKEN_RISK_DESCRIPTION =
  'Answers what is known about one token contract or one pool: the token and how it was deployed, its founder (the wallet that sent the deployment, with its own risk answer and money partners), ' +
  'the factory or launchpad that deployed it (such as Virtuals), the first accounts that paid the founder (gas wallets), and its pools with their liquidity, their 5 biggest adders and removers. ' +
  'A wallet is no token: ask aml_address_risk about a wallet. A ticker is no address: call meta_token_lookup first. ' +
  'risk.word is the highest of the token own word, its founder word and each detailed pool own word, and raised_by says whose (raised_by_address names it); risk.own is the token own risk block. ' +
  'A factory or launchpad, a first funder and a liquidity provider never raise the word: each carries its own beside it. ' +
  'Every word is the higher of what labels prove and what the risk model predicts; unscored is not low and not safe. ' +
  'A pool row is one address: the pools inside one pool manager (such as Uniswap v4) are answered as one row for the manager (is_manager true), with its providers and this token side, not pool by pool; a manager row carries no word and never raises it. ' +
  'pools_found counts the pool addresses read; only the 10 biggest are detailed (detail true), pools_truncated says when more exist, and providers_truncated when the providers read was full. ' +
  'A part listed in not_read was not read: it is never "none found". ' +
  `${TOKEN_RISK_READING_RULE} ` +
  'USD figures are tokens worth at day prices; null is unpriced, never 0. Write every address in full, all 42 characters. ' +
  'Pass surroundings: true for the nodes and links behind the answer, to draw.'

export const AML_TOKEN_RISK_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const AML_TOKEN_RISK_ARGS = ['network', 'address', 'surroundings'] as const

/** The most batches one answer sends, and the most reads in one batch. */
export const BATCH_LIMIT = 3
export const BATCH_MEMBER_LIMIT = 20

/** A token's node read adds its facts and, for a pool, its sums. */
const SUBJECT_COLUMNS = [
  'a.token_standard AS token_standard',
  'a.contract_creation_timestamp AS contract_creation_timestamp',
  ...POOL_NODE_COLUMNS,
]

export type AskedAs = 'token' | 'pool' | 'address'
export type RaisedBy = 'token' | 'founder' | 'pool'

export interface TokenRisk {
  word: RiskWord
  /** Who set the word of the party that raised it: rules, model, both; none when unscored. */
  set_by: SetBy
  /** The subject's own model score, or null. */
  score: number | null
  raised_by: RaisedBy | null
  raised_by_address: string | null
  /** The subject's own risk block. */
  own: AddressRisk
}

export interface TokenNotRead {
  part: string
  code: string
  reason: string
  /** A part of one pool: the pool address. */
  pool?: string
}

export type FounderParty = Party & { exposure: Exposure | null; exchange_ends: ExchangeEnd[] }
export type FactoryParty = Party & { name: string | null }

export interface TokenSurroundingsNode extends Omit<SurroundingsNode, 'role'> {
  role:
    | 'subject'
    | 'founder'
    | 'factory'
    | 'deployer'
    | 'gas_wallet'
    | 'pool'
    | 'adder'
    | 'remover'
    | 'partner'
    | 'exchange_end'
}

export interface TokenSurroundingsLink extends Omit<SurroundingsLink, 'link'> {
  link: 'FLOWED_TO' | 'DEPLOYED_CONTRACT' | 'ADDED_LIQUIDITY' | 'REMOVED_LIQUIDITY'
}

export interface AmlTokenRiskResult {
  schema: typeof AML_TOKEN_RISK_SCHEMA
  tool: typeof AML_TOKEN_RISK_TOOL
  network: string
  address: string
  asked_as: AskedAs
  found: boolean
  token: {
    address: string
    standard: string | null
    created_utc: string | null
    identity: { word: string; name: string | null } | null
  } | null
  risk: TokenRisk
  model: ModelScore
  founder: FounderParty | null
  factory: FactoryParty | null
  deployment: { tx_id: string | null; created_utc: string | null; kind: string | null } | null
  gas_wallets: Party[]
  pools: PoolFacts[]
  /** Every pool address read; null when the providers read did not answer. */
  pools_found: number | null
  pools_truncated: boolean
  /** True when a providers read came back full: more providers, and maybe more pools, exist. */
  providers_truncated: boolean
  /** A pool answer: the tokens of the pool. */
  pool_tokens: Party[]
  /** A pool answer: the wallet that deployed the pool. */
  deployer: Party | null
  exposure: Exposure | null
  exchange_ends: ExchangeEnd[]
  not_read: TokenNotRead[]
  surroundings?: {
    nodes: TokenSurroundingsNode[]
    links: TokenSurroundingsLink[]
    truncated: boolean
  }
}

export interface TokenRiskDependencies {
  loadAddressCard: () => Promise<LoadedAddressCard | null>
  loadExchangeRegistry: (network: string) => Promise<LoadedExchangeRegistry>
  /** The exchange registry: it names a factory. */
  loadDexRegistry: (network: string) => Promise<LoadedRegistry>
  graphQueryBatch: (args: {
    network: string
    queries: Array<{ id: string; query: string }>
  }) => Promise<GraphAnswer>
  unavailable?: () => Promise<string | undefined> | string | undefined
  describeFailure: (err: unknown) => string
}

export type AmlTokenRiskToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

/** What the node labels make of the subject: a launchpad pair carries Token and Pool, and Pool wins. */
export function askedAsOf(nodeLabels: readonly string[]): AskedAs {
  if (nodeLabels.includes('Pool')) return 'pool'
  if (nodeLabels.includes('Token')) return 'token'
  return 'address'
}

/** The deployment of a contract: its founder (tx_origin, else the deployer) and its factory. */
export interface Deployment {
  deployer: string | null
  /** The factory the deployment names, whoever sent it. */
  factory_address: string | null
  founder: string | null
  factory: string | null
  tx_id: string | null
  kind: string | null
  created_utc: string | null
}

export function deploymentOf(row: Record<string, unknown> | undefined): Deployment | null {
  if (!row) return null
  const deployer = addressOrNull(row.deployer)
  const founder = addressOrNull(row.tx_origin) ?? deployer
  const kind = textOrNull(row.kind)
  const factoryAddress = addressOrNull(row.factory_address)
  const factory =
    kind?.toLowerCase() === 'factory' && factoryAddress !== null && factoryAddress !== founder
      ? factoryAddress
      : null
  return {
    deployer,
    factory_address: factoryAddress,
    founder,
    factory,
    tx_id: textOrNull(row.tx_id),
    kind,
    created_utc: timeText(row.block_timestamp),
  }
}

/** The word of an answer: the highest of the candidates, the first on a tie; unscored when none speaks. */
export type Candidate = { by: RaisedBy; address: string; risk: AddressRisk }

export function raisedWordOf(own: AddressRisk, candidates: Candidate[]): TokenRisk {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.risk.word === 'unscored') continue
    if (!best || riskWordRank(candidate.risk.word) > riskWordRank(best.risk.word)) best = candidate
  }
  return {
    word: best?.risk.word ?? 'unscored',
    set_by: best?.risk.set_by ?? 'none',
    score: own.score,
    raised_by: best?.by ?? null,
    raised_by_address: best?.address ?? null,
    own,
  }
}

type Batch = Array<{ id: string; query: string }>

/** Sends one batch; a call that throws or holds no reads answers every read as not read, with why. */
async function sendBatch(
  deps: TokenRiskDependencies,
  network: string,
  queries: Batch
): Promise<Map<string, Member>> {
  let answer: GraphAnswer
  try {
    answer = await deps.graphQueryBatch({ network, queries })
  } catch (err) {
    return failedMembers(queries, deps.describeFailure(err))
  }
  const members = membersOf(answer)
  if (members.size > 0) return members
  const text = answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
  return failedMembers(queries, text)
}

function failedMembers(queries: Batch, error: string): Map<string, Member> {
  return new Map(queries.map(({ id }) => [id, { id, ok: false, error }]))
}

const poolId = (index: number, part: 'node' | 'deployment') => `pool${index}_${part}`

function errorResult(text: string): AmlTokenRiskToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: AmlTokenRiskResult): AmlTokenRiskToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** The answer's not-read entry of one member, or null when it answered. */
function notReadOf(
  part: string,
  id: string,
  members: Map<string, Member>,
  pool?: string
): TokenNotRead | null {
  const member = members.get(id)
  if (memberAnswered(member)) return null
  return { part, ...memberRefusal(id, member), ...(pool ? { pool } : {}) }
}

/** The founder party from its full address answer. */
function founderOf(address: string, answer: AmlAddressRiskResult): FounderParty {
  return {
    role: 'founder',
    address,
    risk: answer.risk,
    kind: answer.kind,
    identity: answer.identity,
    exposure: answer.exposure,
    exchange_ends: answer.exchange_ends,
  }
}

/** aml_token_risk, {network, address, surroundings?}. Every argument is checked before a read is sent. */
export async function handleAmlTokenRisk(
  args: unknown,
  deps: TokenRiskDependencies
): Promise<AmlTokenRiskToolResult> {
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
      'invalid_address: address is required: the token contract or the pool, 0x plus 40 hex characters. ' +
        'A ticker or a name is not an address: call meta_token_lookup first.'
    )
  }
  if (record.surroundings !== undefined && typeof record.surroundings !== 'boolean') {
    return errorResult('invalid_surroundings: surroundings is true or false.')
  }
  const address = raw.toLowerCase()
  const drawing = record.surroundings === true

  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    return errorResult(
      `No token risk read was sent: ${unavailable} There is no answer yet, which is not "no risk": try again later.`
    )
  }

  let dictionary: readonly AddressCardWord[]
  try {
    const card = await deps.loadAddressCard()
    if (!card) throw new Error('no copy of the address card dictionary is available')
    dictionary = card.document.words
  } catch (err) {
    return errorResult(
      `No token risk read was sent: the address card dictionary did not load (${(err as Error).message}). ` +
        'There is no answer yet, which is not "no risk".'
    )
  }
  let exchangeRows: ExchangeEntry[] = []
  try {
    exchangeRows = (await deps.loadExchangeRegistry(network)).document.rows
  } catch {
    // The lookup only names an exchange wallet; the graph reads still answer.
  }
  let dexRows: DexEntry[] = []
  try {
    dexRows = (await deps.loadDexRegistry(network)).document.rows
  } catch {
    // The registry only names a factory.
  }

  // Batch 1: the subject, its money partners, its deployment, and its pool parts.
  const first: Batch = [
    { id: 'node', query: addressNodeQuery(address, SUBJECT_COLUMNS) },
    { id: 'in', query: addressPartnerQuery(address, 'in') },
    { id: 'out', query: addressPartnerQuery(address, 'out') },
    { id: 'deployment', query: deploymentQuery(address) },
    { id: 'adders', query: poolPartiesQuery(address, 'adders') },
    { id: 'removers', query: poolPartiesQuery(address, 'removers') },
    { id: 'assets', query: poolAssetsQuery(address) },
  ]
  let answer: GraphAnswer
  try {
    answer = await deps.graphQueryBatch({ network, queries: first })
  } catch (err) {
    return errorResult(
      `The token risk read failed: ${deps.describeFailure(err)} This is not "no risk": send the same call again once.`
    )
  }
  const members1 = membersOf(answer)
  if (members1.size === 0) {
    const text = answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
    return errorResult(`The token risk read failed: ${text} This is not "no risk".`)
  }
  const subjectBuilt = addressRiskFromMembers(network, address, members1, dictionary, exchangeRows, '', {
    surroundings: drawing,
  })
  if ('failure' in subjectBuilt) {
    return errorResult(
      `The token risk read failed: ${subjectBuilt.failure} This is not "no risk": send the same call again once.`
    )
  }
  const subject = subjectBuilt.result
  const nodeRow = memberRows(members1.get('node'))[0]
  const askedAs: AskedAs = nodeRow ? askedAsOf(strings(nodeRow.node_labels)) : 'address'
  const notRead: TokenNotRead[] = subject.not_read.map((entry) => ({ ...entry }))

  const base: AmlTokenRiskResult = {
    schema: AML_TOKEN_RISK_SCHEMA,
    tool: AML_TOKEN_RISK_TOOL,
    network,
    address,
    asked_as: askedAs,
    found: subject.found,
    token: null,
    // A wallet or an address not found: its own word, raised by nobody else.
    risk: { ...raisedWordOf(subject.risk, []), word: subject.risk.word, set_by: subject.risk.set_by },
    model: subject.model,
    founder: null,
    factory: null,
    deployment: null,
    gas_wallets: [],
    pools: [],
    pools_found: null,
    pools_truncated: false,
    providers_truncated: false,
    pool_tokens: [],
    deployer: null,
    exposure: null,
    exchange_ends: [],
    not_read: [],
  }
  if (askedAs === 'address') {
    // A wallet belongs to aml_address_risk: its own word, and nothing else read here.
    return textResult(base)
  }

  const deployment = deploymentOf(memberRows(members1.get('deployment'))[0])
  const deploymentMissing = notReadOf('deployment', 'deployment', members1)
  if (deploymentMissing) notRead.push(deploymentMissing)

  const result: AmlTokenRiskResult = {
    ...base,
    exposure: subject.exposure,
    exchange_ends: subject.exchange_ends,
    deployment: deployment
      ? { tx_id: deployment.tx_id, created_utc: deployment.created_utc, kind: deployment.kind }
      : null,
  }
  const graph = new SurroundingsBuilder(drawing ? subject : null)

  if (askedAs === 'pool') {
    await answerPool({ deps, network, address, members1, dictionary, dexRows, deployment, notRead, result, graph, subject })
  } else {
    await answerToken({
      deps,
      network,
      address,
      dictionary,
      exchangeRows,
      dexRows,
      deployment,
      notRead,
      result,
      graph,
      subject,
      nodeRow: nodeRow!,
    })
  }
  result.not_read = notRead
  if (drawing) result.surroundings = graph.build()
  return textResult(result)
}

interface Step {
  deps: TokenRiskDependencies
  network: string
  address: string
  dictionary: readonly AddressCardWord[]
  dexRows: DexEntry[]
  deployment: Deployment | null
  notRead: TokenNotRead[]
  result: AmlTokenRiskResult
  graph: SurroundingsBuilder
  subject: AmlAddressRiskResult
}

/** The exchange of a pool address: the manager's exchange, else its deployer's or factory's, else null. */
function exchangeOf(pool: string, deployment: Deployment | null, dexRows: readonly DexEntry[]): string | null {
  const by = [pool, deployment?.deployer ?? null, deployment?.factory_address ?? null]
  const manager = dexManagerOf(pool, dexRows)
  if (manager) return manager.display
  for (const address of by) {
    if (address === null) continue
    const row = dexOfAddress(address, dexRows)
    if (row) return row.display
  }
  return null
}

/** A pool: its own word, its sums and parties from batch 1, its tokens and deployer from batch 2. */
async function answerPool(step: Step & { members1: Map<string, Member> }): Promise<void> {
  const { deps, network, address, members1, dictionary, dexRows, deployment, notRead, result, graph, subject } = step
  const adders = poolPartiesOf('adder', memberRows(members1.get('adders')), dictionary)
  const removers = poolPartiesOf('remover', memberRows(members1.get('removers')), dictionary)
  for (const [part, id] of [
    ['adders', 'adders'],
    ['removers', 'removers'],
    ['tokens', 'assets'],
  ] as const) {
    const missing = notReadOf(part, id, members1)
    if (missing) notRead.push(missing)
  }
  const isManager = dexManagerOf(address, dexRows) !== null
  const nodeRow = memberRows(members1.get('node'))[0] ?? null
  const facts = poolFactsOf({
    pool: address,
    exchange: exchangeOf(address, deployment, dexRows),
    isManager,
    detail: true,
    providers: numberOrNull(nodeRow?.provider_count),
    tokenSide: null,
    node: nodeRow,
    adders,
    removers,
    dictionary,
  })
  result.pools = [facts]
  result.pools_found = 1
  // A pool answers with its own word; a pool manager's word raises nothing.
  result.risk = isManager
    ? { ...raisedWordOf(subject.risk, []), word: subject.risk.word, set_by: subject.risk.set_by }
    : raisedWordOf(subject.risk, [{ by: 'pool', address, risk: subject.risk }])

  const tokens = strings(memberRows(members1.get('assets'))[0]?.assets)
    .map((asset) => addressOrNull(asset))
    .filter((asset): asset is string => asset !== null && asset !== address)
    .slice(0, 2)
  const deployerAddress = deployment?.founder ?? null
  const second: Batch = [
    ...tokens.map((token, index) => ({ id: `token${index}_node`, query: addressNodeQuery(token) })),
    ...(deployerAddress ? [{ id: 'deployer_node', query: addressNodeQuery(deployerAddress) }] : []),
  ]
  if (second.length > 0) {
    const members2 = await sendBatch(deps, network, second)
    tokens.forEach((token, index) => {
      const id = `token${index}_node`
      const missing = notReadOf('token', id, members2)
      if (missing) notRead.push(missing)
      else result.pool_tokens.push(partyOf('token', token, memberRows(members2.get(id))[0], dictionary))
    })
    if (deployerAddress) {
      const missing = notReadOf('deployer', 'deployer_node', members2)
      if (missing) notRead.push(missing)
      else
        result.deployer = partyOf('deployer', deployerAddress, memberRows(members2.get('deployer_node'))[0], dictionary)
    }
  }
  if (result.deployer && deployment?.deployer) graph.deployed(deployment.deployer, address, deployment.created_utc)
  if (result.deployer) graph.party(result.deployer, 'deployer')
  graph.pool(facts)
}

/** A token: its pools, founder, factory and gas wallets in batch 2; the biggest pools in batches 3 and 4. */
async function answerToken(
  step: Step & {
    exchangeRows: ExchangeEntry[]
    nodeRow: Record<string, unknown>
  }
): Promise<void> {
  const { deps, network, address, dictionary, exchangeRows, dexRows, deployment, notRead, result, graph, subject, nodeRow } =
    step
  result.token = {
    address,
    standard: textOrNull(nodeRow.token_standard),
    created_utc: timeText(nodeRow.contract_creation_timestamp) ?? deployment?.created_utc ?? null,
    identity: subject.identity,
  }
  const founder = deployment?.founder ?? null
  const factory = deployment?.factory ?? null
  // The two whole-chain providers reads go first: each answers or is refused on its own.
  const second: Batch = [
    { id: 'providers_added', query: tokenProvidersQuery(address, 'added') },
    { id: 'providers_removed', query: tokenProvidersQuery(address, 'removed') },
    ...(founder
      ? [
          { id: 'founder_node', query: addressNodeQuery(founder) },
          { id: 'founder_in', query: addressPartnerQuery(founder, 'in') },
          { id: 'founder_out', query: addressPartnerQuery(founder, 'out') },
          { id: 'gas_wallets', query: gasWalletsQuery(founder) },
        ]
      : []),
    ...(factory ? [{ id: 'factory_node', query: addressNodeQuery(factory) }] : []),
  ]
  const members2 = await sendBatch(deps, network, second)

  // The founder: the full address answer, with its money partners.
  if (founder) {
    const built = addressRiskFromMembers(network, founder, members2, dictionary, exchangeRows, 'founder_')
    if ('failure' in built) {
      notRead.push({ part: 'founder', ...memberRefusal('founder_node', members2.get('founder_node')) })
    } else {
      result.founder = founderOf(founder, built.result)
      for (const entry of built.result.not_read) {
        notRead.push({ ...entry, part: entry.part === 'senders' ? 'founder_senders' : 'founder_receivers' })
      }
    }
    const gasMissing = notReadOf('gas_wallets', 'gas_wallets', members2)
    if (gasMissing) notRead.push(gasMissing)
    for (const row of memberRows(members2.get('gas_wallets'))) {
      const wallet = addressOrNull(row.address)
      if (!wallet) continue
      result.gas_wallets.push(
        partyOf('gas_wallet', wallet, row, dictionary, {
          tokens_worth_usd: numberOrNull(row.tokens_worth_usd),
          first_seen_utc: utcOrNull(row.first_seen_timestamp),
        })
      )
    }
  }
  if (factory) {
    const missing = notReadOf('factory', 'factory_node', members2)
    if (missing) notRead.push(missing)
    else
      result.factory = {
        ...partyOf('factory', factory, memberRows(members2.get('factory_node'))[0], dictionary),
        name: dexOfAddress(factory, dexRows)?.display ?? null,
      }
  }

  // The pools: every pool address of the two providers reads, the biggest detailed.
  const addedMissing = notReadOf('pools', 'providers_added', members2)
  let listings: PoolListing[] = []
  if (addedMissing) {
    notRead.push(addedMissing)
  } else {
    const removedMissing = notReadOf('pool_removals', 'providers_removed', members2)
    if (removedMissing) notRead.push(removedMissing)
    const added = memberRows(members2.get('providers_added'))
    const removed = removedMissing ? null : memberRows(members2.get('providers_removed'))
    for (const [part, rows] of [
      ['pool_providers', added],
      ['pool_removals', removed],
    ] as const) {
      if (rows && rows.length >= PROVIDERS_READ_LIMIT) {
        result.providers_truncated = true
        notRead.push({
          part,
          code: 'truncated',
          reason: `the read came back full at ${PROVIDERS_READ_LIMIT} rows: more providers, and maybe more pools, exist`,
        })
      }
    }
    listings = poolListingsOf(added, removed)
    result.pools_found = listings.length
    result.pools_truncated = listings.length > POOLS_DETAILED
  }
  const managerOf = (pool: string) => dexManagerOf(pool, dexRows)
  const detailed = listings.slice(0, POOLS_DETAILED)
  const poolQueries: Batch = []
  detailed.forEach((listing, index) => {
    if (managerOf(listing.pool)) return
    poolQueries.push({ id: poolId(index, 'node'), query: addressNodeQuery(listing.pool, POOL_NODE_COLUMNS) })
    poolQueries.push({ id: poolId(index, 'deployment'), query: deploymentQuery(listing.pool) })
  })
  const poolMembers = poolQueries.length > 0 ? await sendBatch(deps, network, poolQueries) : new Map<string, Member>()
  const candidates: Candidate[] = [
    { by: 'token', address, risk: subject.risk },
    ...(result.founder ? [{ by: 'founder' as const, address: result.founder.address, risk: result.founder.risk }] : []),
  ]
  listings.forEach((listing, index) => {
    const manager = managerOf(listing.pool)
    const detail = index < POOLS_DETAILED
    let node: Record<string, unknown> | null = null
    let poolDeployment: Deployment | null = null
    if (detail && !manager) {
      const missing = notReadOf('pool', poolId(index, 'node'), poolMembers, listing.pool)
      if (missing) notRead.push(missing)
      node = memberRows(poolMembers.get(poolId(index, 'node')))[0] ?? null
      poolDeployment = deploymentOf(memberRows(poolMembers.get(poolId(index, 'deployment')))[0])
    }
    const facts = poolFactsOf({
      pool: listing.pool,
      exchange: manager ? manager.display : exchangeOf(listing.pool, poolDeployment, dexRows),
      isManager: manager !== null,
      detail,
      providers: listing.providers,
      tokenSide: { added_usd: listing.added_usd, removed_usd: listing.removed_usd },
      node,
      adders: detail ? poolPartiesOf('adder', listing.adder_rows, dictionary) : [],
      removers: detail ? poolPartiesOf('remover', listing.remover_rows, dictionary) : [],
      dictionary,
    })
    result.pools.push(facts)
    if (facts.risk) candidates.push({ by: 'pool', address: facts.pool, risk: facts.risk })
  })
  result.risk = raisedWordOf(subject.risk, candidates)

  if (result.founder) graph.party(result.founder, 'founder')
  if (result.factory) graph.party(result.factory, 'factory')
  if (deployment?.deployer) graph.deployed(deployment.deployer, address, deployment.created_utc)
  for (const wallet of result.gas_wallets) {
    graph.party(wallet, 'gas_wallet')
    if (result.founder) {
      graph.link({
        from_address: wallet.address,
        to_address: result.founder.address,
        link: 'FLOWED_TO',
        tokens_worth_usd: wallet.tokens_worth_usd ?? null,
        first_seen_utc: wallet.first_seen_utc ?? null,
        last_seen_utc: null,
      })
    }
  }
  for (const facts of result.pools.filter((pool) => pool.detail)) graph.pool(facts)
}

const ROLE_ORDER: Array<TokenSurroundingsNode['role']> = [
  'subject',
  'founder',
  'factory',
  'deployer',
  'gas_wallet',
  'pool',
  'adder',
  'remover',
  'exchange_end',
  'partner',
]

/**
 * The nodes and links behind a token or pool answer, from the reads already
 * made. At most 60 nodes: partners are dropped first, then removers, then
 * adders. A link joins two listed nodes only.
 */
class SurroundingsBuilder {
  private readonly nodes = new Map<string, TokenSurroundingsNode>()
  private readonly links: TokenSurroundingsLink[] = []
  private readonly truncatedBefore: boolean

  constructor(subject: AmlAddressRiskResult | null) {
    this.truncatedBefore = subject?.surroundings?.truncated ?? false
    for (const node of subject?.surroundings?.nodes ?? []) this.nodes.set(node.address, { ...node })
    for (const link of subject?.surroundings?.links ?? []) this.links.push({ ...link })
  }

  private add(node: TokenSurroundingsNode): void {
    // One node per address, under its first role in ROLE_ORDER.
    const known = this.nodes.get(node.address)
    if (!known || ROLE_ORDER.indexOf(node.role) < ROLE_ORDER.indexOf(known.role)) {
      this.nodes.set(node.address, node)
    }
  }

  party(party: Party, role: TokenSurroundingsNode['role']): void {
    this.add({
      address: party.address,
      role,
      kind: party.kind,
      name: (party as Partial<FactoryParty>).name ?? party.identity?.name ?? null,
      risk_word: party.risk.word,
      model_level: party.risk.model_word,
    })
  }

  link(link: TokenSurroundingsLink): void {
    this.links.push(link)
  }

  deployed(deployer: string, contract: string, createdUtc: string | null): void {
    this.links.push({
      from_address: deployer,
      to_address: contract,
      link: 'DEPLOYED_CONTRACT',
      tokens_worth_usd: null,
      first_seen_utc: createdUtc,
      last_seen_utc: null,
    })
  }

  pool(facts: PoolFacts): void {
    const kind: AddressKind = facts.is_manager ? 'contract' : 'pool'
    this.add({
      address: facts.pool,
      role: 'pool',
      kind,
      name: facts.exchange,
      risk_word: facts.risk?.word ?? 'unscored',
      model_level: facts.risk?.model_word ?? 'not_scored',
    })
    for (const adder of facts.adders) {
      this.party(adder, 'adder')
      this.links.push({
        from_address: adder.address,
        to_address: facts.pool,
        link: 'ADDED_LIQUIDITY',
        tokens_worth_usd: adder.tokens_worth_usd ?? null,
        first_seen_utc: null,
        last_seen_utc: null,
      })
    }
    for (const remover of facts.removers) {
      this.party(remover, 'remover')
      this.links.push({
        from_address: facts.pool,
        to_address: remover.address,
        link: 'REMOVED_LIQUIDITY',
        tokens_worth_usd: remover.tokens_worth_usd ?? null,
        first_seen_utc: null,
        last_seen_utc: null,
      })
    }
  }

  build(): NonNullable<AmlTokenRiskResult['surroundings']> {
    const all = [...this.nodes.values()]
    const rank = (node: TokenSurroundingsNode) => ROLE_ORDER.indexOf(node.role)
    const kept = [...all]
      .map((node, at) => ({ node, at }))
      .sort((a, b) => rank(a.node) - rank(b.node) || a.at - b.at)
      .slice(0, SURROUNDINGS_NODE_LIMIT)
      .sort((a, b) => a.at - b.at)
      .map(({ node }) => node)
    const listed = new Set(kept.map((node) => node.address))
    const seen = new Set<string>()
    const links = this.links.filter((link) => {
      if (!listed.has(link.from_address) || !listed.has(link.to_address)) return false
      const key = `${link.link}|${link.from_address}|${link.to_address}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { nodes: kept, links, truncated: this.truncatedBefore || kept.length < all.length }
  }
}
