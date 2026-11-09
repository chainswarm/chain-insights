/**
 * meta_exchange_lookup: a centralized exchange's name becomes its wallets.
 *
 * A local tool of the proxy. It matches the name against the exchange lookup
 * file (src/mcp/exchange-registry.ts) and answers from it alone: no graph read,
 * no cost. The file lists every exchange, and only the wallets proven on that
 * network's own data, each with its payer proof and the block it was proven
 * at. An address instead of a name says whose wallet the address is. Whether
 * an address is a deposit, and which hot wallet it swept into, is read from
 * the graph by aml_exchange_deposit_check.
 *
 * The description below is the contract with every host, Claude Desktop chat
 * included, which reads no skill: it carries the rule the skill
 * chain-insights-aml-exchange opens with. tests/host-parity.test.ts holds it to
 * the skill's trigger words.
 */

import { ANSWER_HINT } from './answer-hint.js'
import { DexRegistryError, normalizeDexNetwork } from './dex-registry.js'
import {
  exchangeOfWallet,
  matchExchange,
  type ExchangeCandidate,
  type ExchangeEntry,
  type ExchangeRegistrySource,
  type ExchangeWallet,
  type LoadedExchangeRegistry,
} from './exchange-registry.js'

/**
 * The rule the exchange skill opens with, carried by both of its doors: where a
 * trail ends, and where an exchange's wallets come from.
 */
export const EXCHANGE_OPENING_RULE =
  'Money that reaches an exchange deposit with a SWEPT link entered that exchange there: the trail ends at the deposit, and never walks on past a hot wallet. ' +
  "Take an exchange's wallets from meta_exchange_lookup, never from a guess or a graph search by name."

export const META_EXCHANGE_LOOKUP_TOOL = 'meta_exchange_lookup' as const
export const META_EXCHANGE_LOOKUP_SCHEMA = 'chain-insights.meta-exchange-lookup.v1' as const
export const META_EXCHANGE_LOOKUP_TITLE = 'Centralized exchange by name or address'
export const META_EXCHANGE_LOOKUP_DESCRIPTION =
  'Call this first when a question names a centralized exchange (Binance, Bitget, Bybit, Coinbase, Gate, KuCoin, MEXC, OKX, ...) ' +
  'and gives no address, or asks which exchange a wallet belongs to. It turns the name into the hot wallets of that exchange on the network, ' +
  "The file lists only wallets proven on that chain's own data, each with its payer proof and the block it was proven at, and its gas wallets; " +
  'an exchange may list none, and its deposits and hot wallets are still marked in the graph. ' +
  'A misspelling within two letters is taken and named in took_for. Send address instead (0x plus 40 hex, any case) to learn whose hot wallet ' +
  'or gas wallet it is. It reads no graph and costs nothing. ' +
  `${EXCHANGE_OPENING_RULE} Give a name or an address, not both.`
export const META_EXCHANGE_LOOKUP_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const META_EXCHANGE_LOOKUP_ARGS = ['network', 'name', 'address'] as const

export type WalletRow = Omit<ExchangeWallet, 'role'>

export interface ExchangeMatch {
  exchange: string
  display: string
  hot_wallets: WalletRow[]
  gas_wallets: WalletRow[]
  spenders: WalletRow[]
}

export interface ListedExchange {
  exchange: string
  display: string
  hot_wallets: number
}

export interface MetaExchangeLookupResult {
  schema: typeof META_EXCHANGE_LOOKUP_SCHEMA
  network: string
  registry_version: number
  registry_source: ExchangeRegistrySource
  recorded_on: string
  matched: ExchangeMatch | null
  /** A near name hit: the name as typed. An address hit: the role the address holds. */
  took_for?: string
  candidates: ExchangeCandidate[]
  /** Every exchange the lookup lists for the network, by display name. */
  listed: string[]
  /** With no name and no address: every listed exchange, with its id and its hot wallet count. */
  exchanges?: ListedExchange[]
  hint: string
}

export interface ExchangeToolDependencies {
  loadExchangeRegistry: (network: string) => Promise<LoadedExchangeRegistry>
}

export type MetaExchangeLookupToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function errorResult(text: string): MetaExchangeLookupToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function textResult(structured: MetaExchangeLookupResult): MetaExchangeLookupToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

const ADDRESS_FORM = /^0x[0-9a-fA-F]{40}$/

function walletsOf(entry: ExchangeEntry, role: ExchangeWallet['role']): WalletRow[] {
  return entry.wallets
    .filter((wallet) => wallet.role === role)
    .map(({ address, evidence, proven_at_block }) => ({ address, evidence, proven_at_block }))
}

/** One row of the lookup as the tool returns it. */
export function exchangeMatchOf(entry: ExchangeEntry): ExchangeMatch {
  return {
    exchange: entry.exchange,
    display: entry.display,
    hot_wallets: walletsOf(entry, 'hot_wallet'),
    gas_wallets: walletsOf(entry, 'gas_wallet'),
    spenders: walletsOf(entry, 'spender'),
  }
}

const ROLE_WORDS: Record<ExchangeWallet['role'], string> = {
  hot_wallet: 'a hot wallet',
  gas_wallet: 'a gas wallet',
  spender: 'a spender',
}

const NO_SEARCH_BY_NAME = 'Send no graph search by name.'

