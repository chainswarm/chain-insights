import { describe, expect, it, vi } from 'vitest'
import {
  addressRisk,
  attachSweptHotWallets,
  buildRouteEvidence,
  exchangeDepositEnds,
  exchangeDepositSweptQuery,
  queryBuilderContract,
  resolveExchangeEnd,
} from '../src/investigation/public-tools.js'

// aml_address_risk now that the labels layer marks deposits :Exchange too.
//
// The deposit, its exchange and its SWEPT link are the lane A answer of
// 2026-11-09 for the Gate deposit (aml_exchange_deposit_check, recorded in
// plugin/evals/aml-exchange-deposit-where-money-went). The customer and the
// middle hop are stand-ins: the walk rows around them are the shape the
// exchange_outflows_N queries return.
const DEPOSIT = '0x64ba5fafa7a6e1991f7f60c9b594a7131a784540'
const HOT_WALLET = '0x0d0707963952f2fba59dd06f2b425ace40b492fe'
const CUSTOMER = '0x1111111111111111111111111111111111111111'
const MIDDLE = '0x2222222222222222222222222222222222222222'
const GATE_SWEPT_ROW = {
  deposit_address: DEPOSIT,
  hot_wallet: HOT_WALLET,
  hot_wallet_labels: ['Exchange', 'gate'],
  hot_wallet_role: 'hot_wallet',
  sweep_count: 1,
  amount_usd_sum: 629.45068023,
  paths: ['plain'],
  first_seen_timestamp: 1785991883000,
  last_seen_timestamp: 1785991883000,
}

// The two-hop walk customer -> middle -> Gate deposit, as exchange_outflows_2
// returns it: the walk ends at the first :Exchange address, here the deposit.
const TWO_HOP_TO_DEPOSIT = {
  direction: 'outflow',
  exchange_address: DEPOSIT,
  exchange_display_labels: ['Exchange', 'gate'],
  exchange_system_labels: ['Exchange', 'gate'],
  exchange_cex_role: 'deposit',
  deposit_address: MIDDLE,
  hops: 2,
  amount_usd_sum: 629.45,
  tx_count: 1,
  addresses: [CUSTOMER, MIDDLE, DEPOSIT],
  path_nodes: [
    { address: CUSTOMER },
    { address: MIDDLE },
    { address: DEPOSIT, labels: ['Exchange', 'gate'], is_exchange: 'gate' },
  ],
  edge_props: [
    { amount_usd_sum: 630, tx_count: 1 },
    { amount_usd_sum: 629.45, tx_count: 1 },
  ],
}

const ONE_HOP_TO_HOT_WALLET = {
  direction: 'outflow',
  exchange_address: HOT_WALLET,
  exchange_display_labels: ['Exchange', 'gate'],
  exchange_system_labels: ['Exchange', 'gate'],
  exchange_cex_role: 'hot_wallet',
  deposit_address: CUSTOMER,
  hops: 1,
  amount_usd_sum: 10,
  tx_count: 1,
  addresses: [CUSTOMER, HOT_WALLET],
}

describe('the exchange walks read the end address cex_role', () => {
  it('returns exchange_cex_role on every outflow and inflow depth', () => {
    for (const { id, query } of [
      ...queryBuilderContract.exchangeOutflowQueries(CUSTOMER),
      ...queryBuilderContract.exchangeInflowQueries(CUSTOMER),
    ]) {
      expect(query, id).toContain('exchange.cex_role AS exchange_cex_role')
    }
  })
})

describe('resolveExchangeEnd', () => {
  it('a walk that ends at a deposit reports the deposit, never the payer, as deposit_address', () => {
    const row = resolveExchangeEnd(TWO_HOP_TO_DEPOSIT)
    expect(row['exchange_role']).toBe('deposit')
    expect(row['exchange']).toBe('gate')
    expect(row['deposit_address']).toBe(DEPOSIT)
    expect(row['payer_address']).toBe(MIDDLE)
  })

  it('a one-hop deposit never names the screened wallet as the deposit', () => {
    const row = resolveExchangeEnd({ ...TWO_HOP_TO_DEPOSIT, deposit_address: CUSTOMER, hops: 1 })
    expect(row['deposit_address']).toBe(DEPOSIT)
    expect(row['payer_address']).toBe(CUSTOMER)
  })

  it('a hot wallet end keeps the node before it, and an unmarked end reads exchange', () => {
    const hot = resolveExchangeEnd(ONE_HOP_TO_HOT_WALLET)
    expect(hot['exchange_role']).toBe('hot_wallet')
    expect(hot['deposit_address']).toBe(CUSTOMER)
    expect(hot['payer_address']).toBeUndefined()
    const bare = resolveExchangeEnd({ ...ONE_HOP_TO_HOT_WALLET, exchange_cex_role: null })
    expect(bare['exchange_role']).toBe('exchange')
  })
})

