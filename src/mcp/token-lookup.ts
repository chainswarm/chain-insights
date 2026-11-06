/**
 * meta_token_lookup: a ticker or a token name becomes its contracts.
 *
 * A local tool of the proxy. It sends one anchored facts read of the Asset
 * lookup by symbol, the same read by name when the symbol answers nothing, and
 * then the creator and the factory of each candidate from topology, one batch
 * member per candidate. Nothing is matched here: the graph server matches the
 * symbol or the name, case-insensitively and exactly, and orders the rows
 * verified first, then oldest first. The proxy keeps that order.
 *
 * Tickers collide on purpose: clones reuse a symbol to borrow its trust. The
 * tool never picks one. The description below is the contract with every
 * host, Claude Desktop chat included, which reads no skill.
 */

import { ANSWER_HINT } from './answer-hint.js'
import { DexRegistryError, normalizeDexNetwork } from './dex-registry.js'
import { isEpochMs, utcText } from './timestamp-text.js'

export const META_TOKEN_LOOKUP_TOOL = 'meta_token_lookup'
export const META_TOKEN_LOOKUP_SCHEMA = 'chain-insights.meta-token-lookup.v1' as const
export const META_TOKEN_LOOKUP_TITLE = 'Token by ticker or name'
export const META_TOKEN_LOOKUP_DESCRIPTION =
  'Call this first when a question names a token by its ticker or name and gives no contract ' +
  '(TCITY, USDG, SPCX). It returns every contract on the network that carries that symbol, ' +
  'verified first, then oldest first. Tickers collide: never treat the first row as the token. ' +
  'When several match, name them and ask, or pick by the evidence the user gave. Zero candidates ' +
  'means no contract carries the symbol: say so, and do not search the web.'
export const META_TOKEN_LOOKUP_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const META_TOKEN_LOOKUP_ARGS = ['network', 'symbol'] as const

/** The candidates returned. The read asks for one more, so a full page says there are more. */
export const CANDIDATES_MAX = 25
export const ROWS_READ = CANDIDATES_MAX + 1
/** The graph server admits at most 20 members in one graph_query_batch. */
export const CREATOR_BATCH_MAX = 20
export const SYMBOL_MAX = 64

export const ADDRESS_INPUT_HINT = 'an address is already an anchor: read it on USE topology'

export interface TokenCandidate {
  contract: string
  symbol: string | null
  name: string | null
  token_standard: string | null
  decimals: number | null
  verified: boolean
  verification_source: string | null
  first_seen_timestamp: number | null
  first_seen_timestamp_utc: string | null
  creator: string | null
  factory: string | null
}

export interface MetaTokenLookupResult {
  schema: typeof META_TOKEN_LOOKUP_SCHEMA
  network: string
  query: string
  matched_on: 'symbol' | 'name' | null
  candidates: TokenCandidate[]
  /** The rows the server sent, at most 26: 26 means there are more than the 25 returned. */
  total: number
  truncated: boolean
  hint: string
}

/** One graph_query or graph_query_batch reply as the remote client returns it. */
export type GraphAnswer = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
}

export interface TokenToolDependencies {
  /** One graph_query through the proxy's remote client, billed as any read. */
  graphQuery: (args: { network: string; query: string }) => Promise<GraphAnswer>
  /** One graph_query_batch through the proxy's remote client, billed as any read. */
  graphQueryBatch: (args: {
    network: string
    queries: Array<{ id: string; query: string }>
  }) => Promise<GraphAnswer>
  /** The reason no read can be sent now, or undefined when the graph is reachable. */
  unavailable?: () => Promise<string | undefined> | string | undefined
  /** The text of a call that threw: payment required, transport. */
  describeFailure: (err: unknown) => string
}

export type MetaTokenLookupToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

