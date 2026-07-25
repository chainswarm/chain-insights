import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadMonitorConfig } from '../../src/monitor/config.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-monitor-'))
}

describe('monitor config', () => {
  it('defaults to all four detectors × bittensor + bittensor_evm (A6)', async () => {
    const root = await ws()
    const cfg = await loadMonitorConfig(root)
    expect(cfg.cells).toHaveLength(8)
    const ids = new Set(cfg.cells.map((c) => c.detector))
    expect(ids).toEqual(new Set(['fake-token', 'mixer', 'address-poisoning', 'attack-attribution']))
    const nets = new Set(cfg.cells.map((c) => c.network))
    expect(nets).toEqual(new Set(['bittensor', 'bittensor_evm']))
    expect(cfg.intervalSeconds).toBe(3600)
    expect(cfg.caseMaxHops).toBe(3)
  })

  it('reads an explicit config file and validates fail-fast', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    await writeFile(
      p.configPath,
      JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor', params: { min_in: '80' } }], intervalSeconds: 60, stopIfRemainingBelow: 100, reviewer: 'ops' }),
    )
    const cfg = await loadMonitorConfig(root)
    expect(cfg.cells).toEqual([{ detector: 'mixer', network: 'bittensor', params: { min_in: '80' } }])
    expect(cfg.stopIfRemainingBelow).toBe(100)
  })

  it('throws a readable error on malformed config (never a raw ZodError)', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    await writeFile(p.configPath, JSON.stringify({ cells: [{ detector: '', network: 'bittensor' }] }))
    await expect(loadMonitorConfig(root)).rejects.toThrow(/Invalid monitor config/)
  })
})