describe('the SWEPT read of deposit ends', () => {
  it('reads each deposit once, nearest first, anchored on the deposit', () => {
    const rows = [
      resolveExchangeEnd(TWO_HOP_TO_DEPOSIT),
      resolveExchangeEnd({ ...TWO_HOP_TO_DEPOSIT, hops: 1, deposit_address: CUSTOMER }),
      resolveExchangeEnd(ONE_HOP_TO_HOT_WALLET),
    ]
    expect(exchangeDepositEnds(rows)).toEqual([DEPOSIT])
    const { id, query } = exchangeDepositSweptQuery(DEPOSIT, 0)
    expect(id).toBe('exchange_deposit_swept_1')
    expect(query).toMatch(
      new RegExp(`^MATCH \\(d:Address \\{address: "${DEPOSIT}"\\}\\)-\\[s:SWEPT\\]->`)
    )
  })

  it('attaches the hot wallet to the deposit row, and says when it was not read', () => {
    const rows = [resolveExchangeEnd(TWO_HOP_TO_DEPOSIT), resolveExchangeEnd(ONE_HOP_TO_HOT_WALLET)]
    const [deposit, hot] = attachSweptHotWallets(rows, [GATE_SWEPT_ROW], [DEPOSIT])
    expect(deposit!['swept_status']).toBe('read')
    expect(deposit!['swept_into']).toEqual([
      {
        hot_wallet: HOT_WALLET,
        hot_wallet_exchange: 'gate',
        hot_wallet_role: 'hot_wallet',
        sweep_count: 1,
        amount_usd_sum: 629.45068023,
        paths: ['plain'],
        first_seen_timestamp: 1785991883000,
        last_seen_timestamp: 1785991883000,
      },
    ])
    expect(hot!['swept_into']).toBeUndefined()
    const [unread] = attachSweptHotWallets(rows, [], [])
    expect(unread!['swept_status']).toBe('not_read')
    expect(unread!['swept_into']).toEqual([])
  })
})

type BatchQuery = { id: string; query: string }

function laneAClient(sweptOk = true) {
  const seen: string[] = []
  const client = {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      const queries = (req.arguments.queries ?? []).map((q) => {
        seen.push(q.id)
        if (q.id === 'address_profile') {
          return { id: q.id, ok: true, results: [{ address: CUSTOMER, network: 'robinhood' }] }
        }
        if (q.id === 'exchange_outflows_2') {
          return { id: q.id, ok: true, results: [TWO_HOP_TO_DEPOSIT] }
        }
        if (q.id === 'exchange_deposit_swept_1') {
          expect(q.query).toContain(DEPOSIT)
          return sweptOk
            ? { id: q.id, ok: true, results: [GATE_SWEPT_ROW] }
            : { id: q.id, ok: false, error: 'context deadline exceeded' }
        }
        return { id: q.id, ok: true, results: [] }
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }],
        isError: false,
      }
    }),
  }
  return { client, seen }
}

describe('aml_address_risk on a walk that ends at a Gate deposit', () => {
  it('names the deposit, the exchange and the hot wallet it was swept into, and stops there', async () => {
    const { client, seen } = laneAClient()
    const result = await addressRisk(client as never, { address: CUSTOMER, network: 'robinhood' })
    expect(seen).toContain('exchange_deposit_swept_1')
    const line = result.summaryText.split('\n').find((text) => text.startsWith('- outflow:'))
    expect(line).toBe(
      `- outflow: ${DEPOSIT} (gate deposit) (2 hop(s), amount_usd_sum 629.45): the money entered gate at this deposit, swept into hot wallet ${HOT_WALLET} (gate), 1 sweep(s). The trail ends here.`
    )
    const facts = (
      result.structuredContent as {
        facts: { exchange_behavior: { outflows: Array<Record<string, unknown>> } }
      }
    ).facts
    const [row] = facts.exchange_behavior.outflows
    expect(row!['deposit_address']).toBe(DEPOSIT)
    expect(row!['payer_address']).toBe(MIDDLE)
    expect((row!['swept_into'] as Array<{ hot_wallet: string }>)[0]!.hot_wallet).toBe(HOT_WALLET)
    const graph = result.graphData as {
      nodes: Array<{ address?: string; id?: string; roles?: string[] }>
      edges: Array<{ source: string; target: string; edge_type: string }>
    }
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: DEPOSIT, target: HOT_WALLET, edge_type: 'swept' })
    )
    // Nothing past the hot wallet is drawn.
    expect(graph.edges.filter((edge) => edge.source === HOT_WALLET)).toEqual([])
  })

  it('a failed SWEPT read degrades to not_read and points at aml_exchange_deposit_check', async () => {
    const { client } = laneAClient(false)
    const result = await addressRisk(client as never, { address: CUSTOMER, network: 'robinhood' })
    expect(result.summaryText).toContain(
      'its SWEPT link was not read, call aml_exchange_deposit_check for the hot wallet'
    )
    expect(result.summaryText).toContain('- exchange_deposit_swept_1: context deadline exceeded')
    // A failed SWEPT read is not a failed exchange search.
    const facts = (
      result.structuredContent as { facts: { exchange_behavior: { search_status: string } } }
    ).facts
    expect(facts.exchange_behavior.search_status).toBe('complete')
  })
})

describe('a route through an exchange links nothing', () => {
  it('route_found stays true, linked_outside_exchanges is false', () => {
    const through = {
      p: {
        nodes: [
          { address: CUSTOMER },
          { address: DEPOSIT, is_exchange: 'gate' },
          { address: MIDDLE },
        ],
      },
    }
    const evidence = buildRouteEvidence([through], [])
    expect(evidence.route_found).toBe(true)
    expect(evidence.outbound!.links_addresses).toBe(false)
    expect(evidence.linked_outside_exchanges).toBe(false)
    const direct = { p: { nodes: [{ address: CUSTOMER }, { address: MIDDLE }] } }
    expect(buildRouteEvidence([direct], []).linked_outside_exchanges).toBe(true)
  })
})
