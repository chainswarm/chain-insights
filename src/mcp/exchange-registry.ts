/**
 * The centralized exchange lookup, as meta_exchange_lookup and
 * aml_exchange_deposit_check read it.
 *
 * registry/exchanges/<network>.json lists, per exchange, the wallets the
 * chain's own data proved: hot wallets that receive the sweeps of its deposits,
 * gas wallets that top deposits up, and spenders that pull approved deposits.
 * Each wallet carries its proof and the block it was proven at. It is written by
 * scripts/pin-exchange-registry.mjs and held to the rules below by
 * tests/exchange-registry.test.ts. Only exchanges with a proven hot wallet are
 * listed.
 *
 * The proxy reads the file as it reads the DEX registry (src/mcp/dex-registry.ts):
 *
 *   cached    ~/.chain-insights/cache/exchange-registry-<network>.json, younger than one hour
 *   fetched   the copy on main, https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/exchanges/<network>.json,
 *             within 3 s, at most once an hour per network
 *   packaged  registry/exchanges/<network>.json of the installed package
 *
 * A fetched file is used only when it passes the rules. A row merged on main
 * reaches every running proxy within the hour, with no release. A lookup is a
 * proxy tool and never a table or a graph property.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chainInsightsHome } from './cache-location.js'
import {
  DEX_REGISTRY_FETCH_BUDGET_MS,
  DEX_REGISTRY_TTL_MS,
  NEAR_DISTANCE,
  NEAR_MIN_ALIAS_LENGTH,
  damerauLevenshtein,
  normalizeDexNetwork,
  normaliseName,
} from './dex-registry.js'

export const EXCHANGE_REGISTRY_SCHEMA = 'chain-insights.exchange-registry.v1' as const
export const EXCHANGE_REGISTRY_URL_ENV = 'CHAIN_INSIGHTS_EXCHANGE_REGISTRY_URL'
export const EXCHANGE_REGISTRY_PUBLIC_URL =
  'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/exchanges/{network}.json'

export const WALLET_ROLES = ['hot_wallet', 'gas_wallet', 'spender'] as const
export type WalletRole = (typeof WALLET_ROLES)[number]
export type ExchangeRegistrySource = 'fetched' | 'cached' | 'packaged' | 'none'

/** One proven wallet of an exchange. */
export interface ExchangeWallet {
  address: string
  role: WalletRole
  /** What the chain showed: payers, the sample that pays only this exchange, the window. */
  evidence: string
  proven_at_block: number
}

/** One exchange of the lookup file. */
export interface ExchangeEntry {
  /** The stable lower-case id, the word the graph's labels carry. */
  exchange: string
  display: string
  aliases: string[]
  wallets: ExchangeWallet[]
}

export interface ExchangeRegistryDocument {
  schema: typeof EXCHANGE_REGISTRY_SCHEMA
  network: string
  registry_version: number
  recorded_on: string
  rows: ExchangeEntry[]
}

