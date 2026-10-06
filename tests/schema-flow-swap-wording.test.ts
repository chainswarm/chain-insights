import { describe, expect, it } from 'vitest'

import { flat, markdownFiles, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// Three things a reader must not have to guess, each one a place where the
// graph holds more or says less than the old text did:
//
//   1. FLOWS_TO tx_count counts internal native transfers, and a facts TRANSFER
//      row lists each one, marked by its kind (tests/transfer-kind.test.ts).
//   2. No swap has strength `swap` today. Every served swap is `swap_like`
//      with families `unknown`. `swap_unsplit` is warehouse-only.
//   3. SWAPPED USD is 0 on an unpriced side. Empty is only the facts SWAP row.

const CYPHER = 'skills/chain-insights-cypher/SKILL.md'
const TOOLS = 'docs/graph-tools.md'

// Every file a reader or an agent is shown.
const SHIPPED_TEXT = [
  'README.md',
  'src/mcp/proxy.ts',
  'src/workspace/init.ts',
  'skills/chain-insights-cypher/SKILL.md',
  ...markdownFiles('docs'),
]

describe('FLOWS_TO tx_count counts internal native transfers', () => {
  it('the tools guide says the same', () => {
    const tools = flat(read(TOOLS))
    expect(tools).toContain('A link covers all time and a facts read covers one day')
    expect(tools).toContain('`FLOWS_TO` `tx_count` counts all three')
  })

  it('the served hints say the same and keep the anchor query for a pair', () => {
    const hints = servedGraphHints()
    expect(hints).toContain(
      'tx_count counts token and native transfers plus internal native transfers (a contract sending ETH during a call)'
    )
    expect(hints).toContain('amount_usd_sum prices them all')
    expect(hints).toContain('USE facts TRANSFER lists all three')
    expect(hints).toContain('A link covers all time and a USE facts read covers one day')
    expect(hints).toContain(
      'A transaction anchor of a pair resolves through USE facts, on the UTC day of the first_seen_timestamp or last_seen_timestamp of the link: MATCH (a:Address {address: $from})-[t:TRANSFER]->(b:Address {address: $to}) WHERE t.block_date = "YYYY-MM-DD" RETURN t.tx_id'
    )
    expect(hints).toContain(
      'Tx ids of every transfer, internal ones included, come from USE facts TRANSFER.'
    )
  })

  it('the runtime skill that workspace init writes says the same', async () => {
    const text = flat(await runtimeSkill())
    expect(text).toContain(
      '`tx_count` counts token and native transfers plus internal native transfers'
    )
    expect(text).toContain('`USE facts` `TRANSFER` lists all three')
    expect(text).toContain('A link covers all time and a `USE facts` read covers one day')
    expect(text).toContain('A transaction anchor of a pair resolves through `USE facts`')
  })

  it("no text still says a flow's transactions are TRANSFER rows", () => {
    const offenders = SHIPPED_TEXT.filter((path) => /flow's transactions are/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('no served text gives the 90-day window an address read once got', () => {
    for (const path of [TOOLS, 'src/mcp/proxy.ts', 'src/workspace/init.ts']) {
      expect(flat(read(path)), `${path} gives a 90-day window`).not.toContain('90 days')
    }
  })
})

describe('swap strength today', () => {
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

  it('the short dialect skill holds no swap strength section', () => {
    expect(flat(read(CYPHER))).not.toContain('strength')
  })

  it('no text still says the pool matches no reviewed family', () => {
    const offenders = SHIPPED_TEXT.filter((path) => /no reviewed family/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('no served text names a swap stamp property or the retired reading', () => {
    // The stamp names tests/schema-swap-stamps.test.ts forbids stay out of the
    // new text too: the reason is a facts column, never `swap.reason`.
    const stamp = /swap\.(kind|family|deployment|pool|route_id|reason|interpreter_version)/
    for (const path of [CYPHER, TOOLS, 'src/mcp/proxy.ts', 'src/workspace/init.ts']) {
      expect(stamp.test(read(path)), `${path} names a swap.* stamp`).toBe(false)
    }
  })
})

describe('SWAPPED USD is 0 on an unpriced side', () => {
  it('the tools guide says SWAPPED adds 0 for an unpriced side', () => {
    const tools = flat(read(TOOLS))
    expect(tools).toContain('`SWAPPED` sums its routes, and a route side with no price adds 0')
    expect(tools).toContain('So 0 can mean no price. Do not read 0 as worth nothing')
    expect(tools).toContain('`sold_price_missing` and `bought_price_missing`')
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
