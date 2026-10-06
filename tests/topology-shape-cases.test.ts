import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { markdownQueries, proseQueries } from './support/pool-walk-guard.js'
import { servedGraphHints } from './support/schema-text.js'

// The topology rule table. tests/fixtures/topology-shape-cases.json lists the
// queries the graph server must admit and the queries it must refuse, each
// refusal with the code and the rule word it must carry. The generator writes
// it. The graph server's own test runs the same file through its gate in both
// directions, so a skill that teaches a query the server refuses fails here
// first.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const casesPath = join(repoRoot, 'tests/fixtures/topology-shape-cases.json')
const tempDir = mkdtempSync(join(tmpdir(), 'topology-shape-cases-'))

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

type ShapeCase = {
  id: string
  expect: 'admit' | 'refuse'
  rule: string | null
  code: string | null
  query: string
  source: string
}
type CasesFile = { rules_version: string; cases: ShapeCase[] }

const SKILLS = ['skills/chain-insights-cypher/SKILL.md']

// The nine codes the shape rules can give, each with the rule words it may
// carry.
const RULE_WORDS: Record<string, string[]> = {
  aggregate_unanchored: ['aggregate'],
  anchor_missing: ['anchor'],
  cartesian_product: ['connected'],
  hop_budget: ['hops'],
  limit_missing: ['limit'],
  query_too_large: ['size', 'nesting'],
  route_search_refused: ['route'],
  unsupported_expression_shape: ['expression'],
  unsupported_topology_dialect: ['dialect'],
}

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function readCases(path = casesPath): CasesFile {
  return JSON.parse(readFileSync(path, 'utf8')) as CasesFile
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

// Every fenced block of a skill that starts with USE topology, spaces
// squashed. A $name placeholder reads as one fixed literal, the way the
// generator reads it.
function fencedTopologyQueries(markdown: string): { shown: string; asRead: string }[] {
  return [...markdown.matchAll(/^```[\w-]*\n([\s\S]*?)^```/gm)]
    .map((block) => squash(block[1] ?? ''))
    .filter((body) => body.startsWith('USE topology'))
    .map((shown) => ({ shown, asRead: shown.replace(/\$\w+/g, '"corpus-address-a"') }))
}

describe('topology shape cases', () => {
  it('the committed file matches a fresh deterministic regeneration', { timeout: 120_000 }, () => {
    const corpusOut = join(tempDir, 'corpus.json')
    const casesOut = join(tempDir, 'cases.json')
    execFileSync('npx', ['tsx', 'scripts/generate-query-corpus.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, CORPUS_OUT: corpusOut, TOPOLOGY_CASES_OUT: casesOut },
      stdio: 'pipe',
    })
    expect(readFileSync(casesOut, 'utf8')).toBe(readFileSync(casesPath, 'utf8'))
  })

  it('every fenced USE topology query of the skill is an admit case, and no refuse case is in a skill', () => {
    const { cases } = readCases()
    const admitted = new Set(cases.filter((c) => c.expect === 'admit').map((c) => c.query))
    const refused = new Set(cases.filter((c) => c.expect === 'refuse').map((c) => c.query))
    for (const skill of SKILLS) {
      const queries = fencedTopologyQueries(read(skill))
      expect(queries.length, `${skill} shows no USE topology query`).toBeGreaterThan(0)
      for (const { shown, asRead } of queries) {
        expect(
          admitted.has(asRead),
          `${skill} shows a query that is not an admit case: ${shown}`
        ).toBe(true)
        expect(
          refused.has(asRead) || refused.has(shown),
          `${skill} shows a refused query: ${shown}`
        ).toBe(false)
      }
    }
  })

  it('every refuse case names one of the nine codes with the rule word of that code', () => {
    const { rules_version: version, cases } = readCases()
    expect(version).toBe('1')
    const refused = cases.filter((c) => c.expect === 'refuse')
    for (const c of refused) {
      expect(Object.keys(RULE_WORDS), `${c.id} has the code ${String(c.code)}`).toContain(c.code)
      expect(RULE_WORDS[c.code ?? ''], `${c.id} has the rule ${String(c.rule)}`).toContain(c.rule)
    }
    // Every code has a case, so no rule goes untested.
    expect([...new Set(refused.map((c) => c.code))].sort()).toEqual(Object.keys(RULE_WORDS).sort())
    // An admit case carries no code and no rule.
    for (const c of cases.filter((x) => x.expect === 'admit')) {
      expect([c.id, c.code, c.rule]).toEqual([c.id, null, null])
    }
  })

  it('no skill, guide or served hint teaches ALL SHORTEST', () => {
    for (const path of [
      ...SKILLS,
      'docs/graph-tools.md',
      'docs/graph-query-compatibility.md',
      'src/mcp/proxy.ts',
    ]) {
      expect(read(path).includes('ALL SHORTEST'), path).toBe(false)
    }
  })

  it('every shortest-path search that a guide, a skill or a served hint shows ends in a literal LIMIT of 5000 or less', () => {
    // The route example sits in a code span and in a shell payload, which the
    // fenced-block test above does not read, so each surface is read here with
    // the readers the pool-guard test uses. A topology read without a literal
    // LIMIT is refused with limit_missing.
    const surfaces: { name: string; queries: string[] }[] = [
      { name: 'docs/graph-tools.md', queries: markdownQueries(read('docs/graph-tools.md')) },
      {
        name: 'skills/chain-insights-cypher/SKILL.md',
        queries: markdownQueries(read('skills/chain-insights-cypher/SKILL.md')),
      },
      { name: 'src/mcp/proxy.ts graph hints', queries: proseQueries(servedGraphHints()) },
    ]
    for (const { name, queries } of surfaces) {
      const searches = queries.map(squash).filter((query) => /\bSHORTEST\b/.test(query))
      // A route search is shown on every surface, so a reader that finds none
      // has stopped reading it.
      expect(
        searches.some((query) => / AS route\b/.test(query)),
        `${name} shows no route search`
      ).toBe(true)
      for (const query of searches) {
        const limit = /(?:^| )LIMIT (\d+)$/.exec(query)
        expect(
          limit,
          `${name} shows a shortest-path search with no literal LIMIT: ${query}`
        ).not.toBeNull()
        expect(
          Number(limit?.[1]),
          `${name} shows a LIMIT above 5000: ${query}`
        ).toBeLessThanOrEqual(5000)
      }
    }
  })

  it('every case is one USE topology query, listed once, and no query is both admitted and refused', () => {
    const { cases } = readCases()
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    for (const c of cases) {
      expect(c.query.startsWith('USE topology '), c.id).toBe(true)
      expect(c.source, c.id).not.toBe('')
    }
    const admitted = new Set(cases.filter((c) => c.expect === 'admit').map((c) => c.query))
    for (const c of cases.filter((x) => x.expect === 'refuse')) {
      expect(admitted.has(c.query), `${c.id} is also an admit case`).toBe(false)
    }
  })

  it('every USE topology query of the corpus and of the documented recipes is an admit case', () => {
    const { cases } = readCases()
    const admitted = new Set(cases.filter((c) => c.expect === 'admit').map((c) => c.query))
    const corpus = JSON.parse(read('tests/fixtures/graph-query-corpus.json')) as {
      entries: { builder: string; scope: string; query: string }[]
    }
    for (const entry of corpus.entries) {
      // The scope of an entry is the graph its text names.
      expect(entry.query.split(' ')[1], `scope of ${entry.builder}`).toBe(entry.scope)
      if (entry.scope === 'topology') {
        expect(admitted.has(entry.query), `corpus entry ${entry.builder}`).toBe(true)
      }
    }
    const recipes = JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
      recipes: { id: string; layer: string; query: string }[]
    }
    for (const recipe of recipes.recipes.filter((r) => r.layer === 'topology')) {
      expect(admitted.has(recipe.query), `recipe ${recipe.id}`).toBe(true)
    }
  })

  it('the whole-graph recipes are gone and the counterparty recipes return both seen times', () => {
    const { recipes } = JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
      recipes: { id: string; query: string }[]
    }
    const byId = new Map(recipes.map((r) => [r.id, r.query]))
    expect(byId.has('recipe_topology_07')).toBe(false)
    expect(byId.has('recipe_topology_09')).toBe(false)
    // recipe_topology_06 reads the largest inflows of one address.
    expect(byId.get('recipe_topology_06')).toMatch(/\(dst:Address \{address: "[^"]+"\}\)/)
    for (const id of ['recipe_topology_05', 'recipe_topology_06']) {
      const query = byId.get(id) ?? ''
      expect(query, id).toContain('first_seen_timestamp')
      expect(query, id).toContain('last_seen_timestamp')
    }
  })
})
