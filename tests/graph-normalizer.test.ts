import { describe, expect, it } from 'vitest'

describe('normalizeGraphPayload', () => {
  it('uses MCP graph labels as source of truth and removes local compatibility fields', async () => {
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
        {
          address: '5OldArtifact',
          labels: [],
          raw_labels: ['Address', 'Exchange', 'Binance'],
        },
      ],
      edges: [{ source: '5Wallet', target: '5Binance', amount_usd_sum: 10 }],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      address: '5Wallet',
      role: 'seed',
      labels: [],
    })
    expect(result.nodes[0]).not.toHaveProperty('address_type')
    expect(result.nodes[0]).not.toHaveProperty('entity_kind')
    expect(result.nodes[0]).not.toHaveProperty('raw_labels')
    expect(result.nodes[0]).not.toHaveProperty('risk_level')
    expect(result.nodes[0]).not.toHaveProperty('pattern_flags')

    expect(result.nodes[1]).toMatchObject({
      labels: [],
      role: 'exchange',
    })
    expect(result.nodes[1]).not.toHaveProperty('entity_kind')
    expect(result.nodes[1]).not.toHaveProperty('raw_labels')

    expect(result.nodes[2]).toMatchObject({
      address: '5Binance',
      labels: ['Binance'],
      role: 'exchange',
    })
    expect(result.nodes[3]).toMatchObject({
      address: '5OldArtifact',
      labels: [],
    })
    expect(result.nodes[3]).not.toHaveProperty('role')
    expect(result.nodes[3]).not.toHaveProperty('raw_labels')
    expect(result.edges[0]).toMatchObject({
      from_address: '5Wallet',
      to_address: '5Binance',
      amount_usd_sum: 10,
    })
  })
})
