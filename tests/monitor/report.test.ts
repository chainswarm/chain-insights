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

describe('report cell escaping (R6)', () => {
  it('escapes pipes and newlines in table cells so the Markdown table survives', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-report-esc-'))
    await withStore(root, (s) => s.run(
      'INSERT INTO scan_runs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [100, 'mixer:bittensor', 'mixer', null, 'bittensor', 0, 0, 5,
       'boom \\| with backslash-pipe | and pipe\nand newline', 'null', 'null', null],
    ))
    const md = await renderReport(root)
    const row = md.split('\n').find((l) => l.includes('boom'))!
    expect(row).toContain('boom \\\\\\| with backslash-pipe \\| and pipe and newline')
    expect(row).not.toMatch(/\nand newline/)
    // the row still has the exact column count of the runs table
    expect(row.split(/(?<!\\)\|/).length).toBe(9)
  })

  it('status leads with profile and trace_mode (victim lane spec req 1)', async () => {
    const root = await ws()
    expect(await statusText(root, DEFAULT_MONITOR_CONFIG)).toContain('profile: operator | trace_mode: interval')
    expect(await statusText(root, { ...DEFAULT_MONITOR_CONFIG, profile: 'victim' })).toContain('profile: victim | trace_mode: on_movement')
  })
})
