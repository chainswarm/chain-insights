import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { ackAlert, emitAlerts, listAlerts } from '../../src/monitor/alerts.js'
import { ingestNewDocs, rebuildStore, withStore } from '../../src/monitor/store.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-alerts-'))
}

describe('monitor alerts', () => {
  it('emits, lists, and acks alert events (AC-14)', async () => {
    const root = await ws()
    const [event] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 3, run_ms: 500 }], 1000)
    expect(event.alert_id).toBe('500-0-new_findings')
    expect(await listAlerts(root, { unackedOnly: true })).toHaveLength(1)
    await ackAlert(root, event.alert_id, 2000)
    expect(await listAlerts(root, { unackedOnly: true })).toHaveLength(0)
    expect(await listAlerts(root)).toHaveLength(1)
    await expect(ackAlert(root, 'nope', 2000)).rejects.toThrow(/unknown alert/)
  })

  it('delivers to a webhook sink (AC-14 webhook smoke)', async () => {
    const root = await ws()
    const received: unknown[] = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => { received.push(JSON.parse(body)); res.end('ok') })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    await emitAlerts(root, [{ type: 'cashout_endpoint', network: 'bittensor', case_id: 'c1', address: '0xex', run_ms: 500 }], 1000, { webhookUrl: `http://127.0.0.1:${port}/` })
    server.close()
    expect(received).toHaveLength(1)
    expect((received[0] as { type: string }).type).toBe('cashout_endpoint')
  })

  it('rebuild reproduces alert + ack state in the store (AC-2, AC-14)', async () => {
    const root = await ws()
    const [event] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_ms: 500 }], 1000)
    await ackAlert(root, event.alert_id, 2000)
    await rebuildStore(root)
    const alerts = await withStore(root, async (s) => s.all('SELECT alert_id FROM alerts'))
    const acks = await withStore(root, async (s) => s.all('SELECT alert_id FROM alert_acks'))
    expect(alerts.map((r) => r.alert_id)).toEqual([event.alert_id])
    expect(acks.map((r) => r.alert_id)).toEqual([event.alert_id])
  })
})
