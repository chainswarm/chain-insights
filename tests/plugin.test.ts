import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PLUGIN_SKILLS,
  pluginSkillDrift,
  syncPluginSkills,
} from '../scripts/sync-plugin-skills.mjs'

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
    expect(PLUGIN_SKILLS).toEqual(['chain-insights-cypher', 'chain-insights-schema-evm'])
    expect(pluginSkillDrift(root)).toEqual([])
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
