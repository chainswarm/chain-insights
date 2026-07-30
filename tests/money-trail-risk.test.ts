import { describe, expect, it } from 'vitest'
import { buildMoneyTrailBlock, moneyTrailEndsQuery, moneyTrailIncidentQuery, moneyTrailSummarySentence } from '../src/investigation/public-tools.js'

describe('money-trail query builders', () => {
  it('moneyTrailIncidentQuery emits pinned query text with an escaped address literal', () => {
    expect(moneyTrailIncidentQuery('addr"1')).toMatchSnapshot()
  })

  it('moneyTrailEndsQuery emits pinned query text with an escaped seed literal', () => {
    expect(moneyTrailEndsQuery('seed"1')).toMatchSnapshot()
  })
})

describe('buildMoneyTrailBlock', () => {
  it('returns undefined when there are no incident rows (S2: address not on a trail)', () => {
    expect(buildMoneyTrailBlock([], [])).toBeUndefined()
  })

  it('picks transport over peripheral when both classes are present', () => {
    const block = buildMoneyTrailBlock(
      [
        { edge_class: 'peripheral', min_hop: 5, primary_seed: 'seedA', generation: 1 },
        { edge_class: 'transport', min_hop: 2, primary_seed: 'seedB', generation: 2 },
      ],
      [],
    )
    expect(block?.class).toBe('transport')
  })

  it('picks the lowest min_hop among rows of the winning class', () => {
    const block = buildMoneyTrailBlock(
      [
        { edge_class: 'transport', min_hop: 4, primary_seed: 'seedA', generation: 1 },
        { edge_class: 'transport', min_hop: 1, primary_seed: 'seedB', generation: 3 },
      ],
      [],
    )
    expect(block?.min_hop).toBe(1)
    expect(block?.primary_seed).toBe('seedB')
    expect(block?.generation).toBe(3)
  })

  it('chooses the highest-value trail end as nearest_trail_end', () => {
    const block = buildMoneyTrailBlock(
      [{ edge_class: 'transport', min_hop: 1, primary_seed: 'seedA', generation: 1 }],
      [
        { address: 'end-low', fact_type: 'mixer', value: '10' },
        { address: 'end-high', fact_type: 'cash_out', value: '500' },
      ],
    )
    expect(block?.nearest_trail_end).toEqual({ address: 'end-high', fact_type: 'cash_out', value: '500' })
  })

  it('holding class also reports "sits on a money trail"', () => {
    const block = buildMoneyTrailBlock(
      [{ edge_class: 'holding', min_hop: 3, primary_seed: 'seedA', generation: 1 }],
      [],
    )
    expect(block?.class).toBe('holding')
  })
})

describe('moneyTrailSummarySentence', () => {
  it('reads "sits on a money trail" for transport class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'transport', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('sits on a money trail')
  })

  it('reads "sits on a money trail" for holding class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'holding', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('sits on a money trail')
  })

  it('reads "touched money-trail funds" for peripheral class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'peripheral', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('touched money-trail funds')
  })

  it('never contains the word "attribution"', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'peripheral', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!).toLowerCase()).not.toContain('attribution')
  })
})
