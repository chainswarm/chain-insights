import { describe, expect, it } from 'vitest'
import { resolvePoisoningConfig } from '../../src/detection/detectors/address-poisoning.js'
import { resolveAttributionConfig } from '../../src/detection/detectors/attack-attribution.js'
import { resolveFakeTokenConfig } from '../../src/detection/detectors/fake-token.js'

describe('resolvePoisoningConfig', () => {
  it('applies defaults', () => {
    const cfg = resolvePoisoningConfig('bittensor', {})
    expect(cfg.dustFloor).toBe(0.0001)
    expect(cfg.scanWindowMs).toBe(2 * 24 * 60 * 60 * 1000)
    expect(cfg.maxRows).toBe(1000)
  })
  it('honors operator overrides', () => {
    const cfg = resolvePoisoningConfig('bittensor', {
      dust_floor: '0.001',
      scan_window_days: '1',
      max_rows: '500',
    })
    expect(cfg.dustFloor).toBe(0.001)
    expect(cfg.scanWindowMs).toBe(24 * 60 * 60 * 1000)
    expect(cfg.maxRows).toBe(500)
  })
  it('keeps the default on a malformed override', () => {
    expect(resolvePoisoningConfig('bittensor', { dust_floor: 'nope' }).dustFloor).toBe(0.0001)
  })
})

describe('resolveAttributionConfig', () => {
  it('applies defaults', () => {
    const cfg = resolveAttributionConfig('bittensor', {})
    expect(cfg.maxHops).toBe(3)
    expect(cfg.maxFrontier).toBe(500)
    expect(cfg.seedSubtypes).toEqual(['poisoning_duster', 'dusting_source', 'fake_token_contract'])
  })
  it('honors operator overrides including csv lists', () => {
    const cfg = resolveAttributionConfig('bittensor', {
      max_hops: '5',
      max_frontier: '100',
      seed_subtypes: 'fake_token_contract, mixer_hourglass',
      boundary_keywords: 'exchange',
    })
    expect(cfg.maxHops).toBe(5)
    expect(cfg.maxFrontier).toBe(100)
    expect(cfg.seedSubtypes).toEqual(['fake_token_contract', 'mixer_hourglass'])
    expect(cfg.boundaryKeywords).toEqual(['exchange'])
  })
})

describe('resolveFakeTokenConfig', () => {
  it('applies defaults and overrides', () => {
    expect(resolveFakeTokenConfig('bittensor', {})).toEqual({ maxPages: 50, pageSize: 1000 })
    expect(resolveFakeTokenConfig('bittensor', { max_pages: '10', page_size: '200' })).toEqual({
      maxPages: 10,
      pageSize: 200,
    })
  })
})
