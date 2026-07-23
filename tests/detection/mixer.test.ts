import { describe, expect, it } from 'vitest'
import { classifyMixer, resolveMixerConfig } from '../../src/detection/detectors/mixer.js'

// Default classifyMixer floor is the generic 5/5, so a degree-6 address clears
// it (per-network floors live in resolveMixerConfig, tested separately).
const base = { address: '5Xmixer', degree_in: 6, degree_out: 6, labels: [] as string[], is_exchange: false }

describe('classifyMixer hourglass', () => {
  it('flags an unlabeled address clearing both thresholds', () => {
    const f = classifyMixer(base)
    expect(f?.classification).toBe('mixer_hourglass')
    expect(f?.evidence.degree_in).toBe(6)
  })
  it('rejects below the (default) input threshold', () => {
    expect(classifyMixer({ ...base, degree_in: 4 })).toBeNull()
  })
  it('honors an operator/config-supplied higher threshold', () => {
    const cfg = { minIn: 100, minOut: 100, roleKeywords: [] as string[] }
    expect(classifyMixer(base, cfg)).toBeNull() // degree 6 < 100
    expect(classifyMixer({ ...base, degree_in: 120, degree_out: 120 }, cfg)?.classification).toBe('mixer_hourglass')
  })
  it('rejects a curated exchange/bridge/validator role', () => {
    expect(classifyMixer({ ...base, labels: ['Binance exchange'] })).toBeNull()
    expect(classifyMixer({ ...base, is_exchange: true })).toBeNull()
    expect(classifyMixer({ ...base, labels: ['validator'] })).toBeNull()
  })
  it('rejects the protocol zero/dead sink', () => {
    expect(classifyMixer({ ...base, address: '0x0000000000000000000000000000000000000000' })).toBeNull()
    expect(classifyMixer({ ...base, address: '0x000000000000000000000000000000000000dEaD' })).toBeNull()
  })
})

describe('resolveMixerConfig per-network defaults + operator overrides', () => {
  it('applies per-network default floors', () => {
    expect(resolveMixerConfig('bittensor', {})).toMatchObject({ minIn: 50, minOut: 50 })
    expect(resolveMixerConfig('bittensor_evm', {})).toMatchObject({ minIn: 20, minOut: 20 })
  })
  it('falls back to the generic default for an unlisted network', () => {
    expect(resolveMixerConfig('some_new_chain', {})).toMatchObject({ minIn: 5, minOut: 5 })
  })
  it('lets operator --param override any knob', () => {
    const cfg = resolveMixerConfig('bittensor', {
      min_in: '80',
      min_out: '90',
      max_candidates: '250',
      time_scope: 'lifetime',
      role_keywords: 'exchange, custodian',
    })
    expect(cfg).toMatchObject({ minIn: 80, minOut: 90, maxCandidates: 250, timeScope: 'lifetime' })
    expect(cfg.roleKeywords).toEqual(['exchange', 'custodian'])
  })
  it('ignores a malformed numeric override and keeps the default', () => {
    expect(resolveMixerConfig('bittensor', { min_in: 'abc' }).minIn).toBe(50)
  })
})
