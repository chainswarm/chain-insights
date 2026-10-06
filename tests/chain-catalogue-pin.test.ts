import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ROUTING_LINES, ROUTING_NO_ADDRESS_ON_CHAIN } from '../src/mcp/layer-routing.js'
import { chainCatalogue, chainLookupProblem, chainLookupsIn } from './support/chain-catalogue.js'
import { read, servedGraphHints } from './support/schema-text.js'

// What `USE chain` serves is the server's chain catalogue, and nothing else:
// a transaction by its hash, a block by its number or its hash, and the head.
// tests/fixtures/chain-catalogue.json pins those labels, with the keys and the
// properties of each, the way tests/fixtures/server-refusal-codes.json pins the
// codes. Regenerate it from the server's main branch with
// `node scripts/pin-chain-catalogue.mjs --catalogue <the catalogue> --commit <sha>`,
// and prove a committed pin with the same command and `--check`.
//
// The catalogue has no address lookup. The routing line said "I know one
// address, hash or block", so an agent that knew an address sent it to the chain
// layer and got `chain_not_served` back. The line now names only what the
// catalogue serves, and `ROUTING_NO_ADDRESS_ON_CHAIN` sends an address to
// topology to find it and then to facts for the rows.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogue = chainCatalogue()
const labels = catalogue.labels.map((entry) => entry.label)

type RoutingEntry = { id: string; layer: string; query: string; source: string }
const routing = (
  JSON.parse(read('tests/fixtures/layer-routing.json')) as { entries: RoutingEntry[] }
).entries

// Every text this package ships that may write a `USE chain` query.
const surfaces: [string, () => string][] = [
  ['skills/chain-insights-cypher/SKILL.md', () => read('skills/chain-insights-cypher/SKILL.md')],
  [
    'plugin/skills/chain-insights-cypher/SKILL.md',
    () => read('plugin/skills/chain-insights-cypher/SKILL.md'),
  ],
  ['docs/graph-tools.md', () => read('docs/graph-tools.md')],
  ['src/mcp/proxy.ts graph hints', servedGraphHints],
]

// Every surface teaches the routing: each holds the routing lines word for word.
const routingSurfaces = surfaces

describe('the pinned chain catalogue', () => {
  it('names the commit it was read from, and gives each label its keys and properties', () => {
    expect(catalogue.server_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(catalogue.labels.length).toBeGreaterThan(0)
    for (const entry of catalogue.labels) {
      expect(entry.answers, `${entry.label} answers nothing`).not.toBe('')
      expect(entry.properties.length, `${entry.label} serves no property`).toBeGreaterThan(0)
      for (const key of entry.keys) {
        expect(entry.properties, `${entry.label} key ${key}`).toContain(key)
      }
    }
  })

  it('is the pin that scripts/pin-chain-catalogue.mjs writes', async () => {
    const { pinChainCatalogue } = (await import(
      join(repoRoot, 'scripts/pin-chain-catalogue.mjs')
    )) as { pinChainCatalogue: (text: string, commit: string) => unknown }
    const committed = readFileSync(join(repoRoot, 'tests/fixtures/chain-catalogue.json'), 'utf8')
    // The server's catalogue, as the pin keeps it: a round trip proves the
    // committed file is a projection of a catalogue and holds no other field.
    const roundTrip = pinChainCatalogue(
      JSON.stringify({
        rules_version: catalogue.rules_version,
        grammar: catalogue.grammar,
        labels: Object.fromEntries(
          catalogue.labels.map((entry) => [
            entry.label,
            {
              answers: entry.answers,
              keys: Object.fromEntries(entry.keys.map((key) => [key, key])),
              ...(entry.key_rule ? { key_rule: entry.key_rule } : {}),
              properties: Object.fromEntries(entry.properties.map((name) => [name, {}])),
            },
          ])
        ),
      }),
      catalogue.server_commit
    )
    expect(`${JSON.stringify(roundTrip, null, 2)}\n`).toBe(committed)
  })
})

describe('the chain routing line names only what the catalogue serves', () => {
  it('names a word for each label the catalogue serves', () => {
    const line = ROUTING_LINES[2].toLowerCase()
    const unnamed = labels.filter((label) => !line.includes(label.toLowerCase()))
    expect(unnamed, 'the chain routing line names no word for these labels').toEqual([])
  })

  it('offers no lookup the catalogue refuses', () => {
    // `Address` is a topology and a facts label. The catalogue has none, so the
    // line may not invite one.
    expect(labels.map((label) => label.toLowerCase())).not.toContain('address')
    expect(ROUTING_LINES[2].toLowerCase()).not.toContain('address')
  })

  it('sends an address to topology to find it and to facts for the rows', () => {
    expect(ROUTING_NO_ADDRESS_ON_CHAIN).toContain('USE topology')
    expect(ROUTING_NO_ADDRESS_ON_CHAIN).toContain('USE facts')
    expect(ROUTING_NO_ADDRESS_ON_CHAIN.indexOf('USE topology')).toBeLessThan(
      ROUTING_NO_ADDRESS_ON_CHAIN.indexOf('USE facts')
    )
  })

  it.each(routingSurfaces)('%s sends an address away from the chain layer', (name, text) => {
    expect(text().replace(/\s+/g, ' '), `${name} lacks the address sentence`).toContain(
      ROUTING_NO_ADDRESS_ON_CHAIN
    )
  })
})

describe('every USE chain query this package teaches is in the catalogue', () => {
  it('the routing table holds one recipe for each label the catalogue serves', () => {
    const chain = routing.filter((entry) => entry.layer === 'chain')
    for (const label of labels) {
      expect(
        chain.some((entry) => entry.query.includes(`:${label}`)),
        `no chain entry for ${label}`
      ).toBe(true)
    }
  })

  it('every chain entry of the routing table names a served label, key and property', () => {
    for (const entry of routing.filter((candidate) => candidate.layer === 'chain')) {
      expect(
        chainLookupProblem(entry.query),
        `${entry.id} (${entry.source}) ${entry.query}`
      ).toBeNull()
    }
  })

  it.each(surfaces)('%s writes no lookup outside the catalogue', (name, text) => {
    const found = chainLookupsIn(text())
    for (const query of found) {
      expect(chainLookupProblem(query), `${name}: ${query}`).toBeNull()
    }
  })

  it('the cypher skill shows a lookup for each label, so the reader meets them all', () => {
    const found = chainLookupsIn(read('skills/chain-insights-cypher/SKILL.md'))
    for (const label of labels) {
      expect(
        found.some((query) => query.includes(`:${label}`)),
        `the cypher skill shows no ${label} lookup`
      ).toBe(true)
    }
  })

  it('names the label and the served ones when a query asks for a label the catalogue lacks', () => {
    expect(
      chainLookupProblem('USE chain MATCH (a:Address {address: "0xabc"}) RETURN a.address')
    ).toMatch(/names :Address, and the catalogue serves/)
    expect(
      chainLookupProblem('USE chain MATCH (t:Transaction {hash: "0xabc"}) RETURN t.nonce_of_sender')
    ).toMatch(/does not serve nonce_of_sender/)
    expect(
      chainLookupProblem('USE chain MATCH (t:Transaction {block_height: 7}) RETURN t.status')
    ).toMatch(/by block_height, and it takes hash/)
  })
})
