import { describe, expect, it } from 'vitest'
import { exchangeExposureFallbackScore } from '../src/investigation/public-tools.js'

describe('exchange exposure fallback score', () => {
  it('returns 0 with no exchange rows', () => {
    expect(exchangeExposureFallbackScore([])).toBe(0)
  })

  it('is monotonically increasing in USD volume', () => {
    const low = exchangeExposureFallbackScore([{ amount_usd_sum: 100, tx_count: 2 }])
    const mid = exchangeExposureFallbackScore([{ amount_usd_sum: 50_000, tx_count: 2 }])
    const high = exchangeExposureFallbackScore([{ amount_usd_sum: 900_000, tx_count: 2 }])
    expect(low).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
  })

  it('dampens shared/omnibus rows', () => {
    const dedicated = exchangeExposureFallbackScore([{ amount_usd_sum: 200_000, tx_count: 3 }])
    const shared = exchangeExposureFallbackScore([{ amount_usd_sum: 200_000, tx_count: 5000 }])
    expect(shared).toBeLessThan(dedicated)
  })

  it('never exceeds 0.6', () => {
    expect(exchangeExposureFallbackScore([{ amount_usd_sum: 50_000_000, tx_count: 1 }])).toBeLessThanOrEqual(0.6)
  })
})
