// tests/monitor/runner.test.ts
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import { listAlerts } from '../../src/monitor/alerts.js'
import { withStore } from '../../src/monitor/store.js'
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
    expect(doc.run_ms).toBe(5000)
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
  })
})