export interface LoadedExchangeRegistry {
  document: ExchangeRegistryDocument
  source: ExchangeRegistrySource
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const EXCHANGE_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

/** The fault of a lookup file, or null when it is valid for the network. */
export function exchangeRegistryFault(value: unknown, network: string): string | null {
  if (!isRecord(value)) return 'the file is not a JSON object'
  if (value.schema !== EXCHANGE_REGISTRY_SCHEMA) {
    return `schema is ${JSON.stringify(value.schema)}, not ${EXCHANGE_REGISTRY_SCHEMA}`
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
  const ids = new Set<string>()
  const owners = new Map<string, string>()
  for (const [index, row] of value.rows.entries()) {
    const at = `rows[${index}]`
    if (!isRecord(row)) return `${at} is not an object`
    if (typeof row.exchange !== 'string' || !EXCHANGE_RE.test(row.exchange))
      return `${at}.exchange is not an id: ${String(row.exchange)}`
    if (ids.has(row.exchange)) return `${at}.exchange ${row.exchange} is listed twice`
    ids.add(row.exchange)
    if (typeof row.display !== 'string' || row.display.trim() === '')
      return `${at} (${row.exchange}) has no display`
    if (!isStringList(row.aliases)) return `${at} (${row.exchange}) aliases is not a list of names`
    if (!Array.isArray(row.wallets) || row.wallets.length === 0)
      return `${at} (${row.exchange}) has no wallet`
    for (const wallet of row.wallets) {
      if (!isRecord(wallet)) return `${at} (${row.exchange}) has a wallet that is not an object`
      const address = wallet.address
      if (typeof address !== 'string' || !ADDRESS_RE.test(address))
        return `${at} (${row.exchange}) address ${String(address)} is not lowercase 0x plus 40 hex characters`
      if (!WALLET_ROLES.includes(wallet.role as WalletRole))
        return `${at} (${row.exchange}) role ${String(wallet.role)} is not hot_wallet, gas_wallet or spender`
      if (typeof wallet.evidence !== 'string' || wallet.evidence.trim() === '')
        return `${at} (${row.exchange}) ${address} has no evidence`
      if (!Number.isInteger(wallet.proven_at_block) || (wallet.proven_at_block as number) <= 0)
        return `${at} (${row.exchange}) ${address} has no proven_at_block`
      const owner = owners.get(address)
      if (owner !== undefined)
        return `${at} (${row.exchange}) ${address} is also a wallet of ${owner}`
      owners.set(address, row.exchange)
    }
    if (!row.wallets.some((wallet) => isRecord(wallet) && wallet.role === 'hot_wallet'))
      return `${at} (${row.exchange}) has no proven hot wallet`
  }
  return null
}

/** The URL of the served copy: the public file on main, or the override with {network} filled in. */
export function exchangeRegistryUrl(network: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[EXCHANGE_REGISTRY_URL_ENV]?.trim()
  const template = override || EXCHANGE_REGISTRY_PUBLIC_URL
  if (template.includes('{network}')) return template.replaceAll('{network}', network)
  return template.endsWith('/') ? `${template}${network}.json` : template
}

export function exchangeRegistryCachePath(network: string): string {
  return path.join(chainInsightsHome(), 'cache', `exchange-registry-${network}.json`)
}

/** registry/exchanges of the installed package: next to dist/, or the repository root when run from source. */
export function packagedExchangeRegistryDir(): string {
  const candidates = [
    fileURLToPath(new URL('../registry/exchanges', import.meta.url)),
    fileURLToPath(new URL('../../registry/exchanges', import.meta.url)),
  ]
  return (
    candidates.find((candidate) => existsSync(path.join(candidate, 'robinhood.json'))) ??
    candidates[0]!
  )
}

/** The packaged copy of a network, or null when the package carries none. A packaged copy that fails the rules throws. */
export function readPackagedExchangeRegistry(
  network: string,
  dir: string = packagedExchangeRegistryDir()
): ExchangeRegistryDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, `${network}.json`), 'utf8'))
  } catch {
    return null
  }
  const fault = exchangeRegistryFault(parsed, network)
  if (fault)
    throw new Error(
      `the packaged exchange lookup registry/exchanges/${network}.json is malformed: ${fault}`
    )
  return parsed as ExchangeRegistryDocument
}

interface CacheFile {
  document: ExchangeRegistryDocument
  checked_at_ms: number
  source: 'fetched' | 'packaged'
}

async function readCache(network: string): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(exchangeRegistryCachePath(network), 'utf8')) as unknown
    if (!isRecord(parsed) || typeof parsed.checked_at_ms !== 'number') return null
    if (parsed.source !== 'fetched' && parsed.source !== 'packaged') return null
    if (exchangeRegistryFault(parsed.document, network) !== null) return null
    return parsed as unknown as CacheFile
  } catch {
    return null
  }
}

