/**
 * The exchange registry, as the proxy tool meta_dex_lookup reads it.
 *
 * The reviewed table lives in this repository, registry/<network>.md, and its
 * served copy registry/<network>.json is checked in CI
 * (scripts/pin-dex-registry.mjs). The proxy reads the copy three ways, in this
 * order:
 *
 *   cached    ~/.chain-insights/cache/dex-registry-<network>.json, younger than one hour
 *   fetched   the copy on main, https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/<network>.json,
 *             within 3 s, at most once an hour per network and never two in flight
 *   packaged  registry/<network>.json of the installed package, when the fetch fails and no cache exists
 *
 * A fetched file is used only when it passes the same rules the pin script
 * applies. A malformed file never replaces a good cache: the stale cache keeps
 * answering and one line names the fault. So a proxy that never reaches GitHub
 * behaves like the skill memo of its own version, and a row merged on main
 * reaches every running proxy within the hour, with no release.
 *
 * matchDex turns a name into one exchange: normalise, exact on key, display and
 * aliases, then within two letters of an alias of four or more characters. One
 * winner is matched, a tie is listed, never guessed, and no hit names every
 * covered exchange.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chainInsightsHome } from './cache-location.js'

export const DEX_REGISTRY_SCHEMA = 'chain-insights.dex-registry.v1' as const
/** How long a cached registry stays fresh. CACHE_TTL_MS (24 h) stays the lifetime of the schema caches. */
export const DEX_REGISTRY_TTL_MS = 60 * 60 * 1000
/** The most a fetch of the public file may take on the call path. */
export const DEX_REGISTRY_FETCH_BUDGET_MS = 3_000
export const DEX_REGISTRY_URL_ENV = 'CHAIN_INSIGHTS_DEX_REGISTRY_URL'
export const DEX_REGISTRY_PUBLIC_URL =
  'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/{network}.json'

export const TRAIL_TYPES = ['plain', 'vault', 'gauge', 'launchpad'] as const
export type TrailType = (typeof TRAIL_TYPES)[number]
export const ROLES = ['factory', 'manager', 'router'] as const
export type Role = (typeof ROLES)[number]
export type RegistrySource = 'fetched' | 'cached' | 'packaged'

/** One exchange of the served copy. */
export interface DexEntry {
  dex: string
  display: string
  aliases: string[]
  trail_type: TrailType
  adapters: string[]
  roles: Record<string, Role>
  /** Its factory addresses, or the one manager of a vault. */
  factories: string[]
  /** Its routers, or the manager of a vault: a vault forwards its own swaps. */
  routers: string[]
  example_pool: string | null
  pool_floor: number | null
  since_block: number
  source: string
}

export interface DexRegistryDocument {
  schema: typeof DEX_REGISTRY_SCHEMA
  network: string
  registry_version: number
  recorded_on: string
  rows: DexEntry[]
}

export interface LoadedRegistry {
  document: DexRegistryDocument
  source: RegistrySource
  loaded_at_ms: number
}

/** A refusal with its own words for the caller: a network the registry does not cover. */
export class DexRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DexRegistryError'
  }
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/
// An example pool is a pool address, or the pool id of a manager that keeps its pools by id.
const POOL_RE = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const DEX_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/
const NETWORK_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

/** The network as a lower-case identifier; it becomes part of a file name and a URL. */
export function normalizeDexNetwork(raw: unknown): string {
  const network = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!network) {
    throw new DexRegistryError(
      'invalid_network: network is required. Pass the identifier of a served network, for example robinhood.'
    )
  }
  if (!NETWORK_RE.test(network)) {
    throw new DexRegistryError(`invalid_network: "${String(raw)}" is not a network identifier`)
  }
  return network
}

/**
 * The fault of a registry document, or null when it is valid for the network:
 * the rules of registry/README.md, the same ones the pin script applies.
 */
