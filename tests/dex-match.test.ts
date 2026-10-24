import { describe, expect, it } from 'vitest'

import {
  damerauLevenshtein,
  matchDex,
  normaliseName,
  type DexEntry,
} from '../src/mcp/dex-registry.js'
import { readRegistry } from './dex-registry.js'

// matchDex, the name rule of meta_dex_lookup, over the served registry copy:
// normalise, exact on key, display and aliases, then within two letters of an
// alias of four or more characters. One winner is matched, a tie is listed,
// and no hit names every covered exchange. Pure logic: no file but the copy, no
// network.

const rows = readRegistry().rows as unknown as DexEntry[]

describe('normaliseName and the distance', () => {
  it('drops case, spaces, dots, hyphens and underscores', () => {
    expect(normaliseName('Uni v4')).toBe('univ4')
    expect(normaliseName('up.')).toBe('up')
    expect(normaliseName('alan_dale-xyz')).toBe('alandalexyz')
  })

  it('counts a swap of two neighbours as one letter', () => {
    expect(damerauLevenshtein('areo', 'aero')).toBe(1)
    expect(damerauLevenshtein('aerodome', 'aerodrome')).toBe(1)
    expect(damerauLevenshtein('kyber', 'kyber')).toBe(0)
    expect(damerauLevenshtein('', 'abc')).toBe(3)
  })
})

describe('matchDex over the served registry', () => {
  it.each(['Aerodrome', 'aerodrome', 'AERO', 'Velodrome', 'aero slipstream'])(
    'takes %s as aero, exact',
    (name) => {
      const result = matchDex(name, rows)
      expect(result.matched?.dex).toBe('aero')
      expect(result.matched?.trail_type).toBe('gauge')
      expect(result.took_for).toBeUndefined()
    }
  )

  it.each(['Aerodome', 'areo'])('takes the typo %s as aero, and names it in took_for', (name) => {
    const result = matchDex(name, rows)
    expect(result.matched?.dex).toBe('aero')
    expect(result.took_for).toBe(name)
  })

  it('lists Balancer as a tie of two vaults, distance 0, and matches neither', () => {
    const result = matchDex('Balancer', rows)
    expect(result.matched).toBeNull()
    expect(result.candidates).toEqual([
      { dex: 'swaap', display: 'Swaap v2', distance: 0 },
      { dex: 'balancer-v3', display: 'unnamed Balancer v3 vault', distance: 0 },
    ])
  })

  it('says Kyber is not covered and names the 29 covered exchanges', () => {
    const result = matchDex('Kyber', rows)
    expect(result.matched).toBeNull()
    expect(result.candidates).toEqual([])
    expect(result.covered).toHaveLength(29)
    expect(result.covered).toContain('Aero (Aerodrome and Velodrome, merged)')
  })

  it('takes "Uniswap" as the v4 row and "uni v3" as the v3 row', () => {
    expect(matchDex('Uniswap', rows).matched?.dex).toBe('uniswap-v4')
    expect(matchDex('uni v3', rows).matched?.dex).toBe('uniswap-v3')
  })

  it('lists a near tie instead of guessing: "Uniswap v5" is one letter from v4, v3 and v2', () => {
    const result = matchDex('Uniswap v5', rows)
    expect(result.matched).toBeNull()
    expect(result.candidates.map((candidate) => [candidate.dex, candidate.distance])).toEqual([
      ['uniswap-v2', 1],
      ['uniswap-v3', 1],
      ['uniswap-v4', 1],
    ])
  })

  it('never takes a near hit from an alias shorter than four letters', () => {
    // "UNI" is an alias of uniswap-v4; "uno" is one letter from it, and still not covered.
    expect(matchDex('uno', rows).matched).toBeNull()
    expect(matchDex('uno', rows).candidates).toEqual([])
  })

  it('takes up. with or without its dot, never Aero, though both share an adapter', () => {
    expect(matchDex('up.', rows).matched?.dex).toBe('up')
    expect(matchDex('UP', rows).matched?.dex).toBe('up')
  })

  it('takes nothing from an empty name', () => {
    expect(matchDex('  ', rows)).toMatchObject({ matched: null, candidates: [] })
  })
})
