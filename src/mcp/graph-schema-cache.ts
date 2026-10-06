import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CACHE_TTL_MS, chainInsightsHome } from './cache-location.js'
import type { GraphSchemaDocument } from './graph-schema.js'

// The graph schema of one network on one endpoint, kept on disk beside the tool
// list cache (src/mcp/schema-cache.ts) with the same home and the same 24 hour
// lifetime: ~/.chain-insights/cache/schema-<network>-<endpoint hash>.json.
//
// A schema built while a read failed is kept for a short time only. Kept for
// 24 hours, one refused or rate-limited read would hide a section of the schema
// for a whole day.

/** How long a schema with a failed read stays fresh. */
export const PARTIAL_SCHEMA_TTL_MS = 10 * 60 * 1000

interface GraphSchemaCacheFile {
  cached_at: number
  complete: boolean
  endpoint: string
  document: GraphSchemaDocument
}

function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 12)
}

/** The cache file of a network on an endpoint. The network is an identifier already checked by the caller. */
export function graphSchemaCachePath(network: string, endpoint: string): string {
  return path.join(chainInsightsHome(), 'cache', `schema-${network}-${endpointHash(endpoint)}.json`)
}

/**
 * The cached schema, marked cached, or null when there is none, it is stale, or
 * the file cannot be read. A cache is derived data: a damaged file is a miss and
 * the next build replaces it.
 */
export async function loadGraphSchemaCache(
  network: string,
  endpoint: string,
  now: Date
): Promise<GraphSchemaDocument | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(graphSchemaCachePath(network, endpoint), 'utf8'))
  } catch {
    return null
  }
  const file = parsed as Partial<GraphSchemaCacheFile> | null
  if (
    !file ||
    typeof file.cached_at !== 'number' ||
    file.endpoint !== endpoint ||
    file.document?.schema !== 'chain-insights.graph-schema.v1'
  ) {
    return null
  }
  const lifetime = file.complete === true ? CACHE_TTL_MS : PARTIAL_SCHEMA_TTL_MS
  const age = now.getTime() - file.cached_at
  if (age < 0 || age > lifetime) return null
  return { ...file.document, cached: true }
}

/** `network` is the name the caller asked for, the same one a later load asks with. */
export async function saveGraphSchemaCache(
  network: string,
  document: GraphSchemaDocument,
  endpoint: string,
  complete: boolean,
  now: Date
): Promise<void> {
  const target = graphSchemaCachePath(network, endpoint)
  const file: GraphSchemaCacheFile = {
    cached_at: now.getTime(),
    complete,
    endpoint,
    document: { ...document, cached: false },
  }
  await mkdir(path.dirname(target), { recursive: true })
  // Written beside the target and renamed, so a second proxy reading the file
  // never sees half of it.
  const scratch = `${target}.${process.pid}.tmp`
  await writeFile(scratch, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
  await rename(scratch, target)
}
