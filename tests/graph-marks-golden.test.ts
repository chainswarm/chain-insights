import { describe, expect, it } from 'vitest'
import { readGolden, SERVED_MARKS, TOKEN_STANDARDS } from './graph-marks-golden.js'

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
        expect(SERVED_MARKS, `${row.address} names ${mark}`).toContain(mark)
      }
      for (const mark of row.never) {
        expect(row.marks, `${row.address} wants ${mark} present and absent`).not.toContain(mark)
      }
      // Judgement labels differ by lane (lane A carries none, ruling
      // 2026-10-19), so no row may assert on them either way.
      for (const judgement of ['Scam', 'Victim', 'Targeted']) {
        expect(row.marks, row.address).not.toContain(judgement)
        expect(row.never, row.address).not.toContain(judgement)
      }
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

  it('holds one count floor per mark family, read on a named lane at a named time', () => {
    const marks = golden.counts.map((count) => count.mark).sort()
    expect(marks).toEqual(['Launchpad', 'Mixer', 'NFT', 'Pool', 'SmartAccount', 'Token'])
    for (const count of golden.counts) {
      expect(Number.isInteger(count.floor) && count.floor > 0, count.mark).toBe(true)
      expect(['a', 'b'], count.mark).toContain(count.lane)
      expect(count.read_at, count.mark).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    }
  })
})
