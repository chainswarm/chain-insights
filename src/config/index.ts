import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConfigSchema, DEFAULT_CONFIG, type InvestigatorConfig } from './schema.js'

// Config path derived from HOME at call time so tests can override HOME.
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}

let _cached: InvestigatorConfig | null = null

export async function loadConfig(): Promise<InvestigatorConfig> {
  if (_cached) return _cached
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    _cached = ConfigSchema.parse(parsed)
    return _cached
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(updates: Partial<InvestigatorConfig>): Promise<void> {
  const current = await loadConfig()
  const next = ConfigSchema.parse({ ...current, ...updates })
  const p = configPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  _cached = next
}

export async function resetConfigCache(): Promise<void> {
  _cached = null
}