const ADDRESS_FORM = /^0x[0-9a-fA-F]{40}$/
const CONTRACT_FORM = /^0x[0-9a-f]{40}$/
// A string literal of the read holds no double quote, no backslash and no
// control character: the symbol is refused rather than escaped, so the read the
// server receives is always the read written here.
function unsafeLiteral(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (char === '"' || char === '\\' || code < 0x20 || code === 0x7f) return true
  }
  return false
}
const CODE_PREFIX = /^([a-z][a-z0-9_]*):\s*/
// Codes of a read that was stopped, not refused: the same read may answer later.
const TRANSIENT_CODE =
  /(timeout|memory_limit|cpu_limit|busy|_failed$|rate_limited|unavailable|too_large|node_error)/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function errorResult(text: string): MetaTokenLookupToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: MetaTokenLookupResult): MetaTokenLookupToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** The facts Asset read by symbol or by name, in the one shape the graph server admits. */
export function assetQuery(key: 'symbol' | 'name', value: string): string {
  return (
    `USE facts MATCH (t:Asset {${key}: "${value}"}) ` +
    'RETURN t.asset_contract AS contract, t.asset_symbol AS symbol, t.name AS name, ' +
    't.token_standard AS token_standard, t.decimals AS decimals, t.verified AS verified, ' +
    't.verification_source AS verification_source, t.first_seen_timestamp AS first_seen_timestamp ' +
    `LIMIT ${ROWS_READ}`
  )
}

