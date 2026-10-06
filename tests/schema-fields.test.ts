import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { flat, markdownFiles, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// The served hints name the fields a link carries, and the bounds text says
// what the graph server does. The cypher skill names no field list: it shows
// how to read the keys of a sample, so the graph is the one source.

const root = process.cwd()

const SYNC_MARKER_KINDS = [
  'FLOWS_TO',
  'SWAPPED',
  'OPERATED_BY',
  'ADDED_LIQUIDITY',
  'REMOVED_LIQUIDITY',
  'BRIDGED',
  'APPROVED',
  'SPONSORED',
  'BUNDLED',
  'SIGNED_FOR',
]

describe('the served hints name the fields of the links', () => {
  const hints = servedGraphHints()

  it('names the valuation fields, the other bookkeeping links and swap_unsplit', () => {
    for (const name of [
      'valuation_complete',
      'valuation_coverage_ratio',
      'valuation_tracked_count',
      'valued_count',
      'owner_state',
      'swap_unsplit',
      'synced_through_height is also on the other summed links',
      'pair_key on SWAPPED',
    ]) {
      expect(hints, `hints miss ${name}`).toContain(name)
    }
    for (const kind of SYNC_MARKER_KINDS.filter((kind) => kind !== 'FLOWS_TO')) {
      expect(hints.split('synced_through_height is also on')[1] ?? '', kind).toContain(kind)
    }
    expect(hints).toContain('a floor unless valuation_complete is true')
    expect(hints).toContain('A route that could not be paired (swap_unsplit) is never served')
  })
})

// The bounds text: an unanchored link filter, and the limits that apply.
describe('the bounds text', () => {
  it('the graph tools guide says a link filter needs an address anchor, and the short dialect skill says it in one line', () => {
    expect(flat(read('skills/chain-insights-cypher/SKILL.md'))).toContain(
      'a filter on a link property needs an anchor on every pattern'
    )
    for (const path of ['docs/graph-tools.md']) {
      const text = flat(read(path))
      expect(text, path).toContain(
        'A topology read that filters on a link property needs an address anchor'
      )
      expect(text, path).toContain(
        "`WHERE x.strength = 'swap'` on `SWAPPED` checks every `SWAPPED` link"
      )
      expect(text, path).toContain('can run to the 60-second limit and fail with `query_timeout`')
      expect(text, path).toContain('A discovery probe with no filter')
      expect(text, path).toContain('`degree_out` and `degree_in`')
      expect(text, path).toContain('a rough guide, not a guarantee')
      expect(text, path).toContain('share a 100-second budget')
    }
  })

  it('the served hints say the same, with the 60 s and 100 s limits', () => {
    const hints = servedGraphHints()
    expect(hints).toContain('Anchor every topology read that filters on a link property')
    expect(hints).toContain('can run to the 60 s topology limit and fail with query_timeout')
    expect(hints).toContain('rough guide')
    expect(hints).toContain('Discovery probes with LIMIT and no filter stay valid')
    expect(hints).toContain('share a 100 s budget')
    expect(hints).toContain('USE facts queries stop at 30 s')
  })

  it('the runtime skill that workspace init writes says the same', async () => {
    const text = flat(await runtimeSkill())
    expect(text).toContain('Anchor every topology read that filters on a link property')
    expect(text).toContain('can run to the 60 s topology limit and fail with `query_timeout`')
    expect(text).toContain('rough guide')
    expect(text).toContain('share a 100 s budget')
    expect(text).toContain('`synced_through_height` is also on the other summed links')
  })

  it('the anchored example is a one-hop SWAPPED read on a named address', () => {
    for (const path of ['docs/graph-tools.md']) {
      expect(read(path), path).toContain(
        'MATCH (a:Address {address: "0x…"})-[x:SWAPPED]->(b:Address)\nWHERE x.swap_count >= 2'
      )
    }
  })

  // The topology limit is 60 s per query and 100 s per batch. docs/mcp-proxy.md
  // is left out: its "10-second free tier" is a dated UAT note about the daily
  // free allowance, not a limit.
  it('no text still gives the retired 10 second topology limit', () => {
    const files = [
      'README.md',
      'src/mcp/proxy.ts',
      'src/workspace/init.ts',
      ...readdirSync(join(root, 'skills')).map((skill) => `skills/${skill}/SKILL.md`),
      ...markdownFiles('docs').filter((path) => path !== 'docs/mcp-proxy.md'),
    ]
    const retired = [/10-second/, /10 seconds by default/, /capped at `10`/]
    const offenders = files.flatMap((path) =>
      retired.filter((pattern) => pattern.test(read(path))).map((pattern) => `${path}: ${pattern}`)
    )
    expect(offenders).toEqual([])
  })

  it('the guide and the tools guide give the 60 s topology limit and the 30 s facts limit', () => {
    const tools = flat(read('docs/graph-tools.md'))
    expect(tools).toContain('(60 seconds by default, or your lower `per_query_timeout_seconds`)')
    expect(tools).toContain('capped at `60` by default (`30` for `USE facts`)')
    expect(tools).toContain('"live_tier_timeout_seconds": 60')
    expect(tools).toContain('"starrocks_tier_timeout_seconds": 30')
    expect(flat(read('docs/graph-query-compatibility.md'))).toContain(
      'the per-query limit (60 seconds by default)'
    )
  })
})
