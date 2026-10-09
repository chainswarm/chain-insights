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
  SKILL_VERSION_FILE,
  compareVersions,
  packagedSkillsDir,
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

  it('setup stamps the copy it installs, so the next start of the same release changes nothing', () => {
    const version = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version
    execSync(`node ${join(__dirname, '..', 'bin', 'install.cjs')} --codex`, {
      env: { ...process.env, HOME: home },
      stdio: 'pipe',
    })
    const dir = join(home, '.codex', 'skills', SKILL)
    expect(readFileSync(join(dir, SKILL_VERSION_FILE), 'utf8')).toBe(`${version}\n`)

    const result = refreshInstalledSkills(version, { home, sourceDir: packagedSkillsDir() })
    expect(result.refreshed).toEqual([])
    expect(result.skipped).toContainEqual({ dir, reason: 'current' })
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
