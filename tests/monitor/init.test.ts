// tests/monitor/init.test.ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initVictimWorkspace } from '../../src/monitor/init.js'
import { loadMonitorConfig, resolvedProfile, resolvedTraceMode } from '../../src/monitor/config.js'
import { listCases } from '../../src/monitor/cases.js'
import { loadWatchlist } from '../../src/monitor/watchlist.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-init-'))
}

describe('cia monitor init victim (victim lane spec req 7)', () => {
  it('writes the minimal victim config, creates the case, and watchlists the seeds as managed', async () => {
    const root = await ws()
    const result = await initVictimWorkspace(root, { caseId: 'my-theft', network: 'bittensor', seeds: ['5Aaa', '5Bbb'], note: 'drained wallet' }, 1000)
    const raw = JSON.parse(await readFile(monitorPaths(root).configPath, 'utf8'))
    expect(raw).toEqual({ profile: 'victim', trace_mode: 'on_movement', cells: [], watchlist: {} })
    const cfg = await loadMonitorConfig(root)
    expect(resolvedProfile(cfg)).toBe('victim')
    expect(resolvedTraceMode(cfg)).toBe('on_movement')
    expect(cfg.cells).toEqual([])
    expect(cfg.watchlist?.enabled).toBe(true)
    const [created] = await listCases(root)
    expect(created).toMatchObject({ case_id: 'my-theft', type: 'stolen-funds', network: 'bittensor', status: 'open', seeds: ['5Aaa', '5Bbb'], note: 'drained wallet' })
    const managed = (await loadWatchlist(root)).filter((e) => e.managed_by === 'case:my-theft')
    expect(managed.map((e) => e.address).sort()).toEqual(['5Aaa', '5Bbb'])
    expect(result.watchlisted.sort()).toEqual(['5Aaa', '5Bbb'])
  })

  it('refuses when a monitor config already exists and creates nothing new', async () => {
    const root = await ws()
    await initVictimWorkspace(root, { caseId: 'first', network: 'bittensor', seeds: ['5Aaa'] }, 1000)
    await expect(
      initVictimWorkspace(root, { caseId: 'second', network: 'bittensor', seeds: ['5Bbb'] }, 2000),
    ).rejects.toThrow(/already exists/)
    expect((await listCases(root)).map((c) => c.case_id)).toEqual(['first'])
  })

  it('a bad seed fails BEFORE anything is written', async () => {
    const root = await ws()
    await expect(
      initVictimWorkspace(root, { caseId: 'bad', network: 'bittensor', seeds: ["5Aaa' RETURN 1 //"] }, 1000),
    ).rejects.toThrow(/chain address/)
    expect(await listCases(root)).toEqual([])
    await expect(readFile(monitorPaths(root).configPath, 'utf8')).rejects.toThrow()
  })
})
