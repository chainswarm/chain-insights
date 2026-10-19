import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CORE_SKILL_NAME,
  SKILL_VERSION_FILE,
  compareVersions,
  packagedSkillsDir,
  publicSkillNames,
  refreshInstalledSkills,
} from '../src/skill-refresh.js'

const SKILL = 'chain-insights-cypher'

describe('refreshInstalledSkills', () => {
  let home: string
  let source: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ci-skill-refresh-'))
    source = join(home, 'package-skills')
    mkdirSync(join(source, SKILL, 'agents'), { recursive: true })
    writeFileSync(join(source, SKILL, 'SKILL.md'), '# new rules\n')
    writeFileSync(join(source, SKILL, 'agents', 'openai.yaml'), 'new: true\n')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function install(relative: string, stamp?: string): string {
    const dir = join(home, relative, SKILL)
    mkdirSync(join(dir, 'agents'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# old rules\n')
    writeFileSync(join(dir, 'agents', 'stale.yaml'), 'old: true\n')
    if (stamp) writeFileSync(join(dir, SKILL_VERSION_FILE), `${stamp}\n`)
    return dir
  }

  it('replaces an older or unstamped copy in every place setup installed, and installs nowhere else', () => {
    const claude = install('.claude/skills', '0.49.1')
    const codex = install('.codex/skills')

    const result = refreshInstalledSkills('0.51.0', { home, sourceDir: source })

    expect(result.refreshed.sort()).toEqual([claude, codex].sort())
    expect(result.failed).toEqual([])
    for (const dir of [claude, codex]) {
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('# new rules\n')
      expect(readFileSync(join(dir, SKILL_VERSION_FILE), 'utf8')).toBe('0.51.0\n')
      expect(existsSync(join(dir, 'agents', 'stale.yaml'))).toBe(false)
      // no staged or retired copy is left next to the skill
      expect(readdirSync(join(dir, '..'))).toEqual([SKILL])
    }
    expect(existsSync(join(home, '.hermes'))).toBe(false)
  })

  it('leaves a current copy, a newer copy and a symlinked skill alone', () => {
    const current = install('.claude/skills', '0.51.0')
    const newer = install('.codex/skills', '0.52.0')
    const checkout = join(home, 'checkout', SKILL)
    mkdirSync(checkout, { recursive: true })
    writeFileSync(join(checkout, 'SKILL.md'), '# my checkout\n')
    const linked = join(home, '.hermes', 'skills', 'chain-insights', SKILL)
    mkdirSync(join(linked, '..'), { recursive: true })
    symlinkSync(checkout, linked)

    const result = refreshInstalledSkills('0.51.0', { home, sourceDir: source })

    expect(result.refreshed).toEqual([])
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { dir: current, reason: 'current' },
        { dir: newer, reason: 'newer' },
        { dir: linked, reason: 'symlink' },
      ])
    )
    expect(readFileSync(join(current, 'SKILL.md'), 'utf8')).toBe('# old rules\n')
    expect(readFileSync(join(newer, 'SKILL.md'), 'utf8')).toBe('# old rules\n')
    expect(readFileSync(join(checkout, 'SKILL.md'), 'utf8')).toBe('# my checkout\n')
  })

  it('adds a new protocol skill only beside a core skill that setup installed as a copy', () => {
    const PROTOCOL = 'chain-insights-testproto'
    mkdirSync(join(source, PROTOCOL), { recursive: true })
    writeFileSync(join(source, PROTOCOL, 'SKILL.md'), '# protocol\n')
    const claude = install('.claude/skills', '0.50.0')
    const codex = install('.codex/skills', '0.52.0') // a newer release owns this place
    const checkout = join(home, 'checkout', SKILL)
    mkdirSync(checkout, { recursive: true })
    writeFileSync(join(checkout, 'SKILL.md'), '# my checkout\n')
    const hermes = join(home, '.hermes', 'skills', 'chain-insights')
    mkdirSync(hermes, { recursive: true })
    symlinkSync(checkout, join(hermes, SKILL))

    const result = refreshInstalledSkills('0.51.0', { home, sourceDir: source })

    const added = join(claude, '..', PROTOCOL)
    expect(result.installed).toEqual([added])
    expect(result.failed).toEqual([])
    expect(readFileSync(join(added, 'SKILL.md'), 'utf8')).toBe('# protocol\n')
    expect(readFileSync(join(added, SKILL_VERSION_FILE), 'utf8')).toBe('0.51.0\n')
    expect(readdirSync(join(claude, '..')).sort()).toEqual([SKILL, PROTOCOL].sort())
    expect(existsSync(join(codex, '..', PROTOCOL))).toBe(false)
    expect(existsSync(join(hermes, PROTOCOL))).toBe(false)

    // The next start of the same release finds the protocol skill current.
    const again = refreshInstalledSkills('0.51.0', { home, sourceDir: source })
    expect(again.installed).toEqual([])
    expect(again.skipped).toContainEqual({ dir: added, reason: 'current' })
  })

  it('reads the shipped skills from the package: the core skill first, then every protocol skill', () => {
    const names = publicSkillNames(packagedSkillsDir())
    expect(names[0]).toBe(CORE_SKILL_NAME)
    for (const name of names) {
      expect(name).toMatch(/^chain-insights-[a-z0-9-]+$/)
      expect(existsSync(join(packagedSkillsDir(), name, 'SKILL.md')), name).toBe(true)
    }
    expect(names.slice(1)).toEqual(names.slice(1).sort())
  })

  it('setup stamps the copy it installs, so the next start of the same release changes nothing', () => {
    const version = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version
    execSync(`node ${join(__dirname, '..', 'bin', 'install.cjs')} --codex`, {
      env: { ...process.env, HOME: home },
      stdio: 'pipe',
    })
    const target = join(home, '.codex', 'skills')
    const result = refreshInstalledSkills(version, { home, sourceDir: packagedSkillsDir() })
    expect(result.refreshed).toEqual([])
    expect(result.installed).toEqual([])
    // Setup installed every shipped skill, the protocol skills included.
    for (const name of publicSkillNames(packagedSkillsDir())) {
      const dir = join(target, name)
      expect(readFileSync(join(dir, SKILL_VERSION_FILE), 'utf8')).toBe(`${version}\n`)
      expect(result.skipped).toContainEqual({ dir, reason: 'current' })
    }
  })
})

describe('compareVersions', () => {
  it.each([
    ['0.50.0', '0.51.0', -1],
    ['0.51.0', '0.50.9', 1],
    ['0.51.0', '0.51.0', 0],
    ['1.0.0', '0.99.99', 1],
    ['0.51.0-rc.1', '0.51.0', 0],
  ])('%s against %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })
})