export function registryFault(value: unknown, network: string): string | null {
  if (!isRecord(value)) return 'the file is not a JSON object'
  if (value.schema !== DEX_REGISTRY_SCHEMA) {
    return `schema is ${JSON.stringify(value.schema)}, not ${DEX_REGISTRY_SCHEMA}`
  }
  if (value.network !== network)
    return `network is ${JSON.stringify(value.network)}, not ${network}`
  if (!Number.isInteger(value.registry_version) || (value.registry_version as number) < 0) {
    return 'registry_version is not a whole number'
  }
  if (typeof value.recorded_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.recorded_on)) {
    return 'recorded_on is not a YYYY-MM-DD day'
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0) return 'rows is empty'
  const keys = new Set<string>()
  for (const [index, row] of value.rows.entries()) {
    const at = `rows[${index}]`
    if (!isRecord(row)) return `${at} is not an object`
    if (typeof row.dex !== 'string' || !DEX_RE.test(row.dex))
      return `${at}.dex is not a key: ${String(row.dex)}`
    if (keys.has(row.dex)) return `${at}.dex ${row.dex} is listed twice`
    keys.add(row.dex)
    if (typeof row.display !== 'string' || row.display.trim() === '')
      return `${at} (${row.dex}) has no display`
    if (!isStringList(row.aliases)) return `${at} (${row.dex}) aliases is not a list of names`
    if (!TRAIL_TYPES.includes(row.trail_type as TrailType)) {
      return `${at} (${row.dex}) trail_type ${String(row.trail_type)} is not plain, vault, gauge or launchpad`
    }
    if (!isStringList(row.adapters)) return `${at} (${row.dex}) adapters is not a list`
    if (!isRecord(row.roles)) return `${at} (${row.dex}) roles is not a map`
    for (const [address, role] of Object.entries(row.roles)) {
      if (!ADDRESS_RE.test(address))
        return `${at} (${row.dex}) address ${address} is not lowercase 0x plus 40 hex characters`
      if (!ROLES.includes(role as Role))
        return `${at} (${row.dex}) role ${String(role)} is not factory, manager or router`
    }
    for (const field of ['factories', 'routers'] as const) {
      const list = row[field]
      if (!isStringList(list)) return `${at} (${row.dex}) ${field} is not a list`
      for (const address of list) {
        if (!ADDRESS_RE.test(address))
          return `${at} (${row.dex}) address ${address} is not lowercase 0x plus 40 hex characters`
        if (!(address in row.roles))
          return `${at} (${row.dex}) ${field} names ${address}, which roles lacks`
      }
    }
    if ((row.factories as string[]).length === 0)
      return `${at} (${row.dex}) has no factory or manager`
    if (
      row.example_pool !== null &&
      (typeof row.example_pool !== 'string' || !POOL_RE.test(row.example_pool))
    ) {
      return `${at} (${row.dex}) example_pool ${String(row.example_pool)} is not a pool`
    }
    if (
      row.pool_floor !== null &&
      (!Number.isInteger(row.pool_floor) || (row.pool_floor as number) < 0)
    ) {
      return `${at} (${row.dex}) pool_floor is not a whole number`
    }
    if (!Number.isInteger(row.since_block) || (row.since_block as number) < 0) {
      return `${at} (${row.dex}) since_block is not a block`
    }
    if (typeof row.source !== 'string' || !row.source.startsWith('https://')) {
      return `${at} (${row.dex}) source is not an https link`
    }
  }
  return null
}

/** The URL of the served copy: the public file on main, or the override with {network} filled in. */
export function dexRegistryUrl(network: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DEX_REGISTRY_URL_ENV]?.trim()
  const template = override || DEX_REGISTRY_PUBLIC_URL
  if (template.includes('{network}')) return template.replaceAll('{network}', network)
  return template.endsWith('/') ? `${template}${network}.json` : template
}

export function dexRegistryCachePath(network: string): string {
  return path.join(chainInsightsHome(), 'cache', `dex-registry-${network}.json`)
}

/** The registry/ folder of the installed package: next to dist/, or the repository root when run from source. */
export function packagedRegistryDir(): string {
  const candidates = [
    fileURLToPath(new URL('../registry', import.meta.url)),
    fileURLToPath(new URL('../../registry', import.meta.url)),
  ]
  return (
    candidates.find((candidate) => existsSync(path.join(candidate, 'robinhood.json'))) ??
    candidates[0]!
  )
}

