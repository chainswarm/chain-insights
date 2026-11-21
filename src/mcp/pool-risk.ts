/**
 * The facts of the pools of a token, and the parties every token risk answer
 * names.
 *
 * A pool row is one ADDRESS. A token trades in pools of two shapes:
 *
 *   own address   a pool contract with its own :Address node, which carries
 *                 the pool's card and its liquidity sums;
 *   pool manager  one address that holds many pools (the manager of a vault
 *                 exchange in the exchange registry). The graph links each
 *                 provider to the manager address, so the pools inside it are
 *                 not told apart: the manager is one row, with its providers
 *                 and this token's side, and the node's sums (the manager's
 *                 whole book) are never shown as the pool's.
 *
 * The reads, all on USE topology:
 *
 *   providers  one read per direction gives the pools, the providers and the
 *              adders of a token at once: every ADDED_LIQUIDITY link that
 *              carries the token as `asset`, one row per pool and provider,
 *              the biggest first, and the same on REMOVED_LIQUIDITY in its own
 *              direction (pool to receiver). A whole-chain search: it may be
 *              refused or time out on a lane that is behind;
 *   node       a pool with its own address: its card, its model level and
 *              score, and its liquidity sums;
 *   parties    the 5 biggest adders or removers of one pool, anchored on it,
 *              for a pool asked about itself.
 *
 * Every named address is a Party: its risk block is built by the same code as
 * aml_address_risk (src/mcp/address-risk.ts), from its own row. A party never
 * raises the word of a pool or a token: it is shown beside it.
 *
 * A USD figure is the tokens worth at day prices. A sum over links none of
 * which carries a price stays null, never 0.
 */

import type { AddressCardWord } from './address-card.js'
import {
  assertReadAddress,
  kindOf,
  rowRisk,
  type AddressKind,
  type AddressRisk,
} from './address-risk.js'
import { addressOrNull, numberOrNull, strings, textOrNull, utcOrNull } from './row-values.js'

/** The rows a providers read lists at most; a full read means more may exist. */
export const PROVIDERS_READ_LIMIT = 200
/** The pools detailed (node read, adders and removers), the biggest by tokens added first. */
export const POOLS_DETAILED = 10
/** The adders and the removers kept per pool. */
export const POOL_PARTY_LIMIT = 5
/** The first accounts that paid the founder, oldest first. */
export const GAS_WALLET_LIMIT = 3

/** The liquidity sums on a pool node with its own address. */
export const POOL_NODE_COLUMNS = [
  'a.liquidity_added_usd AS liquidity_added_usd',
  'a.liquidity_removed_usd AS liquidity_removed_usd',
  'a.liquidity_net_usd AS liquidity_net_usd',
  'a.provider_count AS provider_count',
] as const

/** The card and model fields of a party read, on the node `v`. */
function partyColumns(v: string): string {
  return (
    `labels(${v}) AS node_labels, ${v}.identity AS identity, ${v}.identity_name AS identity_name, ` +
    `${v}.identities AS identities, ${v}.evidence AS evidence, ${v}.judgements AS judgements, ` +
    `${v}.risk_level AS risk_level, ${v}.risk_score AS risk_score`
  )
}

/**
 * The providers of a token on one side, by pool: liquidity added into a pool,
 * or taken off one. One row per pool and provider, the biggest first; a full
 * read (PROVIDERS_READ_LIMIT rows) means more may exist. `priced` counts the
 * links that carry a price.
 */
export function tokenProvidersQuery(token: string, side: 'added' | 'removed'): string {
  assertReadAddress(token)
  const match =
    side === 'added'
      ? `(a:Address)-[r:ADDED_LIQUIDITY {asset: "${token}"}]->(p:Address)`
      : `(p:Address)-[r:REMOVED_LIQUIDITY {asset: "${token}"}]->(a:Address)`
  return (
    `USE topology MATCH ${match} ` +
    'RETURN p.address AS pool, a.address AS address, sum(r.usd) AS tokens_worth_usd, count(r.usd) AS priced, ' +
    'sum(r.event_count) AS events, min(r.first_seen_height) AS first_seen_height, ' +
    `max(r.last_seen_height) AS last_seen_height, ${partyColumns('a')} ` +
    `ORDER BY tokens_worth_usd DESC LIMIT ${PROVIDERS_READ_LIMIT}`
  )
}

/** The biggest adders or removers of one pool address. */
export function poolPartiesQuery(pool: string, side: 'adders' | 'removers'): string {
  assertReadAddress(pool)
  const anchor = `(p:Address {address: "${pool}"})`
  const match =
    side === 'adders'
      ? `(a:Address)-[r:ADDED_LIQUIDITY]->${anchor}`
      : `${anchor}-[r:REMOVED_LIQUIDITY]->(a:Address)`
  return (
    `USE topology MATCH ${match} ` +
    'RETURN a.address AS address, sum(r.usd) AS tokens_worth_usd, count(r.usd) AS priced, ' +
    'sum(r.event_count) AS events, min(r.first_seen_height) AS first_seen_height, ' +
    `max(r.last_seen_height) AS last_seen_height, ${partyColumns('a')} ` +
    `ORDER BY tokens_worth_usd DESC LIMIT ${POOL_PARTY_LIMIT}`
  )
}

