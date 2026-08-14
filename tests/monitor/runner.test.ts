// tests/monitor/runner.test.ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runMonitorOnce } from '../../src/monitor/runner.js'
import { addCase } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import type { MonitorConfig } from '../../src/monitor/config.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-runner-'))
}

const CFG: MonitorConfig = {
  render: { dormant_after_days: 30 },
}

describe('runMonitorOnce case-only pass', () => {
  it('reports one outcome per open case and no detection cells', async () => {
    const doc = await runMonitorOnce({} as Client, '/nonexistent', { render: { dormant_after_days: 30 } }, 123)
    expect(doc.cases).toEqual([])
    expect(doc.run_timestamp).toBe(123)
  })

  it('renders every open case and records the outcome', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'case-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 100)
    const doc = await runMonitorOnce({} as Client, root, CFG, 1000)
    expect(doc.cases).toHaveLength(1)
    expect(doc.cases[0].case_id).toBe('case-1')
    expect(doc.cases[0].rendered).toBe(true)
    expect(doc.cases[0].error).toBeUndefined()
    expect(await readFile(path.join(monitorPaths(root).casesDir, 'case-1', 'case.json'), 'utf8')).toBeTruthy()
  })

  it('a closed case is skipped with a reason, not rendered', async () => {
    const root = await ws()
    const { closeCase } = await import('../../src/monitor/cases.js')
    await addCase(root, { case_id: 'gone', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 100)
    await closeCase(root, 'gone', 200)
    const doc = await runMonitorOnce({} as Client, root, CFG, 1000)
    expect(doc.cases).toHaveLength(0)
  })

  it('a failing render is isolated per case with an error outcome', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'case-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 100)
    // Make the dossier write fail (a file blocking the published dir) while
    // the case doc stays valid, so listCases still returns the case.
    const fs = await import('node:fs/promises')
    await fs.mkdir(path.join(root, 'published'))
    await fs.writeFile(path.join(root, 'published', 'cases'), 'blocker', 'utf8')
    const doc = await runMonitorOnce({} as Client, root, CFG, 1000)
    expect(doc.cases).toHaveLength(1)
    expect(doc.cases[0].case_id).toBe('case-1')
    expect(doc.cases[0].rendered).toBeUndefined()
    expect(doc.cases[0].error).toBeTruthy()
  })
})