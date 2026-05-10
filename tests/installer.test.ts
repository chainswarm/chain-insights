import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

describe('Installer (FOUND-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(fakeHome, { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('--claude copies ci-status SKILL.md to ~/.claude/skills/ci-status/', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const skillPath = join(fakeHome, '.claude', 'skills', 'ci-status', 'SKILL.md')
    expect(existsSync(skillPath)).toBe(true)
  })

  it('--claude copies ci-case SKILL.md to ~/.claude/skills/ci-case/', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const skillPath = join(fakeHome, '.claude', 'skills', 'ci-case', 'SKILL.md')
    expect(existsSync(skillPath)).toBe(true)
  })

  it('--claude creates ~/.chain-insights/config.json', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    expect(existsSync(configPath)).toBe(true)
  })

  it('config.json has 0o600 permissions', async () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    const st = await stat(configPath)
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('config.json contains valid JSON with serverPort 4321', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const configPath = join(fakeHome, '.chain-insights', 'config.json')
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as { serverPort: number }
    expect(parsed.serverPort).toBe(4321)
  })
})
