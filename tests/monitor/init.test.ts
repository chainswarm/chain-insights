// tests/monitor/init.test.ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initVictimWorkspace } from '../../src/monitor/init.js'
import { loadMonitorConfig } from '../../src/monitor/config.js'
import { listCases } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-init-'))
}

describe('cia monitor init victim (case-tracking shape)', () => {
  it('writes the minimal config and creates the case', async () => {
    const root = await ws()
    const result = await initVictimWorkspace(root, { caseId: 'my-theft', network: 'bittensor', seeds: ['5Aaa', '5Bbb'], note: 'drained wallet' }, 1000)
    const raw = JSON.parse(await readFile(monitorPaths(root).configPath, 'utf8'))
    expect(raw).toEqual({})
    const cfg = await loadMonitorConfig(root)
    expect(cfg.render.dormant_after_days).toBe(30)
    const [created] = await listCases(root)
    expect(created).toMatchObject({ case_id: 'my-theft', type: 'stolen-funds', network: 'bittensor', status: 'open', seeds: ['5Aaa', '5Bbb'], note: 'drained wallet' })
    expect(result.monitorCase.case_id).toBe('my-theft')
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