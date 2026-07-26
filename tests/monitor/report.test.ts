import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { renderReport, statusText } from '../../src/monitor/report.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import { DEFAULT_MONITOR_CONFIG } from '../../src/monitor/config.js'
import { withStore } from '../../src/monitor/store.js'
import { addWatched } from '../../src/monitor/watchlist.js'

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

  it('omits the watchlist section entirely when the watchlist is empty (AC-10)', async () => {
    const root = await ws()
    const md = await renderReport(root)
    expect(md).not.toContain('## Watchlist')
  })

  it('shows per-address hits by trigger when the watchlist is populated (AC-10)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor', note: 'cold' })
    await withStore(root, async (store) => {
      await store.run("INSERT INTO watchlist VALUES ('5Mine','bittensor','cold')")
      await store.run("INSERT INTO watchlist_hits VALUES (1000,'5Mine','bittensor','finding','d1.json',NULL)")
      await store.run("INSERT INTO watchlist_hits VALUES (1000,'5Mine','bittensor','dust','tx-1',NULL)")
    })
    const md = await renderReport(root)
    expect(md).toContain('## Watchlist')
    expect(md).toContain('5Mine')
    expect(md).toMatch(/\| bittensor \| 5Mine \| 1 \| 0 \| 1 \|/)
  })
})
