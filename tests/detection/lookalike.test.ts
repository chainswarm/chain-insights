import { describe, expect, it } from 'vitest'
import { isLookalike } from '../../src/detection/lookalike.js'

const real = '0xabcdef1111111111111111111111111111119999'

// Build a lookalike of `base`: keep first `p` and last `s` chars, replace the
// middle with `fill` repeated to the exact original length.
function makeLookalike(base: string, fill = '0', p = 6, s = 4): string {
  const mid = fill.repeat(base.length - p - s)
  return base.slice(0, p) + mid + base.slice(base.length - s)
}

describe('isLookalike vanity match', () => {
  it('flags a same-length address sharing prefix and suffix but different middle', () => {
    const look = makeLookalike(real)
    expect(look.length).toBe(real.length)
    expect(look).not.toBe(real)
    expect(isLookalike(look, real)).toBe(true)
  })

  it('does not flag the identical address', () => {
    expect(isLookalike(real, real)).toBe(false)
  })

  it('does not flag a different-length address', () => {
    expect(isLookalike(real.slice(0, real.length - 1), real)).toBe(false)
  })

  it('does not flag when the prefix differs', () => {
    const look = makeLookalike(real)
    const diffPrefix = 'ZZ' + look.slice(2)
    expect(isLookalike(diffPrefix, real)).toBe(false)
  })

  it('does not flag when the suffix differs', () => {
    const look = makeLookalike(real)
    const diffSuffix = look.slice(0, look.length - 2) + 'ZZ'
    expect(isLookalike(diffSuffix, real)).toBe(false)
  })

  it('is case-insensitive on the envelope', () => {
    const look = makeLookalike(real)
    const upper = look.slice(0, 6).toUpperCase() + look.slice(6)
    expect(isLookalike(upper, real)).toBe(true)
  })
})
