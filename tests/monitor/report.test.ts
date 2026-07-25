import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { renderReport, statusText } from '../../src/monitor/report.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import { DEFAULT_MONITOR_CONFIG } from '../../src/monitor/config.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-report-'))
}

describe('report + status (AC-6)', () => {
  it('renders runs, pending, alerts sections from store state', async () => {
    const root = await ws()
    await runMonitorOnce({} as Client, root, { cells: [{ detector: 'mixer', network: 'bittensor' }], intervalSeconds: 60, caseMaxHops: 3 }, 4242, {
      runDetection: async () => ({ findingsPath: '/tmp/f.json', findingsCount: 1, status: 'complete' }),
      usage: async () => null,
    })
    const md = await renderReport(root)
    expect(md).toContain('# Chain Insights Monitor Report')
    expect(md).toContain('mixer:bittensor')
    expect(md).toContain('4242')
    const status = await statusText(root, DEFAULT_MONITOR_CONFIG)
    expect(status).toContain('cells: 8')
    expect(status).toContain('unacked alerts: 1')
  })
})
