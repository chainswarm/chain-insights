// tests/monitor/closable.test.ts
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { caseClosableStatus, isClosable } from '../../src/monitor/closable.js'
import { statusText } from '../../src/monitor/report.js'
import { addCase, closeCase } from '../../src/monitor/cases.js'
import { approveDoc } from '../../src/monitor/review.js'
import { addWatched } from '../../src/monitor/watchlist.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { DEFAULT_MONITOR_CONFIG } from '../../src/monitor/config.js'

const DAY_MS = 86_400_000
const NOW = 1_800_000_000_000

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-closable-'))
}

async function openScamCase(root: string, caseId: string) {
  return addCase(root, { case_id: caseId, type: 'scam-topology', network: 'bittensor', seeds: ['5Seed'] }, NOW - 40 * DAY_MS)
}

async function labelCase(root: string, caseId: string): Promise<void> {
  const dir = monitorPaths(root).detectionsDir
  await mkdir(dir, { recursive: true })
  const doc = path.join(dir, `1-case-${caseId}-bittensor.findings.json`)
  await writeFile(doc, JSON.stringify({
    schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
    status: 'complete', generated_at_timestamp: 1,
    findings: [{ address: '5Seed', role: 'seed', evidence: {}, truncated: false, inconclusive: false }],
  }))
  await approveDoc(root, doc, 'ops', NOW - 35 * DAY_MS)
}

async function manage(root: string, caseId: string, address = '5Seed'): Promise<void> {
  await addWatched(root, { address, network: 'bittensor', managed_by: `case:${caseId}` })
}

async function recordHit(root: string, address: string, runTimestamp: number, trigger = 'activity'): Promise<void> {
  const p = monitorPaths(root)
  await mkdir(p.logsDir, { recursive: true })
  await appendFile(p.watchlistHitsLog, JSON.stringify({
    run_timestamp: runTimestamp, address, network: 'bittensor', trigger, source_ref: `${address}|${runTimestamp}`,
  }) + '\n', 'utf8')
}

describe('isClosable truth table (labeled x dormant)', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('labeled=%s dormant=%s -> closable=%s', (labeled, dormant, closable) => {
    expect(isClosable({ labeled, dormant })).toBe(closable)
  })
})

describe('caseClosableStatus (label-lifecycle spec req 2)', () => {
  it('labeled + no recent activity on managed entries -> closable', async () => {
    const root = await ws()
    const c = await openScamCase(root, 'ring1')
    await labelCase(root, 'ring1')
    await manage(root, 'ring1')
    await recordHit(root, '5Seed', NOW - 31 * DAY_MS) // outside the 30-day window
    expect(await caseClosableStatus(root, c, 30, NOW)).toEqual({ case_id: 'ring1', labeled: true, dormant: true, closable: true })
  })

  it('a recent activity hit on a managed entry defeats dormancy', async () => {
    const root = await ws()
    const c = await openScamCase(root, 'ring1')
    await labelCase(root, 'ring1')
    await manage(root, 'ring1')
    await recordHit(root, '5Seed', NOW - 2 * DAY_MS)
    expect(await caseClosableStatus(root, c, 30, NOW)).toEqual({ case_id: 'ring1', labeled: true, dormant: false, closable: false })
  })

  it('no approved decision for the case -> not labeled, not closable (even when dormant)', async () => {
    const root = await ws()
    const c = await openScamCase(root, 'ring1')
    await manage(root, 'ring1')
    expect(await caseClosableStatus(root, c, 30, NOW)).toEqual({ case_id: 'ring1', labeled: false, dormant: true, closable: false })
  })

  it('not labeled + recent activity -> neither flag', async () => {
    const root = await ws()
    const c = await openScamCase(root, 'ring1')
    await manage(root, 'ring1')
    await recordHit(root, '5Seed', NOW - DAY_MS)
    expect(await caseClosableStatus(root, c, 30, NOW)).toEqual({ case_id: 'ring1', labeled: false, dormant: false, closable: false })
  })

  it('hits on unmanaged addresses or with non-activity triggers never defeat dormancy', async () => {
    const root = await ws()
    const c = await openScamCase(root, 'ring1')
    await labelCase(root, 'ring1')
    await manage(root, 'ring1')
    await recordHit(root, '5SomeoneElse', NOW - DAY_MS) // not a managed entry of this case
    await recordHit(root, '5Seed', NOW - DAY_MS, 'dust') // wrong trigger
    expect((await caseClosableStatus(root, c, 30, NOW)).closable).toBe(true)
  })
})

describe('statusText open-case list', () => {
  it('lists open cases and marks a labeled+dormant scam-topology case closable; stolen-funds lines carry no marker', async () => {
    const root = await ws()
    await openScamCase(root, 'ring1')
    await labelCase(root, 'ring1')
    await manage(root, 'ring1')
    await addCase(root, { case_id: 'theft9', type: 'stolen-funds', network: 'bittensor', seeds: ['5V'] }, NOW - DAY_MS)
    const status = await statusText(root, DEFAULT_MONITOR_CONFIG, NOW)
    expect(status).toContain('open cases: 2')
    expect(status).toContain('ring1 [scam-topology/bittensor] labeled=yes dormant=yes -> closable')
    expect(status).toContain('theft9 [stolen-funds/bittensor]')
    expect(status).not.toContain('theft9 [stolen-funds/bittensor] labeled')
  })

  it('a not-yet-labeled case shows the flags without the marker', async () => {
    const root = await ws()
    await openScamCase(root, 'ring2')
    const status = await statusText(root, DEFAULT_MONITOR_CONFIG, NOW)
    expect(status).toContain('ring2 [scam-topology/bittensor] labeled=no dormant=yes')
    expect(status).not.toContain('-> closable')
  })

  it('a closed case disappears from the open list', async () => {
    const root = await ws()
    await openScamCase(root, 'ring3')
    await closeCase(root, 'ring3', NOW)
    const status = await statusText(root, DEFAULT_MONITOR_CONFIG, NOW)
    expect(status).toContain('open cases: 0')
    expect(status).not.toContain('ring3 [')
  })
})
