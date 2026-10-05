import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { markdownQueries, proseQueries } from './support/pool-walk-guard.js'
import { flat, markdownFiles, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// Stopgap for graph server issue 1121. Every USE facts SWAP read that returns
// `pools` fails at the warehouse query memory limit: the view builds `pools`
// from a read of every swap day that ignores the day, the address and the
// transaction bound. The view joins that read in whenever a query names
// `pools` anywhere, in RETURN, in WHERE or in ORDER BY. The read is not fixed
// here. These tests pin the text that tells readers and agents how to avoid
// it, and keep every shipped recipe from naming `pools` in a facts SWAP read.
//
// Delete this file, the Temporary notes it pins and the Temporary hint in
// src/mcp/proxy.ts when issue 1121 ships.

// The sentences every home carries, with the Markdown marks removed.
const STOPGAP_SENTENCES = [
  'Temporary, until graph server issue 1121 is fixed.',
  'Do not return, filter or order by pools in a USE facts SWAP read.',
  'Every such read fails at the warehouse query memory limit with facts query could not be completed: by address, by day and by tx_id.',
  'Only pools is built by the failing part of the warehouse view. pool_keys and families come from the main read.',
  'Read SWAP rows by tx_id, or by the payer, the recipient and one day, and leave pools out.',
  'For the pools of a swap, read SWAPPED.pools on USE topology, anchored on the payer or the recipient.',
]

// The text with whitespace folded and the Markdown marks (backticks, bold)
// removed, so one sentence matches in a skill, a doc, a served hint and the
// workspace notes.
function plain(text: string): string {
  return flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')
}

const GUIDE_HOMES = [
  'skills/chain-insights-schema-evm/SKILL.md',
  'skills/chain-insights-cypher/SKILL.md',
  'docs/graph-tools.md',
  'docs/graph-query-compatibility.md',
]

describe('stopgap for graph server issue 1121: leave pools out of a facts SWAP read', () => {
  it.each(GUIDE_HOMES)('%s carries the temporary text', (path) => {
    const text = plain(read(path))
    for (const sentence of STOPGAP_SENTENCES) {
      expect(text, `${path} lacks: ${sentence}`).toContain(sentence)
    }
    // The note says it ends with the fix.
    expect(text).toMatch(/Remove this (note|section) when it ships\./)
  })

  it('the served graph hints carry the same sentences', () => {
    const hints = plain(servedGraphHints())
    for (const sentence of STOPGAP_SENTENCES) {
      expect(hints, `served hints lack: ${sentence}`).toContain(sentence)
    }
  })

  it('the workspace runtime notes carry the same sentences', async () => {
    const notes = plain(await runtimeSkill())
    for (const sentence of STOPGAP_SENTENCES) {
      expect(notes, `runtime notes lack: ${sentence}`).toContain(sentence)
    }
  })

  it('names pools as the only affected column and says nothing about liquidity reads', () => {
    // The pools sub-read sits in the swap view only. The liquidity views carry
    // no such sub-read, so no stopgap sentence may name a liquidity read.
    for (const sentence of STOPGAP_SENTENCES) {
      expect(sentence).not.toMatch(/LIQUIDITY/i)
    }
    const hints = servedGraphHints()
    const hint = hints.split('\n').find((line) => line.includes('graph server issue 1121')) ?? ''
    expect(hint).toContain('Temporary, until graph server issue 1121 is fixed.')
    expect(hint).not.toMatch(/LIQUIDITY/i)
  })

  it('the SWAP property table tells the reader not to use pools', () => {
    const facts = read('skills/chain-insights-schema-evm/SKILL.md')
    const parties = facts.split('\n').find((line) => line.startsWith('| Parties')) ?? ''
    expect(flat(parties)).toContain('`pools` (in route order; do not return, filter or order by it')
  })

  it('the dialect skill no longer promises pools from one facts swap route', () => {
    const cypher = flat(read('skills/chain-insights-cypher/SKILL.md'))
    expect(cypher).not.toContain('One swap route, its strength and pools')
    expect(cypher).toContain('One swap route and its strength')
  })
})

// A USE facts SWAP read: the SWAP relationship type is served on facts only.
// SWAPPED, the topology link, is a different type and is not matched. The type
// may stand alone or in a union, in either place: [s:SWAP], [:SWAP|LIQUIDITY_ADD],
// [:LIQUIDITY_ADD|SWAP].
const FACTS_SWAP = /\[[^\]]*:\s*(?:`?\w+`?\s*\|\s*)*`?SWAP`?\s*(?=[\]{|])/

// A facts SWAP read that names pools anywhere: a `.pools` property reference in
// RETURN, WHERE, ORDER BY or a map projection, or a `pools:` key. The view
// joins the pools read in whenever the query names the column. `.pool_keys`
// is another column and does not match.
function namesPoolsInFactsSwap(query: string): boolean {
  if (!FACTS_SWAP.test(query)) return false
  return /\.\s*`?pools`?(?![\w])|[{,]\s*`?pools`?\s*:/.test(query)
}

describe('no shipped recipe names pools in a facts SWAP read', () => {
  it('the detector tells a facts SWAP read of pools from the reads that stay valid', () => {
    const clean =
      'USE facts MATCH (payer:Address)-[s:SWAP]->(recipient:Address) WHERE s.tx_id = "0x1" RETURN s.route_id AS route_id LIMIT 10'
    expect(namesPoolsInFactsSwap(clean)).toBe(false)
    // Returned.
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', ', s.pools AS pools LIMIT'))).toBe(true)
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', ', s.`pools` AS p LIMIT'))).toBe(true)
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', ', s {.pools} AS p LIMIT'))).toBe(true)
    // Filtered.
    expect(namesPoolsInFactsSwap(clean.replace('"0x1"', '"0x1" AND size(s.pools) > 1'))).toBe(true)
    expect(namesPoolsInFactsSwap(clean.replace('s.tx_id = "0x1"', '$pool IN s.pools'))).toBe(true)
    // Ordered.
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', 'ORDER BY s.pools LIMIT'))).toBe(true)
    // A union of relationship types, with SWAP in either place.
    expect(
      namesPoolsInFactsSwap(
        clean.replace('[s:SWAP]', '[s:LIQUIDITY_ADD|SWAP]').replace('LIMIT', ', s.pools AS p LIMIT')
      )
    ).toBe(true)
    expect(
      namesPoolsInFactsSwap(
        clean.replace('[s:SWAP]', '[s:SWAP|LIQUIDITY_ADD]').replace('LIMIT', ', s.pools AS p LIMIT')
      )
    ).toBe(true)
    // The other columns of the same read stay valid.
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', ', s.pool_keys AS keys LIMIT'))).toBe(false)
    expect(namesPoolsInFactsSwap(clean.replace('LIMIT', ', s.families AS f LIMIT'))).toBe(false)
    // SWAPPED is the topology link: its pools are the read that stays valid.
    expect(
      namesPoolsInFactsSwap(
        'USE topology MATCH (a:Address {address: $addr})-[s:SWAPPED]->(b:Address) RETURN s.pools AS pools LIMIT 25'
      )
    ).toBe(false)
    expect(
      namesPoolsInFactsSwap(
        'USE topology MATCH (a:Address {address: $addr})-[s:SWAP|SWAPPED]->(b:Address) RETURN s.pools AS pools LIMIT 25'
      )
    ).toBe(true)
  })

  it('no documented recipe, corpus query, skill, doc, hint or runtime note names pools in one', async () => {
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
    // The guard is not vacuous: the dialect skill and the tools guide each
    // ship one facts SWAP read that returns rows.
    expect(
      swapReads.filter(({ query }) => /\bRETURN\b/i.test(query)).map(({ name }) => name)
    ).toEqual(
      expect.arrayContaining(['skills/chain-insights-cypher/SKILL.md', 'docs/graph-tools.md'])
    )

    const violations = swapReads
      .filter(({ query }) => namesPoolsInFactsSwap(query))
      .map(({ name, query }) => `${name}: ${flat(query)}`)
    expect(violations).toEqual([])
  })
})
