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

  // Live bittensor campaign shape (2026-07-23): ss58 vanity dusters sharing a
  // long prefix with the victim's real whale counterparty, matched on prefix
  // only, and the cluster size surfaced as evidence.
  it('flags ss58 prefix-only vanity dusters and reports the vanity cluster size', () => {
    const whale = '5EYCAe5jLQhn6ofDSvqF6iY53erXNkwhyE1aCEgvi1NNs91F'
    const v1 = '5EYCAe5jLQhn6ofDSwRz48FMNwMoybug9AJngvbsufKfME2t'
    const v2 = '5EYCAe5jLQhn6ofDSwPp7uteUyxEKB6gFnniHP7CD4KqCQDN'
    const victimA = '5D7fthS7zBDhwi2u2JYd74t7FpQuseDkUkTuaLZoenXNpXPK'
    const dust: DustEdge[] = [
      { duster: v1, victim: victimA, amount: 0.00009 },
      { duster: v2, victim: victimA, amount: 0.00003 },
    ]
    const reals = new Map([[victimA, [whale]]])
    const out = findPoisoning(dust, reals)
    expect(out).toHaveLength(2)
    expect(out[0].classification).toBe('poisoning_duster')
    expect(out[0].evidence.impersonated_counterparty).toBe(whale)
    // both vanity dusters fall in one cluster (shared 14-char prefix)
    expect(out[0].evidence.vanity_cluster_size).toBe(2)
  })
})
