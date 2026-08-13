import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { statusText } from '../../src/monitor/report.js'
import { addCase } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-report-'))
}

const CFG = { intervalSeconds: 60, render: { dormant_after_days: 30 } }

describe('statusText (case-tracking shape)', () => {
  it('shows open cases and never when no run has happened', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 100)
    const status = await statusText(root, CFG)
    expect(status).toContain('open cases: 1')
    expect(status).toContain('c1 [stolen-funds/bittensor]')
    expect(status).toContain('last run: never')
  })

  it('reads the last run timestamp from logs/monitor-runs.jsonl', async () => {
    const root = await ws()
    const logDir = path.join(monitorPaths(root).logsDir)
    await import('node:fs/promises').then((fs) => fs.mkdir(logDir, { recursive: true }))
    await writeFile(path.join(logDir, 'monitor-runs.jsonl'), `${JSON.stringify({ run_timestamp: 1000 })}\n${JSON.stringify({ run_timestamp: 2000 })}\n`, 'utf8')
    expect(await statusText(root, CFG)).toContain('last run: 2000')
  })
})