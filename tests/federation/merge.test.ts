import { describe, expect, it } from 'vitest'
import { mergeShardRows } from '../../src/federation/merge.js'

function edgeRow(shard: string, from: string, to: string, usd: number, tx: number, first = 100, last = 200) {
  return {
    __shard: shard,
    r: {
      type: 'FLOWS_TO',
      properties: {
        from_address: from, to_address: to,
        amount_usd_sum: usd, tx_count: tx,
        first_seen_timestamp: first, last_seen_timestamp: last,
      },
    },
  }
}

describe('mergeShardRows — edges', () => {
  it('sum-merges the same pair across shards into one lifetime edge', () => {
    const merged = mergeShardRows([
      edgeRow('s1', 'A', 'B', 10, 2, 100, 150),
      edgeRow('s2', 'A', 'B', 5, 3, 300, 400),
    ])
    expect(merged.rows).toHaveLength(1)
    const props = (merged.rows[0].r as any).properties
    expect(props.amount_usd_sum).toBe(15)
    expect(props.tx_count).toBe(5)
    expect(props.first_seen_timestamp).toBe(100)
    expect(props.last_seen_timestamp).toBe(400)
  })

  it('keeps distinct pairs separate', () => {
    const merged = mergeShardRows([
      edgeRow('s1', 'A', 'B', 10, 2),
      edgeRow('s2', 'A', 'C', 5, 3),
    ])
    expect(merged.rows).toHaveLength(2)
  })

  it('does not mutate the caller rows', () => {
    const rows = [edgeRow('s1', 'A', 'B', 10, 2), edgeRow('s2', 'A', 'B', 5, 3)]
    const snapshot = JSON.stringify(rows)
    mergeShardRows(rows)
    expect(JSON.stringify(rows)).toBe(snapshot)
  })

  it('strips the __shard tag from merged output', () => {
    const merged = mergeShardRows([edgeRow('s1', 'A', 'B', 10, 2)])
    expect(merged.rows[0].__shard).toBeUndefined()
  })
})

describe('mergeShardRows — nodes', () => {
  it('dedups an identical node seen in several shards', () => {
    const merged = mergeShardRows([
      { __shard: 's1', address: 'A', risk_level: 'LOW' },
      { __shard: 's2', address: 'A', risk_level: 'LOW' },
      { __shard: 's3', address: 'B', risk_level: 'HIGH' },
    ])
    expect(merged.rows).toHaveLength(2)
    expect(merged.rows.map((r) => r.address).sort()).toEqual(['A', 'B'])
  })
})

describe('mergeShardRows — per-shard aggregates (A7)', () => {
  it('returns named aggregates per shard instead of a merged scalar', () => {
    const merged = mergeShardRows(
      [
        { __shard: 's1', total: 10 },
        { __shard: 's2', total: 25 },
      ],
      { aggregateKeys: ['total'] },
    )
    expect(merged.perShard).toEqual({ s1: { total: 10 }, s2: { total: 25 } })
  })

  it('keeps aggregates out of the merged rows so they cannot be summed by accident', () => {
    const merged = mergeShardRows(
      [
        { __shard: 's1', total: 10 },
        { __shard: 's2', total: 25 },
      ],
      { aggregateKeys: ['total'] },
    )
    const summable = merged.rows.reduce((acc, r) => acc + (typeof r.total === 'number' ? r.total : 0), 0)
    expect(summable).toBe(0)
  })
})

describe('mergeShardRows — ordering marker (D3)', () => {
  it('is exact for a shard-invariant sort key', () => {
    const merged = mergeShardRows(
      [
        { __shard: 's2', address: 'B' },
        { __shard: 's1', address: 'A' },
      ],
      { orderBy: { key: 'address' }, orderKeyClass: 'invariant', limit: 1 },
    )
    expect(merged.ordering).toBe('exact')
    expect(merged.rows).toHaveLength(1)
    expect(merged.rows[0].address).toBe('A')
  })

  it('is approximate for a merge-affected sort key', () => {
    const merged = mergeShardRows(
      [{ __shard: 's1', address: 'A', usd: 5 }],
      { orderBy: { key: 'usd', desc: true }, orderKeyClass: 'merge-affected' },
    )
    expect(merged.ordering).toBe('approximate')
  })

  it('re-cuts the limit globally, after merging', () => {
    const merged = mergeShardRows(
      [
        { __shard: 's1', address: 'C' },
        { __shard: 's2', address: 'A' },
        { __shard: 's3', address: 'B' },
      ],
      { orderBy: { key: 'address' }, orderKeyClass: 'invariant', limit: 2 },
    )
    expect(merged.rows.map((r) => r.address)).toEqual(['A', 'B'])
  })
})
