import { describe, expect, it } from 'vitest'

import { freeTierSpentText } from '../src/mcp/usage-status.js'

describe('freeTierSpentText', () => {
  const spent = {
    access_mode: 'public_free',
    identifier_kind: 'ip',
    daily_units_used: 5000,
    daily_units_limit: 5000,
    remaining_units: 0,
    reset_at: '2026-10-24T00:00:00Z',
    paid_available: true,
  }

  it('names the spent free tier, its units and the reset time, before any wallet step', () => {
    const text = freeTierSpentText(spent)
    expect(text).toContain('The free tier for today is used up')
    expect(text).toContain('5,000 of 5,000 free units')
    expect(text).toContain('resets at 2026-10-24 00:00 UTC')
    expect(text).not.toContain('wallet')
  })

  it.each([
    ['units left', { ...spent, remaining_units: 120 }],
    ['a paid caller', { ...spent, access_mode: 'paid' }],
    ['no usage object', undefined],
    ['a primitive backend', { mode: 'primitive_graph_backend', quota_enforced: false }],
  ])('is silent for %s', (_name, usage) => {
    expect(freeTierSpentText(usage)).toBeUndefined()
  })
})
