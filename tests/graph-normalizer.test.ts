import { describe, expect, it } from 'vitest'

describe('normalizeGraphPayload', () => {
  it('emits canonical node_type, labels, roles, and flags', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5Seed',
          labels: ['Address'],
          system_labels: ['Address'],
          role: 'seed',
          entity_kind: 'address',
          raw_labels: ['Address'],
        },
        {
          id: '5Exchange',
          address: '5Exchange',
          labels: ['Binance', 'exchange'],
          system_labels: ['Address', 'Exchange'],
          address_subtypes: [],
          role: 'source_exchange',
          pattern_flags: ['layering'],
        },
        {
          address: '0xabc',
          labels: null,
          system_labels: ['Address'],
          address_subtypes: null,
        },
      ],
      edges: [
        {
          source: '5Seed',
          target: '5Exchange',
          type: 'FLOWS_TO',
          from_address: '5Seed',
          to_address: '5Exchange',
          amount_usd_sum: 12,
        },
        {
          from_address: '5Exchange',
          to_address: '0xabc',
          type: 'TRANSFER',
          tx_count: 2,
        },
      ],
      flows: [],
      edge_anchors: [],
    })

    for (const node of result.nodes) {
      expect(node).not.toHaveProperty('entity_kind')
      expect(node).not.toHaveProperty('raw_labels')
      expect(node).not.toHaveProperty('role')
      expect(node).not.toHaveProperty('pattern_flags')
    }

    expect(result.nodes[0]).toMatchObject({
      id: '5Seed',
      address: '5Seed',
      node_type: 'address',
      labels: [],
      roles: ['seed'],
    })
    expect(result.nodes[0]).not.toHaveProperty('address_type')
    expect(result.nodes[0]).not.toHaveProperty('entity_kind')
    expect(result.nodes[0]).not.toHaveProperty('raw_labels')
    expect(result.nodes[0]).not.toHaveProperty('role')

    expect(result.nodes[1]).toMatchObject({
      id: '5Exchange',
      address: '5Exchange',
      node_type: 'address',
      labels: ['Binance', 'exchange'],
      roles: ['exchange'],
      flags: ['layering'],
    })
    expect(result.nodes[1]).not.toHaveProperty('address_type')
    expect(result.nodes[1]).not.toHaveProperty('address_subtypes')
    expect(result.nodes[1]).not.toHaveProperty('pattern_flags')

    expect(result.nodes[2]).toMatchObject({
      id: '0xabc',
      address: '0xabc',
      node_type: 'address',
      labels: [],
    })
    expect(result.nodes[2]).not.toHaveProperty('address_type')
    expect(result.nodes[2]).not.toHaveProperty('address_subtypes')

    expect(result.edges[0]).toMatchObject({
      source: '5Seed',
      target: '5Exchange',
      edge_type: 'flows_to',
      amount_usd_sum: 12,
    })
    expect(result.edges[0]).not.toHaveProperty('from_address')
    expect(result.edges[0]).not.toHaveProperty('to_address')
    expect(result.edges[0]).not.toHaveProperty('type')

    expect(result.edges[1]).toMatchObject({
      source: '5Exchange',
      target: '0xabc',
      edge_type: 'flows_to',
      tx_count: 2,
    })
    for (const edge of result.edges) {
      expect(edge).not.toHaveProperty('from_address')
      expect(edge).not.toHaveProperty('to_address')
      expect(edge).not.toHaveProperty('type')
    }
  })

  it('does not collapse money_trail/trail_ends_at edges into flows_to (own visual layer)', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [],
      edges: [
        { from_address: 'seed', to_address: 'hop1', edge_type: 'MONEY_TRAIL' },
        { from_address: 'seed', to_address: 'term1', type: 'TRAIL_ENDS_AT' },
        { from_address: 'seed', to_address: 'hop2', edge_type: 'money_trail' },
        { from_address: 'seed', to_address: 'term2', edge_type: 'trail_ends_at' },
      ],
      flows: [],
      edge_anchors: [],
    })

    expect(result.edges[0]).toMatchObject({
      source: 'seed',
      target: 'hop1',
      edge_type: 'money_trail',
    })
    expect(result.edges[1]).toMatchObject({
      source: 'seed',
      target: 'term1',
      edge_type: 'trail_ends_at',
    })
    expect(result.edges[2]).toMatchObject({
      source: 'seed',
      target: 'hop2',
      edge_type: 'money_trail',
    })
    expect(result.edges[3]).toMatchObject({
      source: 'seed',
      target: 'term2',
      edge_type: 'trail_ends_at',
    })
    for (const edge of result.edges) {
      expect(edge['edge_type']).not.toBe('flows_to')
    }
  })

  it('preserves optional address_subtypes only when non-empty', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5Validator',
          labels: ['validator'],
          address_subtypes: ['validator_hotkey'],
        },
      ],
      edges: [],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      id: '5Validator',
      address: '5Validator',
      node_type: 'address',
      labels: ['validator'],
      address_subtypes: ['validator_hotkey'],
    })
  })

  it('strips exact system labels while preserving lowercase and domain display labels', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5MinerHotkey',
          labels: ['Miner', 'Hotkey', 'Subnet', 'Alpha Pool', 'miner subnet 27'],
          system_labels: ['Miner', 'Hotkey', 'Subnet'],
        },
        {
          address: '5ExchangeValidator',
          labels: [
            'Address',
            'Exchange',
            'Binance',
            'exchange',
            'validator',
            'miner subnet 27',
            'IPAddress',
          ],
          system_labels: ['Address', 'Exchange', 'IPAddress'],
        },
      ],
      edges: [],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      id: '5MinerHotkey',
      address: '5MinerHotkey',
      node_type: 'address',
      labels: ['Alpha Pool', 'miner subnet 27'],
    })
    expect(result.nodes[1]).toMatchObject({
      id: '5ExchangeValidator',
      address: '5ExchangeValidator',
      node_type: 'address',
      labels: ['Binance', 'exchange', 'validator', 'miner subnet 27'],
    })
  })
})
