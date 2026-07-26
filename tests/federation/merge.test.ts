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
    // perShard[shard] is an array of group entries (see the grouped-aggregate
    // describe block below for why: a plain object keyed by shard alone
    // cannot hold more than one group per shard without overwriting).
    expect(merged.perShard).toEqual({ s1: [{ total: 10 }], s2: [{ total: 25 }] })
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

describe('mergeShardRows — grouped per-shard aggregates do not overwrite (defect 2)', () => {
  it('keeps every group from the same shard instead of the last one silently overwriting the rest', () => {
    // RETURN b.address AS counterparty, sum(r.amount_usd_sum) AS usd — two
    // different counterparty groups coming back from the SAME shard s1.
    const merged = mergeShardRows(
      [
        { __shard: 's1', counterparty: 'X', usd: 100 },
        { __shard: 's1', counterparty: 'Y', usd: 5 },
        { __shard: 's2', counterparty: 'X', usd: 50 },
      ],
      { aggregateKeys: ['usd'] },
    )
    expect(merged.perShard.s1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ counterparty: 'X', usd: 100 }),
        expect.objectContaining({ counterparty: 'Y', usd: 5 }),
      ]),
    )
    expect(merged.perShard.s1).toHaveLength(2)
    expect(merged.perShard.s2).toEqual([{ counterparty: 'X', usd: 50 }])
  })

  it('still keeps aggregates out of the merged rows for grouped aggregates', () => {
    const merged = mergeShardRows(
      [
        { __shard: 's1', counterparty: 'X', usd: 100 },
        { __shard: 's1', counterparty: 'Y', usd: 5 },
      ],
      { aggregateKeys: ['usd'] },
    )
    const summable = merged.rows.reduce((acc, r) => acc + (typeof r.usd === 'number' ? r.usd : 0), 0)
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

/** Full-property edge helper: every FLOWS_TO property combineEdge knows
 *  about, with neutral defaults so a test only has to override what it
 *  cares about. */
function fullEdge(shard: string, from: string, to: string, overrides: Record<string, unknown> = {}) {
  return {
    __shard: shard,
    r: {
      type: 'FLOWS_TO',
      properties: {
        from_address: from,
        to_address: to,
        amount_usd_sum: 0,
        tx_count: 0,
        first_seen_timestamp: 100,
        last_seen_timestamp: 200,
        ...overrides,
      },
    },
  }
}

function props(merged: ReturnType<typeof mergeShardRows>) {
  return (merged.rows[0].r as any).properties
}

describe('mergeShardRows — combineEdge property rules (oracle-verified discrepancies)', () => {
  it('last_tx_id follows the shard with the greatest last_seen_timestamp, not merge order', () => {
    // Real oracle discrepancy: merged kept the earlier shard's last_tx_id
    // (7221975-20) even though a later shard carried more recent activity
    // (last_seen_timestamp 400 > 150) tagged with last_tx_id 8655558-24.
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { last_seen_timestamp: 150, last_tx_id: '7221975-20' }),
      fullEdge('s2', 'A', 'B', { last_seen_timestamp: 400, last_tx_id: '8655558-24' }),
    ])
    const p = props(merged)
    expect(p.last_seen_timestamp).toBe(400)
    expect(p.last_tx_id).toBe('8655558-24')
  })

  it('first_tx_id follows the shard with the smallest first_seen_timestamp, not merge order (mirror defect)', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { first_seen_timestamp: 500, first_tx_id: 'later-shard-first' }),
      fullEdge('s2', 'A', 'B', { first_seen_timestamp: 100, first_tx_id: 'earlier-shard-first' }),
    ])
    const p = props(merged)
    expect(p.first_seen_timestamp).toBe(100)
    expect(p.first_tx_id).toBe('earlier-shard-first')
  })

  it('avg_tx_size_usd is recomputed from the merged totals, not carried from one shard', () => {
    // Real oracle discrepancy: merged 3370.658 vs oracle 2314.028 — carrying
    // one shard's average instead of recomputing amount_usd_sum/tx_count.
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { amount_usd_sum: 1000, tx_count: 10 }), // per-shard avg 100
      fullEdge('s2', 'A', 'B', { amount_usd_sum: 2000, tx_count: 5 }), // per-shard avg 400
    ])
    const p = props(merged)
    expect(p.amount_usd_sum).toBe(3000)
    expect(p.tx_count).toBe(15)
    expect(p.avg_tx_size_usd).toBe(200) // 3000 / 15, NOT either shard's own average
  })

  it('avg_tx_size_usd guards divide-by-zero when the merged tx_count is 0', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { amount_usd_sum: 0, tx_count: 0 }),
      fullEdge('s2', 'A', 'B', { amount_usd_sum: 0, tx_count: 0 }),
    ])
    const p = props(merged)
    expect(p.avg_tx_size_usd).toBe(0)
  })

  it('dominant_asset comes from the constituent with the single largest amount_usd_sum, across 3+ shards', () => {
    // A pairwise fold that compares the running ACCUMULATED total against
    // each new shard's individual amount gets this wrong once there are more
    // than two shards: after folding s1+s2 the accumulator (70) already
    // exceeds s3's individual 50, so s3 never wins even though it is the
    // single largest individual contribution.
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { amount_usd_sum: 40, tx_count: 1, dominant_asset: 'TAO' }),
      fullEdge('s2', 'A', 'B', { amount_usd_sum: 30, tx_count: 1, dominant_asset: 'USDC' }),
      fullEdge('s3', 'A', 'B', { amount_usd_sum: 50, tx_count: 1, dominant_asset: 'DOT' }),
    ])
    expect(props(merged).dominant_asset).toBe('DOT')
  })

  it('dominant_asset ties keep the first-seen constituent', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { amount_usd_sum: 50, tx_count: 1, dominant_asset: 'TAO' }),
      fullEdge('s2', 'A', 'B', { amount_usd_sum: 50, tx_count: 1, dominant_asset: 'USDC' }),
    ])
    expect(props(merged).dominant_asset).toBe('TAO')
  })

  it('price_coverage_ratio is recomputed as the tx-count-weighted mean across shards', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { tx_count: 8, price_coverage_ratio: 1.0 }), // fully priced
      fullEdge('s2', 'A', 'B', { tx_count: 2, price_coverage_ratio: 0.0 }), // fully unpriced
    ])
    // (1.0*8 + 0.0*2) / 10 = 0.8 — the lifetime priced/total ratio, not a
    // naive average of the two shard ratios (which would be 0.5).
    expect(props(merged).price_coverage_ratio).toBeCloseTo(0.8)
  })

  it('bucket_start_ms/bucket_end_ms merge to the outer span of contributing shard windows', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { bucket_start_ms: 2000, bucket_end_ms: 2500 }),
      fullEdge('s2', 'A', 'B', { bucket_start_ms: 1000, bucket_end_ms: 3000 }),
    ])
    const p = props(merged)
    expect(p.bucket_start_ms).toBe(1000)
    expect(p.bucket_end_ms).toBe(3000)
  })

  it('endpoint identity and lookalike flags stay stable across constituents (shard-invariant)', () => {
    const merged = mergeShardRows([
      fullEdge('s1', 'A', 'B', { from_address_lookalike: false, to_address_lookalike: true }),
      fullEdge('s2', 'A', 'B', { from_address_lookalike: false, to_address_lookalike: true }),
    ])
    const p = props(merged)
    expect(p.from_address).toBe('A')
    expect(p.to_address).toBe('B')
    expect(p.from_address_lookalike).toBe(false)
    expect(p.to_address_lookalike).toBe(true)
  })
})
