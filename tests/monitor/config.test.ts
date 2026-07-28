import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadMonitorConfig, resolvedProfile, resolvedTraceMode } from '../../src/monitor/config.js'
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

  describe('profile & trace_mode resolution (victim lane spec req 1-2)', () => {
    it('absent profile = operator, absent trace_mode = interval (back-compat)', async () => {
      const root = await ws()
      const cfg = await loadMonitorConfig(root)
      expect(cfg.profile).toBeUndefined()
      expect(cfg.trace_mode).toBeUndefined()
      expect(resolvedProfile(cfg)).toBe('operator')
      expect(resolvedTraceMode(cfg)).toBe('interval')
    })

    it('profile victim defaults trace_mode to on_movement', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({ profile: 'victim', cells: [] }), 'utf8')
      const cfg = await loadMonitorConfig(root)
      expect(resolvedProfile(cfg)).toBe('victim')
      expect(resolvedTraceMode(cfg)).toBe('on_movement')
    })

    it('explicit trace_mode overrides the profile default in both directions', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({ profile: 'victim', trace_mode: 'interval', cells: [] }), 'utf8')
      expect(resolvedTraceMode(await loadMonitorConfig(root))).toBe('interval')
      await writeFile(p.configPath, JSON.stringify({ profile: 'operator', trace_mode: 'on_movement', cells: [] }), 'utf8')
      expect(resolvedTraceMode(await loadMonitorConfig(root))).toBe('on_movement')
    })

    it('rejects an unknown profile or trace_mode fail-fast', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({ profile: 'bank', cells: [] }), 'utf8')
      await expect(loadMonitorConfig(root)).rejects.toThrow(/Invalid monitor config/)
      await writeFile(p.configPath, JSON.stringify({ trace_mode: 'sometimes', cells: [] }), 'utf8')
      await expect(loadMonitorConfig(root)).rejects.toThrow(/Invalid monitor config/)
    })

    it('cells may be empty or absent (victim minimal config, spec req 7)', async () => {
      const root = await ws()
      const p = monitorPaths(root)
      await mkdir(p.monitorDir, { recursive: true })
      await writeFile(p.configPath, JSON.stringify({ profile: 'victim' }), 'utf8')
      expect((await loadMonitorConfig(root)).cells).toEqual([])
    })
  })
})
