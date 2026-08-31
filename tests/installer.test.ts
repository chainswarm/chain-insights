import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const reviewedSkills = [
  'chain-insights-address-risk',
  'chain-insights-cypher',
  'chain-insights-schema-bittensor',
  'chain-insights-schema-evm',
]

const retiredSkills = [
  'chain-insights-bittensor-cypher',
  'chain-insights-developer-experience',
  'chain-insights-investigation',
  'chain-insights-monitoring',
  'ci-status',
  'test-chain-insights-graph',
]

const installTargets = [
  ['--claude', '.claude/skills'],
  ['--codex', '.codex/skills'],
  ['--hermes', '.hermes/skills/chain-insights'],
] as const

describe('Installer (FOUND-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(
      tmpdir(),
      `ci-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(fakeHome, { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  for (const [flag, relativeTarget] of installTargets) {
    it(`${flag} installs only the reviewed set and cleans known stale skills`, () => {
      const target = join(fakeHome, relativeTarget)
      const userSkillDir = join(target, 'ci-my-user-skill')
      mkdirSync(userSkillDir, { recursive: true })
      writeFileSync(join(userSkillDir, 'SKILL.md'), '# my own skill\n', 'utf8')

      for (const name of retiredSkills) {
        const staleSkillDir = join(target, name)
        mkdirSync(staleSkillDir, { recursive: true })
        writeFileSync(join(staleSkillDir, 'SKILL.md'), '# stale\n', 'utf8')
      }

      execSync(`HOME=${fakeHome} node bin/install.cjs ${flag}`, { stdio: 'pipe' })

      for (const name of reviewedSkills) {
        expect(existsSync(join(target, name, 'SKILL.md'))).toBe(true)
      }
      for (const name of retiredSkills) {
        expect(existsSync(join(target, name))).toBe(false)
      }
      expect(existsSync(join(userSkillDir, 'SKILL.md'))).toBe(true)
    })
  }

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

  for (const flag of ['--claude', '--codex', '--hermes']) {
    it(`${flag} fresh setup defaults Chain Insights Graph to production`, () => {
      execSync(`HOME=${fakeHome} node bin/install.cjs ${flag}`, { stdio: 'pipe' })
      const configPath = join(fakeHome, '.chain-insights', 'config.json')
      const raw = readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(raw) as { graphMcpEndpoint: string }
      expect(parsed.graphMcpEndpoint).toBe('https://mcp.chain-insights.ai/')
    })
  }

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
    const skillPath = join(
      fakeHome,
      '.hermes',
      'skills',
      'chain-insights',
      'chain-insights-cypher',
      'SKILL.md'
    )
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
    writeFileSync(
      configPath,
      [
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
      ].join('\n'),
      'utf8'
    )

    execSync(`HOME=${fakeHome} node bin/install.cjs --hermes`, { stdio: 'pipe' })

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('  other:')
    expect(raw).toContain('    - "other-server"')
    expect(raw).toContain('    command: "node"')
    expect(raw).toContain('    enabled: true')
    expect(raw).not.toContain('old.js')
  })
})
