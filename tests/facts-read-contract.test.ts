import { describe, expect, it } from 'vitest'

import {
  FACTS_CODES,
  factsReadViolations,
  isFactsRead,
  shippedFactsReads,
} from './support/facts-contract.js'
import { flat, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// A `USE facts` read names an address pair with one day, or one transaction
// hash. It has one relationship and no ORDER BY. The graph server refuses
// every other read with a code. These tests keep what this package shows a
// reader or an agent inside that contract: no recipe, corpus query, skill,
// doc, served hint or workspace note carries a facts read the server refuses,
// and a recipe that documents a refusal names the one code it must get.

type Recipe = {
  id: string
  query: string
  layer: string
  admits?: boolean
  expects_code?: string
}

const recipes = (
  JSON.parse(read('tests/fixtures/documented-recipes.json')) as { recipes: Recipe[] }
).recipes
const factsRecipes = recipes.filter((recipe) => recipe.layer === 'facts')

describe('the reader of the facts limits', () => {
  const pair = 'MATCH (a:Address {address: "0xa"})-[t:TRANSFER]->(b:Address {address: "0xb"})'
  const tail = 'RETURN t.tx_id AS tx_id LIMIT 10'

  it.each([
    ['a pair and one day', `USE facts ${pair} WHERE t.block_date = "2026-07-11" ${tail}`, []],
    [
      'a transaction hash alone',
      'USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.tx_id = "0xc" RETURN t.tx_id LIMIT 10',
      [],
    ],
    ['a pair with no day', `USE facts ${pair} ${tail}`, ['facts_day_required']],
    [
      'a pair over a range of days',
      `USE facts ${pair} WHERE t.block_date >= "2026-07-01" AND t.block_date <= "2026-07-11" ${tail}`,
      ['facts_window_too_wide'],
    ],
    [
      'one address and one day',
      'USE facts MATCH (a:Address {address: "0xa"})-[t:TRANSFER]->(b:Address) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_pair_required'],
    ],
    [
      'a day alone',
      'USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_pair_required'],
    ],
    [
      'a pair with no arrow',
      'USE facts MATCH (a:Address {address: "0xa"})-[t:TRANSFER]-(b:Address {address: "0xb"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_pair_required'],
    ],
    [
      'nothing bound',
      'USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a pair and a day inside an OR',
      `USE facts ${pair} WHERE t.block_date = "2026-07-11" OR t.amount_usd > 1 ${tail}`,
      ['facts_day_required'],
    ],
    [
      'two relationships',
      'USE facts MATCH (a:Address {address: "0xa"})-[t:TRANSFER]->(m:Address)-[u:TRANSFER]->(b:Address {address: "0xb"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_hops_refused'],
    ],
    [
      'a kind label on the sender',
      'USE facts MATCH (a:Account {address: "0xa"})-[t:TRANSFER]->(b:Address {address: "0xb"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a kind label on the receiver',
      'USE facts MATCH (a:Address {address: "0xa"})-[t:TRANSFER]->(b:Contract {address: "0xb"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a second label beside Address',
      'USE facts MATCH (a:Address:Account {address: "0xa"})-[t:TRANSFER]->(b:Address {address: "0xb"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a kind label on a read by transaction',
      'USE facts MATCH (a:Account)-[t:TRANSFER]->(b:Address) WHERE t.tx_id = "0xc" RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a network filter alone is no anchor',
      'USE facts MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.network = "robinhood" RETURN t.tx_id LIMIT 10',
      ['facts_no_anchor'],
    ],
    [
      'a network filter beside a pair and one day',
      `USE facts ${pair} WHERE t.block_date = "2026-07-11" AND t.network = "robinhood" ${tail}`,
      [],
    ],
    [
      'an ORDER BY on a pair and a day',
      `USE facts ${pair} WHERE t.block_date = "2026-07-11" RETURN t.tx_id ORDER BY t.block_timestamp ASC LIMIT 1`,
      ['facts_order_not_served'],
    ],
  ])('%s', (_name, query, expected) => {
    expect(factsReadViolations(query)).toEqual(expected)
  })

  it('a topology read of a link is not a facts read', () => {
    expect(
      isFactsRead(
        'USE topology MATCH (a:Address {address: "0xa"})-[s:SWAPPED]->(b:Address) RETURN s.pools LIMIT 5'
      )
    ).toBe(false)
    expect(
      isFactsRead(
        'MATCH (a:Address {address: $addr})-[l:REMOVED_LIQUIDITY]->(b:Address) RETURN b.address LIMIT 5'
      )
    ).toBe(false)
    expect(isFactsRead('MATCH (a:Address)-[t:TRANSFER]->(b:Address) RETURN t.tx_id LIMIT 5')).toBe(
      true
    )
  })
})

