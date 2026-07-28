// tests/monitor/label-alert.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendAlerts, listAlerts, type AlertEvent } from '../../src/monitor/alerts.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-lblalert-'))
}

describe('watchlist_label alert event (label-cutover spec req 1)', () => {
  it('round-trips a label alert naming address, label, and source', async () => {
    const root = await ws()
    const event: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'> = {
      type: 'watchlist_label',
      network: 'bittensor',
      address: '5Mine',
      label: 'MEXC',
      source: 'topology',
      run_timestamp: 1000,
    }
    const stamped = await appendAlerts(root, [event], 2000)
    expect(stamped[0].alert_id).toBe('1000-0-watchlist_label')
    const listed = await listAlerts(root)
    expect(listed).toHaveLength(1)
    expect(listed[0].type).toBe('watchlist_label')
    expect(listed[0].label).toBe('MEXC')
    expect(listed[0].source).toBe('topology')
    expect(listed[0].address).toBe('5Mine')
  })

  it('a managed-entry label alert carries the owning case id', async () => {
    const root = await ws()
    await appendAlerts(root, [{
      type: 'watchlist_label',
      network: 'bittensor',
      address: '5Mule',
      label: 'mule',
      source: 'topology',
      case_id: 'theft-1',
      run_timestamp: 1000,
    }], 2000)
    expect((await listAlerts(root))[0].case_id).toBe('theft-1')
  })
})
