import { describe, expect, it } from 'vitest'

describe('normalizeGraphPayload', () => {
  it('separates raw graph labels from display labels and removes unsupported placeholders', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5Wallet',
          labels: ['Address'],
          address_type: 'wallet',
          role: 'seed',
          risk_level: null,
          pattern_flags: [],
        },
        {
          address: '5HiveMEoWPmQmBAb8v63bKPcFhgTGCmST1TVZNvPHSTKFLCv',
          labels: ['Address', 'Miner', 'Exchange', 'Subnet'],
          address_type: 'wallet',
          role: 'source_exchange',
        },
        {
          id: '5Binance',
          labels: ['Address', 'Exchange', 'Binance'],
          address_type: 'exchange',
        },
      ],
      edges: [{ source: '5Wallet', target: '5Binance', amount_usd_sum: 10 }],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      address: '5Wallet',
      role: 'seed',
      entity_kind: 'address',
      labels: [],
      raw_labels: ['Address'],
    })
    expect(result.nodes[0]).not.toHaveProperty('address_type')
    expect(result.nodes[0]).not.toHaveProperty('risk_level')
    expect(result.nodes[0]).not.toHaveProperty('pattern_flags')

    expect(result.nodes[1]).toMatchObject({
      entity_kind: 'exchange_labeled_address',
      labels: [],
      raw_labels: ['Address', 'Miner', 'Exchange', 'Subnet'],
      role: 'source_exchange',
    })

    expect(result.nodes[2]).toMatchObject({
      address: '5Binance',
      entity_kind: 'exchange_labeled_address',
      labels: ['Binance'],
      raw_labels: ['Address', 'Exchange', 'Binance'],
    })
    expect(result.edges[0]).toMatchObject({
      from_address: '5Wallet',
      to_address: '5Binance',
      amount_usd_sum: 10,
    })
  })
})
