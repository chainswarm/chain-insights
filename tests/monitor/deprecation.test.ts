// tests/monitor/deprecation.test.ts
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEPRECATED_DETECTORS, deprecationWarning } from '../../src/detection/registry.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import type { MonitorConfig } from '../../src/monitor/config.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-deprec-'))
}

describe('migrated-detector deprecation (label-cutover spec req 3)', () => {
  it('exactly address-poisoning, fake-token, attack-attribution are deprecated; mixer is not', () => {
    expect([...DEPRECATED_DETECTORS].sort()).toEqual(['address-poisoning', 'attack-attribution', 'fake-token'])
    for (const d of DEPRECATED_DETECTORS) {
      expect(deprecationWarning(d)).toMatch(/deprecated/)
      expect(deprecationWarning(d)).toMatch(/watchlist_label/)
      expect(deprecationWarning(d)).toMatch(/aml_address_risk/)
    }
    expect(deprecationWarning('mixer')).toBeUndefined()
    expect(deprecationWarning('no-such-detector')).toBeUndefined()
  })

  it('a monitor cell for a deprecated detector records the warning on its run-document outcome', async () => {
    const root = await ws()
    const config = {
      cells: [
        { detector: 'address-poisoning', network: 'bittensor' },
        { detector: 'mixer', network: 'bittensor' },
      ],
      intervalSeconds: 3600, caseMaxHops: 2, render: { dormant_after_days: 30 },
    } as unknown as MonitorConfig
    const doc = await runMonitorOnce({} as never, root, config, 1000, {
      usage: async () => null,
      runDetection: async () => ({ findingsPath: 'detections/x.findings.json', findingsCount: 0, status: 'complete' }),
    })
    const poisoning = doc.cells.find((c) => c.cell === 'address-poisoning:bittensor')
    const mixer = doc.cells.find((c) => c.cell === 'mixer:bittensor')
    expect(poisoning?.deprecation).toMatch(/deprecated/)
    expect(poisoning?.error).toBeUndefined() // warning only — the cell still runs
    expect(mixer?.deprecation).toBeUndefined()
  })

  it('cia detect --help documents the deprecation (CLI surface)', () => {
    const help = execFileSync('npx', ['tsx', 'src/cli.ts', 'detect', '--help'], { encoding: 'utf8' })
    expect(help.toLowerCase()).toContain('deprecated')
    expect(help).toContain('mixer')
  })
})