/** The topology read of who deployed one contract: the deploying address and the transaction's sender. */
export function creatorQuery(contract: string): string {
  return (
    `USE topology MATCH (f:Address)-[d:DEPLOYED_CONTRACT]->(t:Address {address: "${contract}"}) ` +
    'RETURN f.address AS factory, d.tx_origin AS creator LIMIT 1'
  )
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

const addressOrNull = (value: unknown): string | null =>
  typeof value === 'string' && ADDRESS_FORM.test(value.trim()) ? value.trim().toLowerCase() : null

function verifiedOf(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') return ['true', '1'].includes(value.trim().toLowerCase())
  return false
}

function answerText(answer: GraphAnswer): string {
  return (Array.isArray(answer.content) ? answer.content : [])
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export type Refusal = { code: string; text: string; transient: boolean }

/** A graph_query answer that did not answer: its code, its text, and whether the same read may answer later. */
export function refusalOf(answer: GraphAnswer): Refusal {
  const text = answerText(answer)
  const detail = isRecord(answer.structuredContent)
    ? answer.structuredContent.error_detail
    : undefined
  const detailCode = isRecord(detail) && typeof detail.code === 'string' ? detail.code : ''
  const detailClass = isRecord(detail) && typeof detail.class === 'string' ? detail.class : ''
  const named = detailCode || CODE_PREFIX.exec(text)?.[1] || ''
  // A refusal that names no class is a stop only when its code says so; a
  // refusal in plain words ("unknown label Asset") is a server that lacks the read.
  const transient = detailClass ? detailClass !== 'refused' : TRANSIENT_CODE.test(named)
  const code = named || 'not_served'
  return { code, text: text || `${code}: the graph endpoint refused the read`, transient }
}

/** The result rows of a graph_query answer, or null when it holds none. */
function rowsOf(answer: GraphAnswer): Array<Record<string, unknown>> | null {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const query = isRecord(facts) ? facts.query : undefined
  const results = isRecord(query) ? query.results : undefined
  return Array.isArray(results) ? results.filter(isRecord) : null
}

export type Member = { id?: unknown; ok?: unknown; results?: unknown; error?: unknown }

/** The members of a graph_query_batch answer by id. */
export function membersOf(answer: GraphAnswer): Map<string, Member> {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const queries = isRecord(facts) ? facts.queries : undefined
  const members = new Map<string, Member>()
  if (Array.isArray(queries)) {
    for (const member of queries)
      if (isRecord(member) && typeof member.id === 'string') members.set(member.id, member)
  }
  return members
}

function candidateOf(row: Record<string, unknown>): TokenCandidate | null {
  const contract = textOrNull(row.contract)?.trim().toLowerCase()
  if (!contract) return null
  const firstSeen = numberOrNull(row.first_seen_timestamp)
  return {
    contract,
    symbol: textOrNull(row.symbol),
    name: textOrNull(row.name),
    token_standard: textOrNull(row.token_standard),
    decimals: numberOrNull(row.decimals),
    verified: verifiedOf(row.verified),
    verification_source: textOrNull(row.verification_source),
    first_seen_timestamp: firstSeen,
    first_seen_timestamp_utc: isEpochMs(firstSeen) ? utcText(firstSeen) : null,
    creator: null,
    factory: null,
  }
}

type Read =
  | { kind: 'rows'; rows: Array<Record<string, unknown>> }
  | { kind: 'not_served'; refusal: Refusal }
  | { kind: 'failed'; text: string }

async function readAssets(
  deps: TokenToolDependencies,
  network: string,
  key: 'symbol' | 'name',
  value: string
): Promise<Read> {
  let answer: GraphAnswer
  try {
    answer = await deps.graphQuery({ network, query: assetQuery(key, value) })
  } catch (err) {
    return { kind: 'failed', text: deps.describeFailure(err) }
  }
  const rows = rowsOf(answer)
  if (answer.isError !== true && rows !== null) return { kind: 'rows', rows }
  const refusal = refusalOf(answer)
  if (answer.isError === true && refusal.transient) return { kind: 'failed', text: refusal.text }
  return { kind: 'not_served', refusal }
}

/**
 * The creator and the factory of each candidate, written in place. Returns why
 * some creators were not read, or null when every read answered. A read that
 * answered with no row leaves the candidate's creator empty with no note: the
 * graph holds no deployment for it.
 */
async function readCreators(
  deps: TokenToolDependencies,
  network: string,
  candidates: TokenCandidate[]
): Promise<string | null> {
  const contracts = [
    ...new Set(candidates.map((c) => c.contract).filter((c) => CONTRACT_FORM.test(c))),
  ]
  const found = new Map<string, { creator: string | null; factory: string | null }>()
  const reasons: string[] = []
  let unread = candidates.length - candidates.filter((c) => CONTRACT_FORM.test(c.contract)).length
  for (let at = 0; at < contracts.length; at += CREATOR_BATCH_MAX) {
    const chunk = contracts.slice(at, at + CREATOR_BATCH_MAX)
    const queries = chunk.map((contract) => ({
      id: `creator:${contract}`,
      query: creatorQuery(contract),
    }))
    let members = new Map<string, Member>()
    try {
      const answer = await deps.graphQueryBatch({ network, queries })
      members = membersOf(answer)
      if (members.size === 0) {
        reasons.push(
          answer.isError === true ? refusalOf(answer).text : 'the batch answer held no reads'
        )
      }
    } catch (err) {
      reasons.push(deps.describeFailure(err))
    }
    for (const contract of chunk) {
      const member = members.get(`creator:${contract}`)
      if (member?.ok === true && Array.isArray(member.results)) {
        const row = member.results.find(isRecord)
        found.set(contract, {
          creator: row ? addressOrNull(row.creator) : null,
          factory: row ? addressOrNull(row.factory) : null,
        })
        continue
      }
      unread += 1
      if (member && typeof member.error === 'string' && !reasons.includes(member.error))
        reasons.push(member.error)
    }
  }
  for (const candidate of candidates) {
    const read = found.get(candidate.contract)
    if (read) Object.assign(candidate, read)
  }
  if (unread === 0) return null
  return `${unread} of ${candidates.length}${reasons.length > 0 ? `: ${reasons.join('; ')}` : ''}`
}

const NO_WEB =
  'Do not search the web and do not guess a contract: a web page is not a contract on this network.'

function hintFor(
  result: Omit<MetaTokenLookupResult, 'hint'>,
  creatorsNotRead: string | null
): string {
  const { network, query, candidates, matched_on, truncated } = result
  const parts: string[] = [ANSWER_HINT]
  if (candidates.length === 0) {
    parts.push(
      `No contract on ${network} carries the symbol or the name "${query}". Say so in one line. ${NO_WEB} ` +
        'Ask the user for the contract if they have one.'
    )
    return parts.join(' ')
  }
  if (matched_on === 'name') {
    parts.push(`No contract carries "${query}" as its symbol; these carry it as their name.`)
  }
  if (candidates.length === 1) {
    parts.push(
      `One contract on ${network} carries "${query}": ${candidates[0]!.contract}. ` +
        'Say it is the only one on this network, then read it by this full contract on USE topology.'
    )
  } else {
    parts.push(
      `${candidates.length} contracts on ${network} carry "${query}"` +
        `${truncated ? `, and more exist than the ${CANDIDATES_MAX} listed` : ''}. ` +
        'Tickers collide: never treat the first row as the token. Name them, each contract in full, ' +
        'with its creator and first seen time, and ask which one the user means, or pick one by the evidence the user gave ' +
        '(a creator, a launch date, a price move) and say why.'
    )
  }
  if (creatorsNotRead) {
    parts.push(
      `The creators were not read for ${creatorsNotRead}. creator and factory are empty there because the read failed, ` +
        'not because the chain holds none.'
    )
  }
  parts.push('Write every contract and creator in full, 0x plus 40 hex characters.')
  return parts.join(' ')
}

/** meta_token_lookup, {network, symbol}. Every argument is checked before a read is sent. */
export async function handleMetaTokenLookup(
  args: unknown,
  deps: TokenToolDependencies
): Promise<MetaTokenLookupToolResult> {
  const record = isRecord(args) ? args : {}
  let network: string
  try {
    network = normalizeDexNetwork(record.network)
  } catch (err) {
    return errorResult(
      err instanceof DexRegistryError ? err.message : `invalid_network: ${(err as Error).message}`
    )
  }
  if (typeof record.symbol !== 'string' || record.symbol.trim() === '') {
    return errorResult(
      'invalid_symbol: symbol is required: the ticker or the name as the user wrote it, for example TCITY'
    )
  }
  const symbol = record.symbol.trim()
  if (symbol.length > SYMBOL_MAX) {
    return errorResult(`invalid_symbol: symbol holds at most ${SYMBOL_MAX} characters`)
  }
  const base = {
    schema: META_TOKEN_LOOKUP_SCHEMA,
    network,
    query: symbol,
  }

  if (ADDRESS_FORM.test(symbol)) {
    const address = symbol.toLowerCase()
    return textResult({
      ...base,
      matched_on: null,
      candidates: [],
      total: 0,
      truncated: false,
      hint: `${ANSWER_HINT} ${address} is a contract address, not a ticker: ${ADDRESS_INPUT_HINT}. Send no token lookup for it.`,
    })
  }
  if (unsafeLiteral(symbol)) {
    return errorResult(
      'invalid_symbol: a symbol holds no double quote, backslash or control character. Send the ticker or the name as plain text.'
    )
  }

  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    return errorResult(
      `No token read was sent: ${unavailable} The lookup has no answer yet, which is not "no contract": try again later, or ask the user for the contract. ${NO_WEB}`
    )
  }

  let matchedOn: 'symbol' | 'name' = 'symbol'
  let read = await readAssets(deps, network, 'symbol', symbol)
  if (read.kind === 'rows' && read.rows.length === 0) {
    matchedOn = 'name'
    read = await readAssets(deps, network, 'name', symbol)
  }
  if (read.kind === 'failed') {
    return errorResult(
      `The token read failed: ${read.text} This is not "no contract": send the same lookup again once, or ask the user for the contract. ${NO_WEB}`
    )
  }
  if (read.kind === 'not_served') {
    return textResult({
      ...base,
      matched_on: null,
      candidates: [],
      total: 0,
      truncated: false,
      hint:
        `${ANSWER_HINT} This Chain Insights server does not serve the token lookup yet (${read.refusal.code}). ` +
        `That is not "no contract carries ${symbol}": ask the user for the token's contract, 0x plus 40 hex characters. ${NO_WEB}`,
    })
  }

  const total = read.rows.length
  const candidates = read.rows
    .slice(0, CANDIDATES_MAX)
    .map(candidateOf)
    .filter((candidate): candidate is TokenCandidate => candidate !== null)
  const creatorsNotRead =
    candidates.length > 0 ? await readCreators(deps, network, candidates) : null
  const result = {
    ...base,
    matched_on: candidates.length > 0 ? matchedOn : null,
    candidates,
    total,
    truncated: total > CANDIDATES_MAX,
  }
  return textResult({ ...result, hint: hintFor(result, creatorsNotRead) })
}
