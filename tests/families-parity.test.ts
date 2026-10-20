import { describe, expect, it } from 'vitest'

import { familyOfLinkType, LAYER_FAMILIES } from '../src/mcp/families.js'
import { ROUTING_NOT_SERVED } from '../src/mcp/layer-routing.js'
import { flat, read } from './support/schema-text.js'

// src/mcp/families.json is a verbatim copy of the graph server's own family
// table. Three readers must agree
// on it: the server's own reply (`graph_progress.families` of
// meta_network_capabilities), this package's copy, and the whole-chain rule of
// the skill, which names a family by its Head property (`behind_money`) and
// pairs each link type with that property. A family renamed, reordered or
// regrouped on one side fails here.
//
// Two replies are read: tests/fixtures/network-capabilities-robinhood-families.json,
// the 2026-10-13 reply with the families block of the design added (the agreed
// `cia network` screen is drawn from it), and
// tests/fixtures/network-capabilities-robinhood-20261017.json, the live reply of
// lane B on 2026-10-17 01:50 CEST, the first server that served families. That
// reply is a recording and holds the five families of its day; the sixth,
// `transfers`, came with the per-asset money links, so the recording is held to
// the table up to the families it served.

type ReplyFamily = { name: string; layers: string[] }
type Reply = { graph_progress: { families: ReplyFamily[] } }
// The families a reply must hold: all of the table, or for the recording of
// 2026-10-17 the first five.
const replies: [string, Reply, number][] = [
  ['tests/fixtures/network-capabilities-robinhood-families.json', LAYER_FAMILIES.length] as const,
  ['tests/fixtures/network-capabilities-robinhood-20261017.json', 5] as const,
].map(([file, count]) => [file, JSON.parse(read(file)) as Reply, count])

const RULE_SURFACES: [string, string][] = [
  ['skills/chain-insights-cypher/SKILL.md', read('skills/chain-insights-cypher/SKILL.md')],
  [
    'plugin/skills/chain-insights-cypher/SKILL.md',
    read('plugin/skills/chain-insights-cypher/SKILL.md'),
  ],
  ['docs/graph-tools.md', read('docs/graph-tools.md')],
  ['src/mcp/layer-routing.ts', ROUTING_NOT_SERVED],
]

/** The families the rule names, read from its `behind_<family>` properties. */
function familiesNamedIn(rule: string): string[] {
  return [...new Set([...rule.matchAll(/`(?:h\.)?behind_([a-z_]+)`/g)].map((match) => match[1]!))]
}

describe('the family table', () => {
  it('holds six families, transfers last, with the layer transfers_by_asset', () => {
    expect(LAYER_FAMILIES.map((family) => family.name)).toEqual([
      'money',
      'dex',
      'interactions',
      'smart_accounts',
      'annotations',
      'transfers',
    ])
    expect(LAYER_FAMILIES.at(-1)).toEqual({
      name: 'transfers',
      layers: ['transfers_by_asset'],
      link_types: ['TRANSFERRED'],
    })
  })

  for (const [file, served, count] of replies) {
    it(`is the server reply ${file}: the same names, in the same order, with the same layers`, () => {
      expect(LAYER_FAMILIES.slice(0, count).map(({ name, layers }) => ({ name, layers }))).toEqual(
        served.graph_progress.families.map(({ name, layers }) => ({ name, layers }))
      )
    })
  }

  it('gives every link type one family, and annotations none', () => {
    const types = LAYER_FAMILIES.flatMap((family) => family.link_types)
    expect(new Set(types).size).toBe(types.length)
    for (const family of LAYER_FAMILIES) {
      for (const type of family.link_types) expect(familyOfLinkType(type)?.name).toBe(family.name)
    }
    expect(LAYER_FAMILIES.find((family) => family.name === 'annotations')?.link_types).toEqual([])
    expect(familyOfLinkType('FLOWS_TO')?.name).toBe('money')
    expect(familyOfLinkType('SWAPPED')?.name).toBe('dex')
    expect(familyOfLinkType('TRANSFERRED')?.name).toBe('transfers')
    expect(familyOfLinkType('NOT_A_LINK')).toBeUndefined()
  })
})

describe('the whole-chain rule and the family table', () => {
  for (const [surface, text] of RULE_SURFACES) {
    it(`${surface}: names only families of the table, and holds the rule word for word`, () => {
      expect(flat(text)).toContain(ROUTING_NOT_SERVED)
      const named = familiesNamedIn(ROUTING_NOT_SERVED)
      expect(named).toEqual(['money', 'dex', 'transfers'])
      const names = LAYER_FAMILIES.map((family) => family.name)
      for (const name of named) expect(names, `the rule names family ${name}`).toContain(name)
    })
  }

  it('pairs each link type it names with the Head property of that link type family', () => {
    // "a `FLOWS_TO` search is sent when `behind_money` ...; a `SWAPPED`,
    // `ADDED_LIQUIDITY` or `REMOVED_LIQUIDITY` search when `behind_dex` ...; a
    // `TRANSFERRED` search when `behind_transfers` ..."
    const pairs = [
      ...ROUTING_NOT_SERVED.matchAll(
        /a ((?:`[A-Z_]+`(?:, | or )?)+) search (?:is sent )?when `behind_([a-z_]+)`/g
      ),
    ].map((match) => ({
      types: [...match[1]!.matchAll(/`([A-Z_]+)`/g)].map((type) => type[1]!),
      family: match[2]!,
    }))
    expect(pairs).toEqual([
      { types: ['FLOWS_TO'], family: 'money' },
      { types: ['SWAPPED', 'ADDED_LIQUIDITY', 'REMOVED_LIQUIDITY'], family: 'dex' },
      { types: ['TRANSFERRED'], family: 'transfers' },
    ])
    for (const { types, family } of pairs) {
      for (const type of types) expect(familyOfLinkType(type)?.name, type).toBe(family)
    }
    // Every dex link type has its limit: none of them is left out of the rule.
    expect(pairs[1]!.types).toEqual(
      LAYER_FAMILIES.find((entry) => entry.name === 'dex')!.link_types
    )
  })
})

describe('the family table in the skill text', () => {
  // Rows of the skill's family table:
  // | name | `layer`, `layer` | `LINK`, ... or none | `behind_x` |
  // The name is plain text: a snake_case name in backquotes at the start of a
  // row reads as a refusal code row (tests/refusal-moves.test.ts).
  function skillTable(text: string) {
    return text
      .split('\n')
      .filter((line) => /^\| [a-z_]+\s+\|/.test(line))
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => LAYER_FAMILIES.some((family) => family.name === cells[1]))
      .map((cells) => ({
        name: cells[1]!,
        layers: [...cells[2]!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!),
        link_types: [...cells[3]!.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]!),
        head: cells[4]!.replaceAll('`', ''),
      }))
  }

  for (const file of [
    'skills/chain-insights-cypher/SKILL.md',
    'plugin/skills/chain-insights-cypher/SKILL.md',
  ]) {
    it(`${file}: lists the six families of src/mcp/families.json, with their Head property`, () => {
      const rows = skillTable(read(file))
      expect(rows.map(({ name, layers, link_types }) => ({ name, layers, link_types }))).toEqual(
        LAYER_FAMILIES.map(({ name, layers, link_types }) => ({ name, layers, link_types }))
      )
      expect(rows.map((row) => row.head)).toEqual([
        'behind_money',
        'behind_dex',
        'behind_interactions',
        'behind_smart_accounts',
        'annotations_fresh',
        'behind_transfers',
      ])
    })
  }
})