/** The packaged copy of a network, or null when the package carries none. A packaged copy that fails the rules is a defect: it throws. */
export function readPackagedRegistry(
  network: string,
  dir: string = packagedRegistryDir()
): DexRegistryDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, `${network}.json`), 'utf8'))
  } catch {
    return null
  }
  const fault = registryFault(parsed, network)
  if (fault)
    throw new Error(
      `the packaged exchange registry registry/${network}.json is malformed: ${fault}`
    )
  return parsed as DexRegistryDocument
}

interface CacheFile {
  schema: typeof DEX_REGISTRY_SCHEMA
  network: string
  registry_version: number
  recorded_on: string
  rows: DexEntry[]
  /** When the copy was read: the fetch, or the first start with no fetch. */
  cached_at_ms: number
  /** When a fetch was last tried. The cache is fresh for an hour after it. */
  checked_at_ms: number
  source: 'fetched' | 'packaged'
}

const documentOf = (file: CacheFile): DexRegistryDocument => ({
  schema: file.schema,
  network: file.network,
  registry_version: file.registry_version,
  recorded_on: file.recorded_on,
  rows: file.rows,
})

async function readCache(network: string): Promise<CacheFile | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(dexRegistryCachePath(network), 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(parsed) || registryFault(parsed, network) !== null) return null
  if (typeof parsed.checked_at_ms !== 'number' || typeof parsed.cached_at_ms !== 'number')
    return null
  if (parsed.source !== 'fetched' && parsed.source !== 'packaged') return null
  return parsed as unknown as CacheFile
}

async function writeCache(file: CacheFile): Promise<void> {
  const target = dexRegistryCachePath(file.network)
  await mkdir(path.dirname(target), { recursive: true })
  // Written beside the target and renamed, so a second proxy never reads half of it.
  const scratch = `${target}.${process.pid}.tmp`
  await writeFile(scratch, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
  await rename(scratch, target)
}

export interface LoadRegistryOptions {
  fetch?: typeof fetch
  now?: () => number
  env?: NodeJS.ProcessEnv
  /** One line per fault: a failed fetch, a malformed file, a cache that cannot be written. */
  log?: (line: string) => void
  packagedDir?: string
  budgetMs?: number
}

type FetchOutcome = { document: DexRegistryDocument } | { fault: string }

async function fetchRegistry(network: string, options: LoadRegistryOptions): Promise<FetchOutcome> {
  const url = dexRegistryUrl(network, options.env)
  const fetchImpl = options.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(options.budgetMs ?? DEX_REGISTRY_FETCH_BUDGET_MS),
    })
  } catch (err) {
    return { fault: `${url} unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (response.status !== 200) return { fault: `${url} answered HTTP ${response.status}` }
  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    return { fault: `${url} is not JSON` }
  }
  const fault = registryFault(parsed, network)
  if (fault) return { fault: `${url} is malformed: ${fault}` }
  return { document: parsed as DexRegistryDocument }
}

// Fetches in flight, by network: two calls at once share one fetch.
const inFlight = new Map<string, Promise<LoadedRegistry>>()

const defaultLog = (line: string): void => {
  process.stderr.write(`[chain-insights] dex-registry: ${line}\n`)
}

/**
 * The registry of one network: the fresh cache, else the public file, else the
 * stale cache, else the packaged copy. A packaged copy with a higher registry
 * version than the cache or the public file wins, so an upgrade is never
 * answered from an older file. Never throws for a network the package covers.
 */
export async function loadRegistry(
  rawNetwork: unknown,
  options: LoadRegistryOptions = {}
): Promise<LoadedRegistry> {
  const network = normalizeDexNetwork(rawNetwork)
  const now = options.now ?? Date.now
  const log = options.log ?? defaultLog
  const packaged = readPackagedRegistry(network, options.packagedDir)
  const newer = (document: DexRegistryDocument): boolean =>
    packaged !== null && packaged.registry_version > document.registry_version
  const fromPackaged = (): LoadedRegistry => ({
    document: packaged!,
    source: 'packaged',
    loaded_at_ms: now(),
  })

  const cache = await readCache(network)
  const age = cache ? now() - cache.checked_at_ms : Infinity
  if (cache && age >= 0 && age < DEX_REGISTRY_TTL_MS) {
    if (newer(cache)) return fromPackaged()
    return {
      document: documentOf(cache),
      source: cache.source === 'fetched' ? 'cached' : 'packaged',
      loaded_at_ms: now(),
    }
  }

  const running = inFlight.get(network)
  if (running) return running
  const load = (async (): Promise<LoadedRegistry> => {
    const outcome = await fetchRegistry(network, options)
    const checked = now()
    const save = async (file: CacheFile): Promise<void> => {
      try {
        await writeCache(file)
      } catch (err) {
        log(
          `the cache ${dexRegistryCachePath(network)} could not be written: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    if ('document' in outcome) {
      const { document } = outcome
      await save({ ...document, cached_at_ms: checked, checked_at_ms: checked, source: 'fetched' })
      if (newer(document)) return fromPackaged()
      return { document, source: 'fetched', loaded_at_ms: checked }
    }
    log(outcome.fault)
    if (cache) {
      // The stale cache keeps answering, and the next fetch waits an hour.
      await save({ ...cache, checked_at_ms: checked })
      if (newer(cache)) return fromPackaged()
      return {
        document: documentOf(cache),
        source: cache.source === 'fetched' ? 'cached' : 'packaged',
        loaded_at_ms: checked,
      }
    }
    if (!packaged) {
      throw new DexRegistryError(
        `network_not_covered: the exchange registry covers no network "${network}", and ${outcome.fault}`
      )
    }
    await save({ ...packaged, cached_at_ms: checked, checked_at_ms: checked, source: 'packaged' })
    return fromPackaged()
  })()
  inFlight.set(network, load)
  try {
    return await load
  } finally {
    inFlight.delete(network)
  }
}

