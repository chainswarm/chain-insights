import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  flat,
  markdownFiles,
  read,
  runtimeSkill,
  sectionWith,
  servedGraphHints,
} from './support/schema-text.js'

// The schema guide names or documents every property a link carries, and the
// bounds text says what the graph server does. The guide is the shipped
// skill, so a field the graph serves and the guide omits is a field an agent
// cannot read.

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

// The property keys each link kind served on the production graph on
// 2026-10-03, read from one link of each kind. The section of the guide that
// owns a kind lists every key but the two bookkeeping fields, which sit in the
// bookkeeping table.
const SERVED_LINK_KEYS: Record<string, string[]> = {
  FLOWS_TO: [
    'last_seen_timestamp',
    'first_seen_timestamp',
    'tx_count',
    'synced_through_height',
    'amount_usd_sum',
    'pair_key',
  ],
  SWAPPED: [
    'sold_amount_raw',
    'sold_usd',
    'families',
    'bought_usd',
    'swap_count',
    'sold_asset',
    'pools',
    'bought_amount_raw',
    'synced_through_height',
    'strength',
    'bought_asset',
    'pair_key',
    'last_seen_height',
    'first_seen_height',
  ],
  ADDED_LIQUIDITY: [
    'first_seen_height',
    'last_seen_height',
    'unpriced_count',
    'synced_through_height',
    'totals_raw',
    'event_count',
    'usd',
  ],
  REMOVED_LIQUIDITY: [
    'unpriced_count',
    'usd',
    'last_seen_height',
    'totals_raw',
    'first_seen_height',
    'event_count',
    'synced_through_height',
    'receiver_provided',
    'receiver_added_usd',
    'fees_raw',
  ],
  BRIDGED: [
    'last_height',
    'events',
    'synced_through_height',
    'first_height',
    'kinds',
    'totals_raw',
    'last_bridge_event_id',
  ],
  OPERATED_BY: [
    'pair_id',
    'usd_range_count',
    'valued_count',
    'missing_valuation_price_count',
    'operator_address',
    'synced_through_height',
    'amount_usd_sum',
    'valuation_coverage_ratio',
    'unrepresentable_quantity_count',
    'owner_address',
    'last_seen_timestamp',
    'unknown_quantity_count',
    'valuation_complete',
    'valuation_tracked_count',
    'tx_count',
    'token_standard',
    'first_seen_timestamp',
  ],
  LINKED: ['last_height', 'confidence', 'declared_owner', 'owner_state', 'source_event', 'basis'],
  APPROVED: [
    'source_event',
    'last_height',
    'synced_through_height',
    'first_height',
    'granted_tokens',
    'has_infinite_grant',
    'infinite_tokens',
  ],
  DEPLOYED_CONTRACT: [
    'tx_id',
    'confidence_score',
    'block_timestamp',
    'deployer_address',
    'kind',
    'block_height',
    'source_event',
    'tx_origin',
    'factory_address',
  ],
  SPONSORED: [
    'last_height',
    'operations',
    'failed_operations',
    'synced_through_height',
    'first_height',
    'entrypoints',
    'source_event',
  ],
  BUNDLED: [
    'last_height',
    'operations',
    'failed_operations',
    'synced_through_height',
    'first_height',
    'entrypoints',
    'source_event',
  ],
  SIGNED_FOR: [
    'operations',
    'failed_operations',
    'synced_through_height',
    'first_height',
    'source_event',
    'last_height',
  ],
  SIGNED_AUTHORIZATION: ['first_height', 'source_event', 'last_height'],
}

describe('the schema guide names every field a link serves', () => {
  const guide = read('skills/chain-insights-schema-evm/SKILL.md')

  it.each(Object.entries(SERVED_LINK_KEYS))(
    '%s: every served key is in the guide',
    (kind, keys) => {
      const section = sectionWith(guide, kind, 'properties')
      const missing = keys.filter((key) => {
        if (key === 'synced_through_height' || key === 'pair_key') return false
        return !section.includes(`\`${key}\``)
      })
      expect(missing, `${kind} section does not name these served keys`).toEqual([])
    }
  )

  it('the bookkeeping table names the two internal fields and the links that carry them', () => {
    const bookkeeping = sectionWith(guide, 'Bookkeeping fields on links')
    const rows = bookkeeping.split('\n').filter((line) => line.startsWith('| `'))
    const marker = rows.find((row) => row.startsWith('| `synced_through_height`')) ?? ''
    const pairKey = rows.find((row) => row.startsWith('| `pair_key`')) ?? ''

    for (const kind of SYNC_MARKER_KINDS)
      expect(marker, `marker row misses ${kind}`).toContain(kind)
    for (const kind of ['LINKED', 'DEPLOYED_CONTRACT', 'SIGNED_AUTHORIZATION']) {
      expect(marker, `${kind} carries no marker`).not.toContain(`\`${kind}\``)
    }
    expect(pairKey).toContain('`FLOWS_TO`')
    expect(pairKey).toContain('`SWAPPED`')
    expect(pairKey).not.toContain('`OPERATED_BY`')
    expect(flat(bookkeeping)).toContain('They are not part of the contract')
    expect(flat(bookkeeping)).toContain('graph_progress')
  })

  it('every kind that serves synced_through_height is in the bookkeeping table', () => {
    const served = Object.entries(SERVED_LINK_KEYS)
      .filter(([, keys]) => keys.includes('synced_through_height'))
      .map(([kind]) => kind)
    expect(served.sort()).toEqual([...SYNC_MARKER_KINDS].sort())
  })

  it('swap_unsplit is named as warehouse-only, and facts SWAP serves swap or swap_like', () => {
    const swapped = flat(sectionWith(guide, 'SWAPPED properties'))
    expect(swapped).toContain('strength `swap_unsplit`')
    expect(swapped).toContain('It exists in the warehouse only')
    expect(swapped).toContain('It makes no edge and no facts row')
    expect(swapped).toContain(
      '`strength` is `swap` or `swap_like` on `SWAPPED` and on facts `SWAP`'
    )

    const facts = sectionWith(guide, 'Facts labels and relationships')
    expect(facts).toContain('`strength` (`swap` or `swap_like`)')
  })

  it('the OPERATED_BY section says what the valuation fields mean and that the USD sum is a floor', () => {
    const operatedBy = flat(sectionWith(guide, 'OPERATED_BY properties'))
    expect(operatedBy).toContain('`valuation_complete` | `true` when `valued_count` equals')
    expect(operatedBy).toContain('`valued_count` divided by `valuation_tracked_count`')
    expect(operatedBy).toContain('counts a transfer with no USD value as 0')
    expect(operatedBy).toContain('a floor unless `valuation_complete` is true')
    // The reason counters and the valued count do not add up to the tracked count.
    expect(operatedBy).toContain('do not add up to `valuation_tracked_count`')
  })

  it('names the contract fields on an address and the LINKED owner state', () => {
    const address = sectionWith(guide, 'Address properties')
    for (const key of [
      'is_contract',
      'contract_creation_tx_id',
      'contract_creation_type',
      'contract_creation_confidence',
      'contract_creation_block_height',
      'contract_creation_timestamp',
    ]) {
      expect(address, `Address properties misses ${key}`).toContain(`\`${key}\``)
    }
    expect(flat(sectionWith(guide, 'LINKED properties'))).toContain(
      'An owner that was removed has no link'
    )
  })
})

describe('the served hints name the same fields', () => {
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
