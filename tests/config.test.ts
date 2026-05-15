import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Config system (FOUND-05)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('returns DEFAULT_CONFIG when config file absent', async () => {
    // Dynamic import after HOME override so config path resolves to fakeHome
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.serverPort).toBe(4321)
    expect(config.version).toBe('1')
    expect(config.graphMcpMode).toBe('paid')
  })

  it('loads config values from config.json on disk', async () => {
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    await writeFile(configPath, JSON.stringify({ serverPort: 5000, version: '1' }), { mode: 0o600 })
    const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    const config = await loadConfig()
    expect(config.serverPort).toBe(5000)
  })

  it('saveConfig writes file with 0o600 permissions', async () => {
    const { saveConfig, resetConfigCache } = await import('../src/config/index.js')
    await resetConfigCache()
    await saveConfig({ serverPort: 9999 })
    const { stat } = await import('node:fs/promises')
    const st = await stat(join(fakeHome, '.chain-insights', 'config.json'))
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })
})
