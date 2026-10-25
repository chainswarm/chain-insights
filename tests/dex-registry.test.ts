import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { checkRegistry, parseRows, validate } from '../scripts/pin-dex-registry.mjs'
import {
  handTypedContracts,
  renderIndexMemo,
  renderVirtualsMemo,
  staleTargets,
  withBlock,
} from '../scripts/render-dex-registry.mjs'
import { normaliseName } from '../src/mcp/dex-registry.js'
import { readAdapters, readRegistry, repoRoot, TRAIL_TYPES } from './dex-registry.js'

// The exchange registry: registry/robinhood.md is the reviewed table, and
// registry/robinhood.json its served copy, which the proxy tool meta_dex_lookup
// fetches and the skill memo renders from. This T1 test keeps the table and the
// copy equal (the pin check CI runs), keeps the copy honest, and keeps the memo
// the skills carry equal to the copy. The live read of every row is
// tests/dex-registry-live.integration.test.ts.

const ADDRESS = /^0x[0-9a-f]{40}$/
const SOURCE = /^https:\/\/\S+$/
const REGISTRY_MD = 'registry/robinhood.md'
const tempDir = mkdtempSync(join(tmpdir(), 'dex-registry-'))
afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

describe('the reviewed table and its served copy', () => {
  it('pins to the committed copy: node scripts/pin-dex-registry.mjs --check is clean', () => {
    const out = execFileSync('node', ['scripts/pin-dex-registry.mjs', '--check', REGISTRY_MD], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(out).toContain('rows: 44 served, 0 refused, 3 not served')
    expect(out).toContain('registry/robinhood.json up to date, registry version 2')
  })

  it('fails on a hand edit of the served copy, naming both versions', () => {
    const dir = join(tempDir, 'drift')
    cpSync(join(repoRoot, 'registry'), dir, { recursive: true })
    const json = JSON.parse(readFileSync(join(dir, 'robinhood.json'), 'utf8')) as {
      registry_version: number
    }
    json.registry_version = 1
    writeFileSync(join(dir, 'robinhood.json'), `${JSON.stringify(json, null, 2)}\n`)
    const { ok, lines } = checkRegistry(join(dir, 'robinhood.md'))
    expect(ok).toBe(false)
    expect(lines.join('\n')).toMatch(
      /the file gives registry version 2, the committed copy says registry version 1/
    )
  })

  it('refuses a served row with no source link, and an exchange with routers only', () => {
    const header =
      '## Rows\n\n| dex | display | aliases | trail type | adapter | role | address | valid from block | example pool | pool floor | source link | verification |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n'
    const noSource = validate(
      parseRows(
        `${header}| kyber | Kyber | Kyber | plain | uniswap-v2 | factory | \`0x1111111111111111111111111111111111111111\` | 0 | - | - | no link | served |\n`
      )
    )
    expect(noSource.refused).toEqual([
      ['no source link', 'kyber factory 0x1111111111111111111111111111111111111111'],
    ])
    const routersOnly = validate(
      parseRows(
        `${header}| kyber | Kyber | Kyber | plain | uniswap-v2 | router | \`0x1111111111111111111111111111111111111111\` | 0 | - | - | [docs](https://example.org) | served |\n`
      )
    )
    expect(routersOnly.refused.map(([reason]) => reason)).toEqual([
      'no factory or manager row for the dex',
    ])
  })
})

describe('the served copy', () => {
  const registry = readRegistry()

  it('names the schema, the network, the day it was recorded and the registry version', () => {
    expect(registry.schema).toBe('chain-insights.dex-registry.v1')
    expect(registry.network).toBe('robinhood')
    expect(registry.recorded_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(registry.registry_version).toBe(2)
    expect(registry.rows).toHaveLength(29)
  })

  it("holds the registry version the package's chainInsights.dexRegistryVersion names", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      chainInsights?: { dexRegistryVersion?: number }
      files?: string[]
    }
    expect(pkg.chainInsights?.dexRegistryVersion).toBe(registry.registry_version)
    expect(pkg.files, 'the packaged copy ships with the package').toContain('registry')
  })

  it('writes every address in full and lower case', () => {
    for (const row of registry.rows) {
      for (const address of [...row.factories, ...row.routers, ...Object.keys(row.roles)]) {
        expect(address, row.dex).toMatch(ADDRESS)
      }
      if (row.example_pool) expect(row.example_pool, row.dex).toMatch(ADDRESS)
    }
  })

  it('links every row to its source', () => {
    for (const row of registry.rows) expect(row.source, row.dex).toMatch(SOURCE)
  })

  it('gives every row one of the four trail types, a unique key and its aliases', () => {
    const keys = new Set<string>()
    for (const row of registry.rows) {
      expect(TRAIL_TYPES, row.dex).toContain(row.trail_type)
      expect(row.dex, row.dex).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(keys.has(row.dex), `${row.dex} listed twice`).toBe(false)
      keys.add(row.dex)
      expect(row.display.length, row.dex).toBeGreaterThan(0)
      expect(row.aliases.length, `${row.dex} has no alias`).toBeGreaterThan(0)
    }
  })

  it('lets two exchanges share a written name only where a user means both: Balancer', () => {
    // A shared name makes meta_dex_lookup list both instead of guessing one.
    // Any other shared name is a typo in the table.
    const owners = new Map<string, Set<string>>()
    for (const row of registry.rows) {
      for (const written of [row.dex, row.display, ...row.aliases]) {
        const key = normaliseName(written)
        owners.set(key, (owners.get(key) ?? new Set()).add(row.dex))
      }
    }
    const shared = [...owners]
      .filter(([, dexes]) => dexes.size > 1)
      .map(([name, dexes]) => `${name}: ${[...dexes].sort().join(', ')}`)
    expect(shared).toEqual(['balancer: balancer-v3, swaap'])
  })

  it('names the contract past the swap for every vault row', () => {
    for (const row of registry.rows) {
      if (row.trail_type !== 'vault') continue
      expect(row.factories, row.dex).toHaveLength(1)
      expect(row.routers, row.dex).toEqual(row.factories)
      expect(row.roles[row.factories[0]!], row.dex).toBe('manager')
    }
  })

  it('gives every row a factory or a manager, and a role to every contract', () => {
    for (const row of registry.rows) {
      expect(row.factories.length, `${row.dex} has no factory or manager`).toBeGreaterThan(0)
      expect(
        row.pool_floor === null || (Number.isInteger(row.pool_floor) && row.pool_floor >= 0),
        row.dex
      ).toBe(true)
      expect(Number.isInteger(row.since_block) && row.since_block >= 0, row.dex).toBe(true)
      for (const address of [...row.factories, ...row.routers])
        expect(row.roles[address], `${row.dex} ${address}`).toBeTruthy()
    }
  })

  it('names Virtuals with a role for each of its factories', () => {
    const virtuals = registry.rows.find((row) => row.dex === 'virtuals')
    expect(virtuals?.trail_type).toBe('launchpad')
    for (const factory of virtuals?.factories ?? [])
      expect(virtuals?.roles[factory], factory).toBeTruthy()
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
      if (adapter.discovery_kind === 'factory')
        expect(adapter.anchors.length, adapter.id).toBeGreaterThan(0)
    }
  })

  it('anchors every custody adapter on the manager its vault row names', () => {
    const registry = readRegistry()
    for (const adapter of pin.adapters.filter((a) => a.discovery_kind === 'custody')) {
      const rows = registry.rows.filter((candidate) => candidate.adapters.includes(adapter.id))
      expect(
        rows.some((row) => row.factories.length === 1 && row.factories[0] === adapter.anchors[0]),
        `${adapter.id}: no vault row names its anchor ${adapter.anchors[0]}`
      ).toBe(true)
    }
  })
})

