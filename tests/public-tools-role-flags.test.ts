import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isExchangeMarker,
  queryBuilderContract,
  routeFromPathValue,
} from '../src/investigation/public-tools.js'

// The four role flags `is_exchange`, `is_scam`, `is_victim` and
// `is_sanctioned` are present only when true and absent otherwise, never
// `false`. The readers test the exchange flag as a marker: `IS NOT NULL` finds
// an exchange, `IS NULL` lets a walk pass. Only `is_exchange` ends a walk. A
// scam, victim or sanctioned address is a fact the graph states, not a place
// the walk stops.

const ADDRESS = '0x00000000000000000000000000000000000000aa'
const ROLE_FLAGS = ['is_exchange', 'is_scam', 'is_victim', 'is_sanctioned'] as const
const NON_EXCHANGE_FLAGS = ['is_scam', 'is_victim', 'is_sanctioned'] as const

type Node = Record<string, unknown>

// One node per case, as the sync writes it: a flag is `true` or not a property.
const labelledNoFlag: Node = { address: '0xlabelled', labels: ['UniswapV2Pair'] }
const exchange: Node = { address: '0xexchange', labels: ['Exchange', 'Binance'], is_exchange: true }

// The `IS NULL` and `IS NOT NULL` terms of an exchange walk's WHERE, judged over
// nodes by variable. A property a node does not have reads as null, as it does
// on the graph. Returns whether every exchange term of the WHERE holds.
function exchangeTermsHold(query: string, nodes: Record<string, Node>): boolean {
  const terms = [...query.matchAll(/\b(\w+)\.is_exchange IS (NOT )?NULL/g)]
  expect(terms.length).toBeGreaterThan(0)
  return terms.every(([, variable, not]) => {
    const node = nodes[variable!]
    expect(node, `no node bound to ${variable}`).toBeDefined()
    const present = node!['is_exchange'] !== undefined && node!['is_exchange'] !== null
    return not ? present : !present
  })
}

describe('a walk passes a labelled node with no is_exchange and stops at is_exchange true', () => {
  const outflow2 = queryBuilderContract.exchangeOutflowQueries(ADDRESS)[1]!
  const inflow2 = queryBuilderContract.exchangeInflowQueries(ADDRESS)[1]!

  it('serves the depth-2 walks this test reads', () => {
    expect(outflow2.id).toBe('exchange_outflows_2')
    expect(inflow2.id).toBe('exchange_inflows_2')
  })

  it('lets a labelled node with no is_exchange property be an intermediate hop', () => {
    expect(labelledNoFlag).not.toHaveProperty('is_exchange')
    expect(exchangeTermsHold(outflow2.query, { a: {}, n1: labelledNoFlag, exchange })).toBe(true)
    expect(exchangeTermsHold(inflow2.query, { a: {}, n1: labelledNoFlag, exchange })).toBe(true)
  })

  it('stops the walk at a node with is_exchange true: it cannot be an intermediate hop', () => {
    expect(exchangeTermsHold(outflow2.query, { a: {}, n1: exchange, exchange })).toBe(false)
    expect(exchangeTermsHold(inflow2.query, { a: {}, n1: exchange, exchange })).toBe(false)
  })

  it('finds the exchange at the end of the walk, and only a node with is_exchange', () => {
    expect(exchangeTermsHold(outflow2.query, { a: {}, n1: labelledNoFlag, exchange })).toBe(true)
    expect(
      exchangeTermsHold(outflow2.query, { a: {}, n1: labelledNoFlag, exchange: labelledNoFlag })
    ).toBe(false)
  })

  it.each(NON_EXCHANGE_FLAGS)('does not stop a walk at a node with %s true', (flag) => {
    const flagged: Node = { address: '0xflagged', [flag]: true }
    expect(exchangeTermsHold(outflow2.query, { a: {}, n1: flagged, exchange })).toBe(true)
    expect(exchangeTermsHold(inflow2.query, { a: {}, n1: flagged, exchange })).toBe(true)
  })

  it('never reads is_scam, is_victim or is_sanctioned in any exchange walk', () => {
    const walks = [
      ...queryBuilderContract.exchangeOutflowQueries(ADDRESS),
      ...queryBuilderContract.exchangeInflowQueries(ADDRESS),
    ]
    expect(walks).toHaveLength(6)
    for (const { id, query } of walks) {
      for (const flag of NON_EXCHANGE_FLAGS) {
        expect(query, `${id} reads ${flag}`).not.toContain(flag)
      }
    }
  })

  it('tests the flag as a marker at every depth: IS NULL in the middle, IS NOT NULL at the end', () => {
    for (const depth of [1, 2, 3]) {
      const outflow = queryBuilderContract.exchangeOutflowQueries(ADDRESS)[depth - 1]!
      const inflow = queryBuilderContract.exchangeInflowQueries(ADDRESS)[depth - 1]!
      for (const { id, query } of [outflow, inflow]) {
        expect(query, id).toContain('exchange.is_exchange IS NOT NULL')
        expect(query.match(/\.is_exchange IS NULL/g) ?? [], id).toHaveLength(depth - 1)
        expect(query, id).not.toMatch(/is_exchange\s*(=|<>)\s*(true|false)/i)
      }
    }
  })
})

