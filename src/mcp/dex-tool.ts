/**
 * meta_dex_lookup: an exchange's name becomes its addresses.
 *
 * A local tool of the proxy. It matches the name against the exchange registry
 * (src/mcp/dex-registry.ts) at no cost, then sends one graph_query_batch of
 * anchored reads: Head for the family lag, each factory, manager and router by
 * its address, and the pools each factory deployed. Nothing is read by name and
 * nothing is gated on a family lag: a factory deployed months ago is not stale
 * because the swap family is behind. A name that is not covered sends no read.
 *
 * The description below is the contract with every host, Claude Desktop chat
 * included, which reads no skill: it carries the rule the exchange skills open
 * with. tests/host-parity.test.ts holds it to the skills' trigger words.
 */

import { ANSWER_HINT } from './answer-hint.js'
import { recipeFor, TRAIL_SKILLS, type RecipeStep, poolsByFactoryQuery } from './dex-recipes.js'
import {
  DexRegistryError,
  matchDex,
  normalizeDexNetwork,
  type DexCandidate,
  type DexEntry,
  type LoadedRegistry,
  type RegistrySource,
  type Role,
  type TrailType,
} from './dex-registry.js'

export const META_DEX_LOOKUP_TOOL = 'meta_dex_lookup'
export const META_DEX_LOOKUP_SCHEMA = 'chain-insights.meta-dex-lookup.v1' as const
export const META_DEX_LOOKUP_TITLE = 'Exchange by name'
export const META_DEX_LOOKUP_DESCRIPTION =
  'Call this first when a question names a decentralized exchange, a launchpad or a vault ' +
  '(Aero, Aerodrome, Velodrome, up., Raphael, Topaz, Uniswap, PancakeSwap, Balancer, Curve, ' +
  "Penguin, Virtuals, ...) and gives no address. It turns the name into the exchange's " +
  'factories, routers or pool manager, its biggest pools, and the first reads to send, ' +
  'with every address in full. A misspelling within two letters is taken and named in ' +
  'took_for. When matched is null the name is not covered: say so, list covered, and send ' +
  'no graph query for the name. Never ask the user for a pool, factory or router address.'
export const META_DEX_LOOKUP_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
export const META_DEX_LOOKUP_ARGS = ['network', 'name', 'pools'] as const

/** The pools returned per exchange, and per factory read. */
export const POOLS_LIMIT = 10
/** A batch holds at most 20 members; Head and the pool reads take their share. */
const CONTRACT_MEMBERS_MAX = 12

export interface ContractRow {
  address: string
  role: Role
  confirmed: boolean
  confirmed_by?: string
}

export interface PoolRow {
  address: string
  labels: string[]
  total_volume_usd: number
  tx_total_count: number
}

export interface FamilyLag {
  behind_money: number | null
  behind_dex: number | null
  behind_transfers: number | null
}

export interface DexMatch {
  dex: string
  display: string
  trail_type: TrailType
  /** The skill a host with skills loads next. */
  skill: string
  factories: ContractRow[]
  routers: ContractRow[]
  manager: ContractRow | null
  pools: PoolRow[]
  recipe: RecipeStep[]
}

export interface CoveredExchange {
  dex: string
  display: string
  trail_type: TrailType
  factories: string[]
  routers: string[]
}

export interface MetaDexLookupResult {
  schema: typeof META_DEX_LOOKUP_SCHEMA
  network: string
  registry_version: number
  registry_source: RegistrySource
  matched: DexMatch | null
  took_for?: string
  candidates: DexCandidate[]
  covered: string[]
  /** With no name: every covered exchange, with its key, trail type and contracts. */
  exchanges?: CoveredExchange[]
  families: FamilyLag | null
  /** What a read could not do: a lane that is not reachable, a member that was refused. */
  notes?: string[]
  hint: string
}

/** The batch reply as the remote client returns it. */
export type BatchAnswer = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
}

export interface DexToolDependencies {
  loadRegistry: (network: string) => Promise<LoadedRegistry>
  /** One graph_query_batch through the proxy's remote client, billed as any read. */
  graphQueryBatch: (args: {
    network: string
    queries: Array<{ id: string; query: string }>
  }) => Promise<BatchAnswer>
  /** The reason no read can be sent now, or undefined when the graph is reachable. */
  unavailable?: () => Promise<string | undefined> | string | undefined
  /** The text of a call that threw: payment required, transport. */
  describeFailure: (err: unknown) => string
}

export type MetaDexLookupToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function errorResult(text: string): MetaDexLookupToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

type Member = { id?: unknown; ok?: unknown; results?: unknown; error?: unknown }

