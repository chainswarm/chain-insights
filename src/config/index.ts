import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DEFAULT_CONFIG, parseInvestigatorConfig, type InvestigatorConfig } from './schema.js'
import { graphMcpEndpointEnvOverride } from './mcp-endpoint.js'

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

async function loadStoredConfig(): Promise<InvestigatorConfig> {
  const cfgPath = configPath()
  let raw: string
  try {
    raw = await readFile(cfgPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG
    }
    throw new Error(`Unable to read config ${cfgPath}: ${(err as Error).message}`)
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw) as unknown
  } catch (err) {
    throw new Error(`Invalid JSON in ${cfgPath}: ${(err as Error).message}`)
  }

  try {
    return parseInvestigatorConfig(parsedJson)
  } catch (err) {
    throw new Error(`Invalid configuration in ${cfgPath}: ${(err as Error).message}`)
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
  await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  _cached = applyRuntimeEnvOverrides(next)
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
  await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  // writeFile's mode applies only when it creates the file; an existing
  // settings file may hold an access key, so it is made owner-only here.
  await chmod(p, 0o600)
  _cached = applyRuntimeEnvOverrides(next)
  return { backupPath }
}

export async function resetConfigCache(): Promise<void> {
  _cached = null
}