/** The assets added into one pool: its tokens, and NATIVE for the chain's own coin. */
export function poolAssetsQuery(pool: string): string {
  assertReadAddress(pool)
  return (
    `USE topology MATCH (a:Address)-[r:ADDED_LIQUIDITY]->(p:Address {address: "${pool}"}) ` +
    'RETURN collect(DISTINCT r.asset) AS assets LIMIT 1'
  )
}

/** The contract deployment of one address: who deployed it, from which wallet, by which factory. */
export function deploymentQuery(address: string): string {
  assertReadAddress(address)
  return (
    `USE topology MATCH (d:Address)-[r:DEPLOYED_CONTRACT]->(t:Address {address: "${address}"}) ` +
    'RETURN d.address AS deployer, r.tx_origin AS tx_origin, r.factory_address AS factory_address, ' +
    'r.kind AS kind, r.tx_id AS tx_id, r.block_timestamp AS block_timestamp LIMIT 1'
  )
}

/** The first accounts that paid one wallet, oldest first, with no money floor: a first funder is small on purpose. */
export function gasWalletsQuery(founder: string): string {
  assertReadAddress(founder)
  return (
    `USE topology MATCH (s:Account)-[f:FLOWED_TO]->(a:Address {address: "${founder}"}) ` +
    'RETURN s.address AS address, f.amount_usd_sum AS tokens_worth_usd, ' +
    `f.first_seen_timestamp AS first_seen_timestamp, ${partyColumns('s')} ` +
    `ORDER BY f.first_seen_timestamp ASC LIMIT ${GAS_WALLET_LIMIT}`
  )
}

/** A time in epoch milliseconds, or in seconds, as UTC text; null for anything else. */
export function timeText(value: unknown): string | null {
  const number = numberOrNull(value)
  if (number === null) return null
  return utcOrNull(number) ?? utcOrNull(number * 1000)
}

/** A USD sum of a read, or null when no link of it carried a price. */
export function usdOf(row: Record<string, unknown> | undefined, column: string): number | null {
  const sum = numberOrNull(row?.[column])
  const priced = numberOrNull(row?.priced)
  if (priced !== null && priced <= 0) return null
  return sum
}

export type PartyRole =
  'founder' | 'factory' | 'gas_wallet' | 'adder' | 'remover' | 'deployer' | 'token'

/** A named address of an answer, with its own risk block. */
export interface Party {
  role: PartyRole
  address: string
  /** What this address moved in its role, tokens worth USD at day prices; null when unpriced. */
  tokens_worth_usd?: number | null
  risk: AddressRisk
  kind: AddressKind
  identity: { word: string; name: string | null } | null
  /** A gas wallet: when it first paid the founder. */
  first_seen_utc?: string | null
  /** An adder or a remover: its liquidity events and the blocks of the first and the last. */
  events?: number | null
  first_seen_height?: number | null
  last_seen_height?: number | null
}

/** The party of one row: its risk block by the address rule, its kind and its identity. */
export function partyOf(
  role: PartyRole,
  address: string,
  row: Record<string, unknown> | undefined,
  dictionary: readonly AddressCardWord[],
  extra: Partial<
    Pick<
      Party,
      'tokens_worth_usd' | 'first_seen_utc' | 'events' | 'first_seen_height' | 'last_seen_height'
    >
  > = {}
): Party {
  const word = textOrNull(row?.identity)
  return {
    role,
    address,
    ...('tokens_worth_usd' in extra ? { tokens_worth_usd: extra.tokens_worth_usd ?? null } : {}),
    risk: { ...rowRisk(row, dictionary), card_version: textOrNull(row?.card_version) },
    kind: kindOf(strings(row?.node_labels)),
    identity: word ? { word, name: textOrNull(row?.identity_name) } : null,
    ...('first_seen_utc' in extra ? { first_seen_utc: extra.first_seen_utc ?? null } : {}),
    ...('events' in extra ? { events: extra.events ?? null } : {}),
    ...('first_seen_height' in extra ? { first_seen_height: extra.first_seen_height ?? null } : {}),
    ...('last_seen_height' in extra ? { last_seen_height: extra.last_seen_height ?? null } : {}),
  }
}

/** The adders or removers of one pool read, as parties. */
export function poolPartiesOf(
  role: 'adder' | 'remover',
  rows: Array<Record<string, unknown>>,
  dictionary: readonly AddressCardWord[]
): Party[] {
  const parties: Party[] = []
  for (const row of rows.slice(0, POOL_PARTY_LIMIT)) {
    const address = addressOrNull(row.address)
    if (!address) continue
    parties.push(
      partyOf(role, address, row, dictionary, {
        tokens_worth_usd: usdOf(row, 'tokens_worth_usd'),
        events: numberOrNull(row.events),
        first_seen_height: numberOrNull(row.first_seen_height),
        last_seen_height: numberOrNull(row.last_seen_height),
      })
    )
  }
  return parties
}