describe('the documented facts recipes meet the facts read contract', () => {
  it('the file holds facts recipes of both kinds', () => {
    expect(factsRecipes.filter((recipe) => recipe.admits !== false).length).toBeGreaterThan(1)
    expect(factsRecipes.filter((recipe) => recipe.admits === false).length).toBeGreaterThan(1)
  })

  it('every admitted facts recipe names an address pair with one day, or a transaction hash', () => {
    for (const recipe of factsRecipes.filter((entry) => entry.admits !== false)) {
      expect(factsReadViolations(recipe.query), recipe.id).toEqual([])
    }
  })

  it('every refused facts recipe names the one code it must get, and breaks one limit only', () => {
    for (const recipe of factsRecipes.filter((entry) => entry.admits === false)) {
      expect(FACTS_CODES, `${recipe.id} expects_code`).toContain(recipe.expects_code)
      expect(factsReadViolations(recipe.query), recipe.id).toEqual([recipe.expects_code])
    }
  })

  it('a recipe that is admitted names no code', () => {
    for (const recipe of recipes.filter((entry) => entry.admits !== false)) {
      expect(recipe, recipe.id).not.toHaveProperty('expects_code')
    }
  })
})

describe('no shipped surface carries a facts read the contract refuses', () => {
  it('the corpus, the skills, the docs, the served hints and the workspace notes', async () => {
    const reads = await shippedFactsReads()
    // Not vacuous: the corpus, a skill, a doc and the served hints each carry one.
    const surfaces = new Set(reads.map(({ surface }) => surface))
    expect(surfaces).toContain('tests/fixtures/graph-query-corpus.json')
    expect(surfaces).toContain('tests/fixtures/documented-recipes.json')
    expect(surfaces).toContain('skills/chain-insights-cypher/SKILL.md')
    expect(surfaces).toContain('docs/graph-tools.md')
    expect(surfaces).toContain('src/mcp/proxy.ts graph hints')
    const refused = reads
      .map(({ surface, query }) => ({
        surface,
        query: flat(query),
        codes: factsReadViolations(query),
      }))
      .filter(({ codes }) => codes.length > 0)
      .map(({ surface, query, codes }) => `${surface} [${codes.join(', ')}]: ${query}`)
    expect(refused).toEqual([])
  })
})

// What each surface says a facts read needs. None of it may name a read that
// the contract refuses as one that works: one address, a day alone, a window
// of days, or the recent window an address read once got.
describe('no advice names a facts read the contract refuses as one that works', () => {
  const REFUSED_ADVICE: [string, RegExp][] = [
    ['an address-only read', /address-only/i],
    ['a recent window for an address read', /recent window/i],
    ['one address as the anchor', /address(?: equality)? on either endpoint/i],
    ['a day alone as the anchor', /bare\s+`?block_date`?\s+bound/i],
    ['an ORDER BY on a facts read', /ORDER BY t\.block_timestamp/i],
  ]

  async function advice(): Promise<[string, string][]> {
    return [
      ['skills/chain-insights-cypher/SKILL.md', read('skills/chain-insights-cypher/SKILL.md')],
      ['docs/graph-tools.md', read('docs/graph-tools.md')],
      ['src/mcp/proxy.ts graph hints', servedGraphHints()],
      ['workspace runtime notes', await runtimeSkill()],
    ]
  }

  it.each(REFUSED_ADVICE)('says nothing of %s', async (what, pattern) => {
    for (const [surface, text] of await advice()) {
      const plain = flat(text).replace(/\\?`/g, '`')
      expect(plain, `${surface} advises ${what}`).not.toMatch(pattern)
    }
  })

  it('every surface says what a facts read names: a pair with one day (a transaction is a chain read)', async () => {
    for (const [surface, text] of await advice()) {
      const plain = flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')
      expect(plain, `${surface} lacks the facts read contract`).toMatch(
        /address pair with one day/i
      )
    }
  })
})
