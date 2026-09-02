import { describe, expect, it, vi } from 'vitest'
import {
  addressRisk,
  buildRouteEvidence,
  connectionRouteQueries,
  routeFromPathValue,
  shouldIncludeRouteQueries,
  isExchangeMarker,
} from '../src/investigation/public-tools.js'

// Pairwise route evidence between two KNOWN endpoints via bounded ISO GQL
// shortest paths. Exchange intermediates are DISCLOSED, never silently
// filtered.

describe('connectionRouteQueries', () => {
  it('emits exactly the two bounded GQL shortest route queries (snapshot)', () => {
    const queries = connectionRouteQueries('idA', 'idB')
    expect(queries).toEqual([
      {
        id: 'connection_route_outbound',
        query:
          'MATCH p = SHORTEST 1 (src:Address {address: "idA"})-[:FLOWS_TO]-{1,4}(dst:Address {address: "idB"}) RETURN p LIMIT 1',
      },
      {
        id: 'connection_route_inbound',
        query:
          'MATCH p = SHORTEST 1 (src:Address {address: "idB"})-[:FLOWS_TO]-{1,4}(dst:Address {address: "idA"}) RETURN p LIMIT 1',
      },
    ])
  })

  it('never contains quantifier-inner WHERE (hazard #4343/#4345)', () => {
    for (const { query } of connectionRouteQueries('a', 'b')) {
      expect(query).not.toMatch(/WHERE/)
    }
  })

  it('escapes quotes in addresses', () => {
    const [outbound] = connectionRouteQueries('a"b', 'c')
    expect(outbound!.query).toContain('a\\"b')
    expect(outbound!.query).not.toContain('"a"b"')
  })
})

describe('shouldIncludeRouteQueries', () => {
  it('is true only when a compare address is given', () => {
    expect(shouldIncludeRouteQueries('x')).toBe(true)
    expect(shouldIncludeRouteQueries(undefined)).toBe(false)
  })
})

describe('routeFromPathValue', () => {
  it('classifies exchange markers without accepting falsy encodings', () => {
    expect(isExchangeMarker(null)).toBe(false)
    expect(isExchangeMarker(undefined)).toBe(false)
    expect(isExchangeMarker(false)).toBe(false)
    expect(isExchangeMarker(0)).toBe(false)
    expect(isExchangeMarker('')).toBe(false)
    expect(isExchangeMarker(' false ')).toBe(false)
    expect(isExchangeMarker('0')).toBe(false)
    expect(isExchangeMarker('null')).toBe(false)
    expect(isExchangeMarker(true)).toBe(true)
    expect(isExchangeMarker(1)).toBe(true)
    expect(isExchangeMarker('binance')).toBe(true)
  })

  // Shape-tolerant: hydrated path values arrive as ordered node/edge
  // structures; the parser walks them for address / is_exchange /
  // amount_usd_sum regardless of the exact envelope.
  const path = {
    nodes: [{ address: 'idA' }, { address: 'mid1', is_exchange: 'binance' }, { address: 'idB' }],
    relationships: [{ amount_usd_sum: 100 }, { amount_usd_sum: 40 }],
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
        { address: 'idA' },
        { address: 'midFalse', is_exchange: false },
        { address: 'midFalseStr', is_exchange: 'false' },
        { address: 'midZero', is_exchange: 0 },
        { address: 'midName', is_exchange: 'binance' },
        { address: 'idB' },
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
        { address: 'idA', is_exchange: 'kraken' },
        { address: 'idB', is_exchange: 'binance' },
      ],
      relationships: [{ amount_usd_sum: 10 }],
    })
    expect(route!.exchange_intermediates).toEqual([])
  })

  it('hops come from the node sequence even with partially hydrated edges', () => {
    const route = routeFromPathValue({
      nodes: [{ address: 'idA' }, { address: 'mid' }, { address: 'idB' }],
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

describe('addressRisk route suppression for an unresolved compare address', () => {
  it('does not issue connection_route_* (or a real connection probe) when the compare existence probe fails', async () => {
    const captured: Array<{ id: string; query: string }> = []
    const remote = {
      callTool: vi.fn(
        async (req: {
          name: string
          arguments: { queries?: Array<{ id: string; query: string }> }
        }) => {
          const queries = req.arguments.queries ?? []
          captured.push(...queries)
          const answered = queries.map((q) =>
            q.id === 'address_profile'
              ? { id: q.id, ok: true, results: [{ address: '5Known', network: 'bittensor' }] }
              : // compare_address_exists (and everything else) returns no rows:
                // the compare address does not exist as an :Address node.
                { id: q.id, ok: true, results: [] }
          )
          return {
            content: [{ type: 'text', text: JSON.stringify({ facts: { queries: answered } }) }],
            isError: false,
          }
        }
      ),
    }

    const result = await addressRisk(remote as never, {
      address: '5Known',
      network: 'bittensor',
      compareAddress: '5NoSuchCompare',
    })

    // Pre-revert contract restored: an unresolved compare address suppresses
    // the shortest-path route probes entirely -- they are never issued, not merely
    // ignored -- and the 1-hop connection probe stays a noop.
    expect(captured.some((q) => q.id.startsWith('connection_route_'))).toBe(false)
    const connectionProbe = captured.find((q) => q.id === 'connection_probe')
    expect(connectionProbe?.query).toContain('__chain_insights_noop__')
    expect(connectionProbe?.query).not.toContain('5NoSuchCompare')
    // The compare input is still probed for existence and reported unresolved.
    expect(
      captured.some((q) => q.id === 'compare_address_exists' && q.query.includes('5NoSuchCompare'))
    ).toBe(true)
    const facts = (
      result.structuredContent as { facts: { unresolved?: string[]; connection?: unknown } }
    ).facts
    expect(facts.unresolved).toEqual(['5NoSuchCompare'])
    expect(facts.connection).toBeUndefined()
    expect(result.summaryText).toContain(
      'Unresolved compare_address: no Address found for "5NoSuchCompare"'
    )
  })
})

describe('buildRouteEvidence', () => {
  const outboundRow = {
    nodes: [{ address: 'idA' }, { address: 'idB' }],
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
