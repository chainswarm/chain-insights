import { describe, expect, it } from 'vitest'
import { traceQueryBuilderContract, MAX_SAFE_QUERY_TEXT_BYTES } from '../src/investigation/trace-funds.js'

// chain-insights#209: aml_trace_suspect_funds hard-fails with "query too
// large: maximum 32768 bytes per query" on well-connected seeds. Root
// cause: directEdgePropsQuery / reverseLeadsQuery build ONE Cypher query
// with an OR-predicate per discovered flow edge / deposit address. That
// predicate list is unbounded by graph connectivity, not by max_hops, so
// the single generated query can exceed the server's 32768-byte-per-query
// cap even at modest hop depths on well-connected seeds. The fix chunks
// these into multiple queries that each stay under the cap, merging
// results client-side so nothing is silently dropped.

function fakeAddress(n: number): string {
  return `5${'a'.repeat(46)}${String(n).padStart(2, '0')}`
}

describe('trace query size cap (chain-insights#209)', () => {
  it('directEdgePropsQueries keeps every generated query under the byte cap for a large edge set', () => {
    const flows = Array.from({ length: 400 }, (_, index) => ({
      hop: 1,
      src: fakeAddress(index),
      dst: fakeAddress(index + 1000),
      amount_usd_sum: 1,
      terminal_exchange: false,
    }))

    const queries = traceQueryBuilderContract.directEdgePropsQueries(flows)

    expect(queries.length).toBeGreaterThan(1)
    for (const { query } of queries) {
      expect(Buffer.byteLength(query, 'utf8')).toBeLessThanOrEqual(MAX_SAFE_QUERY_TEXT_BYTES)
    }
    // ids must be unique so results can be merged without collision
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length)
  })

  it('directEdgePropsQueries returns a single query with the legacy id for a small edge set', () => {
    const flows = [
      { hop: 1, src: fakeAddress(1), dst: fakeAddress(2), amount_usd_sum: 1, terminal_exchange: false },
      { hop: 2, src: fakeAddress(2), dst: fakeAddress(3), amount_usd_sum: 1, terminal_exchange: true },
    ]
    const queries = traceQueryBuilderContract.directEdgePropsQueries(flows)
    expect(queries).toHaveLength(1)
    expect(queries[0]!.id).toBe('direct_edge_props')
  })

  it('directEdgePropsQueries returns no queries for an empty flow list', () => {
    expect(traceQueryBuilderContract.directEdgePropsQueries([])).toEqual([])
  })

  it('reverseLeadsQueries keeps every generated query under the byte cap for a large deposit set', () => {
    const deposits = Array.from({ length: 600 }, (_, index) => fakeAddress(index))
    const queries = traceQueryBuilderContract.reverseLeadsQueries(deposits)

    expect(queries.length).toBeGreaterThan(1)
    for (const { query } of queries) {
      expect(Buffer.byteLength(query, 'utf8')).toBeLessThanOrEqual(MAX_SAFE_QUERY_TEXT_BYTES)
    }
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length)
  })

  it('reverseLeadsQueries returns a single query with the legacy id for a small deposit set', () => {
    const queries = traceQueryBuilderContract.reverseLeadsQueries([fakeAddress(1), fakeAddress(2)])
    expect(queries).toHaveLength(1)
    expect(queries[0]!.id).toBe('reverse_1hop')
  })
})
