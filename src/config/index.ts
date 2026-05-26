import { readFile, writeFile, mkdir } from 'node:fs/promises'
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
  return graphMcpEndpoint
    ? parseInvestigatorConfig({ ...config, graphMcpEndpoint })
    : config
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

export async function resetConfigCache(): Promise<void> {
  _cached = null
}
