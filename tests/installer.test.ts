import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('--claude preserves a user-owned ci-* skill dir it does not ship', () => {
    // A user's own skill that merely shares the "ci-" prefix must not be
    // deleted by a clean reinstall.
    const userSkillDir = join(fakeHome, '.claude', 'skills', 'ci-my-user-skill')
    mkdirSync(userSkillDir, { recursive: true })
    writeFileSync(join(userSkillDir, 'SKILL.md'), '# my own skill\n', 'utf8')

    execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })

    // User skill survives; the shipped ci-status skill is still installed.
    expect(existsSync(join(userSkillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(fakeHome, '.claude', 'skills', 'ci-status', 'SKILL.md'))).toBe(true)
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

  it('--claude does not throw even when claude CLI registration step fails', () => {
    // The installer must complete successfully even when claude mcp add fails
    // (claude CLI may not be on PATH in CI environments)
    expect(() => {
      execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    }).not.toThrow()
  })

  it('--claude outputs MCP proxy registration result containing chain-insights-proxy', () => {
    const result = execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const output = result.toString()
    // Either registered successfully or printed the manual instruction
    expect(output).toContain('chain-insights-proxy')
  })

  it('--claude proxy bin path in output contains mcp-proxy.cjs (CR-03: CJS shim, not raw .mjs)', () => {
    const result = execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
    const output = result.toString()
    expect(output).toContain('mcp-proxy.cjs')
  })

  it('--hermes copies Chain Insights skills to ~/.hermes/skills/chain-insights/', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --hermes`, { stdio: 'pipe' })
    const skillPath = join(fakeHome, '.hermes', 'skills', 'chain-insights', 'chain-insights-investigation', 'SKILL.md')
    expect(existsSync(skillPath)).toBe(true)
  })

  it('--hermes registers Chain Insights MCP in ~/.hermes/config.yaml', () => {
    execSync(`HOME=${fakeHome} node bin/install.cjs --hermes`, { stdio: 'pipe' })
    const configPath = join(fakeHome, '.hermes', 'config.yaml')
    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('mcp_servers:')
    expect(raw).toContain('  chain-insights:')
    expect(raw).toContain('    command: "node"')
    expect(raw).toContain('    enabled: true')
    expect(raw).toContain('mcp-proxy.cjs')
  })

  it('--hermes replaces an existing chain-insights MCP entry without removing other servers', () => {
    const hermesDir = join(fakeHome, '.hermes')
    mkdirSync(hermesDir, { recursive: true })
    const configPath = join(hermesDir, 'config.yaml')
    writeFileSync(configPath, [
      'mcp_servers:',
      '  other:',
      '    command: "npx"',
      '    args:',
      '    - "other-server"',
      '  chain-insights:',
      '    command: "old"',
      '    args:',
      '    - "old.js"',
      '    enabled: false',
      '',
    ].join('\n'), 'utf8')

    execSync(`HOME=${fakeHome} node bin/install.cjs --hermes`, { stdio: 'pipe' })

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('  other:')
    expect(raw).toContain('    - "other-server"')
    expect(raw).toContain('    command: "node"')
    expect(raw).toContain('    enabled: true')
    expect(raw).not.toContain('old.js')
  })
})
