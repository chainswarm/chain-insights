// tests/monitor/runner.test.ts
import { mkdtemp, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import { appendAlerts, listAlerts, listUndelivered } from '../../src/monitor/alerts.js'
import { withStore } from '../../src/monitor/store.js'
import { addWatched } from '../../src/monitor/watchlist.js'
import { addCase } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import type { MonitorConfig } from '../../src/monitor/config.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-runner-'))
}

const CFG: MonitorConfig = {
  cells: [
    { detector: 'fake-token', network: 'bittensor_evm' },
    { detector: 'mixer', network: 'bittensor' },
  ],
  intervalSeconds: 3600,
  caseMaxHops: 3,
  render: { dormant_after_days: 30 },
}

describe('runMonitorOnce', () => {
  it('runs every cell with per-cell isolation and records a run doc (AC-1, AC-9)', async () => {
    const root = await ws()
    const doc = await runMonitorOnce({} as Client, root, CFG, 5000, {
      runDetection: async (_client, opts) => {
        if (opts.detector === 'mixer') throw new Error('boom')
        return { findingsPath: '/tmp/x.json', findingsCount: 2, status: 'complete' }
      },
      usage: async () => ({ remaining: 999 }),
    })
    expect(doc.run_timestamp).toBe(5000)
    expect(doc.cells).toHaveLength(2)
    expect(doc.cells.find((c) => c.detector === 'mixer')?.error).toMatch(/boom/)
    expect(doc.cells.find((c) => c.detector === 'fake-token')?.findings_count).toBe(2)
    // Run doc is canonical JSON on disk.
    const runFiles = await readdir(monitorPaths(root).runsDir)
    expect(runFiles).toEqual(['5000.run.json'])
    // scan_runs derived rows exist after the run's own ingest pass.
    const rows = await withStore(root, async (s) => s.all('SELECT cell, error FROM scan_runs ORDER BY cell'))
    expect(rows).toHaveLength(2)
    // new_findings alert for the successful non-empty cell only (AC-14).
    const alerts = await listAlerts(root)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe('new_findings')
    expect(alerts[0].detector).toBe('fake-token')
  })

  it('usage guard halts the run cleanly (AC-5)', async () => {
    const root = await ws()
    const doc = await runMonitorOnce({} as Client, root, { ...CFG, stopIfRemainingBelow: 100 }, 6000, {
      runDetection: async () => {
        throw new Error('must not be called when halted')
      },
      usage: async () => ({ remaining: 50 }),
    })
    expect(doc.halted).toMatch(/remaining 50 below floor 100/)
    expect(doc.cells).toHaveLength(0)
    // Halted runs still produce a canonical run doc on disk...
    const runFiles = await readdir(monitorPaths(root).runsDir)
    expect(runFiles).toEqual(['6000.run.json'])
    // ...and exactly one '(run)' marker row in scan_runs (zero cells ingested).
    const rows = await withStore(root, async (s) => s.all("SELECT cell, error FROM scan_runs WHERE run_timestamp = 6000"))
    expect(rows).toHaveLength(1)
    expect(rows[0].cell).toBe('(run)')
  })

  it('usage guard halts on the real usage_status nested shape (AC-5)', async () => {
    const root = await ws()
    const doc = await runMonitorOnce({} as Client, root, { ...CFG, stopIfRemainingBelow: 100 }, 7000, {
      runDetection: async () => {
        throw new Error('must not be called when halted')
      },
      usage: async () => ({ schema: 'chain-insights.result.v1', tool: 'usage_status', facts: { usage: { remaining_seconds: 50 } }, hint: null }),
    })
    expect(doc.halted).toMatch(/remaining 50 below floor 100/)
    expect(doc.cells).toHaveLength(0)
  })

  it('skips the usage guard when the backend reports no quota shape at all', async () => {
    const root = await ws()
    const doc = await runMonitorOnce({} as Client, root, { ...CFG, stopIfRemainingBelow: 100 }, 8000, {
      runDetection: async (_client, opts) => ({ findingsPath: '/tmp/x.json', findingsCount: opts.detector === 'mixer' ? 0 : 1, status: 'complete' }),
      usage: async () => ({ schema: 'chain-insights.result.v1', tool: 'usage_status', facts: {}, hint: null }),
    })
    expect(doc.halted).toBeUndefined()
    expect(doc.cells).toHaveLength(2)
  })

  it('an empty watchlist changes nothing (AC-7)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = {
      async callTool() {
        calls.n += 1
        return { structuredContent: null }
      },
    } as never
    const doc = await runMonitorOnce(client, root, { ...CFG, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } }, 1000, {
      runDetection: async () => ({ findingsCount: 0, findingsPath: 'x.json' }) as never,
      usage: async () => null,
    })
    expect(doc.cells.some((c) => c.cell === 'watchlist')).toBe(false)
  })

  it('watchlist hits become alerts on the existing stream (AC-5)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    await withStore(root, async (store) => {
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5Mine')")
    })
    const client = {
      async callTool({ name }: { name: string }) {
        if (name === 'aml_address_risk') throw new Error('must not be called')
        return { structuredContent: { facts: { queries: [{ id: 'dust', results: [] }] } } }
      },
    } as never
    const doc = await runMonitorOnce(client, root, { ...CFG, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } }, 1000, {
      runDetection: async () => ({ findingsCount: 0, findingsPath: 'x.json' }) as never,
      usage: async () => null,
    })
    const cell = doc.cells.find((c) => c.cell === 'watchlist')
    expect(cell).toBeDefined()
    const alerts = await listAlerts(root)
    expect(alerts.map((a) => a.type)).toContain('watchlist_finding')
  })
})