function membersOf(answer: BatchAnswer): Map<string, Member> {
  const facts = isRecord(answer.structuredContent) ? answer.structuredContent.facts : undefined
  const queries = isRecord(facts) ? facts.queries : undefined
  const members = new Map<string, Member>()
  if (Array.isArray(queries)) {
    for (const member of queries)
      if (isRecord(member) && typeof member.id === 'string') members.set(member.id, member)
  }
  return members
}

const rowsOf = (member: Member | undefined): Array<Record<string, unknown>> =>
  member?.ok === true && Array.isArray(member.results) ? member.results.filter(isRecord) : []

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/** A column of a row, read under its alias or as the query wrote it (h.behind_dex). */
function column(row: Record<string, unknown>, name: string, variable: string): unknown {
  return name in row ? row[name] : row[`${variable}.${name}`]
}

export const HEAD_QUERY =
  'USE chain MATCH (h:Head) RETURN h.behind_money, h.behind_dex, h.behind_transfers'

export function contractQuery(address: string): string {
  return (
    `USE topology MATCH (a:Address {address: "${address}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.labels AS labels, a.is_contract AS is_contract LIMIT 1'
  )
}

export function contractListQuery(addresses: string[]): string {
  return (
    `USE topology MATCH (a:Address) WHERE a.address IN [${addresses.map((a) => `"${a}"`).join(', ')}] ` +
    `RETURN a.address AS address, labels(a) AS node_labels, a.labels AS labels, a.is_contract AS is_contract LIMIT ${addresses.length}`
  )
}

/** The anchored reads of one exchange: Head, each contract, and the pools of each factory. */
export function lookupQueries(
  entry: DexEntry,
  pools: boolean
): Array<{ id: string; query: string }> {
  const contracts = Object.keys(entry.roles)
  const queries: Array<{ id: string; query: string }> = [{ id: 'head', query: HEAD_QUERY }]
  if (contracts.length <= CONTRACT_MEMBERS_MAX) {
    for (const address of contracts)
      queries.push({ id: `contract:${address}`, query: contractQuery(address) })
  } else {
    queries.push({ id: 'contracts', query: contractListQuery(contracts) })
  }
  if (pools) {
    for (const factory of entry.factories.filter((address) => entry.roles[address] === 'factory')) {
      queries.push({ id: `pools:${factory}`, query: poolsByFactoryQuery(factory, POOLS_LIMIT) })
    }
  }
  return queries
}

function confirmation(
  row: Record<string, unknown> | undefined
): Pick<ContractRow, 'confirmed' | 'confirmed_by'> {
  if (!row) return { confirmed: false }
  if (row.is_contract === true) return { confirmed: true, confirmed_by: 'is_contract' }
  if (stringList(row.node_labels).includes('Contract'))
    return { confirmed: true, confirmed_by: ':Contract' }
  return { confirmed: false }
}

function readMatch(
  entry: DexEntry,
  members: Map<string, Member>,
  read: boolean
): {
  contracts: Map<string, ContractRow>
  pools: PoolRow[]
  families: FamilyLag | null
  notes: string[]
} {
  const notes: string[] = []
  const contracts = new Map<string, ContractRow>()
  const listed = new Map(rowsOf(members.get('contracts')).map((row) => [String(row.address), row]))
  for (const [address, role] of Object.entries(entry.roles)) {
    const row = members.has(`contract:${address}`)
      ? rowsOf(members.get(`contract:${address}`))[0]
      : listed.get(address)
    contracts.set(address, { address, role, ...confirmation(row) })
  }
  const byAddress = new Map<string, PoolRow>()
  for (const [id, member] of members) {
    if (!id.startsWith('pools:')) continue
    for (const row of rowsOf(member)) {
      const address = typeof row.to_address === 'string' ? row.to_address : null
      const volume = numberOrNull(row.total_volume_usd)
      if (!address || volume === null || byAddress.has(address)) continue
      byAddress.set(address, {
        address,
        labels: stringList(row.to_labels),
        total_volume_usd: volume,
        tx_total_count: numberOrNull(row.tx_total_count) ?? 0,
      })
    }
  }
  const pools = [...byAddress.values()]
    .sort((a, b) => b.total_volume_usd - a.total_volume_usd)
    .slice(0, POOLS_LIMIT)
  const head = rowsOf(members.get('head'))[0]
  const families: FamilyLag | null = head
    ? {
        behind_money: numberOrNull(column(head, 'behind_money', 'h')),
        behind_dex: numberOrNull(column(head, 'behind_dex', 'h')),
        behind_transfers: numberOrNull(column(head, 'behind_transfers', 'h')),
      }
    : null
  if (read) {
    for (const [id, member] of members) {
      if (member.ok !== true)
        notes.push(
          `${id}: ${typeof member.error === 'string' ? member.error : 'the read was not served'}`
        )
    }
  }
  return { contracts, pools, families, notes }
}

function hintFor(result: Omit<MetaDexLookupResult, 'hint'>, name: string | null): string {
  if (name === null) {
    return `${ANSWER_HINT} These are the exchanges the registry covers. Call meta_dex_lookup with a name for its addresses and first reads.`
  }
  if (result.matched) {
    const { matched } = result
    const took = result.took_for
      ? `Say in one line: "I took ${matched.display} for ${result.took_for}." Ask nothing. `
      : ''
    return (
      `${ANSWER_HINT} ${took}Exchange ${matched.display}, trail ${matched.trail_type}: send the first reads of recipe, ` +
      `anchored on the addresses above, and load ${matched.skill} when this host has skills. ` +
      'Read families before a SWAPPED search: it is sent when behind_dex is at most 100000. Never ask the user for an address.'
    )
  }
  if (result.candidates.length > 0) {
    const names = result.candidates
      .map((candidate) => `${candidate.display} (${candidate.dex})`)
      .join(', ')
    return `${ANSWER_HINT} ${result.candidates.length} rows fit "${name}": ${names}. Name both or pick one: call meta_dex_lookup with each key. Never guess one, never ask the user for an address.`
  }
  return `${ANSWER_HINT} ${name} is not covered. Send no query for the name: say so in one line and list the covered exchanges by name.`
}

function textResult(structured: MetaDexLookupResult): MetaDexLookupToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: false,
  }
}

/** meta_dex_lookup, {network, name?, pools?}. Every argument is checked before the registry is read. */
export async function handleMetaDexLookup(
  args: unknown,
  deps: DexToolDependencies
): Promise<MetaDexLookupToolResult> {
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
  const rawPools = record.pools
  if (rawPools !== undefined && rawPools !== null && typeof rawPools !== 'boolean') {
    return errorResult('invalid_pools: pools must be true or false')
  }
  const pools = rawPools !== false

  let loaded: LoadedRegistry
  try {
    loaded = await deps.loadRegistry(network)
  } catch (err) {
    return errorResult(
      err instanceof DexRegistryError
        ? err.message
        : `exchange registry unavailable: ${(err as Error).message}`
    )
  }
  const { document } = loaded
  const base = {
    schema: META_DEX_LOOKUP_SCHEMA,
    network,
    registry_version: document.registry_version,
    registry_source: loaded.source,
  }

  if (name === null) {
    const result = {
      ...base,
      matched: null,
      candidates: [],
      covered: document.rows.map((row) => row.display),
      exchanges: document.rows.map((row) => ({
        dex: row.dex,
        display: row.display,
        trail_type: row.trail_type,
        factories: row.factories,
        routers: row.routers,
      })),
      families: null,
    }
    return textResult({ ...result, hint: hintFor(result, null) })
  }

  const match = matchDex(name, document.rows)
  if (!match.matched) {
    const result = {
      ...base,
      matched: null,
      candidates: match.candidates,
      covered: match.covered,
      families: null,
    }
    return textResult({ ...result, hint: hintFor(result, name) })
  }

  const entry = match.matched
  const queries = lookupQueries(entry, pools)
  let members = new Map<string, Member>()
  const notes: string[] = []
  const unavailable = await deps.unavailable?.()
  if (unavailable) {
    notes.push(
      `No graph read was sent: ${unavailable} The contracts are the reviewed registry rows, not yet confirmed on the graph.`
    )
  } else {
    try {
      const answer = await deps.graphQueryBatch({ network, queries })
      members = membersOf(answer)
      if (answer.isError === true && members.size === 0) {
        const first = Array.isArray(answer.content) ? answer.content[0] : undefined
        notes.push(
          `The graph refused the reads: ${isRecord(first) && typeof first.text === 'string' ? first.text : 'no reason given'}`
        )
      }
    } catch (err) {
      notes.push(`The graph reads failed: ${deps.describeFailure(err)}`)
    }
  }
  const read = readMatch(entry, members, members.size > 0)
  notes.push(...read.notes)
  const contractsOf = (role: Role): ContractRow[] =>
    [...read.contracts.values()].filter((contract) => contract.role === role)
  const topPool = read.pools[0]?.address ?? null
  const matched: DexMatch = {
    dex: entry.dex,
    display: entry.display,
    trail_type: entry.trail_type,
    skill: TRAIL_SKILLS[entry.trail_type],
    factories: contractsOf('factory'),
    routers: contractsOf('router'),
    manager: contractsOf('manager')[0] ?? null,
    pools: read.pools,
    recipe: recipeFor(entry, topPool),
  }
  const result = {
    ...base,
    matched,
    ...(match.took_for ? { took_for: match.took_for } : {}),
    candidates: [],
    covered: match.covered,
    families: read.families,
    ...(notes.length > 0 ? { notes } : {}),
  }
  return textResult({ ...result, hint: hintFor(result, name) })
}
