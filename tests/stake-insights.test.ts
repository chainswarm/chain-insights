import { describe, expect, it, vi } from 'vitest'
import { stakeInsights } from '../src/investigation/public-tools.js'

function graphBatchResult(queries: Array<Record<string, unknown>>): {
  content: Array<{ type: 'text'; text: string }>
  isError: false
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        schema: 'chain-insights.result.v1',
        tool: 'graph_query_batch',
        facts: { queries },
      }),
    }],
    isError: false,
  }
}

describe('stakeInsights', () => {
  it('summarizes stake relationships, movement amounts, counterparties, and query evidence', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_stake_relationships',
        ok: true,
        results: [{
          coldkey: '5Cold',
          hotkey: '5Hot',
          netuid: 19,
          amount: 8.75,
          stake_added_amount: 10.5,
          stake_removed_amount: 2.25,
          stake_moved_in_amount: 1,
          stake_moved_out_amount: 0.5,
          net_stake_change: 8.75,
          stake_event_count: 4,
          first_activity_timestamp: 1769126400000,
          last_activity_timestamp: 1769126500000,
          first_tx_id: '8265058-1',
          last_tx_id: '8265060-2',
          source_backend: 'memgraph_live',
        }],
      },
      {
        id: 'archive_stake_relationships',
        ok: true,
        results: [{
          coldkey: '5Cold',
          hotkey: '5Hot',
          netuid: 19,
          amount: 8.75,
          stake_added_amount: 10.5,
          stake_removed_amount: 2.25,
          stake_moved_in_amount: 1,
          stake_moved_out_amount: 0.5,
          net_stake_change: 8.75,
          stake_event_count: 4,
          first_activity_timestamp: 1769126400000,
          last_activity_timestamp: 1769126500000,
          first_tx_id: '8265058-1',
          last_tx_id: '8265060-2',
          source_backend: 'starrocks_archive',
        }],
      },
    ]))

    const result = await stakeInsights({ callTool } as never, {
      network: 'bittensor',
      address: '5Cold',
      netuid: 19,
      startTimestampMs: 1769126300000,
      endTimestampMs: 1769126600000,
      depth: 2,
    })

    expect(callTool).toHaveBeenCalledOnce()
    const args = callTool.mock.calls[0]?.[0].arguments
    expect(args.network).toBe('bittensor')
    expect(args.queries).toHaveLength(2)
    expect(args.queries[0].query).toContain('USE live_topology')
    expect(args.queries[0].query).toContain('STAKES_IN')
    expect(args.queries[0].query).toContain('coldkey.address = "5Cold" OR hotkey.address = "5Cold"')
    expect(args.queries[0].query).toContain('stake.netuid = 19')
    expect(args.queries[1].query).toContain('USE archive_topology')

    expect(result.summaryText).toContain('Stake insights for bittensor:5Cold')
    expect(result.structuredContent.tool).toBe('stake_insights')
    expect(result.structuredContent.facts.stake_totals).toMatchObject({
      total_staked: 10.5,
      total_unstaked: 2.25,
      net_staked: 8.75,
      first_activity_timestamp: 1769126400000,
      last_activity_timestamp: 1769126500000,
    })
    expect(result.structuredContent.facts.active_relationships).toEqual([
      expect.objectContaining({
        coldkey: '5Cold',
        hotkey: '5Hot',
        netuid: 19,
        amount: 8.75,
        source_backend: 'memgraph_live',
      }),
    ])
    expect(result.structuredContent.facts.stake_movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ movement_type: 'stake_added', amount: 10.5, direction: 'coldkey_to_hotkey' }),
      expect.objectContaining({ movement_type: 'stake_removed', amount: 2.25, direction: 'hotkey_to_coldkey' }),
      expect.objectContaining({ movement_type: 'stake_moved_in', amount: 1, direction: 'counterparty_to_relationship' }),
      expect.objectContaining({ movement_type: 'stake_moved_out', amount: 0.5, direction: 'relationship_to_counterparty' }),
    ]))
    expect(result.structuredContent.facts.top_counterparties).toEqual([
      expect.objectContaining({ address: '5Hot', role: 'hotkey', amount: 8.75 }),
    ])
    expect(result.structuredContent.facts.query_evidence).toEqual([
      expect.objectContaining({ id: 'live_stake_relationships', topology_graph: 'live_topology', row_count: 1 }),
      expect.objectContaining({ id: 'archive_stake_relationships', topology_graph: 'archive_topology', row_count: 1 }),
    ])
    expect(result.graphData.edges).toEqual([
      expect.objectContaining({ source: '5Cold', target: '5Hot', edge_type: 'stakes_in', amount: 8.75 }),
    ])
  })

  it('fails explicitly when the stake backend is unavailable', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_stake_relationships',
        ok: false,
        error: 'Unknown relationship type STAKES_IN',
      },
      {
        id: 'archive_stake_relationships',
        ok: false,
        error: 'Unknown relationship type STAKES_IN',
      },
    ]))

    await expect(stakeInsights({ callTool } as never, {
      network: 'bittensor',
      coldkey: '5Cold',
    })).rejects.toThrow('Stake insights unavailable')
  })

  it('returns a partial no-relationship result when one stake topology is unavailable', async () => {
    const callTool = vi.fn().mockResolvedValue(graphBatchResult([
      {
        id: 'live_stake_relationships',
        ok: true,
        results: [],
      },
      {
        id: 'archive_stake_relationships',
        ok: false,
        error: 'An unexpected error occurred executing the query',
      },
    ]))

    const result = await stakeInsights({ callTool } as never, {
      network: 'bittensor',
      coldkey: '5Cold',
    })

    expect(result.summaryText).toContain('No stake relationships matched the requested filters.')
    expect(result.summaryText).toContain('Partial query failures')
    expect(result.structuredContent.facts.stake_totals).toMatchObject({
      relationship_count: 0,
      net_staked: 0,
    })
    expect(result.structuredContent.facts.partial_query_errors).toEqual([
      expect.objectContaining({
        id: 'archive_stake_relationships',
        error: 'An unexpected error occurred executing the query',
      }),
    ])
  })
})
