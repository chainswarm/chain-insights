import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  renderIndexMemo,
  renderVirtualsMemo,
  staleTargets,
  withBlock,
} from '../scripts/render-dex-brands.mjs'
import { readAdapters, readBrands, repoRoot, TRAIL_TYPES } from './dex-brands.js'

// The pinned brand registry (tests/fixtures/dex-brands.json) is the memo every
// exchange skill reads: a brand's aliases, its trail type, its factories or its
// manager, and its routers. This T1 test keeps the file honest, and keeps the
// memo the skills carry equal to the file. The live read of every row is the
// brand part of tests/graph-marks-live.integration.test.ts.

const ADDRESS = /^0x[0-9a-f]{40}$/
const SOURCE = /^https:\/\/github\.com\/chainswarm\/AP1000\/blob\/[^/]+\/.+/

describe('the pinned brand registry', () => {
  const brands = readBrands()

  it('names the network, the day it was recorded and the registry version', () => {
    expect(brands.network).toBe('robinhood')
    expect(brands.recorded_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isInteger(brands.registry_version) && brands.registry_version >= 0).toBe(true)
  })

  it("holds the registry version the package's chainInsights.dexRegistryVersion names", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      chainInsights?: { dexRegistryVersion?: number }
    }
    expect(pkg.chainInsights?.dexRegistryVersion).toBe(brands.registry_version)
  })

  it('writes every address in full and lower case', () => {
    for (const row of brands.rows) {
      for (const address of [...row.factories, ...row.routers, ...Object.keys(row.roles ?? {})]) {
        expect(address, row.brand).toMatch(ADDRESS)
      }
      if (row.example_pool !== '') expect(row.example_pool, row.brand).toMatch(ADDRESS)
    }
  })

  it('links every row to its source in the brand registry', () => {
    for (const row of brands.rows) expect(row.source, row.brand).toMatch(SOURCE)
  })

  it('gives every row one of the four trail types, a unique brand key and its aliases', () => {
    const keys = new Set<string>()
    const aliases = new Map<string, string>()
    for (const row of brands.rows) {
      expect(TRAIL_TYPES, row.brand).toContain(row.trail_type)
      expect(row.brand, row.brand).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(keys.has(row.brand), `${row.brand} listed twice`).toBe(false)
      keys.add(row.brand)
      expect(row.display.length, row.brand).toBeGreaterThan(0)
      expect(row.aliases.length, `${row.brand} has no alias`).toBeGreaterThan(0)
      // One alias resolves to one row, so a name in a question never takes a
      // brand by chance.
      for (const alias of row.aliases) {
        const key = alias.toLowerCase()
        expect(aliases.get(key) ?? row.brand, `alias ${alias} of ${row.brand}`).toBe(row.brand)
        aliases.set(key, row.brand)
      }
    }
  })

  it('names the contract past the swap for every vault and gauge row', () => {
    for (const row of brands.rows) {
      expect(Array.isArray(row.routers), row.brand).toBe(true)
      if (row.trail_type === 'vault') {
        // A vault row names its one manager, and the manager is the contract past the swap.
        expect(row.factories, row.brand).toHaveLength(1)
        expect(row.routers, row.brand).toEqual(row.factories)
      }
      if (row.trail_type === 'gauge' && row.routers.length === 0) {
        expect(row.note ?? '', `${row.brand} has no router and no note`).not.toBe('')
      }
    }
  })

  it('gives every row a factory or a manager, or a note that says why not', () => {
    for (const row of brands.rows) {
      if (row.factories.length === 0) {
        expect(row.note ?? '', `${row.brand} has no factory and no note`).not.toBe('')
      }
      expect(Number.isInteger(row.pool_floor) && row.pool_floor >= 0, row.brand).toBe(true)
      expect(Number.isInteger(row.since_block) && row.since_block >= 0, row.brand).toBe(true)
      for (const address of Object.keys(row.roles ?? {})) {
        expect([...row.factories, ...row.routers], `${row.brand} role ${address}`).toContain(
          address
        )
      }
    }
  })

  it('names Virtuals with a role for each of its factories', () => {
    const virtuals = brands.rows.find((row) => row.brand === 'virtuals')
    expect(virtuals?.trail_type).toBe('launchpad')
    for (const factory of virtuals?.factories ?? []) {
      expect(virtuals?.roles?.[factory], factory).toBeTruthy()
    }
  })
})

describe('the pinned indexer adapters', () => {
  const pin = readAdapters()

  it('holds the 13 adapters of the registry version it names, each once, with full anchors', () => {
    expect(Number.isInteger(pin.registry_version) && pin.registry_version > 0).toBe(true)
    expect(pin.network).toBe('robinhood')
    expect(pin.adapters).toHaveLength(13)
    expect(new Set(pin.adapters.map((adapter) => adapter.id)).size).toBe(13)
    for (const adapter of pin.adapters) {
      expect(['factory', 'custody', 'emitter'], adapter.id).toContain(adapter.discovery_kind)
      for (const anchor of adapter.anchors) expect(anchor, adapter.id).toMatch(ADDRESS)
      if (adapter.discovery_kind === 'custody') expect(adapter.anchors, adapter.id).toHaveLength(1)
      if (adapter.discovery_kind === 'factory') {
        expect(adapter.anchors.length, adapter.id).toBeGreaterThan(0)
      }
    }
  })

  it('anchors every custody adapter on the manager its vault row names', () => {
    const brands = readBrands()
    for (const adapter of pin.adapters.filter((a) => a.discovery_kind === 'custody')) {
      const row = brands.rows.find((candidate) => candidate.adapter === adapter.id)
      expect(row?.factories, adapter.id).toEqual(adapter.anchors)
    }
  })
})

describe('the memo the skills carry', () => {
  it('is the pinned registry rendered: node scripts/render-dex-brands.mjs --check is clean', () => {
    expect(staleTargets()).toEqual([])
  })

  it('writes every brand of the registry into the index memo, every address in full', () => {
    const brands = readBrands()
    const memo = renderIndexMemo(brands)
    for (const row of brands.rows) {
      expect(memo, row.brand).toContain(`\`${row.brand}\``)
      for (const address of [...row.factories, ...row.routers]) expect(memo).toContain(address)
    }
    expect(memo).not.toMatch(/0x[0-9a-f]*(…|\.\.\.)/)
  })

  it('holds the Virtuals factories inside the brands block only', () => {
    const brands = readBrands()
    const text = readFileSync(join(repoRoot, 'skills/chain-insights-virtuals/SKILL.md'), 'utf8')
    const outside = withBlock(text, '', 'skills/chain-insights-virtuals/SKILL.md')
    for (const factory of brands.rows.find((row) => row.brand === 'virtuals')?.factories ?? []) {
      expect(renderVirtualsMemo(brands)).toContain(factory)
      expect(outside.includes(factory), `${factory} is hand-typed outside the block`).toBe(false)
    }
  })

  it('names a stale block, and refuses a file without one', () => {
    const brands = readBrands()
    const text = 'head\n<!-- brands:start -->\nold\n<!-- brands:end -->\ntail\n'
    expect(withBlock(text, renderIndexMemo(brands), 'x.md')).not.toBe(text)
    expect(() => withBlock('no block\n', 'x', 'x.md')).toThrow(/no <!-- brands:start -->/)
  })
})