// ─── The name match ───────────────────────────────────────────────────────────

/** Lower case, with every space, ".", "-" and "_" removed: "Uni v4" and "uni-v4" are "univ4". */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[\s.\-_]+/g, '')
}

/** The optimal string alignment distance: insertions, deletions, substitutions and swaps of two neighbours. */
export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1)
      }
      d[i]![j] = best
    }
  }
  return d[a.length]![b.length]!
}

/** The most letters a near hit may differ by, and the shortest alias a near hit is taken from. */
export const NEAR_DISTANCE = 2
export const NEAR_MIN_ALIAS_LENGTH = 4

export interface DexCandidate {
  dex: string
  display: string
  distance: number
}

export interface DexMatchResult {
  matched: DexEntry | null
  /** The name as typed, when the match is a near hit. */
  took_for?: string
  candidates: DexCandidate[]
  /** Every covered exchange, by display name. */
  covered: string[]
}

/**
 * One name against the registry rows:
 *   one exact hit                        matched
 *   several exact hits                   candidates at distance 0, matched null
 *   no exact hit, one nearest exchange   matched, took_for the name
 *   no exact hit, a tie at the nearest   candidates, matched null
 *   nothing within two letters           matched null, no candidates
 */
export function matchDex(name: string, rows: DexEntry[]): DexMatchResult {
  const covered = rows.map((row) => row.display)
  const wanted = normaliseName(name)
  if (!wanted) return { matched: null, candidates: [], covered }
  const exact = rows.filter((row) =>
    [row.dex, row.display, ...row.aliases].some((written) => normaliseName(written) === wanted)
  )
  if (exact.length === 1) return { matched: exact[0]!, candidates: [], covered }
  if (exact.length > 1) {
    return {
      matched: null,
      candidates: exact.map((row) => ({ dex: row.dex, display: row.display, distance: 0 })),
      covered,
    }
  }
  const near: Array<{ row: DexEntry; distance: number }> = []
  for (const row of rows) {
    const distances = row.aliases
      .map(normaliseName)
      .filter((alias) => alias.length >= NEAR_MIN_ALIAS_LENGTH)
      .map((alias) => damerauLevenshtein(wanted, alias))
    const distance = Math.min(...distances)
    if (distance <= NEAR_DISTANCE) near.push({ row, distance })
  }
  if (near.length === 0) return { matched: null, candidates: [], covered }
  const least = Math.min(...near.map((hit) => hit.distance))
  const nearest = near.filter((hit) => hit.distance === least)
  if (nearest.length === 1)
    return { matched: nearest[0]!.row, took_for: name.trim(), candidates: [], covered }
  return {
    matched: null,
    candidates: nearest.map(({ row, distance }) => ({
      dex: row.dex,
      display: row.display,
      distance,
    })),
    covered,
  }
}
