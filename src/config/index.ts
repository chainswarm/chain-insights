import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DEFAULT_CONFIG, parseInvestigatorConfig, type InvestigatorConfig } from './schema.js'
import {
  DEFAULT_GRAPH_MCP_ENDPOINT,
  graphMcpEndpointEnvOverride,
  savedGraphMcpEndpointChoice,
} from './mcp-endpoint.js'

// Config path derived from HOME at call time so tests can override HOME.
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}

let _cached: InvestigatorConfig | null = null

function applyRuntimeEnvOverrides(config: InvestigatorConfig): InvestigatorConfig {
  let graphMcpEndpoint: string | undefined
  try {
    graphMcpEndpoint = graphMcpEndpointEnvOverride()
  } catch (err) {
    throw new Error(`Invalid configuration in environment: ${(err as Error).message}`)
  }
  return graphMcpEndpoint ? parseInvestigatorConfig({ ...config, graphMcpEndpoint }) : config
}

async function readStoredJson(): Promise<Record<string, unknown> | null> {
  const cfgPath = configPath()
  let raw: string
  try {
    raw = await readFile(cfgPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw new Error(`Unable to read config ${cfgPath}: ${(err as Error).message}`)
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Invalid JSON in ${cfgPath}: ${(err as Error).message}`)
  }
}

/**
 * Parses a config file. A saved production endpoint is not a choice (see
 * savedGraphMcpEndpointChoice): it reads as the build's default.
 */
function parseStoredConfig(stored: Record<string, unknown>): InvestigatorConfig {
  const saved = typeof stored.graphMcpEndpoint === 'string' ? stored.graphMcpEndpoint : undefined
  const choice = savedGraphMcpEndpointChoice(saved)
  const { graphMcpEndpoint: _ignored, ...rest } = stored
  return parseInvestigatorConfig(choice ? { ...rest, graphMcpEndpoint: choice } : rest)
}

/**
 * What a config file holds: the endpoint only when it is the user's own
 * choice. The default is never written, so a file saved by a `next` build
 * does not pin staging into a later `latest` install, nor the reverse.
 */
function storedForm(config: InvestigatorConfig): Record<string, unknown> {
  if (
    savedGraphMcpEndpointChoice(config.graphMcpEndpoint) &&
    config.graphMcpEndpoint !== DEFAULT_GRAPH_MCP_ENDPOINT
  ) {
    return { ...config }
  }
  const { graphMcpEndpoint: _default, ...rest } = config
  return rest
}

async function loadStoredConfig(): Promise<InvestigatorConfig> {
  const stored = await readStoredJson()
  if (stored === null) return DEFAULT_CONFIG
  try {
    return parseStoredConfig(stored)
  } catch (err) {
    throw new Error(`Invalid configuration in ${configPath()}: ${(err as Error).message}`)
  }
}

export async function loadConfig(): Promise<InvestigatorConfig> {
  if (_cached) return _cached
  _cached = applyRuntimeEnvOverrides(await loadStoredConfig())
  return _cached
}

export async function saveConfig(updates: Partial<InvestigatorConfig>): Promise<void> {
  const current = await loadStoredConfig()
  let next: InvestigatorConfig
  try {
    next = parseInvestigatorConfig({ ...current, ...updates })
  } catch (err) {
    throw new Error(`Invalid configuration update: ${(err as Error).message}`)
  }
  const p = configPath()
  await mkdir(path.dirname(p), { recursive: true })
  const stored = storedForm(next)
  await writeFile(p, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 })
  // Read back as a load would, so the cache and the file agree.
  _cached = applyRuntimeEnvOverrides(parseStoredConfig(stored))
}

/**
 * Puts every setting back to its default and returns the backup path. The
 * wallet stays: its key lives in wallet.json, which is not touched, and its
 * address is kept. The previous file is copied to config.json.bak first.
 */
export async function resetConfig(): Promise<{ backupPath: string | null }> {
  const p = configPath()
  let previous: string | null = null
  try {
    previous = await readFile(p, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Unable to read config ${p}: ${(err as Error).message}`)
    }
  }
  let walletAddress: string | undefined
  if (previous !== null) {
    try {
      const parsed = JSON.parse(previous) as { walletAddress?: unknown }
      if (typeof parsed.walletAddress === 'string') walletAddress = parsed.walletAddress
    } catch {
      // A broken file is still backed up and replaced by the defaults.
    }
  }
  await mkdir(path.dirname(p), { recursive: true })
  let backupPath: string | null = null
  if (previous !== null) {
    backupPath = `${p}.bak`
    await writeFile(backupPath, previous, { mode: 0o600 })
    await chmod(backupPath, 0o600)
  }
  const next = parseInvestigatorConfig(walletAddress ? { walletAddress } : {})
  await writeFile(p, JSON.stringify(storedForm(next), null, 2) + '\n', { mode: 0o600 })
  // writeFile's mode applies only when it creates the file; an existing
  // settings file may hold an access key, so it is made owner-only here.
  await chmod(p, 0o600)
  _cached = applyRuntimeEnvOverrides(next)
  return { backupPath }
}

export async function resetConfigCache(): Promise<void> {
  _cached = null
}
