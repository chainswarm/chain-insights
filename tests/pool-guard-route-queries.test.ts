import { describe, expect, it } from 'vitest'
import { queryBuilderContract } from '../src/investigation/public-tools.js'
import {
  traceHopsWithoutSwapped,
  unguardedPoolWalks,
  unguardedSystemWalks,
} from './support/pool-walk-guard.js'

// Pool trace rule (skills/chain-insights-cypher, "Pool trace rule"), applied
// to the query builders in src/investigation/public-tools.ts that
// aml_address_risk serves: a FLOWED_TO walk never starts at a :Pool and never
// passes through one, and it may end at one. Issue chainswarm/chain-insights#399,
// change schema-v2-domain-lanes task 11.12.
//
// No test here runs a query: the repo has no graph and no Cypher executor fake.
// The scenario (a victim, a pool, a trader, an exchange behind the pool) is pinned
// as query text, judged by the same walk reader that guards the served skills and
// recipes (tests/support/pool-walk-guard.ts), and it was planned, never run,
// on DozerDB (see the task report).

const FROM = '0x00000000000000000000000000000000000000aa'
const TO = '0x00000000000000000000000000000000000000bb'

const routes = queryBuilderContract.connectionRouteQueries(FROM, TO)
const outflows = queryBuilderContract.exchangeOutflowQueries(FROM)
const inflows = queryBuilderContract.exchangeInflowQueries(FROM)
const linked = queryBuilderContract.linkedExposureQueries(FROM)
const viaLinked = linked.find((q) => q.id === 'linked_exposure_via_linked')!
const everyWalk = [...routes, ...outflows, ...inflows, viaLinked]

// The same query with one guard term removed: the negative control that shows
// the walk reader would catch a builder that drops it.
// The pool and system guard of one address on a walk of two or more hops.
const SYSTEM_LIST =
  '["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]'
const GUARD = (name: string) =>
  `NOT ${name}:Pool AND NOT ${name}:Protocol AND NOT ${name}:System AND NOT ${name}.address IN ${SYSTEM_LIST}`

function without(query: string, guard: string): string {
  const stripped = query.replace(guard, 'true')
  expect(stripped).not.toBe(query)
  return stripped
}

describe('route queries: the pool guard on every intermediate node', () => {
  it('serves both directions', () => {
    expect(routes.map((r) => r.id)).toEqual([
      'connection_route_outbound',
      'connection_route_inbound',
    ])
  })

  it('outbound and inbound each guard the start and every middle node, and may end at a pool', () => {
    for (const { id, query } of routes) {
      expect(unguardedPoolWalks(query), id).toEqual([])
      expect(traceHopsWithoutSwapped(query), id).toEqual([])
    }
    const [outbound, inbound] = routes
    // The start is the first address of each direction, the end the second.
    expect(outbound!.query).toContain(`(a:Address {address: "${FROM}"} WHERE ${GUARD('a')})`)
    expect(outbound!.query).toContain(`(b:Address {address: "${TO}"})`)
    expect(inbound!.query).toContain(`(a:Address {address: "${TO}"} WHERE ${GUARD('a')})`)
    expect(inbound!.query).toContain(`(b:Address {address: "${FROM}"})`)
    for (const { query } of routes) {
      expect(query).toContain(`(()-[:FLOWED_TO|SWAPPED]-(via:Address) WHERE ${GUARD('via')}){0,4}`)
    }
  })

  it('the walk reader refuses a route that drops either guard', () => {
    for (const { id, query } of routes) {
      expect(unguardedPoolWalks(without(query, 'NOT via:Pool')), id).not.toEqual([])
      expect(unguardedPoolWalks(without(query, 'NOT a:Pool')), id).not.toEqual([])
    }
  })
})

describe('exchange exposure queries: the pool guard on every intermediate node', () => {
  it('serves three depths in each direction', () => {
    expect(outflows.map((q) => q.id)).toEqual([
      'exchange_outflows_1',
      'exchange_outflows_2',
      'exchange_outflows_3',
    ])
    expect(inflows.map((q) => q.id)).toEqual([
      'exchange_inflows_1',
      'exchange_inflows_2',
      'exchange_inflows_3',
    ])
  })

  it('every depth guards the screened address and each intermediate, as its own AND term', () => {
    for (const [index, { id, query }] of [...outflows, ...inflows].entries()) {
      const depth = (index % 3) + 1
      expect(unguardedPoolWalks(query), id).toEqual([])
      expect(query, id).toContain(' AND NOT a:Pool')
      for (let mid = 1; mid < depth; mid++) {
        expect(query, id).toContain(` AND NOT n${mid}:Pool`)
      }
      // The exchange is the target end: it is never guarded.
      expect(query, id).not.toContain('NOT exchange:Pool')
      // No guard for a node that does not exist at this depth.
      expect(query, id).not.toContain(`NOT n${depth}:Pool`)
    }
  })

  it('the walk reader refuses an exposure walk that drops the guard on a middle node', () => {
    for (const { id, query } of [outflows[2]!, outflows[1]!, inflows[2]!, inflows[1]!]) {
      expect(unguardedPoolWalks(without(query, ' AND NOT n1:Pool')), id).not.toEqual([])
    }
    for (const { id, query } of [outflows[0]!, outflows[2]!, inflows[0]!, inflows[2]!]) {
      expect(unguardedPoolWalks(without(query, ' AND NOT a:Pool')), id).not.toEqual([])
    }
  })
})

