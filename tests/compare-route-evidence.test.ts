import { describe, expect, it } from 'vitest'
import {
  buildRouteEvidence,
  connectionRouteQueries,
  routeFromPathValue,
  shouldIncludeRouteQueries,
} from '../src/investigation/public-tools.js'

// Pairwise route evidence between two KNOWN endpoints via native directed
// *BFS (MemGQL retired). Rules: directed only (no undirected shortest),
// bounded depth, exchange intermediates are DISCLOSED, never silently filtered.

describe('connectionRouteQueries', () => {
  it('emits exactly the two directed native *BFS route queries (snapshot)', () => {
    const queries = connectionRouteQueries('idA', 'idB')
    expect(queries).toEqual([
      {
        id: 'connection_route_outbound',
        query:
          'MATCH p = (src:Identity {identity_id: "idA"})-[:FLOWS_TO *BFS 1..4]->(dst:Identity {identity_id: "idB"}) RETURN p LIMIT 1',
      },
      {
        id: 'connection_route_inbound',
        query:
          'MATCH p = (src:Identity {identity_id: "idB"})-[:FLOWS_TO *BFS 1..4]->(dst:Identity {identity_id: "idA"}) RETURN p LIMIT 1',
      },
    ])
  })

  it('never contains quantifier-inner WHERE (hazard #4343/#4345)', () => {
    for (const { query } of connectionRouteQueries('a', 'b')) {
      expect(query).not.toMatch(/WHERE/)
    }
  })

  it('escapes quotes in identity ids', () => {
    const [outbound] = connectionRouteQueries('a"b', 'c')
    expect(outbound!.query).toContain('a\\"b')
    expect(outbound!.query).not.toContain('"a"b"')
  })
})

describe('shouldIncludeRouteQueries', () => {
  it('is true only for live_topology with a compare address', () => {
    expect(shouldIncludeRouteQueries('live_topology', 'x')).toBe(true)
    expect(shouldIncludeRouteQueries('archive_topology', 'x')).toBe(false)
    expect(shouldIncludeRouteQueries('live_topology', undefined)).toBe(false)
    expect(shouldIncludeRouteQueries('archive_topology', undefined)).toBe(false)
  })
})

describe('routeFromPathValue', () => {
  // Shape-tolerant: hydrated path values arrive as ordered node/edge
  // structures; the parser walks them for identity_id / is_exchange /
  // amount_usd_sum regardless of the exact envelope.
  const path = {
    nodes: [
      { identity_id: 'idA' },
      { identity_id: 'mid1', is_exchange: 'binance' },
      { identity_id: 'idB' },
    ],
    relationships: [
      { amount_usd_sum: 100 },
      { amount_usd_sum: 40 },
    ],
  }

  it('extracts hops, identities, and USD totals', () => {
    const route = routeFromPathValue(path)
    expect(route).toEqual({
      hops: 2,
      identities: ['idA', 'mid1', 'idB'],
      exchange_intermediates: ['mid1'],
      amount_usd_sum_total: 140,
    })
  })

  it('discloses exchange intermediates instead of dropping the path', () => {
    const route = routeFromPathValue(path)
    expect(route).not.toBeNull()
    expect(route!.exchange_intermediates).toEqual(['mid1'])
  })

  it('falsy is_exchange encodings are never disclosed; name markers are', () => {
    const route = routeFromPathValue({
      nodes: [
        { identity_id: 'idA' },
        { identity_id: 'midFalse', is_exchange: false },
        { identity_id: 'midFalseStr', is_exchange: 'false' },
        { identity_id: 'midZero', is_exchange: 0 },
        { identity_id: 'midName', is_exchange: 'binance' },
        { identity_id: 'idB' },
      ],
      relationships: [
        { amount_usd_sum: 1 },
        { amount_usd_sum: 1 },
        { amount_usd_sum: 1 },
        { amount_usd_sum: 1 },
        { amount_usd_sum: 1 },
      ],
    })
    expect(route!.exchange_intermediates).toEqual(['midName'])
  })

  it('endpoints are not counted as exchange intermediates', () => {
    const route = routeFromPathValue({
      nodes: [
        { identity_id: 'idA', is_exchange: 'kraken' },
        { identity_id: 'idB', is_exchange: 'binance' },
      ],
      relationships: [{ amount_usd_sum: 10 }],
    })
    expect(route!.exchange_intermediates).toEqual([])
  })

  it('hops come from the node sequence even with partially hydrated edges', () => {
    const route = routeFromPathValue({
      nodes: [{ identity_id: 'idA' }, { identity_id: 'mid' }, { identity_id: 'idB' }],
      // One edge lacks a numeric amount — hop count must not shrink.
      relationships: [{ amount_usd_sum: 30 }, { amount_usd_sum: null }],
    })
    expect(route!.hops).toBe(2)
    expect(route!.amount_usd_sum_total).toBe(30)
  })

  it('returns null for empty/absent rows', () => {
    expect(routeFromPathValue(undefined)).toBeNull()
    expect(routeFromPathValue(null)).toBeNull()
    expect(routeFromPathValue({})).toBeNull()
  })
})

describe('buildRouteEvidence', () => {
  const outboundRow = {
    nodes: [{ identity_id: 'idA' }, { identity_id: 'idB' }],
    relationships: [{ amount_usd_sum: 5 }],
  }

  it('merges directed sides with pinned strategy metadata', () => {
    const evidence = buildRouteEvidence([{ p: outboundRow }], [])
    expect(evidence).toEqual({
      search_strategy: 'any_shortest',
      route_rank_basis: 'hop_count',
      depth_bound: 4,
      route_found: true,
      outbound: {
        hops: 1,
        identities: ['idA', 'idB'],
        exchange_intermediates: [],
        amount_usd_sum_total: 5,
      },
      inbound: null,
    })
  })

  it('route_found is false when both sides are empty', () => {
    const evidence = buildRouteEvidence([], [])
    expect(evidence.route_found).toBe(false)
    expect(evidence.outbound).toBeNull()
    expect(evidence.inbound).toBeNull()
  })
})