describe('the reader of a hydrated route reads the flag as a marker', () => {
  const route = routeFromPathValue({
    nodes: [
      { address: '0xstart' },
      { address: '0xscam', labels: ['Scam'], is_scam: true },
      { address: '0xvictim', labels: ['Victim'], is_victim: true },
      { address: '0xsanctioned', labels: ['Sanctioned'], is_sanctioned: true },
      { address: '0xlabelled', labels: ['UniswapV2Pair'] },
      { address: '0xexchange-mid', labels: ['Exchange'], is_exchange: true },
      { address: '0xend' },
    ],
    relationships: Array.from({ length: 6 }, () => ({ amount_usd_sum: 1 })),
  })

  it('counts a node with is_exchange true as the only exchange intermediate', () => {
    expect(route).not.toBeNull()
    expect(route!.hops).toBe(6)
    expect(route!.exchange_intermediates).toEqual(['0xexchange-mid'])
  })

  it('reads an absent flag as not an exchange, and true as an exchange', () => {
    expect(isExchangeMarker(labelledNoFlag['is_exchange'])).toBe(false)
    expect(isExchangeMarker(undefined)).toBe(false)
    expect(isExchangeMarker(exchange['is_exchange'])).toBe(true)
  })

  it('never counts is_scam, is_victim or is_sanctioned as an exchange', () => {
    for (const flag of NON_EXCHANGE_FLAGS) {
      const only = routeFromPathValue({
        nodes: [{ address: '0xa' }, { address: '0xmid', [flag]: true }, { address: '0xb' }],
        relationships: [{ amount_usd_sum: 1 }, { amount_usd_sum: 1 }],
      })
      expect(only!.exchange_intermediates, flag).toEqual([])
    }
  })
})

describe('the served skills and documents name the four role flags', () => {
  const root = process.cwd()
  // The schema skill is the one home of the four flags. The cypher skill keeps one
  // line on how to test a flag, and the last test reads it too.
  const files = [
    'skills/chain-insights-schema-evm/SKILL.md',
    'docs/graph-query-compatibility.md',
    'docs/graph-tools.md',
  ]

  it.each(files)('%s names all four flags and says each is absent unless true', (file) => {
    const text = readFileSync(join(root, file), 'utf8')
    for (const flag of ROLE_FLAGS) expect(text.includes(flag), `${file} misses ${flag}`).toBe(true)
    expect(/absent unless true/.test(text), `${file} does not say absent unless true`).toBe(true)
  })

  it.each(files)('%s says :Exchange is a node label', (file) => {
    const text = readFileSync(join(root, file), 'utf8')
    expect(
      /`:Exchange` is a node label/.test(text),
      `${file} does not say :Exchange is a node label`
    ).toBe(true)
  })

  it('the dialect skill no longer forbids the :Exchange label', () => {
    const text = readFileSync(join(root, 'skills/chain-insights-cypher/SKILL.md'), 'utf8')
    expect(/No dynamic labels such as `:Exchange`/.test(text)).toBe(false)
  })

  it('no document teaches a role flag that reads false', () => {
    for (const file of [...files, 'skills/chain-insights-cypher/SKILL.md']) {
      const text = readFileSync(join(root, file), 'utf8')
      expect(/is_(exchange|scam|victim|sanctioned)\s*=\s*false/.test(text), file).toBe(false)
      expect(/is_(exchange|scam|victim|sanctioned)[^.\n]*reads? `?false/.test(text), file).toBe(
        false
      )
    }
  })
})
