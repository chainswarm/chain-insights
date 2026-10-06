import path from 'node:path'
import os from 'node:os'

// One home and one lifetime for every file cache of the package: the tool list
// (mcp-schema.json) and the graph schema (cache/schema-<network>-<endpoint>.json).
// The home is read at call time so a test can point HOME at a temporary
// directory.

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function chainInsightsHome(): string {
  return path.join(os.homedir(), '.chain-insights')
}
