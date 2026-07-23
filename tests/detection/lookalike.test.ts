import { describe, expect, it } from 'vitest'
import { addressFamily, isLookalike, sharedVanityPrefix } from '../../src/detection/lookalike.js'

const evmReal = '0xabcdef1111111111111111111111111111119999'
// EVM lookalike: same first 6 + last 4, different middle, same length.
function makeEvmLookalike(base: string, fill = '0', p = 6, s = 4): string {
  return base.slice(0, p) + fill.repeat(base.length - p - s) + base.slice(base.length - s)
}

// A real ss58 whale address and a vanity duster sharing a 17-char prefix, from
// the live bittensor finding (2026-07-23).
const ss58Whale = '5EYCAe5jLQhn6ofDSvqF6iY53erXNkwhyE1aCEgvi1NNs91F'
const ss58Vanity = '5EYCAe5jLQhn6ofDSwRz48FMNwMoybug9AJngvbsufKfME2t'

describe('addressFamily', () => {
  it('classifies hex as evm and base58 5-lead as ss58', () => {
    expect(addressFamily(evmReal)).toBe('evm')
    expect(addressFamily(ss58Whale)).toBe('ss58')
    expect(addressFamily('not-an-address')).toBe('other')
  })
})

describe('isLookalike — EVM (prefix + suffix)', () => {
  it('flags same-length prefix+suffix match, different middle', () => {
    const look = makeEvmLookalike(evmReal)
    expect(look.length).toBe(evmReal.length)
    expect(isLookalike(look, evmReal)).toBe(true)
  })
  it('does not flag when only the prefix matches (suffix required for evm)', () => {
    const look = makeEvmLookalike(evmReal)
    const diffSuffix = look.slice(0, look.length - 2) + 'ab'
    expect(isLookalike(diffSuffix, evmReal)).toBe(false)
  })
  it('does not flag the identical address or a different length', () => {
    expect(isLookalike(evmReal, evmReal)).toBe(false)
    expect(isLookalike(evmReal.slice(0, -1), evmReal)).toBe(false)
  })
  it('is case-insensitive for hex', () => {
    const look = makeEvmLookalike(evmReal).toUpperCase().replace('0X', '0x')
    expect(isLookalike(look, evmReal)).toBe(true)
  })
})

describe('isLookalike — ss58 (long shared prefix only)', () => {
  it('flags the live bittensor vanity duster against the real whale', () => {
    expect(ss58Vanity.length).toBe(ss58Whale.length)
    expect(sharedVanityPrefix(ss58Vanity, ss58Whale)).toBeGreaterThanOrEqual(14)
    expect(isLookalike(ss58Vanity, ss58Whale)).toBe(true)
  })
  it('does NOT require a matching suffix (ss58 tail is a checksum)', () => {
    // suffixes plainly differ; still a lookalike on prefix alone.
    expect(ss58Vanity.slice(-4)).not.toBe(ss58Whale.slice(-4))
    expect(isLookalike(ss58Vanity, ss58Whale)).toBe(true)
  })
  it('does not flag a short shared prefix (structural 5-lead noise)', () => {
    const other = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
    expect(sharedVanityPrefix(other, ss58Whale)).toBeLessThan(14)
    expect(isLookalike(other, ss58Whale)).toBe(false)
  })
  it('does not flag the identical whale address', () => {
    expect(isLookalike(ss58Whale, ss58Whale)).toBe(false)
  })
})

describe('isLookalike — never crosses address families', () => {
  it('returns false comparing an evm and an ss58 address', () => {
    expect(isLookalike(evmReal, ss58Whale)).toBe(false)
  })
})
