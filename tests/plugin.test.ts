import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CORE_SKILL_NAME,
  pluginSkillDrift,
  pluginSkills,
  syncPluginSkills,
} from '../scripts/sync-plugin-skills.mjs'
import { publicSkillNames } from '../src/skill-refresh.js'

const root = process.cwd()

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
}

describe('Claude plugin (plugin/)', () => {
  const scratch: string[] = []
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('carries the plugin skills exactly as skills/ holds them', () => {
    expect(pluginSkills(root)[0]).toBe(CORE_SKILL_NAME)
    // The plugin and the installed copies follow one rule, read from skills/.
    expect(pluginSkills(root)).toEqual(publicSkillNames(join(root, 'skills')))
    expect(pluginSkillDrift(root)).toEqual([])
  })

  it('finds a new protocol skill in skills/ and leaves out what is no chain-insights-* skill', () => {
    const copy = mkdtempSync(join(tmpdir(), 'ci-plugin-discover-'))
    scratch.push(copy)
    cpSync(join(root, 'skills'), join(copy, 'skills'), { recursive: true })
    cpSync(join(root, 'plugin'), join(copy, 'plugin'), { recursive: true })
    for (const [name, withSkill] of [
      ['chain-insights-testproto', true],
      ['chain-insights-no-skill-file', false],
      ['rbmk-private', true],
    ] as const) {
      mkdirSync(join(copy, 'skills', name), { recursive: true })
      if (withSkill) writeFileSync(join(copy, 'skills', name, 'SKILL.md'), '# skill\n')
    }

    const found = pluginSkills(copy)
    expect(found[0]).toBe(CORE_SKILL_NAME)
    expect(new Set(found)).toEqual(new Set([...pluginSkills(root), 'chain-insights-testproto']))
    expect(found).toEqual(publicSkillNames(join(copy, 'skills')))
    expect(pluginSkillDrift(copy)).toEqual([
      'plugin/skills/chain-insights-testproto/SKILL.md: missing',
    ])
    syncPluginSkills(copy)
    expect(pluginSkillDrift(copy)).toEqual([])
    expect(existsSync(join(copy, 'plugin', 'skills', 'rbmk-private'))).toBe(false)
  })

  it('reports drift when a plugin skill differs from skills/, and a sync clears it', () => {
    const copy = mkdtempSync(join(tmpdir(), 'ci-plugin-drift-'))
    scratch.push(copy)
    cpSync(join(root, 'skills'), join(copy, 'skills'), { recursive: true })
    cpSync(join(root, 'plugin'), join(copy, 'plugin'), { recursive: true })
    writeFileSync(join(copy, 'skills', 'chain-insights-cypher', 'SKILL.md'), 'edited\n')

    expect(pluginSkillDrift(copy)).toEqual([
      'plugin/skills/chain-insights-cypher/SKILL.md: differs from skills/chain-insights-cypher/SKILL.md',
    ])
    syncPluginSkills(copy)
    expect(pluginSkillDrift(copy)).toEqual([])
  })

  it('names the plugin and keeps its version equal to the package version', () => {
    const plugin = readJson('plugin/.claude-plugin/plugin.json')
    const pkg = readJson('package.json')
    expect(plugin).toMatchObject({
      name: 'chain-insights',
      displayName: 'Chain Insights',
      version: pkg.version,
      license: 'MIT',
    })
    expect(typeof plugin.description).toBe('string')
    expect(plugin.author).toMatchObject({ name: expect.any(String) })
  })

  it('starts the local proxy over stdio from the published package at the package version', () => {
    const pkg = readJson('package.json') as { version: string; bin: Record<string, string> }
    expect(pkg.bin['chain-insights-mcp-proxy']).toBe('./bin/mcp-proxy.cjs')
    expect(readJson('plugin/.mcp.json')).toEqual({
      mcpServers: {
        'chain-insights': {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', `--package=chain-insights@${pkg.version}`, 'chain-insights-mcp-proxy'],
        },
      },
    })
    expect(readFileSync(join(root, 'plugin', '.mcp.json'), 'utf8')).not.toContain('https://')
  })

  it('ships no bin/ folder, a README of at least 40 words, and the licence', () => {
    expect(existsSync(join(root, 'plugin', 'bin'))).toBe(false)
    const readme = readFileSync(join(root, 'plugin', 'README.md'), 'utf8')
    expect(readme.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40)
    expect(readFileSync(join(root, 'plugin', 'LICENSE'), 'utf8')).toBe(
      readFileSync(join(root, 'LICENSE'), 'utf8')
    )
  })

  it('is listed by the repository marketplace with source ./plugin', () => {
    const marketplace = readJson('.claude-plugin/marketplace.json')
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: 'chain-insights', source: './plugin' }),
    ])
  })
})
