import { describe, expect, it } from 'vitest'

import {
  flat,
  markdownFiles,
  read,
  runtimeSkill,
  sectionWith,
  servedGraphHints,
} from './support/schema-text.js'

// Three things a reader must not have to guess, each one a place where the
// graph holds more or says less than the old text did:
//
//   1. FLOWS_TO tx_count counts internal native transfers, and no MCP read
//      lists those yet.
//   2. No swap has strength `swap` today. Every served swap is `swap_like`
//      with families `unknown`. `swap_unsplit` is warehouse-only.
//   3. SWAPPED USD is 0 on an unpriced side. Empty is only the facts SWAP row.

const GUIDE = 'skills/chain-insights-schema-evm/SKILL.md'
const CYPHER = 'skills/chain-insights-cypher/SKILL.md'
const TOOLS = 'docs/graph-tools.md'

// Every file a reader or an agent is shown.
const SHIPPED_TEXT = [
  'README.md',
  'src/mcp/proxy.ts',
  'src/workspace/init.ts',
  ...['chain-insights-schema-evm', 'chain-insights-cypher'].map(
    (skill) => `skills/${skill}/SKILL.md`
  ),
  ...markdownFiles('docs'),
]

describe('FLOWS_TO tx_count counts internal native transfers', () => {
  const guide = read(GUIDE)

  it('the tx_count row says what the count holds', () => {
    const flows = sectionWith(guide, 'FLOWS_TO properties')
    const row = flows.split('\n').find((line) => line.startsWith('| `tx_count`')) ?? ''
    expect(flat(row)).toContain('token and native transfers plus internal native transfers')
    expect(flat(row)).toContain('a contract sending ETH during a call')
  })

  it('the guide says TRANSFER lists the first group only and no MCP read lists the rest', () => {
    const flows = flat(sectionWith(guide, 'FLOWS_TO properties'))
    expect(flows).toContain(
      '`tx_count` counts token and native transfers and also internal native transfers.'
    )
    expect(flows).toContain('`USE facts` `TRANSFER` lists the first group only.')
    expect(flows).toContain('No MCP read lists an internal native transfer yet')
    expect(flows).toContain('a pair can have a `tx_count` above 0 and no `TRANSFER` row')
  })

  it('the guide gives the recency window as a recent window, not a bare number', () => {
    const flows = flat(sectionWith(guide, 'FLOWS_TO properties'))
    expect(flows).toContain('a recent window (90 days today)')
    expect(flows).toContain('bound the read with `block_date` to read further back')
    const facts = flat(sectionWith(guide, 'Facts labels and relationships'))
    expect(facts).toContain('covers a recent window (90 days today)')
    expect(facts).toContain('Add a bare `block_date` bound to read older rows')
    expect(facts).toContain('It lists no internal native transfer')
  })

  it('the tools guide says the same', () => {
    const tools = flat(read(TOOLS))
    expect(tools).toContain(
      'An address-only `TRANSFER` read covers a recent window (90 days today)'
    )
    expect(tools).toContain('It lists no internal native transfer')
    expect(tools).toContain('`tx_count` counts those too')
    expect(tools).toContain('No MCP read lists internal native transfers yet')
  })

  it('the served hints say the same and keep the anchor query for a pair with transfers', () => {
    const hints = servedGraphHints()
    expect(hints).toContain(
      'tx_count counts token and native transfers plus internal native transfers (a contract sending ETH during a call)'
    )
    expect(hints).toContain('amount_usd_sum prices them all')
    expect(hints).toContain('USE facts TRANSFER lists the first group only')
    expect(hints).toContain('no MCP read lists internal transfers yet')
    expect(hints).toContain('a recent window (90 days today)')
    expect(hints).toContain(
      'For a pair with token or native transfers, a transaction anchor resolves through USE facts: MATCH (a:Address {address: $from})-[t:TRANSFER]->(b:Address {address: $to}) RETURN t.tx_id'
    )
    expect(hints).toContain(
      'Tx ids of token and native transfers come from USE facts TRANSFER; internal native transfers have none to read yet.'
    )
  })

  it('the runtime skill that workspace init writes says the same', async () => {
    const text = flat(await runtimeSkill())
    expect(text).toContain(
      '`tx_count` counts token and native transfers plus internal native transfers'
    )
    expect(text).toContain('`USE facts` `TRANSFER` lists the first group only')
    expect(text).toContain('no MCP read lists internal transfers yet')
    expect(text).toContain('a recent window (90 days today)')
    expect(text).toContain('For a pair with token or native transfers, a transaction anchor')
  })

  it("no text still says a flow's transactions are TRANSFER rows", () => {
    const offenders = SHIPPED_TEXT.filter((path) => /flow's transactions are/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('no served text hard-codes the recency window as a bare 90 days', () => {
    for (const path of [GUIDE, TOOLS, 'src/mcp/proxy.ts', 'src/workspace/init.ts']) {
      const text = flat(read(path))
      for (const match of text.matchAll(/90 days/g)) {
        const before = text.slice(Math.max(0, match.index - 20), match.index)
        expect(before, `${path} gives 90 days without "today"`).toMatch(/recent window \($/)
      }
    }
  })
})

describe('swap strength today', () => {
  const guide = read(GUIDE)
  const swapped = flat(sectionWith(guide, 'SWAPPED properties'))

  it('the guide says no route is swap today and why', () => {
    expect(swapped).toContain('Today no route is `swap`.')
    expect(swapped).toContain('reads transaction receipts only, with no execution trace')
    expect(swapped).toContain(
      'Every served route is `swap_like`, with `reason` `unknown_pool_code` and `families` `unknown`'
    )
    expect(swapped).toContain('A Uniswap V2 or V3 swap reads this way')
    expect(swapped).toContain('`unknown` does not mean the protocol is unsupported')
    expect(swapped).toContain(
      "A filter on `strength = 'swap'` or on a known family matches nothing"
    )
  })

  it('the guide defines swap_like by the shape, not by a reviewed family', () => {
    expect(swapped).toContain(
      "`swap_like`: the shape is a swap and the money moved. The pool's code is not proven, so no protocol is named."
    )
    expect(swapped).toContain('The proof needs an execution trace')
    const properties = sectionWith(guide, 'SWAPPED properties')
    const rows = properties.split('\n').filter((line) => line.startsWith('| `'))
    const families = rows.find((row) => row.startsWith('| `families`')) ?? ''
    const strength = rows.find((row) => row.startsWith('| `strength`')) ?? ''
    expect(families).toContain('Today every route reads `unknown`')
    expect(strength).toContain('Today always `swap_like`')
  })

  it('the guide explains swap_unsplit: no payer, no pool, warehouse only, v4 hidden', () => {
    expect(swapped).toContain('has strength `swap_unsplit`. It has no payer, recipient or pool')
    expect(swapped).toContain('It exists in the warehouse only')
    expect(swapped).toContain('It makes no edge and no facts row')
    expect(swapped).toContain('A missing `SWAPPED` edge is not proof that no swap happened')
    expect(swapped).toContain('Three kinds of transaction read `swap_unsplit` today')
    expect(swapped).toContain(
      'A Uniswap v4 swap. Every one does, by design, so v4 swaps are hidden'
    )
    expect(swapped).toContain('An intent fill')
    expect(swapped).toContain('one input and one output')
    expect(swapped).toContain(
      '1% on 2026-06-18, 7% on 2026-07-10, 19% on 2026-07-26 and 32% on 2026-08-10'
    )
  })

  it('liquidity families are named as a different vocabulary from swap families', () => {
    const facts = flat(sectionWith(guide, 'Facts labels and relationships'))
    expect(facts).toContain('`family` on a liquidity row is `v2` or `v3`')
    expect(facts).toContain('It is not a swap family: swap `families` read `unknown` today')
    expect(facts).toContain('`reason` (why a claim is `swap_like`: `unknown_pool_code` today)')
  })

  it('the tools guide says the same', () => {
    const tools = flat(read(TOOLS))
    expect(tools).toContain('Today no route is `swap`.')
    expect(tools).toContain('reads transaction receipts only, with no execution trace')
    expect(tools).toContain(
      'Every served route is `swap_like`, with `reason` `unknown_pool_code` and `families` `unknown`'
    )
    expect(tools).toContain('`unknown` does not mean the protocol is unsupported')
    expect(tools).toContain('It has no payer, recipient or pool')
    expect(tools).toContain('It makes no `SWAPPED` edge and no `SWAP` row')
    expect(tools).toContain('Every Uniswap v4 swap reads this way today, by design')
    expect(tools).toContain("the pool's code is not proven")
  })

  it('the served hints say the same', () => {
    const hints = servedGraphHints()
    expect(hints).toContain('Today no route is swap')
    expect(hints).toContain('transaction receipts only, with no execution trace')
    expect(hints).toContain(
      'every served route is swap_like, with reason unknown_pool_code and families unknown'
    )
    expect(hints).toContain('unknown does not mean the protocol is unsupported')
    expect(hints).toContain('A filter on strength = "swap" or on a known family matches nothing')
    expect(hints).toContain(
      'A route that could not be paired (swap_unsplit) is never served: it has no payer, recipient or pool, makes no SWAPPED edge and no SWAP row, and exists in the warehouse only.'
    )
    expect(hints).toContain('Every Uniswap v4 swap is swap_unsplit today, by design')
    expect(hints).toContain('the shape is a swap but the pool code is not proven')
  })

  it('the dialect skill warns off a strength = swap filter', () => {
    const cypher = flat(read(CYPHER))
    expect(cypher).toContain('Today every served swap has `strength` `swap_like`')
    expect(cypher).toContain("Do not filter on `strength = 'swap'`: it matches nothing.")
    expect(cypher).toContain('has no edge and no row')
  })

  it('no text still says the pool matches no reviewed family', () => {
    const offenders = SHIPPED_TEXT.filter((path) => /no reviewed family/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('no served text names a swap stamp property or the retired reading', () => {
    // The stamp names tests/schema-swap-stamps.test.ts forbids stay out of the
    // new text too: the reason is a facts column, never `swap.reason`.
    const stamp = /swap\.(kind|family|deployment|pool|route_id|reason|interpreter_version)/
    for (const path of [GUIDE, CYPHER, TOOLS, 'src/mcp/proxy.ts', 'src/workspace/init.ts']) {
      expect(stamp.test(read(path)), `${path} names a swap.* stamp`).toBe(false)
    }
  })
})

describe('SWAPPED USD is 0 on an unpriced side', () => {
  const guide = read(GUIDE)

  it('the SWAPPED row says 0 can mean no price', () => {
    const properties = sectionWith(guide, 'SWAPPED properties')
    const row =
      properties.split('\n').find((line) => line.startsWith('| `sold_usd` / `bought_usd`')) ?? ''
    expect(flat(row)).toContain('summed over the routes on the edge')
    expect(flat(row)).toContain('A route side with no price adds 0, so 0 can mean no price')
    expect(flat(row)).toContain('Do not read 0 as worth nothing')
    expect(row).not.toMatch(/Empty/)
  })

  it('the SWAPPED section sends the reader to the facts SWAP row for which side had no price', () => {
    const swapped = flat(sectionWith(guide, 'SWAPPED properties'))
    expect(swapped).toContain('`sold_usd` and `bought_usd` are always numbers on a link')
    expect(swapped).toContain('the link has no count of unpriced routes')
    expect(swapped).toContain('The facts `SWAP` row of one route tells which')
    expect(swapped).toContain(
      '`sold_price_missing` and `bought_price_missing` say which side had no price'
    )
    expect(swapped).toContain('47 of 100 swap routes had no price on the bought side')
  })

  it('empty USD is only the facts row, in the guide, the tools guide and the dialect skill', () => {
    for (const path of [GUIDE, TOOLS, CYPHER]) {
      const text = flat(read(path))
      expect(text, path).not.toContain('Empty when no price service covers it')
      const claims = [...text.matchAll(/USD is empty|it is empty when no service prices/g)]
      expect(claims.length, `${path} no longer says when USD is empty`).toBeGreaterThan(0)
      for (const claim of claims) {
        const before = text.slice(Math.max(0, claim.index - 160), claim.index)
        expect(before, `${path} says USD is empty without the facts row`).toContain('facts row')
      }
    }
    expect(flat(read(GUIDE))).toContain(
      'A topology link sums its rows and counts a side with no price as 0'
    )
  })

  it('the tools guide and the dialect skill say SWAPPED adds 0 for an unpriced side', () => {
    const tools = flat(read(TOOLS))
    expect(tools).toContain('`SWAPPED` sums its routes, and a route side with no price adds 0')
    expect(tools).toContain('So 0 can mean no price. Do not read 0 as worth nothing')
    expect(tools).toContain('`sold_price_missing` and `bought_price_missing`')
    const cypher = flat(read(CYPHER))
    expect(cypher).toContain('On a facts row it is empty when no service prices the asset')
    expect(cypher).toContain('a side with no price adds 0, so 0 can mean no price')
  })

  it('the served hints say a route side with no price adds 0 and point at the facts row', () => {
    const hints = servedGraphHints()
    expect(hints).toContain(
      'sold_usd and bought_usd sum the routes on the edge at the day price: a route side with no price adds 0, so 0 can mean no price. Do not read 0 as worth nothing.'
    )
    expect(hints).toContain(
      'The USE facts SWAP row says which side had no price (sold_price_missing, bought_price_missing).'
    )
  })

  it('the pinned swap attribution sentence stays at the end of the SWAPPED hint', () => {
    expect(servedGraphHints()).toContain(
      'Swap attribution is read from SWAPPED, the aggregate (strength, pools, families), or from the USE facts SWAP row, one route. FLOWS_TO carries value only.'
    )
  })
})
