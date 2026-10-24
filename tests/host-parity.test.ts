import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import { readRegistry, repoRoot } from './dex-registry.js'

// Host parity: a rule a host never loads does not exist for that host. Claude
// Desktop chat and claude.ai load no skill file, ignore the server
// instructions and never call meta_rules; they read tool descriptions and
// result hints only. So every protocol skill names a tool door:
//
//   1. skills/chain-insights-<protocol>/SKILL.md carries `door: <tool>` in its frontmatter;
//   2. the door is a local tool of the proxy, in LOCAL_TOOL_NAMES of src/mcp/proxy.ts;
//   3. the door's description names the skill's trigger words: at least one of
//      the exchange names the skill's own description names;
//   4. the skill names the door in its text, as its first step.
//
// The core skill chain-insights-cypher is exempt: its door is meta_rules plus
// the graph_query description. The host matrix is in docs/mcp-proxy.md.

const CORE_SKILL = 'chain-insights-cypher'

function protocolSkills(root: string): string[] {
  return readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^chain-insights-[a-z0-9-]+$/.test(entry.name) &&
        entry.name !== CORE_SKILL
    )
    .filter((entry) => existsSync(join(root, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

function frontMatter(text: string): Record<string, string> {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  return Object.fromEntries(
    head.split('\n').flatMap((line) => {
      const at = line.indexOf(': ')
      return at < 0 ? [] : [[line.slice(0, at), line.slice(at + 2)]]
    })
  )
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The exchange names (display names and aliases of the served registry) a text names as words. */
function exchangeNames(text: string, root: string): string[] {
  const names = readRegistry(root).rows.flatMap((row) => [row.display, ...row.aliases])
  return [...new Set(names)]
    .filter((name) => name.length >= 3)
    .filter((name) => new RegExp(`(^|[^A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'i').test(text))
    .sort()
}

/** What breaks host parity, one line per skill: "path: why". */
export function hostParityProblems(root: string = repoRoot): string[] {
  const problems: string[] = []
  for (const name of protocolSkills(root)) {
    const path = `skills/${name}/SKILL.md`
    const text = readFileSync(join(root, path), 'utf8')
    const meta = frontMatter(text)
    const door = meta['door']?.trim()
    if (!door) {
      problems.push(`${path}: no door: line in the frontmatter`)
      continue
    }
    if (!LOCAL_TOOL_NAMES.has(door)) {
      problems.push(`${path}: door ${door} is not a local tool of the proxy`)
      continue
    }
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[door] ?? ''
    const triggers = exchangeNames(meta['description'] ?? '', root)
    if (triggers.length === 0) {
      problems.push(
        `${path}: its description names no exchange of the registry, so no door can carry its trigger words`
      )
    } else if (
      exchangeNames(description, root).filter((word) => triggers.includes(word)).length === 0
    ) {
      problems.push(
        `${path}: the description of ${door} names none of its trigger words (${triggers.join(', ')})`
      )
    }
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
    if (!body.includes(`\`${door}\``))
      problems.push(`${path}: the skill never names its door ${door}`)
  }
  return problems
}

describe('host parity', () => {
  const copy = mkdtempSync(join(tmpdir(), 'host-parity-'))
  afterAll(() => rmSync(copy, { recursive: true, force: true }))

  it('every protocol skill names a local tool door that carries its trigger words', () => {
    expect(protocolSkills(repoRoot)).toEqual([
      'chain-insights-dex',
      'chain-insights-dex-gauge',
      'chain-insights-dex-launchpad',
      'chain-insights-dex-vault',
      'chain-insights-virtuals',
    ])
    expect(hostParityProblems()).toEqual([])
  })

  it('the exchange skills and Virtuals open on meta_dex_lookup', () => {
    for (const name of protocolSkills(repoRoot)) {
      expect(
        frontMatter(readFileSync(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8'))['door'],
        name
      ).toBe('meta_dex_lookup')
    }
  })

  it('the graph_query description points a named exchange at the door', () => {
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']).toContain(
      'A question that names an exchange and no address starts with meta_dex_lookup, never with a scan of :Protocol, :Pool or labels.'
    )
  })

  it('a skill with its door: line removed is red, naming its path', () => {
    for (const dir of ['skills', 'registry'])
      cpSync(join(repoRoot, dir), join(copy, dir), { recursive: true })
    const path = join(copy, 'skills/chain-insights-dex-gauge/SKILL.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^door: .*\n/m, ''))
    expect(hostParityProblems(copy)).toEqual([
      'skills/chain-insights-dex-gauge/SKILL.md: no door: line in the frontmatter',
    ])
  })

  it('a new protocol skill with no door is red, naming its path', () => {
    const dir = join(copy, 'skills/chain-insights-kyber')
    cpSync(join(repoRoot, 'skills/chain-insights-dex-gauge'), dir, { recursive: true })
    const path = join(dir, 'SKILL.md')
    writeFileSync(
      path,
      readFileSync(path, 'utf8')
        .replace(/^door: .*\n/m, '')
        .replace('name: chain-insights-dex-gauge', 'name: chain-insights-kyber')
    )
    expect(hostParityProblems(copy)).toContain(
      'skills/chain-insights-kyber/SKILL.md: no door: line in the frontmatter'
    )
  })

  it('a door that is not a local tool is red', () => {
    const path = join(copy, 'skills/chain-insights-dex-vault/SKILL.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^door: .*$/m, 'door: graph_query'))
    expect(hostParityProblems(copy)).toContain(
      'skills/chain-insights-dex-vault/SKILL.md: door graph_query is not a local tool of the proxy'
    )
  })
})
