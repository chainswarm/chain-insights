import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { moveLines, routingLines } from '../src/mcp/layer-routing.js'
import { factsReadViolations } from './support/facts-contract.js'
import { flat, read, servedGraphHints } from './support/schema-text.js'

// Every query this package teaches sits on its layer. tests/fixtures/layer-routing.json
// lists each documented recipe, each fenced query of the two skills and each query
// of the served graph hints, with the layer it goes to. The generator writes it
// (npm run corpus:generate). Each entry meets the rule of its layer:
//
//   topology  an admit case of tests/fixtures/topology-shape-cases.json
//   facts     a pair with one day, or a transaction hash, unless it is a refused
//             recipe that names the code it must get
//   chain     one node of Transaction, Block or Head, literal keys, a RETURN of
//             properties, and at most LIMIT 1
//
// The routing lines and the move by class live in src/mcp/layer-routing.ts. The
// served hints are built from it, and the cypher skill and the guide hold the
// same lines word for word.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const routingPath = join(repoRoot, 'tests/fixtures/layer-routing.json')
const tempDir = mkdtempSync(join(tmpdir(), 'layer-routing-'))

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

type Layer = 'topology' | 'facts' | 'chain'
type RoutingEntry = {
  id: string
  layer: Layer
  anchor: string
  query: string
  source: string
  expects_code?: string
}
type RoutingFile = { rules_version: string; entries: RoutingEntry[] }

const routing = JSON.parse(readFileSync(routingPath, 'utf8')) as RoutingFile

// The problem of a chain lookup, or null. A chain lookup is one node of a label
// the layer serves, with its key in braces as a literal, a RETURN of properties
// of that node, and no WHERE, no relationship and no range.
const CHAIN_LOOKUP =
  /^USE chain MATCH \((\w+):(Transaction|Block|Head)(?: \{([^{}]*)\})?\) RETURN ((?:\w+\.\w+)(?:, \w+\.\w+)*)(?: LIMIT (\d+))?$/
const LITERAL_KEY = String.raw`(?:"[^"$]*"|\d+)`

function chainProblem(query: string): string | null {
  const found = CHAIN_LOOKUP.exec(query)
  if (!found) {
    return 'is not one node of Transaction, Block or Head with a RETURN of properties'
  }
  const [, variable, label, keys, returned, limit] = found
  if (limit !== undefined && Number(limit) > 1) return `has a LIMIT of ${limit}, at most 1`
  for (const item of (returned ?? '').split(', ')) {
    if (!item.startsWith(`${variable}.`))
      return `returns ${item}, which is not a property of ${variable}`
  }
  const key = new RegExp(String.raw`^(\w+): (${LITERAL_KEY})$`).exec(keys ?? '')
  if (label === 'Head') return keys === undefined ? null : 'names a key, and Head takes none'
  if (keys === undefined) return `names no key, and ${label} takes one`
  if (!key) return `names a key that is not a literal: ${keys}`
  if (label === 'Transaction' && key[1] !== 'hash')
    return 'names a Transaction by something but its hash'
  if (label === 'Block' && key[1] !== 'height' && key[1] !== 'hash') {
    return 'names a Block by something but its height or its hash'
  }
  return null
}

describe('the committed routing table', () => {
  it('matches a fresh deterministic generation', { timeout: 120_000 }, () => {
    const out = join(tempDir, 'layer-routing.json')
    execFileSync('npx', ['tsx', 'scripts/generate-query-corpus.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CORPUS_OUT: join(tempDir, 'corpus.json'),
        TOPOLOGY_CASES_OUT: join(tempDir, 'cases.json'),
        LAYER_ROUTING_OUT: out,
      },
      stdio: 'pipe',
    })
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(routingPath, 'utf8'))
  })

  it('lists every entry once, with its layer, its anchor and where it came from', () => {
    expect(routing.rules_version).toBe('1')
    expect(new Set(routing.entries.map((entry) => entry.id)).size).toBe(routing.entries.length)
    const anchors: Record<Layer, string[]> = {
      topology: ['address', 'probe'],
      facts: ['pair_day', 'transaction', 'none'],
      chain: ['key', 'head'],
    }
    for (const entry of routing.entries) {
      expect(Object.keys(anchors), entry.id).toContain(entry.layer)
      expect(anchors[entry.layer], `${entry.id} anchor`).toContain(entry.anchor)
      expect(entry.query.startsWith(`USE ${entry.layer} `), `${entry.id} names its layer`).toBe(
        true
      )
      expect(entry.source, entry.id).not.toBe('')
    }
    expect(new Set(routing.entries.map((entry) => entry.layer))).toEqual(
      new Set(['topology', 'facts', 'chain'])
    )
  })

  it('holds a chain recipe for each of Transaction, Block and Head', () => {
    const chain = routing.entries.filter((entry) => entry.layer === 'chain')
    for (const label of ['Transaction', 'Block', 'Head']) {
      expect(
        chain.some((entry) => entry.query.includes(`:${label}`)),
        `no chain entry for ${label}`
      ).toBe(true)
    }
  })

  it('holds every documented recipe, every USE fenced query of the skills and every hint query', () => {
    const recipes = (
      JSON.parse(read('tests/fixtures/documented-recipes.json')) as { recipes: { id: string }[] }
    ).recipes
    const ids = new Set(routing.entries.map((entry) => entry.id))
    for (const recipe of recipes) expect(ids.has(recipe.id), recipe.id).toBe(true)
    const sources = new Set(routing.entries.map((entry) => entry.source))
    expect(sources).toContain('skills/chain-insights-cypher/SKILL.md')
    expect(sources).toContain('skills/chain-insights-schema-evm/SKILL.md')
    expect(sources).toContain('src/mcp/proxy.ts graph hints')
  })
})

