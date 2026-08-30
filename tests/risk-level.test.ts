import { describe, expect, it } from 'vitest'

import { isUnscoredRiskLevel, normalizeRiskLevel } from '../src/investigation/risk-level.js'

describe('normalizeRiskLevel', () => {
  it('lowercases known severities from any graph casing', () => {
    expect(normalizeRiskLevel('HIGH')).toBe('high')
    expect(normalizeRiskLevel(' Medium ')).toBe('medium')
    expect(normalizeRiskLevel('critical')).toBe('critical')
  })

  it('recognizes the abstention band distinctly', () => {
    expect(normalizeRiskLevel('UNSCORED')).toBe('unscored')
    expect(isUnscoredRiskLevel('unscored')).toBe(true)
    expect(isUnscoredRiskLevel('low')).toBe(false)
  })

  it('rejects garbage instead of inventing a level', () => {
    expect(normalizeRiskLevel('')).toBeUndefined()
    expect(normalizeRiskLevel('banana')).toBeUndefined()
    expect(normalizeRiskLevel(42)).toBeUndefined()
  })
})
