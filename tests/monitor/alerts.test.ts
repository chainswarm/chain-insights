import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { ackAlert, appendAlerts, deliverAlerts, emitAlerts, listAlerts, listUndelivered } from '../../src/monitor/alerts.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { rebuildStore, withStore } from '../../src/monitor/store.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-alerts-'))
}

describe('monitor alerts', () => {
  it('emits, lists, and acks alert events (AC-14)', async () => {
    const root = await ws()
    const [event] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 3, run_timestamp: 500 }], 1000)
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
    await emitAlerts(root, [{ type: 'cashout_endpoint', network: 'bittensor', case_id: 'c1', address: '0xex', run_timestamp: 500 }], 1000, { webhookUrl: `http://127.0.0.1:${port}/` })
    server.close()
    expect(received).toHaveLength(1)
    expect((received[0] as { type: string }).type).toBe('cashout_endpoint')
  })

  it('rebuild reproduces alert + ack state in the store (AC-2, AC-14)', async () => {
    const root = await ws()
    const [event] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_timestamp: 500 }], 1000)
    await ackAlert(root, event.alert_id, 2000)
    await rebuildStore(root)
    const alerts = await withStore(root, async (s) => s.all('SELECT alert_id FROM alerts'))
    const acks = await withStore(root, async (s) => s.all('SELECT alert_id FROM alert_acks'))
    expect(alerts.map((r) => r.alert_id)).toEqual([event.alert_id])
    expect(acks.map((r) => r.alert_id)).toEqual([event.alert_id])
  })
})

describe('hook timeouts (R4)', () => {
  it('kills a hung exec hook after hookTimeoutMs without failing the run', async () => {
    const root = await ws()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const started = Date.now()
    const emitted = await emitAlerts(root,
      [{ type: 'new_findings', network: 'bittensor', run_timestamp: 100 }], 200,
      { execHook: 'sleep 60', hookTimeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(emitted).toHaveLength(1) // alert still recorded in JSONL, run not failed
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    warn.mockRestore()
  })

  it('aborts a hung webhook after hookTimeoutMs and logs a sink failure', async () => {
    const root = await ws()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const server = http.createServer(() => { /* never respond */ })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    const emitted = await emitAlerts(root,
      [{ type: 'new_findings', network: 'bittensor', run_timestamp: 100 }], 200,
      { webhookUrl: `http://127.0.0.1:${port}/hook`, hookTimeoutMs: 300 })
    expect(emitted).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    server.close()
    warn.mockRestore()
  })
})

describe('alert outbox (spec req 2)', () => {
  it('appendAlerts records to JSONL without delivering; deliverAlerts marks emitted.jsonl', async () => {
    const root = await ws()
    const stamped = await appendAlerts(root, [{ type: 'new_findings', network: 'bittensor', run_timestamp: 100 }], 100)
    expect(stamped).toHaveLength(1)
    expect(await listUndelivered(root)).toHaveLength(1)
    await deliverAlerts(root, stamped, 100)
    expect(await listUndelivered(root)).toHaveLength(0)
    const markers = (await readFile(monitorPaths(root).emittedLog, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(markers[0]).toMatchObject({ alert_id: stamped[0].alert_id })
  })

  it('a crash between JSONL append and delivery leaves the alert undelivered (never lost)', async () => {
    const root = await ws()
    const stamped = await appendAlerts(root, [{ type: 'case_movement', network: 'bittensor', case_id: 'c1', run_timestamp: 200 }], 200)
    // No deliverAlerts call = crash before sinks.
    const pending = await listUndelivered(root)
    expect(pending.map((a) => a.alert_id)).toEqual([stamped[0].alert_id])
  })
})
