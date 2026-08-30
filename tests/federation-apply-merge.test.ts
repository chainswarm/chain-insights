import { describe, expect, it } from 'vitest'
import {
  applyShardMergeToBatchEntries,
  deriveMergeOptionsFromQuery,
  mergeGraphRows,
  type BatchQueryEntry,
} from '../src/federation/apply-merge.js'

describe('deriveMergeOptionsFromQuery', () => {
  it('has no aggregateKeys/orderBy for a plain projection with no ORDER BY', () => {
    const query = 'MATCH (a:Address) RETURN a.address AS address, a.degree_in AS degree_in LIMIT 10'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.aggregateKeys).toBeUndefined()
    expect(options.orderBy).toBeUndefined()
    expect(options.limit).toBe(10)
  })

  it('lifts count/sum/avg/min/max aliases into aggregateKeys', () => {
    const query =
      'MATCH (a:Address) RETURN a.address AS address, count(a) AS n, sum(a.x) AS total, avg(a.y) AS mean, min(a.z) AS lo, max(a.z) AS hi'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.aggregateKeys).toEqual(['n', 'total', 'mean', 'lo', 'hi'])
  })

  it('classifies an invariant node property ORDER BY key as invariant', () => {
    const query =
      'MATCH (t:Address) RETURN t.address AS address, t.risk_score AS risk_score ORDER BY t.risk_score DESC LIMIT 50'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.orderBy).toEqual({ key: 'risk_score', desc: true })
    expect(options.orderKeyClass).toBe('invariant')
  })

  it('classifies a non-invariant ORDER BY key (e.g. an edge sum) as merge-affected', () => {
    const query =
      'MATCH (s)-[r:FLOWS_TO]->(t) RETURN t.address AS address, r.amount_usd_sum AS amount_usd_sum ORDER BY r.amount_usd_sum DESC LIMIT 200'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.orderBy).toEqual({ key: 'amount_usd_sum', desc: true })
    expect(options.orderKeyClass).toBe('merge-affected')
  })

  it('resolves ORDER BY sorting by the alias directly', () => {
    const query = 'MATCH (a:Address) RETURN a.address AS address ORDER BY address ASC'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.orderBy).toEqual({ key: 'address', desc: false })
    expect(options.orderKeyClass).toBe('invariant')
  })

  it('drops ORDER BY entirely when the sort key is itself an aggregate alias', () => {
    const query =
      'MATCH (a:Address)-[r:FLOWS_TO]->(b) RETURN b.address AS address, sum(r.amount_usd_sum) AS usd ORDER BY usd DESC LIMIT 10'
    const options = deriveMergeOptionsFromQuery(query)
    expect(options.aggregateKeys).toEqual(['usd'])
    expect(options.orderBy).toBeUndefined()
  })

  it('has no LIMIT when the query has none', () => {
    const options = deriveMergeOptionsFromQuery('MATCH (a:Address) RETURN a.address AS address')
    expect(options.limit).toBeUndefined()
  })
})

describe('mergeGraphRows — no-op guard', () => {
  it('passes a non-shard-tagged response through byte-identical (same array reference)', () => {
    const rows = [
      { address: 'a', degree_in: 1 },
      { address: 'b', degree_in: 2 },
    ]
    const result = mergeGraphRows(
      rows,
      'MATCH (a:Address) RETURN a.address AS address, a.degree_in AS degree_in'
    )
    expect(result.merged).toBe(false)
    expect(result.rows).toBe(rows)
    expect(result.perShard).toEqual({})
    expect(result.ordering).toBe('unordered')
  })

  it('merges and strips __shard when rows are shard-tagged', () => {
    const rows = [
      { __shard: 's1', address: 'a', risk_score: 5 },
      { __shard: 's2', address: 'a', risk_score: 5 },
    ]
    const result = mergeGraphRows(
      rows,
      'MATCH (a:Address) RETURN a.address AS address, a.risk_score AS risk_score'
    )
    expect(result.merged).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).not.toHaveProperty('__shard')
  })
})

describe('applyShardMergeToBatchEntries', () => {
  const queries = [
    {
      id: 'q1',
      query:
        'MATCH (a:Address) RETURN a.address AS address, a.risk_score AS risk_score ORDER BY a.risk_score DESC LIMIT 10',
    },
  ]

  it('is a no-op for entries whose rows carry no __shard (flag-off case)', () => {
    const entries: BatchQueryEntry[] = [
      { id: 'q1', ok: true, results: [{ address: 'a', risk_score: 5 }] },
    ]
    const before = JSON.parse(JSON.stringify(entries))
    applyShardMergeToBatchEntries(entries, queries)
    expect(entries).toEqual(before)
    expect(entries[0].perShard).toBeUndefined()
    expect(entries[0].ordering).toBeUndefined()
  })

  it('merges shard-tagged entries and attaches perShard/ordering', () => {
    const entries: BatchQueryEntry[] = [
      {
        id: 'q1',
        ok: true,
        results: [
          { __shard: 's1', address: 'a', risk_score: 5 },
          { __shard: 's2', address: 'a', risk_score: 5 },
          { __shard: 's1', address: 'b', risk_score: 3 },
        ],
      },
    ]
    applyShardMergeToBatchEntries(entries, queries)
    expect(entries[0].results).toHaveLength(2)
    for (const row of entries[0].results ?? []) expect(row).not.toHaveProperty('__shard')
    expect(entries[0].ordering).toBe('exact')
  })

  it('skips entries with ok:false or empty results without throwing', () => {
    const entries: BatchQueryEntry[] = [
      { id: 'q1', ok: false, error: 'boom' },
      { id: 'missing-query', ok: true, results: [{ __shard: 's1', x: 1 }] },
    ]
    expect(() => applyShardMergeToBatchEntries(entries, queries)).not.toThrow()
    // 'missing-query' has no matching query text — left untouched (still __shard-tagged).
    expect(entries[1].results?.[0]).toHaveProperty('__shard')
  })
})