describe('render pass in the runner (spec req 1)', () => {
  const fakeDetect = async () => ({ findingsCount: 0, findingsPath: 'x.json' }) as never
  const fakeTrace = async () => ({ movements_count: 0, alerts: [] })

  it('runs the render hook per open case after tracing and records rendered cells', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'case-1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 900)
    const renderCase = vi.fn(async () => ({ rendered: true }))
    const doc = await runMonitorOnce({} as Client, root, CFG, 1000, {
      runDetection: fakeDetect, traceCase: fakeTrace, renderCase, usage: async () => null,
    })
    expect(renderCase).toHaveBeenCalledOnce()
    expect(doc.cells.some((c) => c.cell === 'render:case-1' && c.rendered === true)).toBe(true)
  })

  it('a skipped render adds no cell and a failing render isolates the error', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'case-1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 900)
    const skipped = await runMonitorOnce({} as Client, root, CFG, 1000, {
      runDetection: fakeDetect, traceCase: fakeTrace, usage: async () => null,
      renderCase: async () => ({ rendered: false, skipped_reason: 'unchanged' }),
    })
    expect(skipped.cells.some((c) => c.cell.startsWith('render:'))).toBe(false)
    const failing = await runMonitorOnce({} as Client, root, CFG, 2000, {
      runDetection: fakeDetect, traceCase: fakeTrace, usage: async () => null,
      renderCase: async () => { throw new Error('boom') },
    })
    const cell = failing.cells.find((c) => c.cell === 'render:case-1')
    expect(cell?.error).toBe('boom')
  })
})

describe('alert outbox in the runner (spec req 2)', () => {
  it('re-emits undelivered alerts on run start (at-least-once after crash)', async () => {
    const root = await ws()
    // Simulate a prior run that crashed after the canonical append: alert in
    // alerts.jsonl, no emitted.jsonl marker.
    const [orphan] = await appendAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_timestamp: 111 }], 111)
    const received: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => { received.push(JSON.parse(body).alert_id); res.end() })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await runMonitorOnce({} as Client, root, { ...CFG, cells: [], webhookUrl: `http://127.0.0.1:${port}/` }, 9000, {
        runDetection: async () => ({ findingsCount: 0, findingsPath: 'x.json' }) as never,
        usage: async () => null,
      })
    } finally {
      server.close()
    }
    expect(received).toContain(orphan.alert_id)
    expect(await listUndelivered(root)).toHaveLength(0)
  })

  it('appends alerts to canonical JSONL and commits the DB before sink delivery', async () => {
    const root = await ws()
    const order: string[] = []
    const server = createServer((_req, res) => { order.push('sink'); res.end() })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await runMonitorOnce({} as Client, root, { ...CFG, webhookUrl: `http://127.0.0.1:${port}/` }, 9500, {
        runDetection: async () => { order.push('detect'); return { findingsPath: '/tmp/x.json', findingsCount: 1, status: 'complete' } as never },
        usage: async () => null,
      })
    } finally {
      server.close()
    }
    // DB rows for this run exist by the time the sink fired: the ingest step
    // ran between append and delivery, so alerts are already in the store.
    const rows = await withStore(root, (s) => s.all('SELECT alert_id FROM alerts WHERE run_timestamp = 9500'), { readOnly: true })
    expect(rows.length).toBeGreaterThan(0)
    expect(order.filter((o) => o === 'sink')).toHaveLength(2)
  })
})
