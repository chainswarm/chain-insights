// tests/deposit-sources-value-ordering.test.ts
// chain-insights#237: the reverse deposit-source query capped rows with a bare
// LIMIT and no ORDER BY, so the backend returned an arbitrary slice. On a
// high-fan-in deposit that silently dropped the largest flows into it — the
// paths an analyst is looking for — while keeping negligible ones.
import { describe, expect, it } from 'vitest'
import { reverseDepositSourceQueryAtDepth } from '../src/investigation/public-tools.js'

const DEPOSIT = '5EVTetmsvVf47UyMfaYxhJMeJaGoeY9JMwgnqdWyx5taaTR6'

describe('reverse deposit-source truncation is value-ordered (#237)', () => {
  it('orders by path value before applying the row cap', () => {
    const { query } = reverseDepositSourceQueryAtDepth([DEPOSIT], 3, 0, undefined)
    expect(query).toContain('ORDER BY path_value_usd DESC')
    // The ordering is worthless if it lands after the cap.
    expect(query.indexOf('ORDER BY')).toBeLessThan(query.indexOf('LIMIT'))
  })

  it('ranks a path by its narrowest edge, not by a sum', () => {
    // A sum rewards long paths made of small edges; a path cannot carry more
    // than its bottleneck, so the minimum is the honest measure.
    const { query } = reverseDepositSourceQueryAtDepth([DEPOSIT], 3, 0, undefined)
    expect(query).toContain('path_value_usd')
    expect(query).toMatch(/CASE WHEN .*amount_usd_sum < .*amount_usd_sum THEN/)
    expect(query).not.toMatch(/r1\.amount_usd_sum \+ r2\.amount_usd_sum/)
  })

  it('uses the single edge amount directly at depth 1', () => {
    const { query } = reverseDepositSourceQueryAtDepth([DEPOSIT], 1, 0, undefined)
    expect(query).toContain('r1.amount_usd_sum AS path_value_usd')
    expect(query).not.toContain('CASE WHEN')
  })

  it('still emits one query id per depth', () => {
    expect(reverseDepositSourceQueryAtDepth([DEPOSIT], 2, 0, undefined).id).toBe('reverse_deposit_sources_2')
  })
})
