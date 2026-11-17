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
import { EXCHANGE_OPENING_RULE } from '../src/mcp/exchange-tool.js'
import { LEVEL_RULE } from '../src/mcp/layer-routing.js'
import { readRegistry, repoRoot } from './dex-registry.js'

// Host parity: a rule a host never loads does not exist for that host. Claude
// Desktop chat and claude.ai load no skill file, ignore the server
// instructions and never call meta_rules; they read tool descriptions and
// result hints only. So every protocol skill names a tool door:
//
//   1. skills/chain-insights-<protocol>/SKILL.md carries `door: <tool>` in its
//      frontmatter, or `door: <tool>, <tool>` for a skill with two doors;
//   2. each door is a local tool of the proxy, in LOCAL_TOOL_NAMES of src/mcp/proxy.ts;
//   3. each door's description names the skill's trigger words: at least one of
//      the exchange names the skill's own description names. The names are the
//      display names and aliases of the DEX registry (registry/<network>.json)
//      and of the centralized exchange lookup (registry/exchanges/<network>.json);
//   4. the skill names each door in its text, as its first step.
//
// The core skill chain-insights-cypher is exempt: its door is meta_rules plus
// the graph_query description. The host matrix is in docs/mcp-proxy.md.
//
// The level rule (money is read on three levels) lives in the descriptions of
// graph_query and meta_dex_lookup, and every skill that teaches the levels
// repeats it word for word. A skill that holds the rule while a description
// misses it is red: a rule in a skill only does not exist for Desktop chat.

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

/** The display names and aliases of every centralized exchange lookup file. */
function centralizedExchangeNames(root: string): string[] {
  const dir = join(root, 'registry', 'exchanges')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      const document = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        rows: Array<{ display: string; aliases: string[] }>
      }
      return document.rows.flatMap((row) => [row.display, ...row.aliases])
    })
}

/** The exchange names (display names and aliases of the served registries) a text names as words. */
function exchangeNames(text: string, root: string): string[] {
  const names = [
    ...readRegistry(root).rows.flatMap((row) => [row.display, ...row.aliases]),
    ...centralizedExchangeNames(root),
  ]
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
    const doors = (meta['door'] ?? '')
      .split(',')
      .map((door) => door.trim())
      .filter((door) => door !== '')
    if (doors.length === 0) {
      problems.push(`${path}: no door: line in the frontmatter`)
      continue
    }
    const triggers = exchangeNames(meta['description'] ?? '', root)
    if (triggers.length === 0) {
      problems.push(
        `${path}: its description names no exchange of the registry, so no door can carry its trigger words`
      )
    }
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
    for (const door of doors) {
      if (!LOCAL_TOOL_NAMES.has(door)) {
        problems.push(`${path}: door ${door} is not a local tool of the proxy`)
        continue
      }
      const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[door] ?? ''
      if (
        triggers.length > 0 &&
        exchangeNames(description, root).filter((word) => triggers.includes(word)).length === 0
      ) {
        problems.push(
          `${path}: the description of ${door} names none of its trigger words (${triggers.join(', ')})`
        )
      }
      if (!body.includes(`\`${door}\``))
        problems.push(`${path}: the skill never names its door ${door}`)
    }
  }
  return problems
}

/** The tools whose description carries the level rule. */
export const LEVEL_RULE_DOORS = ['graph_query', 'meta_dex_lookup'] as const

/** The skills that teach the levels, core skill included. */
export const LEVEL_SKILLS = [
  'chain-insights-cypher',
  'chain-insights-dex',
  'chain-insights-dex-gauge',
  'chain-insights-dex-launchpad',
  'chain-insights-dex-vault',
  'chain-insights-virtuals',
] as const

const flatText = (text: string) => text.replace(/\s+/g, ' ')

/**
 * The sentences of a Markdown text that name a level ("level 0", "level 1",
 * "level 2"), with headings, bullets and bold marks dropped.
 */
export function levelSentences(markdown: string): string[] {
  const text = flatText(
    markdown
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .split('\n')
      .filter((line) => !/^#{1,6} /.test(line))
      .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))
      .join('\n')
      .replace(/\*\*/g, '')
  )
  return text
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\blevel [012]\b/.test(sentence))
}

