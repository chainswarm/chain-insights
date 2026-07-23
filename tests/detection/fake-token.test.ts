import { describe, expect, it } from 'vitest'
import { findSpoofs } from '../../src/detection/detectors/fake-token.js'

describe('fake-token findSpoofs', () => {
  const verified = [
    { asset_contract: '0xREAL_USDT', symbol_lower: 'usdt', asset_symbol: 'USDT', verification_source: 'coingecko' },
    { asset_contract: '0xREAL_DAI', symbol_lower: 'dai', asset_symbol: 'DAI', verification_source: 'coingecko' },
  ]

  it('flags a non-verified contract sharing a verified symbol', () => {
    const candidates = [
      { asset_contract: '0xREAL_USDT', symbol_lower: 'usdt', verified: true },
      { asset_contract: '0xFAKE_USDT', symbol_lower: 'usdt', verified: false },
    ]
    const out = findSpoofs(verified, candidates)
    expect(out).toHaveLength(1)
    expect(out[0].address).toBe('0xFAKE_USDT')
    expect(out[0].classification).toBe('fake_token_contract')
    expect(out[0].evidence.spoofed_verified_contract).toBe('0xREAL_USDT')
  })

  it('does not flag the verified token itself, nor another verified token', () => {
    const candidates = [
      { asset_contract: '0xREAL_USDT', symbol_lower: 'usdt', verified: true },
      { asset_contract: '0xOTHER_VERIFIED_USDT', symbol_lower: 'usdt', verified: true },
    ]
    expect(findSpoofs(verified, candidates)).toHaveLength(0)
  })

  it('does not flag a symbol with no verified counterpart', () => {
    const candidates = [{ asset_contract: '0xRANDOM', symbol_lower: 'shib', verified: false }]
    expect(findSpoofs(verified, candidates)).toHaveLength(0)
  })

  it('dedupes a repeated fake contract', () => {
    const candidates = [
      { asset_contract: '0xFAKE_DAI', symbol_lower: 'dai', verified: false },
      { asset_contract: '0xFAKE_DAI', symbol_lower: 'dai', verified: false },
    ]
    expect(findSpoofs(verified, candidates)).toHaveLength(1)
  })
})