describe('every entry meets the rule of its layer', () => {
  const cases = (
    JSON.parse(read('tests/fixtures/topology-shape-cases.json')) as {
      cases: { expect: string; query: string }[]
    }
  ).cases
  const admitted = new Set(cases.filter((c) => c.expect === 'admit').map((c) => c.query))

  it('every topology entry is an admit case of the topology shape cases', () => {
    for (const entry of routing.entries.filter((candidate) => candidate.layer === 'topology')) {
      expect(admitted.has(entry.query), `${entry.id} (${entry.source}) is no admit case`).toBe(true)
    }
  })

  it('every facts entry names a pair with one day or a hash, unless it is a refused recipe', () => {
    for (const entry of routing.entries.filter((candidate) => candidate.layer === 'facts')) {
      const codes = factsReadViolations(entry.query)
      if (entry.expects_code === undefined) {
        expect(codes, `${entry.id} (${entry.source})`).toEqual([])
        expect(entry.anchor, `${entry.id} names no anchor of its layer`).not.toBe('none')
      } else {
        expect(codes, `${entry.id} must get ${entry.expects_code}`).toEqual([entry.expects_code])
        expect(entry.anchor, entry.id).toBe('none')
      }
    }
  })

  it('every chain entry is one node, with literal keys, a RETURN of properties and at most LIMIT 1', () => {
    for (const entry of routing.entries.filter((candidate) => candidate.layer === 'chain')) {
      expect(chainProblem(entry.query), `${entry.id} (${entry.source}) ${entry.query}`).toBeNull()
    }
  })

  it('names the example and the problem when a chain query is a range, a search or has no literal key', () => {
    expect(chainProblem('USE chain MATCH (b:Block) WHERE b.height > 10 RETURN b.hash')).toMatch(
      /not one node/
    )
    expect(chainProblem('USE chain MATCH (b:Block {height: 10}) RETURN b.hash LIMIT 50')).toMatch(
      /LIMIT of 50/
    )
    expect(chainProblem('USE chain MATCH (t:Transaction {hash: $hash}) RETURN t.status')).toMatch(
      /not a literal/
    )
    expect(chainProblem('USE chain MATCH (t:Transaction) RETURN t.status')).toMatch(/names no key/)
    expect(chainProblem('USE chain MATCH (h:Head {height: 5}) RETURN h.height')).toMatch(
      /Head takes none/
    )
    expect(
      chainProblem('USE chain MATCH (t:Transaction {hash: "0xabc"}) RETURN t.status')
    ).toBeNull()
    expect(
      chainProblem('USE chain MATCH (b:Block {height: 7}) RETURN b.hash, b.block_date')
    ).toBeNull()
    expect(chainProblem('USE chain MATCH (h:Head) RETURN h.height LIMIT 1')).toBeNull()
  })
})

describe('the routing lines are one text in the skill, the guide and the served hints', () => {
  const surfaces: [string, () => string][] = [
    ['skills/chain-insights-cypher/SKILL.md', () => read('skills/chain-insights-cypher/SKILL.md')],
    ['docs/graph-tools.md', () => read('docs/graph-tools.md')],
    ['src/mcp/proxy.ts graph hints', servedGraphHints],
  ]

  it.each(surfaces)('%s holds each routing line word for word', (name, text) => {
    const body = flat(text())
    const missing = routingLines().filter((line) => !body.includes(line))
    expect(missing, `${name} lacks a routing line`).toEqual([])
  })

  it.each(surfaces)('%s holds the move by class word for word', (name, text) => {
    const body = flat(text())
    const missing = moveLines().filter((line) => !body.includes(line))
    expect(missing, `${name} lacks a move line`).toEqual([])
  })

  it('names the line that differs when one word of a routing line changes', () => {
    const body = flat(read('skills/chain-insights-cypher/SKILL.md')).replace(
      'I do not know the thing yet',
      'I do not know the thing now'
    )
    expect(routingLines().filter((line) => !body.includes(line))).toEqual([
      'I do not know the thing yet: `USE topology`.',
    ])
  })
})

describe('no third graph skill', () => {
  it('skills/ holds the address risk, the cypher and the schema skill only', () => {
    expect(readdirSync(join(repoRoot, 'skills')).sort()).toEqual([
      'chain-insights-address-risk',
      'chain-insights-cypher',
      'chain-insights-schema-evm',
    ])
  })

  it('the plugin carries the cypher and the schema skill, equal to skills/', () => {
    expect(readdirSync(join(repoRoot, 'plugin/skills')).sort()).toEqual([
      'chain-insights-cypher',
      'chain-insights-schema-evm',
    ])
  })
})