/** What breaks the level rule's host parity, one line per problem. */
export function levelRuleProblems(
  root: string = repoRoot,
  descriptions: Record<string, string> = KNOWN_PUBLIC_TOOL_DESCRIPTIONS
): string[] {
  const problems: string[] = []
  const doors = LEVEL_RULE_DOORS.map((door) => flatText(descriptions[door] ?? ''))
  for (const door of LEVEL_RULE_DOORS) {
    if (!(descriptions[door] ?? '').includes(LEVEL_RULE))
      problems.push(`the description of ${door} misses the level rule`)
  }
  for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, 'skills', entry.name)
    const skillPath = `skills/${entry.name}/SKILL.md`
    if (
      (LEVEL_SKILLS as readonly string[]).includes(entry.name) &&
      !(existsSync(join(root, skillPath)) &&
        flatText(readFileSync(join(root, skillPath), 'utf8')).includes(LEVEL_RULE))
    )
      problems.push(`${skillPath}: teaches the levels without the level rule`)
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
      for (const sentence of levelSentences(readFileSync(join(dir, file), 'utf8'))) {
        if (!doors.some((door) => door.includes(sentence)))
          problems.push(
            `skills/${entry.name}/${file}: "${sentence}" is in a skill only, in neither ${LEVEL_RULE_DOORS.join(' nor ')}`
          )
      }
    }
  }
  return problems
}

