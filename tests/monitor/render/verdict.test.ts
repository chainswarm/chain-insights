import { describe, expect, it } from 'vitest'
import { computeVerdict, lastMovementTimestamp } from '../../../src/monitor/render/verdict.js'
import type { TraceV1Doc } from '../../../src/monitor/render/trace-io.js'

const DAY = 86400
const NOW = 1_753_600_000
const docWith = (edges: TraceV1Doc['edges']): TraceV1Doc => ({
  schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds',
  network: 'bittensor', addresses: [], edges, paths: [],
})

describe('lastMovementTimestamp', () => {
  it('takes the max across docs and both timestamp fields', () => {
    const a = docWith([{ edge_id: 'e1', from_address: 'a', to_address: 'b', first_seen_timestamp: NOW - 90 * DAY, last_seen_timestamp: NOW - 40 * DAY }])
    const b = docWith([{ edge_id: 'e1', from_address: 'b', to_address: 'c', last_seen_timestamp: NOW - 10 * DAY }])
    expect(lastMovementTimestamp([a, b])).toBe(NOW - 10 * DAY)
  })
  it('is null with no timestamps', () => {
    expect(lastMovementTimestamp([docWith([{ edge_id: 'e1', from_address: 'a', to_address: 'b' }])])).toBeNull()
  })
})

describe('computeVerdict boundary', () => {
  const created = NOW - 200 * DAY
  it('movement 29 days ago with 30-day threshold is ACTIVE', () => {
    const v = computeVerdict([docWith([{ edge_id: 'e1', from_address: 'a', to_address: 'b', last_seen_timestamp: NOW - 29 * DAY }])], NOW, 30, created)
    expect(v.status).toBe('active')
    expect(v.headline).toMatch(/^ACTIVE \(last movement \d{4}-\d{2}-\d{2}\)$/)
  })
  it('movement exactly 30 days ago is DORMANT', () => {
    const v = computeVerdict([docWith([{ edge_id: 'e1', from_address: 'a', to_address: 'b', last_seen_timestamp: NOW - 30 * DAY }])], NOW, 30, created)
    expect(v.status).toBe('dormant')
    expect(v.headline).toMatch(/^DORMANT since \d{4}-\d{2}-\d{2}$/)
  })
  it('no timestamps at all is DORMANT since case creation', () => {
    const v = computeVerdict([docWith([])], NOW, 30, created)
    expect(v.status).toBe('dormant')
    expect(v.lastMovementTimestamp).toBeNull()
    expect(v.headline).toContain(new Date(created * 1000).toISOString().slice(0, 10))
  })
  it('respects a configured non-default threshold', () => {
    const edges = [{ edge_id: 'e1', from_address: 'a', to_address: 'b', last_seen_timestamp: NOW - 10 * DAY }]
    expect(computeVerdict([docWith(edges)], NOW, 7, created).status).toBe('dormant')
    expect(computeVerdict([docWith(edges)], NOW, 30, created).status).toBe('active')
  })
})
