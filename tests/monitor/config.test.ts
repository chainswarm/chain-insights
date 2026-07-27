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

  it('parses alerts.hook_timeout_ms and rejects a non-positive value (R4)', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    await writeFile(p.configPath, JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor' }], alerts: { hook_timeout_ms: 5000 } }))
    const cfg = await loadMonitorConfig(root)
    expect(cfg.alerts?.hook_timeout_ms).toBe(5000)
    await writeFile(p.configPath, JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor' }], alerts: { hook_timeout_ms: 0 } }))
    await expect(loadMonitorConfig(root)).rejects.toThrow(/hook_timeout_ms/)
  })

  it('throws a readable error on malformed config (never a raw ZodError)', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    await writeFile(p.configPath, JSON.stringify({ cells: [{ detector: '', network: 'bittensor' }] }))
    await expect(loadMonitorConfig(root)).rejects.toThrow(/Invalid monitor config/)
  })

  it('watchlist block defaults and validation', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(path.dirname(p.configPath), { recursive: true })
    await writeFile(
      p.configPath,
      JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor' }], watchlist: {} }),
      'utf8',
    )
    const cfg = await loadMonitorConfig(root)
    expect(cfg.watchlist).toEqual({ dustMaxUsd: 1.0, dustLookbackSeconds: 86400, enabled: true })
  })

  it('watchlist block is absent by default (feature off)', async () => {
    const root = await ws()
    const cfg = await loadMonitorConfig(root)
    expect(cfg.watchlist).toBeUndefined()
  })

  describe('render config (investigation output)', () => {
    it('defaults render.dormant_after_days to 30 when absent', async () => {
      const root = await ws()
      expect((await loadMonitorConfig(root)).render.dormant_after_days).toBe(30)
    })

    it('accepts an explicit render.dormant_after_days', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({
        cells: [{ detector: 'mixer', network: 'bittensor' }],
        render: { dormant_after_days: 7 },
      }), 'utf8')
      expect((await loadMonitorConfig(root)).render.dormant_after_days).toBe(7)
    })

    it('rejects a non-positive dormant_after_days', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({
        cells: [{ detector: 'mixer', network: 'bittensor' }],
        render: { dormant_after_days: 0 },
      }), 'utf8')
      await expect(loadMonitorConfig(root)).rejects.toThrow(/render\.dormant_after_days/)
    })
  })

  it('rejects a negative dustMaxUsd', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(path.dirname(p.configPath), { recursive: true })
    await writeFile(
      p.configPath,
      JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor' }], watchlist: { dustMaxUsd: -1 } }),
      'utf8',
    )
    await expect(loadMonitorConfig(root)).rejects.toThrow(/watchlist.dustMaxUsd/)
  })
})
