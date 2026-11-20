import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AddressCardDocument } from '../src/mcp/address-card.js'
import { cardProblems, readGolden, SERVED_MARKS, TOKEN_STANDARDS } from './graph-marks-golden.js'

const addressCard = JSON.parse(
  readFileSync(join(process.cwd(), 'registry/address-card.json'), 'utf8')
) as AddressCardDocument
// The marks the card gives (Exchange, Deposit, HotWallet, Scam, Victim) are served too.
const MARKS: string[] = [...SERVED_MARKS, ...addressCard.marks.map((mark) => mark.name)]

// The golden mark set (tests/fixtures/graph-marks-golden.json) is what the
// live marks test and the AP1000 UAT script read. This T1 test keeps the file
// itself honest: every row is a full lower-case address with a source
// permalink and a since block, every mark is one the graph serves, and the
// count floors cover every mark family. The live read is
// tests/graph-marks-live.integration.test.ts.

describe('the golden mark set', () => {
  const golden = readGolden()

  it('names the network and the day it was recorded', () => {
    expect(golden.network).toBe('robinhood')
    expect(golden.recorded_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('holds at least 35 rows, each a full lower-case address with a source and a since block', () => {
    expect(golden.rows.length).toBeGreaterThanOrEqual(35)
    const seen = new Set<string>()
    for (const row of golden.rows) {
      expect(row.address, row.name).toMatch(/^0x[0-9a-f]{40}$/)
      expect(seen.has(row.address), `${row.address} listed twice`).toBe(false)
      seen.add(row.address)
      expect(row.name.length, row.address).toBeGreaterThan(0)
      expect(row.source, row.address).toMatch(/^https:\/\/github\.com\/chainswarm\/[A-Za-z0-9-]+\/blob\//)
      expect(Number.isInteger(row.since_block) && row.since_block >= 0, row.address).toBe(true)
    }
  })

  it('asserts only marks the graph serves, never both ways, always with :Address present', () => {
    for (const row of golden.rows) {
      expect(row.marks, row.address).toContain('Address')
      for (const mark of [...row.marks, ...row.never]) {
        expect(MARKS, `${row.address} names ${mark}`).toContain(mark)
      }
      for (const mark of row.never) {
        expect(row.marks, `${row.address} wants ${mark} present and absent`).not.toContain(mark)
      }
      // Judgement labels differ by lane: the staging lane runs the evidence and
      // carries them, the production lane may not. A row asserts one present
      // only as a staging-lane row, and never asserts one absent.
      if (row.lane_only !== undefined) expect(row.lane_only, row.address).toBe('staging')
      for (const judgement of ['Scam', 'Victim', 'Targeted']) {
        if (row.lane_only !== 'staging') expect(row.marks, row.address).not.toContain(judgement)
        expect(row.never, row.address).not.toContain(judgement)
      }
    }
  })

  it('names only card properties, words and values the address card dictionary knows', () => {
    const properties = new Map(addressCard.properties.map((property) => [property.name, property]))
    // Free text: the name an identity row gives, and the value part of an entry.
    const free = new Set(['identity_name', 'behaviour_week', 'card_version'])
    const carded = golden.rows.filter((row) => row.card)
    expect(carded.length).toBeGreaterThanOrEqual(6)
    for (const row of carded) {
      const card = row.card!
      expect(Object.keys(card).length, row.address).toBeGreaterThan(0)
      for (const [name, wanted] of Object.entries(card)) {
        const property = properties.get(name)
        expect(property, `${row.address} names the card property ${name}`).toBeDefined()
        const isList = property!.type.startsWith('list<')
        expect(Array.isArray(wanted), `${row.address} ${name} is a ${property!.type}`).toBe(isList)
        const entries = Array.isArray(wanted) ? wanted : [wanted]
        if (isList) expect(entries.length, `${row.address} ${name}`).toBeGreaterThan(0)
        for (const entry of entries) {
          expect(typeof entry === 'string' && entry !== '', `${row.address} ${name}`).toBe(true)
          if (free.has(name) || !property!.values) continue
          // word:VALUE when the property has a value form; the word is closed, the value free.
          const word = property!.value_form ? entry.split(':')[0]! : entry
          expect(property!.values, `${row.address} ${name} ${entry}`).toContain(word)
        }
      }
    }
    // One row for each question the card answers.
    for (const name of ['identity', 'address_roles', 'behaviour', 'evidence', 'risk']) {
      expect(carded.some((row) => name in row.card!), `no row asserts the card ${name}`).toBe(true)
    }
  })

  it('judges a card as a subset, never as equality', () => {
    const card = { identity: 'exchange', address_roles: ['exchange_deposit'], sources: ['rule'] }
    const served = {
      identity: 'exchange',
      address_roles: ['exchange_deposit', 'exchange_hot_wallet'],
      sources: ['registry', 'rule'],
      risk: 'low',
    }
    expect(cardProblems(card, served)).toEqual([])
    expect(cardProblems(card, { ...served, identity: 'mixer' })).toEqual([
      'card identity "mixer" wanted exchange',
    ])
    expect(cardProblems(card, { ...served, address_roles: null })).toEqual([
      'card address_roles misses exchange_deposit; served []',
    ])
  })

  it('asserts label words only as plain role words, never a judgement', () => {
    for (const row of golden.rows) {
      for (const word of row.words ?? []) {
        expect(word, row.address).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
        expect(['Scam', 'Victim', 'Targeted', 'Sanctioned'], `${row.address} word ${word}`).not.toContain(word)
      }
    }
  })

  it('holds the basket factory, its router, an old basket and a new one, the new one without an explorer name', () => {
    const byAddress = new Map(golden.rows.map((row) => [row.address, row]))
    expect(byAddress.get('0xe78b036bd6da158cd61a3dac3f67e18f62ecddfd')?.words).toEqual(['BasketFactory'])
    expect(byAddress.get('0xb672a5d825f82dea8574711d1da696fcc48d2ae0')?.marks).toContain('Contract')
    for (const basket of ['0x923bce12f2faa00e21f9406dd161e360f858c3e2', '0x844e7f539ec3e90391b35843001e8624bef6eb83']) {
      expect(byAddress.get(basket)?.words, basket).toEqual(['Basket'])
      expect(byAddress.get(basket)?.marks, basket).toEqual(expect.arrayContaining(['Protocol', 'Token']))
    }
  })

  it('gives every :Token row its standard, and every :NFT row a non-fungible standard', () => {
    for (const row of golden.rows) {
      if (row.marks.includes('Token')) {
        expect(TOKEN_STANDARDS, `${row.address} standard`).toContain(row.token_standard)
      } else {
        expect(row.token_standard, `${row.address} has a standard but no :Token`).toBeUndefined()
      }
      if (row.marks.includes('NFT')) {
        expect(row.marks, `${row.address} :NFT without :Token`).toContain('Token')
        expect(['ERC721', 'ERC1155'], `${row.address} NFT standard`).toContain(row.token_standard)
      }
    }
  })

  it('covers every mark family at least once, present and absent', () => {
    for (const mark of ['Token', 'NFT', 'Pool', 'Launchpad', 'Mixer', 'Protocol', 'SmartAccount']) {
      expect(golden.rows.some((row) => row.marks.includes(mark)), `no row carries ${mark}`).toBe(true)
      expect(golden.rows.some((row) => row.never.includes(mark)), `no row forbids ${mark}`).toBe(true)
    }
  })

  it('holds the three self-trading contracts of chain-insights #527, never as a smart account', () => {
    const bots = golden.rows.filter((row) => row.marks.includes('SelfTrader')).map((row) => row.address)
    expect(bots.sort()).toEqual([
      '0x2192bc3b4028acc1113f2cd9ac2cba70c36520db',
      '0xc2eedf3bc7f93366c00c6074df0e6f122fa2445c',
      '0xc33acc93942105c57602e59e8e448c20ba718a85',
    ])
    for (const row of golden.rows.filter((row) => row.marks.includes('SelfTrader'))) {
      expect(row.marks, row.address).toContain('Contract')
      expect(row.never, row.address).toContain('SmartAccount')
    }
  })

  it('holds one count floor per mark family, read on a named lane at a named time', () => {
    const marks = golden.counts.map((count) => count.mark).sort()
    expect(marks).toEqual(['Launchpad', 'Mixer', 'NFT', 'Pool', 'SelfTrader', 'SmartAccount', 'Token'])
    for (const count of golden.counts) {
      expect(Number.isInteger(count.floor) && count.floor > 0, count.mark).toBe(true)
      expect(['a', 'b'], count.mark).toContain(count.lane)
      expect(count.read_at, count.mark).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    }
  })
})