describe('the memo the skills carry', () => {
  it('is the served copy rendered: node scripts/render-dex-registry.mjs --check is clean', () => {
    expect(staleTargets()).toEqual([])
    expect(handTypedContracts()).toEqual([])
  })

  it('writes every exchange of the registry into the index memo, every address in full', () => {
    const registry = readRegistry()
    const memo = renderIndexMemo(registry)
    for (const row of registry.rows) {
      expect(memo, row.dex).toContain(`\`${row.dex}\``)
      for (const address of [...row.factories, ...row.routers]) expect(memo).toContain(address)
    }
    expect(memo).not.toMatch(/0x[0-9a-f]*(…|\.\.\.)/)
  })

  it('holds the Virtuals factories inside the dex-registry block only', () => {
    const registry = readRegistry()
    const text = readFileSync(join(repoRoot, 'skills/chain-insights-virtuals/SKILL.md'), 'utf8')
    const outside = withBlock(text, '', 'skills/chain-insights-virtuals/SKILL.md')
    for (const factory of registry.rows.find((row) => row.dex === 'virtuals')?.factories ?? []) {
      expect(renderVirtualsMemo(registry)).toContain(factory)
      expect(outside.includes(factory), `${factory} is hand-typed outside the block`).toBe(false)
    }
  })

  it('names a stale block, and refuses a file without one', () => {
    const registry = readRegistry()
    const text = 'head\n<!-- dex-registry:start -->\nold\n<!-- dex-registry:end -->\ntail\n'
    expect(withBlock(text, renderIndexMemo(registry), 'x.md')).not.toBe(text)
    expect(() => withBlock('no block\n', 'x', 'x.md')).toThrow(/no <!-- dex-registry:start -->/)
  })

  it('names a factory address a skill holds that no row of the served copy holds', () => {
    const copy = join(tempDir, 'typed')
    for (const dir of ['registry', 'skills'])
      cpSync(join(repoRoot, dir), join(copy, dir), { recursive: true })
    const page = join(copy, 'skills/chain-insights-dex-gauge/SKILL.md')
    writeFileSync(
      page,
      `${readFileSync(page, 'utf8')}\nThe factory \`0x1111111111111111111111111111111111111111\` is new.\n`
    )
    expect(handTypedContracts(copy)).toEqual([
      expect.stringMatching(
        /^skills\/chain-insights-dex-gauge\/SKILL\.md:\d+ 0x1111111111111111111111111111111111111111$/
      ),
    ])
  })
})