async function writeCache(network: string, file: CacheFile): Promise<void> {
  const target = exchangeRegistryCachePath(network)
  await mkdir(path.dirname(target), { recursive: true })
  const scratch = `${target}.${process.pid}.tmp`
  await writeFile(scratch, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
  await rename(scratch, target)
}

export interface LoadExchangeRegistryOptions {
  fetch?: typeof fetch
  now?: () => number
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
  packagedDir?: string
  budgetMs?: number
}

async function fetchDocument(
  network: string,
  options: LoadExchangeRegistryOptions
): Promise<{ document: ExchangeRegistryDocument } | { fault: string }> {
  const url = exchangeRegistryUrl(network, options.env)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, {
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
  const fault = exchangeRegistryFault(parsed, network)
  return fault
    ? { fault: `${url} is malformed: ${fault}` }
    : { document: parsed as ExchangeRegistryDocument }
}

/** A network with no file: no rows, so every lookup on it answers with an empty list. */
function emptyDocument(network: string): ExchangeRegistryDocument {
  return {
    schema: EXCHANGE_REGISTRY_SCHEMA,
    network,
    registry_version: 0,
    recorded_on: '1970-01-01',
    rows: [],
  }
}

const defaultLog = (line: string): void => {
  process.stderr.write(`[chain-insights] exchange-registry: ${line}\n`)
}

/**
 * The lookup file of one network: the fresh cache, else the public file, else
 * the stale cache, else the packaged copy. A packaged copy with a higher
 * version than the cache or the public file wins. A network with no file
 * anywhere answers with no rows; it never throws for a well-formed network.
 */
export async function loadExchangeRegistry(
  rawNetwork: unknown,
  options: LoadExchangeRegistryOptions = {}
): Promise<LoadedExchangeRegistry> {
  const network = normalizeDexNetwork(rawNetwork)
  const now = options.now ?? Date.now
  const log = options.log ?? defaultLog
  const packaged = readPackagedExchangeRegistry(network, options.packagedDir)
  const pick = (
    document: ExchangeRegistryDocument,
    source: ExchangeRegistrySource
  ): LoadedExchangeRegistry =>
    packaged !== null && packaged.registry_version > document.registry_version
      ? { document: packaged, source: 'packaged' }
      : { document, source }

  const cache = await readCache(network)
  const age = cache ? now() - cache.checked_at_ms : Infinity
  if (cache && age >= 0 && age < DEX_REGISTRY_TTL_MS) {
    return pick(cache.document, cache.source === 'fetched' ? 'cached' : 'packaged')
  }
  const save = async (file: CacheFile): Promise<void> => {
    try {
      await writeCache(network, file)
    } catch (err) {
      log(
        `the cache ${exchangeRegistryCachePath(network)} could not be written: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  const outcome = await fetchDocument(network, options)
  const checked = now()
  if ('document' in outcome) {
    await save({ document: outcome.document, checked_at_ms: checked, source: 'fetched' })
    return pick(outcome.document, 'fetched')
  }
  if (cache) {
    log(outcome.fault)
    await save({ ...cache, checked_at_ms: checked })
    return pick(cache.document, cache.source === 'fetched' ? 'cached' : 'packaged')
  }
  if (packaged) {
    log(outcome.fault)
    await save({ document: packaged, checked_at_ms: checked, source: 'packaged' })
    return { document: packaged, source: 'packaged' }
  }
  return { document: emptyDocument(network), source: 'none' }
}

// ─── The name and the address match ───────────────────────────────────────────

export interface ExchangeCandidate {
  exchange: string
  display: string
  distance: number
}

export interface ExchangeMatchResult {
  matched: ExchangeEntry | null
  /** The name as typed, when the match is a near hit. */
  took_for?: string
  candidates: ExchangeCandidate[]
  /** Every exchange the file lists for the network, by display name. */
  listed: string[]
}

/**
 * One name against the rows, as matchDex does for a DEX: exact on the id, the
 * display and the aliases; then within two letters of an alias of four or more
 * characters. A tie is listed, never guessed.
 */
export function matchExchange(name: string, rows: ExchangeEntry[]): ExchangeMatchResult {
  const listed = rows.map((row) => row.display)
  const wanted = normaliseName(name)
  if (!wanted) return { matched: null, candidates: [], listed }
  const exact = rows.filter((row) =>
    [row.exchange, row.display, ...row.aliases].some((written) => normaliseName(written) === wanted)
  )
  if (exact.length === 1) return { matched: exact[0]!, candidates: [], listed }
  if (exact.length > 1) {
    return {
      matched: null,
      candidates: exact.map((row) => ({
        exchange: row.exchange,
        display: row.display,
        distance: 0,
      })),
      listed,
    }
  }
  const near: Array<{ row: ExchangeEntry; distance: number }> = []
  for (const row of rows) {
    const distances = [row.exchange, row.display, ...row.aliases]
      .map(normaliseName)
      .filter((alias) => alias.length >= NEAR_MIN_ALIAS_LENGTH)
      .map((alias) => damerauLevenshtein(wanted, alias))
    if (distances.length === 0) continue
    const distance = Math.min(...distances)
    if (distance <= NEAR_DISTANCE) near.push({ row, distance })
  }
  if (near.length === 0) return { matched: null, candidates: [], listed }
  const least = Math.min(...near.map((hit) => hit.distance))
  const nearest = near.filter((hit) => hit.distance === least)
  if (nearest.length === 1)
    return { matched: nearest[0]!.row, took_for: name.trim(), candidates: [], listed }
  return {
    matched: null,
    candidates: nearest.map(({ row, distance }) => ({
      exchange: row.exchange,
      display: row.display,
      distance,
    })),
    listed,
  }
}

/** The exchange and the wallet a lowercase address is, or null when no row lists it. */
export function exchangeOfWallet(
  address: string,
  rows: ExchangeEntry[]
): { entry: ExchangeEntry; wallet: ExchangeWallet } | null {
  for (const entry of rows) {
    const wallet = entry.wallets.find((candidate) => candidate.address === address)
    if (wallet) return { entry, wallet }
  }
  return null
}

/** The exchange a list of graph label words names, or null: the first word that is an id, a display name or an alias. */
export function exchangeOfLabels(
  labels: readonly string[],
  rows: ExchangeEntry[]
): ExchangeEntry | null {
  for (const word of labels) {
    const wanted = normaliseName(word)
    if (!wanted) continue
    const row = rows.find((entry) =>
      [entry.exchange, entry.display, ...entry.aliases].some(
        (name) => normaliseName(name) === wanted
      )
    )
    if (row) return row
  }
  return null
}
