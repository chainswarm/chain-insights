import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { propertiesOf } from './support/facts-columns.js'
import { markdownQueries, proseQueries } from './support/pool-walk-guard.js'
import { flat, markdownFiles, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// The swap route is a topology question. A facts `SWAP` row carries no pools
// list and no families list: the graph server's mapping of the row names neither
// (tests/fixtures/facts-columns.json), and a read that names one of them, to
// return it, to filter on it or to order by it, is refused. The route of a swap
// is `SWAPPED.pools` and `SWAPPED.families` on `USE topology`.
//
// This file replaces the stopgap that told readers to leave `pools` out of a
// facts `SWAP` read while the warehouse could not build it. The stopgap is gone
// from every home, and the permanent rule stands in its place.

// The route columns a facts SWAP row does not serve. `pool_keys` is the third:
// the pin proves the row serves none of them, and no shipped text may name it.
const ROUTE_COLUMNS = ['pools', 'pool_keys', 'families']

// The sentences every home carries, with the Markdown marks removed.
const RULE_SENTENCES = [
  'A USE facts SWAP row carries no route: it has no pools and no families column.',
  'A read that names one of them, to return it, to filter on it or to order by it, is refused.',
  'The route of a swap stays a topology question.',
  'For the pools of the swaps of an address, read SWAPPED.pools and SWAPPED.families on USE topology, anchored on the payer or the recipient.',
  'SWAPPED has one link per payer, recipient, sold asset and bought asset, so its pools cover every route on the link, not one route.',
]

// The text with whitespace folded and the Markdown marks (backticks, bold)
// removed, so one sentence matches in a skill, a doc, a served hint and the
// workspace notes.
function plain(text: string): string {
  return flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')
}

// The guides are the homes of the swap route rule. The cypher skill is short: it
// names the pools of a swap as `SWAPPED.pools` and no facts column, and the "no
// shipped recipe names a route column" test below still reads it.
const GUIDE_HOMES = ['docs/graph-tools.md', 'docs/graph-query-compatibility.md']

// Every file a reader or an agent is shown.
const SHIPPED_TEXT = [
  'README.md',
  'src/mcp/proxy.ts',
  'src/workspace/init.ts',
  'src/investigation/public-tools.ts',
  ...GUIDE_HOMES,
  'skills/chain-insights-cypher/SKILL.md',
  'plugin/skills/chain-insights-cypher/SKILL.md',
  ...markdownFiles('docs'),
]

describe('the swap route rule stands in every home', () => {
  it.each(GUIDE_HOMES)('%s states the permanent rule', (path) => {
    const text = plain(read(path))
    for (const sentence of RULE_SENTENCES) {
      expect(text, `${path} lacks: ${sentence}`).toContain(sentence)
    }
  })

  it('the served graph hints carry the same sentences', () => {
    const hints = plain(servedGraphHints())
    for (const sentence of RULE_SENTENCES) {
      expect(hints, `served hints lack: ${sentence}`).toContain(sentence)
    }
  })

  it('the workspace runtime notes carry the same sentences', async () => {
    const notes = plain(await runtimeSkill())
    for (const sentence of RULE_SENTENCES) {
      expect(notes, `runtime notes lack: ${sentence}`).toContain(sentence)
    }
  })
})

describe('the stopgap is gone', () => {
  it('no shipped text names graph server issue 1121, a temporary note or a pool key', async () => {
    const homes: [string, string][] = [...new Set(SHIPPED_TEXT)].map(
      (path) => [path, read(path)] as [string, string]
    )
    homes.push(
      ['the served hints', servedGraphHints()],
      ['the runtime notes', await runtimeSkill()]
    )
    for (const [name, text] of homes) {
      const body = plain(text)
      expect(body, `${name} names the issue`).not.toMatch(/issue 1121/i)
      expect(body, `${name} keeps a temporary note`).not.toMatch(/Temporary, until/)
      expect(body, `${name} points at a temporary note`).not.toMatch(/temporary note/i)
      expect(body, `${name} keeps a remove-when-it-ships line`).not.toMatch(
        /Remove this (note|section) when it ships/
      )
      expect(body, `${name} names pool_keys`).not.toContain('pool_keys')
      expect(body, `${name} says to leave pools out`).not.toMatch(/leave pools out/i)
      expect(body, `${name} blames the warehouse view`).not.toMatch(/failing part of the warehouse/)
    }
  })

  it('the dialect skill no longer promises pools from one facts swap route', () => {
    const cypher = flat(read('skills/chain-insights-cypher/SKILL.md'))
    expect(cypher).not.toContain('One swap route, its strength and pools')
  })
})

describe('the facts SWAP row the texts describe is the row the server serves', () => {
  it('the served hints list no route column among the columns of a facts SWAP row', () => {
    const line =
      servedGraphHints()
        .split('\n')
        .find((candidate) => candidate.includes('is one row per swap route')) ?? ''
    expect(line, 'the served hints hold no facts SWAP row line').not.toBe('')
    const row =
      plain(line)
        .split(/\.\s/)
        .find((sentence) => sentence.includes('is one row per swap route')) ?? ''
    expect(row).toContain('route_id')
    for (const route of ROUTE_COLUMNS) {
      expect(row, `the SWAP row line lists ${route}`).not.toMatch(new RegExp(`\\b${route}\\b`))
    }
  })

  it('the pin maps no route column on SWAP, and the cypher skill sends a swap route to SWAPPED.pools', () => {
    for (const route of ROUTE_COLUMNS) {
      expect(propertiesOf('SWAP'), `the server maps ${route} on SWAP`).not.toContain(route)
    }
    const cypher = plain(read('skills/chain-insights-cypher/SKILL.md'))
    expect(cypher).toContain('A facts SWAP row has no route: the pools are SWAPPED.pools.')
  })
})

// A USE facts SWAP read: the SWAP relationship type is served on facts only.
// SWAPPED, the topology link, is a different type and is not matched. The type
// may stand alone or in a union, in either place: [s:SWAP], [:SWAP|LIQUIDITY_ADD],
// [:LIQUIDITY_ADD|SWAP].
const FACTS_SWAP = /\[[^\]]*:\s*(?:`?\w+`?\s*\|\s*)*`?SWAP`?\s*(?=[\]{|])/

// A facts SWAP read that names a route column anywhere: a `.pools`, `.pool_keys`
// or `.families` property reference in RETURN, WHERE, ORDER BY or a map
// projection, or a `pools:` key. The server refuses every one of them as an
// unmapped property.
function namesRouteInFactsSwap(query: string): boolean {
  if (!FACTS_SWAP.test(query)) return false
  const names = ROUTE_COLUMNS.join('|')
  return new RegExp(String.raw`\.\s*\`?(?:${names})\`?(?![\w])|[{,]\s*\`?(?:${names})\`?\s*:`).test(
    query
  )
}

describe('no shipped recipe names a route column in a facts SWAP read', () => {
  it('the detector tells a facts SWAP read of a route column from the reads that stay valid', () => {
    const clean =
      'USE facts MATCH (payer:Address)-[s:SWAP]->(recipient:Address) WHERE s.tx_id = "0x1" RETURN s.route_id AS route_id LIMIT 10'
    expect(namesRouteInFactsSwap(clean)).toBe(false)
    for (const column of ROUTE_COLUMNS) {
      // Returned.
      expect(namesRouteInFactsSwap(clean.replace('LIMIT', `, s.${column} AS c LIMIT`))).toBe(true)
      expect(namesRouteInFactsSwap(clean.replace('LIMIT', `, s.\`${column}\` AS c LIMIT`))).toBe(
        true
      )
      expect(namesRouteInFactsSwap(clean.replace('LIMIT', `, s {.${column}} AS c LIMIT`))).toBe(
        true
      )
      // Filtered.
      expect(namesRouteInFactsSwap(clean.replace('"0x1"', `"0x1" AND size(s.${column}) > 1`))).toBe(
        true
      )
      expect(namesRouteInFactsSwap(clean.replace('s.tx_id = "0x1"', `$pool IN s.${column}`))).toBe(
        true
      )
      // Ordered.
      expect(namesRouteInFactsSwap(clean.replace('LIMIT', `ORDER BY s.${column} LIMIT`))).toBe(true)
    }
    // A union of relationship types, with SWAP in either place.
    expect(
      namesRouteInFactsSwap(
        clean.replace('[s:SWAP]', '[s:LIQUIDITY_ADD|SWAP]').replace('LIMIT', ', s.pools AS p LIMIT')
      )
    ).toBe(true)
    expect(
      namesRouteInFactsSwap(
        clean.replace('[s:SWAP]', '[s:SWAP|LIQUIDITY_ADD]').replace('LIMIT', ', s.pools AS p LIMIT')
      )
    ).toBe(true)
    // The columns the row does serve stay valid.
    expect(namesRouteInFactsSwap(clean.replace('LIMIT', ', s.strength AS strength LIMIT'))).toBe(
      false
    )
    // SWAPPED is the topology link: its pools and families are the route that stays valid.
    expect(
      namesRouteInFactsSwap(
        'USE topology MATCH (a:Address {address: $addr})-[s:SWAPPED]->(b:Address) RETURN s.pools AS pools, s.families AS families LIMIT 25'
      )
    ).toBe(false)
    expect(
      namesRouteInFactsSwap(
        'USE topology MATCH (a:Address {address: $addr})-[s:SWAP|SWAPPED]->(b:Address) RETURN s.pools AS pools LIMIT 25'
      )
    ).toBe(true)
  })

  it('no documented recipe, corpus query, skill, doc, hint or runtime note names one', async () => {
    const surfaces: { name: string; queries: string[] }[] = [
      {
        name: 'tests/fixtures/documented-recipes.json',
        queries: (
          JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
            recipes: { query: string }[]
          }
        ).recipes.map((recipe) => recipe.query),
      },
      {
        name: 'tests/fixtures/graph-query-corpus.json',
        queries: (
          JSON.parse(read('tests/fixtures/graph-query-corpus.json')) as {
            entries: { query: string }[]
          }
        ).entries.map((entry) => entry.query),
      },
      { name: 'src/mcp/proxy.ts graph hints', queries: proseQueries(servedGraphHints()) },
      { name: 'workspace runtime notes', queries: markdownQueries(await runtimeSkill()) },
    ]
    const markdown = [
      'README.md',
      ...readdirSync('skills').map((skill) => `skills/${skill}/SKILL.md`),
      ...markdownFiles('docs'),
    ]
    for (const path of markdown) surfaces.push({ name: path, queries: markdownQueries(read(path)) })

    const swapReads = surfaces.flatMap(({ name, queries }) =>
      queries.filter((query) => FACTS_SWAP.test(query)).map((query) => ({ name, query }))
    )
    // The guard is not vacuous: the tools guide ships a facts SWAP read that
    // returns rows.
    expect(
      swapReads.filter(({ query }) => /\bRETURN\b/i.test(query)).map(({ name }) => name)
    ).toEqual(expect.arrayContaining(['docs/graph-tools.md']))

    const violations = swapReads
      .filter(({ query }) => namesRouteInFactsSwap(query))
      .map(({ name, query }) => `${name}: ${flat(query)}`)
    expect(violations).toEqual([])
  })
})
