import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AddressCardDocument } from '../src/mcp/address-card.js'
import {
  partyOf,
  poolFactsOf,
  poolListingsFromGroups,
  poolListingsOf,
  poolPartiesOf,
  poolPartiesQuery,
  timeText,
  tokenPoolsQuery,
  tokenProvidersQuery,
  usdOf,
} from '../src/mcp/pool-risk.js'
import { repoRoot } from './dex-registry.js'

// One pool's facts: the pool addresses of a token as its two providers reads
// list them, a pool with its own address against a pool manager, and the parties
// built by the address rule. Pure: every row is written here in the shape the
// graph returns.

const words = (
  JSON.parse(readFileSync(join(repoRoot, 'registry', 'address-card.json'), 'utf8')) as AddressCardDocument
).words

const MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const OWN = '0x0adeeaea9aff53c9dfad6f0fb6df96c228b25d3e'
const OTHER = '0x00000000000000000000000000000000000b0b01'
const PROVIDER_A = '0x00000000000000000000000000000000000add01'
const PROVIDER_B = '0x00000000000000000000000000000000000add02'
const TOKEN = '0x766bd6598182586beda76414dc5f8deb1530a213'

describe('the pools of a token', () => {
  const adder = (pool: string, address: string, usd: number | null) => ({
    pool,
    address,
    tokens_worth_usd: usd ?? 0,
    priced: usd === null ? 0 : 1,
  })

  it('one row per pool address: providers are distinct adders, this token side is the priced sum, biggest first', () => {
    const listings = poolListingsOf(
      [
        adder(MANAGER, PROVIDER_A, 600),
        adder(MANAGER, PROVIDER_B, 400),
        adder(OWN, PROVIDER_A, 5000),
        adder(OWN, PROVIDER_A, 1),
        adder(OTHER, PROVIDER_B, null),
        { pool: 'not an address', address: PROVIDER_A, tokens_worth_usd: 1, priced: 1 },
      ],
      [adder(MANAGER, PROVIDER_B, 100), adder(OWN, PROVIDER_A, null)]
    )
    expect(listings.map(({ adder_rows, remover_rows, ...rest }) => [rest, adder_rows.length, remover_rows.length])).toEqual([
      [{ pool: OWN, providers: 1, added_usd: 5001, removed_usd: null }, 2, 1],
      [{ pool: MANAGER, providers: 2, added_usd: 1000, removed_usd: 100 }, 2, 1],
      // No removal row in a read that answered whole: nothing removed, 0.
      [{ pool: OTHER, providers: 1, added_usd: null, removed_usd: 0 }, 1, 0],
    ])
  })

  it('a removals read that did not answer, or came back full, leaves a pool with no removal row null', () => {
    expect(poolListingsOf([adder(OWN, PROVIDER_A, 5)], null)[0]).toMatchObject({ added_usd: 5, removed_usd: null })
    const full = Array.from({ length: 200 }, () => adder(MANAGER, PROVIDER_B, 1))
    expect(poolListingsOf([adder(OWN, PROVIDER_A, 5)], full).find((listing) => listing.pool === OWN)).toMatchObject({
      removed_usd: null,
    })
    expect(poolListingsOf([adder(OWN, PROVIDER_A, 5)], full.slice(1)).find((listing) => listing.pool === OWN)).toMatchObject({
      removed_usd: 0,
    })
  })

  it('the grouped reads count every pool: providers and this token side from the groups, parties from the rows', () => {
    const groups = [
      { pool: OWN, providers: 900, added_usd: 5000, priced: 9 },
      { pool: MANAGER, providers: 12, added_usd: 0, priced: 0 },
    ]
    const listings = poolListingsFromGroups(
      groups,
      [
        { pool: OWN, removers: 3, removed_usd: 40, priced: 3 },
        { pool: OTHER, removers: 1, removed_usd: 2, priced: 1 },
      ],
      [adder(OWN, PROVIDER_A, 5)],
      null
    )
    expect(listings.map(({ adder_rows, remover_rows, ...rest }) => [rest, adder_rows.length, remover_rows.length])).toEqual([
      [{ pool: OWN, providers: 900, added_usd: 5000, removed_usd: 40 }, 1, 0],
      // A pool only removed from is listed too (unpriced pools rank by address).
      [{ pool: OTHER, providers: 0, added_usd: null, removed_usd: 2 }, 0, 0],
      // Unpriced added stays null; no removal group in a removals read that answered whole is 0.
      [{ pool: MANAGER, providers: 12, added_usd: null, removed_usd: 0 }, 0, 0],
    ])
    expect(poolListingsFromGroups(groups, null, null, null).map((listing) => listing.removed_usd)).toEqual([null, null])
    const full = Array.from({ length: 500 }, (_, index) => ({ pool: `0x${'c'.repeat(36)}${String(index).padStart(4, '0')}`, removed_usd: 1, priced: 1 }))
    expect(poolListingsFromGroups(groups, full, null, null).find((listing) => listing.pool === OWN)?.removed_usd).toBeNull()
    expect(tokenPoolsQuery(TOKEN, 'removed')).not.toEqual(tokenPoolsQuery(TOKEN, 'added'))
  })

  it('a sum with no priced link is unpriced, never 0', () => {
    expect(usdOf({ added_usd: 0, priced: 0 }, 'added_usd')).toBeNull()
    expect(usdOf({ added_usd: 0, priced: 3 }, 'added_usd')).toBe(0)
    expect(usdOf({ added_usd: 12.5 }, 'added_usd')).toBe(12.5)
    expect(usdOf(undefined, 'added_usd')).toBeNull()
  })

  it('refuses an address that is not lowercase before any read is written', () => {
    expect(() => tokenProvidersQuery(TOKEN.toUpperCase().replace('0X', '0x'), 'added')).toThrow(
      'is not a lowercase 0x address'
    )
    expect(() => poolPartiesQuery('0xabc', 'adders')).toThrow('is not a lowercase 0x address')
  })

  it('reads a time in milliseconds or in seconds', () => {
    expect(timeText(1791000000000)).toBe('2026-10-03 04:00:00 UTC')
    expect(timeText(1791000000)).toBe('2026-10-03 04:00:00 UTC')
    expect(timeText('soon')).toBeNull()
  })
})

