import { describe, expect, it } from 'vitest'
import { exchangeExposureFallbackScore, riskAssessment } from '../src/investigation/public-tools.js'

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

describe('risk assessment precedence', () => {
  it('a lower-severity label never suppresses a more severe usable ML band', () => {
    const assessment = riskAssessment(
      { live_risk_score: 0.92, live_risk_level: 'HIGH' },
      [{ label: 'known-service', risk_level: 'low', updated_timestamp: 1700000000000 }],
      [],
    )
    expect(assessment['level']).toBe('critical')
    expect(String(assessment['drivers'])).toContain('ml_label_divergence')
  })

  it('labels stay first when equal or more severe than the ML band', () => {
    const assessment = riskAssessment(
      { live_risk_score: 0.45, live_risk_level: 'MEDIUM' },
      [{ label: 'scam', risk_level: 'high', updated_timestamp: 1700000000000 }],
      [],
    )
    expect(assessment['level']).toBe('high')
    expect(String(assessment['drivers'])).not.toContain('ml_label_divergence')
  })

  it('an abstained ML verdict still never launders into a severity', () => {
    const assessment = riskAssessment(
      { live_risk_score: 0.83, live_risk_level: 'UNSCORED' },
      [],
      [],
    )
    expect(assessment['level']).toBe('unscored')
    expect(assessment['ml_verdict']).toBe('unscored')
    expect(String(assessment['drivers'])).toContain('ml_abstained')
  })
})
