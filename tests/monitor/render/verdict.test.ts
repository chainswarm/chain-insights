import { describe, expect, it } from 'vitest'
import { computeVerdict, lastCaseActivity } from '../../../src/monitor/render/verdict.js'
import type { MonitorCase } from '../../../src/monitor/cases.js'

const DAY = 86_400_000
const NOW = 1_753_600_000_000 // epoch ms
const CREATED = NOW - 200 * DAY

const CASE: MonitorCase = {
  case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['s1'],
  status: 'open', created_at_timestamp: CREATED,
}

describe('lastCaseActivity', () => {
  it('is the newest of created_at and seed events', () => {
    expect(lastCaseActivity(CASE)).toBe(CREATED)
    expect(lastCaseActivity({
      ...CASE, seed_events: [{ action: 'add', addresses: ['s2'], at_timestamp: NOW - 10 * DAY }],
    })).toBe(NOW - 10 * DAY)
    expect(lastCaseActivity({
      ...CASE, seed_events: [{ action: 'add', addresses: ['s2'], at_timestamp: NOW - 10 * DAY }, { action: 'remove', addresses: ['s1'], at_timestamp: NOW - 5 * DAY }],
    })).toBe(NOW - 5 * DAY)
  })
})

describe('computeVerdict (case-document activity)', () => {
  it('activity 29 days ago with a 30-day threshold is ACTIVE', () => {
    const v = computeVerdict({ ...CASE, seed_events: [{ action: 'add', addresses: ['s2'], at_timestamp: NOW - 29 * DAY }] }, NOW, 30)
    expect(v.status).toBe('active')
    expect(v.headline).toMatch(/^ACTIVE \(last activity \d{4}-\d{2}-\d{2}\)$/)
  })
  it('activity exactly 30 days ago is DORMANT', () => {
    const v = computeVerdict(CASE, NOW, 30)
    expect(v.status).toBe('dormant')
    expect(v.headline).toMatch(/^DORMANT since \d{4}-\d{2}-\d{2}$/)
  })
  it('an old created_at with no events is DORMANT since creation', () => {
    const v = computeVerdict(CASE, NOW, 30)
    expect(v.lastActivityTimestamp).toBe(CREATED)
    expect(v.headline).toContain(new Date(CREATED).toISOString().slice(0, 10))
  })
  it('respects a configured non-default threshold', () => {
    const recent = { ...CASE, seed_events: [{ action: 'add', addresses: ['s2'], at_timestamp: NOW - 10 * DAY }] }
    expect(computeVerdict(recent, NOW, 7).status).toBe('dormant')
    expect(computeVerdict(recent, NOW, 30).status).toBe('active')
  })
  it('renders real dates, never 1970 or +0-style far-future years', () => {
    const v = computeVerdict({ ...CASE, seed_events: [{ action: 'add', addresses: ['s2'], at_timestamp: NOW - DAY }] }, NOW, 30)
    expect(v.headline).not.toContain('1970')
    expect(v.headline).not.toContain('+0')
  })
})