describe('the facts of one pool', () => {
  const base = {
    exchange: null,
    detail: true,
    providers: 9,
    tokenSide: { added_usd: 5000, removed_usd: 10 },
    adders: [],
    removers: [],
    dictionary: words,
  }

  it('a pool with its own address takes both sides of its liquidity and its word from its node', () => {
    const facts = poolFactsOf({
      ...base,
      pool: OWN,
      isManager: false,
      node: {
        node_labels: ['Address', 'Contract', 'Token', 'Pool'],
        liquidity_added_usd: 9000,
        liquidity_removed_usd: 8000,
        liquidity_net_usd: null,
        provider_count: 12,
        evidence: ['scam'],
        card_version: '3',
      },
    })
    expect(Object.keys(facts)).toEqual([
      'pool',
      'exchange',
      'is_manager',
      'detail',
      'providers',
      'token_side',
      'liquidity',
      'risk',
      'adders',
      'removers',
    ])
    expect(facts).toMatchObject({
      pool: OWN,
      is_manager: false,
      providers: 9,
      token_side: { added_usd: 5000, removed_usd: 10 },
      liquidity: { added_usd: 9000, removed_usd: 8000, net_usd: 1000 },
      risk: { word: 'critical', set_by: 'rules', card_version: '3' },
    })
  })

  it('a pool manager is one row: this token side only, never the node sums, no word, pools inside not told apart', () => {
    const facts = poolFactsOf({
      ...base,
      pool: MANAGER,
      exchange: 'Uniswap v4',
      isManager: true,
      node: { liquidity_added_usd: 99999999, evidence: ['scam'] },
    })
    expect(facts).toMatchObject({
      exchange: 'Uniswap v4',
      is_manager: true,
      pools_inside: null,
      token_side: { added_usd: 5000, removed_usd: 10 },
      liquidity: null,
      risk: null,
    })
  })

  it('a pool whose node was not read has no liquidity and no word', () => {
    const facts = poolFactsOf({ ...base, pool: OWN, isManager: false, detail: false, node: null })
    expect(facts).toMatchObject({ detail: false, liquidity: null, risk: null, token_side: { added_usd: 5000 } })
  })

  it('an adder is a party by the address rule, with its sums; an unpriced adder stays null', () => {
    const parties = poolPartiesOf(
      'adder',
      [
        {
          address: TOKEN,
          tokens_worth_usd: 0,
          priced: 0,
          events: 3,
          first_seen_height: 10,
          last_seen_height: 20,
          node_labels: ['Address', 'Account'],
          evidence: ['scam:FAKE_TOKEN_LP'],
          risk_level: 'HIGH',
          risk_score: 0.9,
        },
        { address: 'nobody' },
      ],
      words
    )
    expect(parties).toEqual([
      {
        role: 'adder',
        address: TOKEN,
        tokens_worth_usd: null,
        risk: expect.objectContaining({ word: 'high', set_by: 'model', score: 0.9, rules_word: 'none' }),
        kind: 'account',
        identity: null,
        events: 3,
        first_seen_height: 10,
        last_seen_height: 20,
      },
    ])
    expect(parties[0]!.risk.reasons.map((reason) => reason.word)).toEqual(['pattern', 'model'])
    expect(partyOf('token', TOKEN, { identity: 'token', identity_name: 'CIA' }, words)).toMatchObject({
      identity: { word: 'token', name: 'CIA' },
      kind: 'unknown',
      risk: { word: 'unscored' },
    })
  })
})
