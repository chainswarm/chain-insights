import { describe, expect, it } from 'vitest'
import { findPoisoning, type DustEdge } from '../../src/detection/detectors/address-poisoning.js'

const victim = '0xvictim0000000000000000000000000000victim'
const realCp = '0xabcdef1111111111111111111111111111119999'
// vanity lookalike of realCp: same first 6 + last 4, different middle, same length
const duster = realCp.slice(0, 6) + '0'.repeat(realCp.length - 10) + realCp.slice(-4)

describe('address-poisoning findPoisoning', () => {
  it('flags a duster that vanity-matches a real prior counterparty of the victim', () => {
    expect(duster.length).toBe(realCp.length)
    const dust: DustEdge[] = [{ duster, victim, amount: 0.00001 }]
    const reals = new Map([[victim, [realCp]]])
    const out = findPoisoning(dust, reals)
    expect(out).toHaveLength(1)
    expect(out[0].address).toBe(duster)
    expect(out[0].classification).toBe('poisoning_duster')
    expect(out[0].evidence.impersonated_counterparty).toBe(realCp)
    expect(out[0].evidence.victim).toBe(victim)
  })

  it('does not flag a duster matching none of the victim real counterparties', () => {
    const dust: DustEdge[] = [{ duster, victim, amount: 0.00001 }]
    const reals = new Map([[victim, ['0xUNRELATED']]])
    expect(findPoisoning(dust, reals)).toHaveLength(0)
  })

  it('does not flag when the victim has no known counterparties', () => {
    const dust: DustEdge[] = [{ duster, victim, amount: 0.00001 }]
    expect(findPoisoning(dust, new Map())).toHaveLength(0)
  })

  it('dedupes a repeated duster->victim edge', () => {
    const dust: DustEdge[] = [
      { duster, victim, amount: 0.00001 },
      { duster, victim, amount: 0.00002 },
    ]
    const reals = new Map([[victim, [realCp]]])
    expect(findPoisoning(dust, reals)).toHaveLength(1)
  })
})
