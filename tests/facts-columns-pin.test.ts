import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { factsColumns, propertiesOf } from './support/facts-columns.js'

// The columns of a facts row are the graph server's own. The swap route left the
// `SWAP` row, and `TRANSFER` gained `kind`. tests/fixtures/facts-columns.json pins
// the properties each facts relationship serves, the way
// tests/fixtures/facts-contract.json pins the read contract. Regenerate it from
// the server's main branch with
// `node scripts/pin-facts-columns.mjs --mapping <the mapping> --commit <sha>`, and
// prove a committed pin with the same command and `--check`.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pin = factsColumns()

describe('the pinned facts columns', () => {
  it('names the commit it was read from and the five facts relationships', () => {
    expect(pin.server_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(pin.relationships.map((entry) => entry.relationship).sort()).toEqual([
      'BRIDGE_CROSSING',
      'LIQUIDITY_ADD',
      'LIQUIDITY_REMOVE',
      'SWAP',
      'TRANSFER',
    ])
    for (const entry of pin.relationships) {
      expect(entry.properties.length, `${entry.relationship} serves no property`).toBeGreaterThan(0)
      expect(new Set(entry.properties).size, `${entry.relationship} repeats a property`).toBe(
        entry.properties.length
      )
    }
  })

  it('names no repository path: no value holds a path of the server', () => {
    const values: string[] = []
    JSON.stringify(pin, (_key, value: unknown) => {
      if (typeof value === 'string') values.push(value)
      return value
    })
    for (const value of values) expect(value, value).not.toMatch(/[/\\]|\.go\b|\.json\b/)
  })

  it('is the pin that scripts/pin-facts-columns.mjs writes', async () => {
    const { pinFactsColumns } = (await import(join(repoRoot, 'scripts/pin-facts-columns.mjs'))) as {
      pinFactsColumns: (text: string, commit: string) => unknown
    }
    const committed = readFileSync(join(repoRoot, 'tests/fixtures/facts-columns.json'), 'utf8')
    // The server's mapping, as the pin keeps it: a round trip proves the committed
    // file is a projection of a mapping and holds no other field.
    const roundTrip = pinFactsColumns(
      JSON.stringify({
        nodes: [],
        edges: pin.relationships.map((entry) => ({
          rel_type: entry.relationship,
          table: 'a_view',
          properties: Object.fromEntries(entry.properties.map((name) => [name, name])),
        })),
      }),
      pin.server_commit
    )
    expect(`${JSON.stringify(roundTrip, null, 2)}\n`).toBe(committed)
  })
})

describe('what the server serves on a SWAP row and a TRANSFER row', () => {
  it('a SWAP row carries no route: no pools list, no families list, no pool keys', () => {
    const swap = propertiesOf('SWAP')
    for (const route of ['pools', 'pool_keys', 'families']) {
      expect(swap, `a facts SWAP row serves ${route}`).not.toContain(route)
    }
  })

  it('a SWAP row keeps the route_id label, the strength and the two sides', () => {
    const swap = propertiesOf('SWAP')
    for (const property of ['route_id', 'strength', 'reason', 'payer', 'recipient']) {
      expect(swap).toContain(property)
    }
    expect(swap.filter((name) => name.startsWith('sold_')).length).toBeGreaterThan(0)
    expect(swap.filter((name) => name.startsWith('bought_')).length).toBeGreaterThan(0)
  })

  it('a TRANSFER row carries kind, and no call-tree property', () => {
    const transfer = propertiesOf('TRANSFER')
    expect(transfer).toContain('kind')
    for (const callTree of ['call_type', 'call_depth', 'parent_call_index']) {
      expect(transfer, `a facts TRANSFER row serves ${callTree}`).not.toContain(callTree)
    }
  })
})
