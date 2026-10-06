import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ROUTING_ADDRESS_ON_CHAIN, ROUTING_LINES } from '../src/mcp/layer-routing.js'
import { chainCatalogue, chainLookupProblem, chainLookupsIn } from './support/chain-catalogue.js'
import { read, servedGraphHints } from './support/schema-text.js'

// What `USE chain` serves is the server's chain catalogue, and nothing else:
// a transaction by its tx_id, a block by its block_height or its block_hash, an
// address at one block, and the head. tests/fixtures/chain-catalogue.json pins
// those labels, with the keys and the properties of each, the way
// tests/fixtures/server-refusal-codes.json pins the codes. Regenerate it from the
// server's main branch with
// `node scripts/pin-chain-catalogue.mjs --catalogue <the catalogue> --commit <sha>`,
// and prove a committed pin with the same command and `--check`.
//
// The first catalogue had no address lookup, and a routing line that offered one
// sent an agent to `chain_not_served`. The catalogue now serves `Address`, and the
// routing line offers it for a balance, a nonce or a kind, now or at a past block.
// A kind is never a lookup label: `Account` and `Contract` are refused.

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
    expect(catalogue.computed_on_every_label).toContain('network')
    for (const entry of catalogue.labels) {
      expect(entry.answers, `${entry.label} answers nothing`).not.toBe('')
      expect(entry.properties.length, `${entry.label} serves no property`).toBeGreaterThan(0)
      for (const key of entry.keys) {
        // `at_block` picks the block of an Address lookup. It is a key and never a property.
        if (key === 'at_block') continue
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
        computed_on_every_label: Object.fromEntries(
          catalogue.computed_on_every_label.map((name) => [name, {}])
        ),
        labels: Object.fromEntries(
          catalogue.labels.map((entry) => [
            entry.label,
            {
              answers: entry.answers,
              keys: Object.fromEntries(entry.keys.map((key) => [key, key])),
              optional_keys: Object.fromEntries(entry.optional_keys.map((key) => [key, key])),
              ...(entry.key_rule ? { key_rule: entry.key_rule } : {}),
              kind_labels: entry.kind_labels,
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

  it('serves the unified keys, and no key that was renamed', () => {
    const keysOf = (label: string) => catalogue.labels.find((entry) => entry.label === label)?.keys
    const optionalOf = (label: string) =>
      catalogue.labels.find((entry) => entry.label === label)?.optional_keys
    expect(keysOf('Transaction')).toEqual(['tx_id'])
    expect(keysOf('Block')).toEqual(['block_hash', 'block_height'])
    expect(keysOf('Address')).toEqual(['address'])
    expect(optionalOf('Address')).toEqual(['at_block'])
    expect(keysOf('Head')).toEqual([])
    const names = catalogue.labels.flatMap((entry) => [...entry.keys, ...entry.properties])
    expect(names, 'a renamed chain name is still served').not.toContain('hash')
    expect(names, 'a renamed chain name is still served').not.toContain('height')
  })

  it('serves the Address lookup, and a kind is never a lookup label', () => {
    expect(labels).toContain('Address')
    const kinds = catalogue.labels.find((entry) => entry.label === 'Address')?.kind_labels ?? []
    expect(kinds, 'the Address lookup names the kind words it answers for').toEqual(
      expect.arrayContaining(['Account', 'Contract'])
    )
    for (const kind of kinds) {
      expect(labels, `${kind} is a kind, not a lookup label`).not.toContain(kind)
    }
  })

  it('offers the Address lookup for a balance, a nonce or a kind, and says no address lookup is missing', () => {
    const line = ROUTING_ADDRESS_ON_CHAIN
    expect(line).toContain('USE chain')
    expect(line).toContain('`Address`')
    for (const word of ['balance', 'nonce', 'kind', 'at_block']) expect(line).toContain(word)
    expect(line.toLowerCase()).not.toContain('no address lookup')
  })

  it('names the depth of a past block by the field that publishes it, never by a number', () => {
    expect(ROUTING_ADDRESS_ON_CHAIN).toContain('chain_admission.at_block_min_depth')
    expect(ROUTING_ADDRESS_ON_CHAIN).not.toMatch(/\d/)
  })

  it.each(routingSurfaces)('%s offers the Address lookup of the chain layer', (name, text) => {
    expect(text().replace(/\s+/g, ' '), `${name} lacks the address sentence`).toContain(
      ROUTING_ADDRESS_ON_CHAIN
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
      chainLookupProblem('USE chain MATCH (a:Account {address: "0xabc"}) RETURN a.balance')
    ).toMatch(/names :Account, and the catalogue serves/)
    expect(
      chainLookupProblem('USE chain MATCH (a:Wallet {address: "0xabc"}) RETURN a.balance')
    ).toMatch(/names :Wallet, and the catalogue serves/)
    expect(
      chainLookupProblem(
        'USE chain MATCH (t:Transaction {tx_id: "0xabc"}) RETURN t.nonce_of_sender'
      )
    ).toMatch(/does not serve nonce_of_sender/)
    expect(
      chainLookupProblem('USE chain MATCH (t:Transaction {block_height: 7}) RETURN t.status')
    ).toMatch(/by block_height, and it takes tx_id/)
  })
})

describe('an old chain name is no key and no property of any label', () => {
  it.each([
    [
      'Transaction by hash',
      'USE chain MATCH (t:Transaction {hash: "0xabc"}) RETURN t.status',
      /by hash, and it takes tx_id/,
    ],
    [
      'Block by height',
      'USE chain MATCH (b:Block {height: 7}) RETURN b.block_hash',
      /by height, and it takes block_hash or block_height/,
    ],
    [
      'Block by hash',
      'USE chain MATCH (b:Block {hash: "0xabc"}) RETURN b.block_height',
      /by hash, and it takes block_hash or block_height/,
    ],
    [
      't.hash',
      'USE chain MATCH (t:Transaction {tx_id: "0xabc"}) RETURN t.hash',
      /does not serve hash/,
    ],
    [
      'b.height',
      'USE chain MATCH (b:Block {block_height: 7}) RETURN b.height',
      /does not serve height/,
    ],
    ['h.height', 'USE chain MATCH (h:Head) RETURN h.height', /does not serve height/],
    ['h.hash', 'USE chain MATCH (h:Head) RETURN h.hash', /does not serve hash/],
  ])('%s is refused', (_name, query, problem) => {
    expect(chainLookupProblem(query)).toMatch(problem)
  })

  it.each([
    'USE chain MATCH (t:Transaction {tx_id: "0xabc"}) RETURN t.tx_id, t.block_height, t.block_timestamp, t.network',
    'USE chain MATCH (b:Block {block_height: 7}) RETURN b.block_hash, b.block_date, b.network',
    'USE chain MATCH (b:Block {block_hash: "0xabc"}) RETURN b.block_height',
    'USE chain MATCH (h:Head) RETURN h.block_height, h.block_hash, h.network',
  ])('%s is served', (query) => {
    expect(chainLookupProblem(query)).toBeNull()
  })
})

describe('the Address lookup is one node with an address and, optionally, at_block', () => {
  it.each([
    'USE chain MATCH (a:Address {address: "0xabc"}) RETURN a.balance, a.nonce, a.is_contract',
    'USE chain MATCH (a:Address {address: "0xabc"}) RETURN a.address, a.network',
    'USE chain MATCH (a:Address {address: "0xabc"}) RETURN a.code_size, a.delegated_to LIMIT 1',
    'USE chain MATCH (a:Address {address: "0xabc", at_block: 79000000}) RETURN a.balance',
  ])('%s is served', (query) => {
    expect(chainLookupProblem(query)).toBeNull()
  })

  it.each([
    [
      'no address',
      'USE chain MATCH (a:Address {at_block: 5}) RETURN a.balance',
      /names no address/,
    ],
    ['no key', 'USE chain MATCH (a:Address) RETURN a.balance', /names no key/],
    [
      'a range',
      'USE chain MATCH (a:Address) WHERE a.at_block > 5 RETURN a.balance',
      /not one node/,
    ],
    [
      'text for at_block',
      'USE chain MATCH (a:Address {address: "0xabc", at_block: "latest"}) RETURN a.balance',
      /block number from 0/,
    ],
    [
      'the code',
      'USE chain MATCH (a:Address {address: "0xabc"}) RETURN a.code',
      /does not serve code/,
    ],
    [
      'at_block on a transaction',
      'USE chain MATCH (t:Transaction {tx_id: "0xabc", at_block: 5}) RETURN t.status',
      /by at_block, and it takes tx_id/,
    ],
  ])('%s is refused', (_name, query, problem) => {
    expect(chainLookupProblem(query)).toMatch(problem)
  })
})