/** One pool address of a token, as its two providers reads list it. */
export interface PoolListing {
  pool: string
  /** Distinct adders of this token into the pool, among the rows read. */
  providers: number
  /** This token's side: added and removed, tokens worth USD; null when unpriced or not read. */
  added_usd: number | null
  removed_usd: number | null
  adder_rows: Array<Record<string, unknown>>
  remover_rows: Array<Record<string, unknown>>
}

/** The sum of the priced rows' USD, or null when no row carried a price. */
function pricedSum(rows: Array<Record<string, unknown>>): number | null {
  let sum: number | null = null
  for (const row of rows) {
    const usd = usdOf(row, 'tokens_worth_usd')
    if (usd !== null) sum = (sum ?? 0) + usd
  }
  return sum
}

/**
 * The pool addresses of a token from its two providers reads, the biggest by
 * this token added first. A removed sum is 0 for a pool with no removal row
 * in a removals read that answered with fewer than PROVIDERS_READ_LIMIT rows
 * (nothing removed). It is null when the read did not answer (`removed` is
 * null), when it came back full (more rows may exist), or when the pool's
 * removal rows carry no price.
 */
export function poolListingsOf(
  added: Array<Record<string, unknown>>,
  removed: Array<Record<string, unknown>> | null
): PoolListing[] {
  const byPool = new Map<
    string,
    { adders: Array<Record<string, unknown>>; removers: Array<Record<string, unknown>> }
  >()
  const entry = (pool: string) => {
    const known = byPool.get(pool) ?? { adders: [], removers: [] }
    byPool.set(pool, known)
    return known
  }
  for (const row of added) {
    const pool = addressOrNull(row.pool)
    if (pool && addressOrNull(row.address)) entry(pool).adders.push(row)
  }
  for (const row of removed ?? []) {
    const pool = addressOrNull(row.pool)
    if (pool && addressOrNull(row.address)) entry(pool).removers.push(row)
  }
  const listings: PoolListing[] = [...byPool].map(([pool, rows]) => ({
    pool,
    providers: new Set(rows.adders.map((row) => addressOrNull(row.address))).size,
    added_usd: pricedSum(rows.adders),
    // No removal row in a read that answered whole is nothing removed: 0, not unknown.
    removed_usd:
      removed === null
        ? null
        : rows.removers.length === 0 && removed.length < PROVIDERS_READ_LIMIT
          ? 0
          : pricedSum(rows.removers),
    adder_rows: rows.adders,
    remover_rows: rows.removers,
  }))
  const rank = (value: number | null) => (value === null ? -1 : value)
  return listings.sort(
    (a, b) => rank(b.added_usd) - rank(a.added_usd) || a.pool.localeCompare(b.pool)
  )
}

export interface PoolLiquidity {
  added_usd: number | null
  removed_usd: number | null
  net_usd: number | null
}

/** The facts of one pool address. */
export interface PoolFacts {
  pool: string
  /** The exchange's name in the exchange registry, by its factory or its manager; null when unknown. */
  exchange: string | null
  /** A pool manager: its pools inside are answered as this one row. */
  is_manager: boolean
  /** A pool manager only: the pools inside it, which the graph does not tell apart. */
  pools_inside?: null
  /** True for the biggest pools: their node read and their parties. */
  detail: boolean
  /** Distinct liquidity providers: of this token, or of the pool asked about. */
  providers: number | null
  /** This token's side of the pool, tokens worth USD; null in a pool answer. */
  token_side: { added_usd: number | null; removed_usd: number | null } | null
  /** Both sides of a pool with its own address, from its node; null for a manager and when not read. */
  liquidity: PoolLiquidity | null
  /** The pool's own risk block; null for a manager, and when not read. */
  risk: AddressRisk | null
  adders: Party[]
  removers: Party[]
}

/**
 * The facts of one pool address. A pool with its own address takes both sides
 * of its liquidity and its word from its node; a manager takes neither (its
 * node is its whole book) and shows this token's side only.
 */
export function poolFactsOf(input: {
  pool: string
  exchange: string | null
  isManager: boolean
  detail: boolean
  providers: number | null
  tokenSide: PoolFacts['token_side']
  node: Record<string, unknown> | null
  adders: Party[]
  removers: Party[]
  dictionary: readonly AddressCardWord[]
}): PoolFacts {
  const { node } = input
  const own = !input.isManager && node !== null
  let liquidity: PoolLiquidity | null = null
  if (own) {
    const added = numberOrNull(node.liquidity_added_usd)
    const removed = numberOrNull(node.liquidity_removed_usd)
    const net =
      numberOrNull(node.liquidity_net_usd) ??
      (added !== null && removed !== null ? added - removed : null)
    liquidity = { added_usd: added, removed_usd: removed, net_usd: net }
  }
  return {
    pool: input.pool,
    exchange: input.exchange,
    is_manager: input.isManager,
    ...(input.isManager ? { pools_inside: null } : {}),
    detail: input.detail,
    providers: input.providers,
    token_side: input.tokenSide,
    liquidity,
    risk: own
      ? { ...rowRisk(node, input.dictionary), card_version: textOrNull(node.card_version) }
      : null,
    adders: input.adders,
    removers: input.removers,
  }
}