function hintFor(
  result: Omit<MetaExchangeLookupResult, 'hint'>,
  name: string | null,
  address: string | null
): string {
  const { network } = result
  if (address !== null && !result.matched) {
    return (
      `${ANSWER_HINT} ${address} is no wallet the exchange lookup lists for ${network}: the file lists only wallets proven on this chain. ` +
      `The graph marks deposits and hot wallets of every exchange: call aml_exchange_deposit_check {network: "${network}", address: "${address}"} ` +
      'to read its cex_role, its exchange and its SWEPT links.'
    )
  }
  if (address !== null && result.matched) {
    return (
      `${ANSWER_HINT} Say in one line: "${address} is ${result.took_for} of ${result.matched.display} on ${network}." ` +
      'A trail that reaches it has entered the exchange: end the trail there. Never walk on past a hot wallet.'
    )
  }
  if (name === null) {
    return `${ANSWER_HINT} These are the exchanges the lookup lists for ${network}. Call meta_exchange_lookup with a name for its wallets.`
  }
  if (result.matched) {
    const { matched } = result
    const took = result.took_for
      ? `Say in one line: "I took ${matched.display} for ${result.took_for}." Ask nothing. `
      : ''
    const count = matched.hot_wallets.length
    const wallets =
      count === 0
        ? `${matched.display} on ${network}: the lookup lists no wallet of it proven on this chain yet; the graph marks its deposits and hot wallets. `
        : `${matched.display} on ${network}: ${count} hot wallet${count === 1 ? '' : 's'} proven on this chain. `
    return (
      `${ANSWER_HINT} ${took}${wallets}` +
      'A deposit of this exchange has a SWEPT link into its hot wallet. Read SWEPT anchored on the address the trail reached, never on a hot wallet: ' +
      'a hot wallet links to many thousands of deposits. To check one address, call aml_exchange_deposit_check. ' +
      `${EXCHANGE_OPENING_RULE}`
    )
  }
  if (result.candidates.length > 0) {
    const names = result.candidates
      .map((candidate) => `${candidate.display} (${candidate.exchange})`)
      .join(', ')
    return `${ANSWER_HINT} ${result.candidates.length} exchanges fit "${name}": ${names}. Name both or pick one: call meta_exchange_lookup with each id. Never guess one.`
  }
  return (
    `${ANSWER_HINT} The exchange lookup holds no wallet of "${name}" for ${network}` +
    (result.listed.length > 0 ? `; it lists ${result.listed.join(', ')}. ` : '. ') +
    'If the user knows one address of that exchange (a deposit address, or a wallet it paid them from), call aml_exchange_deposit_check with it. ' +
    NO_SEARCH_BY_NAME
  )
}

/** meta_exchange_lookup, {network, name?, address?}. Every argument is checked before the lookup is read. */
export async function handleMetaExchangeLookup(
  args: unknown,
  deps: ExchangeToolDependencies
): Promise<MetaExchangeLookupToolResult> {
  const record = isRecord(args) ? args : {}
  let network: string
  try {
    network = normalizeDexNetwork(record.network)
  } catch (err) {
    return errorResult((err as Error).message)
  }
  const rawName = record.name
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
    return errorResult('invalid_name: name must be the exchange name as text')
  }
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : null
  const rawAddress = record.address
  if (rawAddress !== undefined && rawAddress !== null && typeof rawAddress !== 'string') {
    return errorResult('invalid_address: address must be 0x plus 40 hex characters')
  }
  const addressText =
    typeof rawAddress === 'string' && rawAddress.trim() !== '' ? rawAddress.trim() : null
  if (name !== null && addressText !== null)
    return errorResult('Give a name or an address, not both.')
  if (addressText !== null && !ADDRESS_FORM.test(addressText)) {
    return errorResult('invalid_address: address must be 0x plus 40 hex characters')
  }
  const address = addressText === null ? null : addressText.toLowerCase()

  let loaded: LoadedExchangeRegistry
  try {
    loaded = await deps.loadExchangeRegistry(network)
  } catch (err) {
    return errorResult(
      err instanceof DexRegistryError
        ? err.message
        : `exchange lookup unavailable: ${(err as Error).message}`
    )
  }
  const { document } = loaded
  const listed = document.rows.map((row) => row.display)
  const base = {
    schema: META_EXCHANGE_LOOKUP_SCHEMA,
    network,
    registry_version: document.registry_version,
    registry_source: loaded.source,
    recorded_on: document.recorded_on,
  }

  if (name === null && address === null) {
    const result = {
      ...base,
      matched: null,
      candidates: [],
      listed,
      exchanges: document.rows.map((row) => ({
        exchange: row.exchange,
        display: row.display,
        hot_wallets: row.wallets.filter((wallet) => wallet.role === 'hot_wallet').length,
      })),
    }
    return textResult({ ...result, hint: hintFor(result, null, null) })
  }

  if (address !== null) {
    const owner = exchangeOfWallet(address, document.rows)
    const result = {
      ...base,
      matched: owner ? exchangeMatchOf(owner.entry) : null,
      ...(owner ? { took_for: ROLE_WORDS[owner.wallet.role] } : {}),
      candidates: [],
      listed,
    }
    return textResult({ ...result, hint: hintFor(result, null, address) })
  }

  const match = matchExchange(name as string, document.rows)
  const result = {
    ...base,
    matched: match.matched ? exchangeMatchOf(match.matched) : null,
    ...(match.took_for ? { took_for: match.took_for } : {}),
    candidates: match.candidates,
    listed,
  }
  return textResult({ ...result, hint: hintFor(result, name, null) })
}