describe('host parity', () => {
  const copy = mkdtempSync(join(tmpdir(), 'host-parity-'))
  afterAll(() => rmSync(copy, { recursive: true, force: true }))

  it('every protocol skill names a local tool door that carries its trigger words', () => {
    expect(protocolSkills(repoRoot)).toEqual([
      'chain-insights-aml-exchange',
      'chain-insights-dex',
      'chain-insights-dex-gauge',
      'chain-insights-dex-launchpad',
      'chain-insights-dex-vault',
      'chain-insights-virtuals',
    ])
    expect(hostParityProblems()).toEqual([])
  })

  it('the exchange skills and Virtuals open on meta_dex_lookup', () => {
    for (const name of protocolSkills(repoRoot).filter((skill) => skill !== 'chain-insights-aml-exchange')) {
      expect(
        frontMatter(readFileSync(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8'))['door'],
        name
      ).toBe('meta_dex_lookup')
    }
  })

  it('the centralized exchange skill opens on its two doors, and each carries the opening rule', () => {
    const text = readFileSync(join(repoRoot, 'skills/chain-insights-aml-exchange/SKILL.md'), 'utf8')
    expect(frontMatter(text)['door']).toBe('meta_exchange_lookup, aml_exchange_deposit_check')
    const flat = text.replace(/\s+/g, ' ').replace(/\*\*/g, '').replace(/`/g, '')
    for (const door of ['meta_exchange_lookup', 'aml_exchange_deposit_check']) {
      expect(LOCAL_TOOL_NAMES.has(door), door).toBe(true)
      expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS[door], door).toContain(EXCHANGE_OPENING_RULE)
    }
    expect(flat).toContain(EXCHANGE_OPENING_RULE)
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']).toContain(
      'A question that names a centralized exchange (Binance, OKX, Bitget) starts with meta_exchange_lookup'
    )
  })

  it('a door of a two-door skill that is no local tool is red, naming the door', () => {
    const dir = join(copy, 'two-doors')
    for (const sub of ['skills', 'registry'])
      cpSync(join(repoRoot, sub), join(dir, sub), { recursive: true })
    const path = join(dir, 'skills/chain-insights-aml-exchange/SKILL.md')
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /^door: .*$/m,
        'door: meta_exchange_lookup, aml_exchange_screen'
      )
    )
    expect(hostParityProblems(dir)).toEqual([
      'skills/chain-insights-aml-exchange/SKILL.md: door aml_exchange_screen is not a local tool of the proxy',
    ])
  })

  it('the graph_query description points a named exchange at the door', () => {
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']).toContain(
      'A question that names an exchange and no address starts with meta_dex_lookup, never with a scan of :Protocol, :Pool or labels.'
    )
  })

  it('a token named by its ticker has a door every host reads: meta_token_lookup', () => {
    // The core skill is exempt from the protocol-skill door rule, so this door
    // is held here: a local tool, a description that carries the collision
    // rule, the graph_query description pointing at it, and the skill row.
    expect(LOCAL_TOOL_NAMES.has('meta_token_lookup')).toBe(true)
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS['meta_token_lookup'] ?? ''
    expect(description).toContain('Tickers collide: never treat the first row as the token.')
    expect(description).toContain('do not search the web')
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']).toContain('starts with meta_token_lookup')
    const skill = readFileSync(join(repoRoot, 'skills', CORE_SKILL, 'SKILL.md'), 'utf8')
    expect(skill).toContain(
      '| The user names a token by its ticker or name, no contract    | none       | Call `meta_token_lookup {network, symbol}` first; several candidates are clones, name them and ask |'
    )
  })

  it('the core skill and the graph_query description both say what :IssuerFrozen means, beside :Sanctioned', () => {
    const meaning = 'an issuer froze this wallet; the token in labels says which'
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']
    expect(description).toContain(`:IssuerFrozen (is_issuer_frozen) means ${meaning}`)
    expect(description.indexOf(':Sanctioned')).toBeGreaterThan(-1)
    expect(description.indexOf(':Sanctioned')).toBeLessThan(description.indexOf(':IssuerFrozen'))
    const skill = readFileSync(join(repoRoot, 'skills', CORE_SKILL, 'SKILL.md'), 'utf8')
    expect(skill.replace(/`/g, '')).toContain(`:IssuerFrozen means ${meaning}`)
    expect(skill).toContain('`is_issuer_frozen`')
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

  it('the level rule is in the descriptions of graph_query and meta_dex_lookup, and in the six skills', () => {
    for (const door of LEVEL_RULE_DOORS)
      expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS[door], door).toContain(LEVEL_RULE)
    expect(LOCAL_TOOL_NAMES.has('meta_dex_lookup')).toBe(true)
    expect(levelRuleProblems()).toEqual([])
  })

  it('the level rule in chain-insights-cypher with no graph_query description is red: a rule in a skill only', () => {
    const descriptions = { ...KNOWN_PUBLIC_TOOL_DESCRIPTIONS, graph_query: 'Run a read.' }
    const problems = levelRuleProblems(repoRoot, descriptions)
    expect(problems).toContain('the description of graph_query misses the level rule')
    // The pool sentence is served by graph_query only: without it, it is in a skill only.
    expect(problems).toContain(
      'skills/chain-insights-cypher/SKILL.md: "A pool has no level 2 link." is in a skill only, in neither graph_query nor meta_dex_lookup'
    )
  })

  it('a level sentence a skill adds and no door serves is red, naming the file', () => {
    const dir = join(copy, 'new-level-sentence')
    cpSync(join(repoRoot, 'skills'), join(dir, 'skills'), { recursive: true })
    const path = join(dir, 'skills/chain-insights-dex/reference.md')
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nA vault is a level 1 hub.\n`)
    expect(levelRuleProblems(dir)).toEqual([
      'skills/chain-insights-dex/reference.md: "A vault is a level 1 hub." is in a skill only, in neither graph_query nor meta_dex_lookup',
    ])
  })

  it('a level skill that drops the rule is red, naming its path', () => {
    const dir = join(copy, 'levels')
    cpSync(join(repoRoot, 'skills'), join(dir, 'skills'), { recursive: true })
    const path = join(dir, 'skills/chain-insights-dex-vault/SKILL.md')
    writeFileSync(path, flatText(readFileSync(path, 'utf8')).replace(LEVEL_RULE, ''))
    expect(levelRuleProblems(dir)).toEqual([
      'skills/chain-insights-dex-vault/SKILL.md: teaches the levels without the level rule',
    ])
  })

  it('a door that is not a local tool is red', () => {
    const path = join(copy, 'skills/chain-insights-dex-vault/SKILL.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^door: .*$/m, 'door: graph_query'))
    expect(hostParityProblems(copy)).toContain(
      'skills/chain-insights-dex-vault/SKILL.md: door graph_query is not a local tool of the proxy'
    )
  })
})
