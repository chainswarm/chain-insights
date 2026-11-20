/**
 * One public file of this repository, read at run time by the proxy.
 *
 * The exchange lookup (registry/exchanges/<network>.json) and the address card
 * dictionary (registry/address-card.json) are read the same way:
 *
 *   cached    ~/.chain-insights/cache/<name>.json, younger than one hour
 *   fetched   the copy on main over raw.githubusercontent.com, within 3 s,
 *             at most once an hour, never two fetches of one file in flight
 *   packaged  the copy in the installed package
 *
 * A fetched file is used only when it passes the file's rules. A malformed
 * file never replaces a good cache: the stale cache keeps answering and one
 * line names the fault. A packaged copy with a higher version than the cache
 * or the fetched file wins, so an upgrade is never answered from an older
 * file. A file merged on main reaches every running proxy within the hour,
 * with no release.
 *
 * The DEX registry (src/mcp/dex-registry.ts) keeps its own loader: its cache
 * file has its own shape, and a network it does not cover is refused.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEX_REGISTRY_FETCH_BUDGET_MS, DEX_REGISTRY_TTL_MS } from './dex-registry.js'

export type PublicFileSource = 'fetched' | 'cached' | 'packaged'

export interface LoadedPublicFile<T> {
  document: T
  source: PublicFileSource
}

export interface PublicFileSpec<T> {
  /** The URL of the copy on main, or its override. */
  url: string
  /** The cache file, under the chain-insights home. */
  cachePath: string
  /** The fault of a document, or null when it passes the rules. */
  fault: (value: unknown) => string | null
  /** The packaged copy, or null when the package carries none. */
  packaged: T | null
  /** The version of a document: the higher one wins against the packaged copy. */
  version: (document: T) => number
  /** One line per fault: a failed fetch, a malformed file, a cache that cannot be written. */
  log: (line: string) => void
}

export interface PublicFileOptions {
  fetch?: typeof fetch
  now?: () => number
  budgetMs?: number
}

interface CacheFile<T> {
  document: T
  checked_at_ms: number
  source: 'fetched' | 'packaged'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function readCache<T>(spec: PublicFileSpec<T>): Promise<CacheFile<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(spec.cachePath, 'utf8')) as unknown
    if (!isRecord(parsed) || typeof parsed.checked_at_ms !== 'number') return null
    if (parsed.source !== 'fetched' && parsed.source !== 'packaged') return null
    if (spec.fault(parsed.document) !== null) return null
    return parsed as unknown as CacheFile<T>
  } catch {
    return null
  }
}

async function writeCache<T>(target: string, file: CacheFile<T>): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  // Written beside the target and renamed, so a second proxy never reads half of it.
  const scratch = `${target}.${process.pid}.tmp`
  await writeFile(scratch, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
  await rename(scratch, target)
}

async function fetchDocument<T>(
  spec: PublicFileSpec<T>,
  options: PublicFileOptions
): Promise<{ document: T } | { fault: string }> {
  const { url } = spec
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
  const fault = spec.fault(parsed)
  return fault ? { fault: `${url} is malformed: ${fault}` } : { document: parsed as T }
}

// Loads in flight, by cache file: two calls at once share one fetch.
const inFlight = new Map<string, Promise<LoadedPublicFile<unknown> | null>>()

/**
 * The file: the fresh cache, else the public copy, else the stale cache, else
 * the packaged copy. Null when there is no copy anywhere; it never throws.
 */
export async function loadPublicFile<T>(
  spec: PublicFileSpec<T>,
  options: PublicFileOptions = {}
): Promise<LoadedPublicFile<T> | null> {
  const now = options.now ?? Date.now
  const { packaged } = spec
  const pick = (document: T, source: PublicFileSource): LoadedPublicFile<T> =>
    packaged !== null && spec.version(packaged) > spec.version(document)
      ? { document: packaged, source: 'packaged' }
      : { document, source }

  const cache = await readCache(spec)
  const age = cache ? now() - cache.checked_at_ms : Infinity
  if (cache && age >= 0 && age < DEX_REGISTRY_TTL_MS) {
    return pick(cache.document, cache.source === 'fetched' ? 'cached' : 'packaged')
  }

  const running = inFlight.get(spec.cachePath)
  if (running) return running as Promise<LoadedPublicFile<T> | null>
  const load = (async (): Promise<LoadedPublicFile<T> | null> => {
    const save = async (file: CacheFile<T>): Promise<void> => {
      try {
        await writeCache(spec.cachePath, file)
      } catch (err) {
        spec.log(
          `the cache ${spec.cachePath} could not be written: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    const outcome = await fetchDocument(spec, options)
    const checked = now()
    if ('document' in outcome) {
      await save({ document: outcome.document, checked_at_ms: checked, source: 'fetched' })
      return pick(outcome.document, 'fetched')
    }
    if (cache) {
      // The stale cache keeps answering, and the next fetch waits an hour.
      spec.log(outcome.fault)
      await save({ ...cache, checked_at_ms: checked })
      return pick(cache.document, cache.source === 'fetched' ? 'cached' : 'packaged')
    }
    if (packaged !== null) {
      spec.log(outcome.fault)
      await save({ document: packaged, checked_at_ms: checked, source: 'packaged' })
      return { document: packaged, source: 'packaged' }
    }
    return null
  })()
  inFlight.set(spec.cachePath, load)
  try {
    return await load
  } finally {
    inFlight.delete(spec.cachePath)
  }
}
