import { describe, expect, it } from 'vitest'
import { classifyMixer, MIXER_MIN_INPUT_COUNT } from '../../src/detection/detectors/mixer.js'

const base = { address: '5Xmixer', degree_in: 20, degree_out: 20, labels: [] as string[], is_exchange: false }

describe('classifyMixer hourglass', () => {
  it('flags an unlabeled address clearing both thresholds', () => {
    const f = classifyMixer(base)
    expect(f?.classification).toBe('mixer_hourglass')
    expect(f?.evidence.degree_in).toBe(20)
  })
  it('rejects below the input threshold', () => {
    expect(classifyMixer({ ...base, degree_in: MIXER_MIN_INPUT_COUNT - 1 })).toBeNull()
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