describe('scenario as query text: a victim pays a pool, a trader left the pool', () => {
  // victim -> pool <- trader -> exchange. The victim is the screened address.
  // Without the guard the walk victim -> pool -> trader -> exchange reads as a
  // two-hop exposure, and every trader of the pool becomes a lead.
  it('walks that would cross the pool carry the guard that stops them', () => {
    const twoHopOut = outflows[1]!.query
    expect(twoHopOut).toContain(')-[r1:FLOWED_TO]->(n1:Address)-[r2:FLOWED_TO]->(exchange:Address)')
    expect(twoHopOut).toContain('AND NOT n1:Pool')
    const twoHopIn = inflows[1]!.query
    expect(twoHopIn).toContain(
      '(exchange:Address)-[r1:FLOWED_TO]->(n1:Address)-[r2:FLOWED_TO]->(a:Address)'
    )
    expect(twoHopIn).toContain('AND NOT n1:Pool')
  })

  it('a walk that ends at the pool still can: the target end has no guard', () => {
    // Depth 1 outflow: victim -> exchange-marked pool would still be read; the
    // only guard is on the start, never on the node the walk ends at.
    expect(outflows[0]!.query).toContain('WHERE a.address <> exchange.address')
    expect(outflows[0]!.query).not.toMatch(/exchange:Pool|NOT exchange/)
    for (const { query } of routes) expect(query).not.toMatch(/b:Pool|NOT b:/)
  })

  it('no served walk builder is left without a pool guard', () => {
    for (const { id, query } of everyWalk) {
      expect(query, id).toMatch(/NOT a:Pool/)
    }
  })
})

describe('linked exposure: the walk through the owned address', () => {
  // (a)-[:LINKED]-(owned)-[:FLOWED_TO]-(b) passes through `owned`, so it is a
  // two-hop walk. `b` is the target end and stays unguarded.
  it('guards the start and the owned address, and leaves the target end open', () => {
    expect(viaLinked).toBeDefined()
    expect(unguardedPoolWalks(viaLinked.query)).toEqual([])
    expect(viaLinked.query).toContain(`WHERE ${GUARD('a')} AND ${GUARD('owned')} AND `)
    expect(viaLinked.query).not.toMatch(/b:Pool|NOT b:/)
  })

  it('the walk reader catches the builder when the owned guard is dropped', () => {
    expect(unguardedPoolWalks(without(viaLinked.query, 'NOT owned:Pool')), 'owned').not.toEqual([])
  })

  it('matches the served AC11 recipe guard in the proxy text', async () => {
    const { readFileSync } = await import('node:fs')
    const proxy = readFileSync(new URL('../src/mcp/proxy.ts', import.meta.url), 'utf8')
    expect(proxy).toContain(
      `WHERE ${GUARD('a')} AND ${GUARD('owned')} AND owned.address <> b.address`
    )
  })
})

describe('the system guard: no walk of two or more hops starts at or passes a protocol or a system address', () => {
  // The zero address (every mint and burn), the dead address and a :Protocol
  // contract such as the PoolManager link millions of unrelated wallets. A
  // route through one connects nothing (ruled 2026-10-11).
  const multiHop = [...routes, outflows[1]!, outflows[2]!, inflows[1]!, inflows[2]!, viaLinked]

  it('every walk builder of two or more hops carries it on the start and every middle address', () => {
    for (const { id, query } of multiHop) expect(unguardedSystemWalks(query), id).toEqual([])
    for (const { id, query } of [outflows[1]!, outflows[2]!, inflows[1]!, inflows[2]!]) {
      expect(query, id).toContain(GUARD('a'))
      expect(query, id).toContain(GUARD('n1'))
      expect(query, id).not.toContain('NOT exchange:Protocol')
    }
  })

  it('a one-hop read carries no system guard: the links of such an address are facts', () => {
    for (const { id, query } of [outflows[0]!, inflows[0]!]) {
      expect(unguardedSystemWalks(query), id).toEqual([])
      expect(query, id).not.toContain('Protocol')
    }
  })

  it('the walk reader refuses a builder that drops either system term', () => {
    for (const { id, query } of routes) {
      expect(unguardedSystemWalks(without(query, 'NOT via:Protocol')), id).not.toEqual([])
      expect(
        unguardedSystemWalks(without(query, `NOT via.address IN ${SYSTEM_LIST}`)),
        id
      ).not.toEqual([])
      expect(unguardedSystemWalks(without(query, 'NOT a:Protocol')), id).not.toEqual([])
      expect(unguardedSystemWalks(without(query, 'NOT via:System')), id).not.toEqual([])
      expect(unguardedSystemWalks(without(query, 'NOT a:System')), id).not.toEqual([])
    }
    for (const { id, query } of [outflows[2]!, inflows[2]!]) {
      expect(unguardedSystemWalks(without(query, 'NOT n2:Protocol')), id).not.toEqual([])
    }
    expect(unguardedSystemWalks(without(viaLinked.query, 'NOT owned:Protocol'))).not.toEqual([])
  })
})
