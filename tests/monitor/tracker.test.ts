// tests/monitor/tracker.test.ts
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { diffSnapshots, readSnapshots, traceCase, type CaseSnapshot } from '../../src/monitor/tracker.js'
import { addCase } from '../../src/monitor/cases.js'
import { approveDoc } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-tracker-'))
}

const PREV: CaseSnapshot = {
  case_id: 'c1', run_ms: 100, seed_set: ['seed1'],
  addresses: [{ address: 'seed1' }, { address: 'mule1', classification: 'propagated_scam' }],
}

describe('diffSnapshots (AC-12)', () => {
  it('baseline (prev null) emits no movements', () => {
    expect(diffSnapshots(null, PREV)).toEqual([])
  })

  it('yields the exact expected movement set for a moved-funds pair', () => {
    const next: CaseSnapshot = {
      case_id: 'c1', run_ms: 200, seed_set: ['seed1'],
      addresses: [
        ...PREV.addresses,
        { address: 'mule2', classification: 'propagated_scam' },
        { address: 'exch1', classification: 'exchange_terminal' },
        { address: 'dep1', gate: 'shared_deposit_exchange_infra' },
      ],
    }
    const moves = diffSnapshots(PREV, next)
    const byType = (t: string) => moves.filter((m) => m.type === t).map((m) => m.address)
    expect(byType('new_hop').sort()).toEqual(['dep1', 'exch1', 'mule2'])
    expect(byType('cashout_endpoint')).toEqual(['exch1'])
    expect(byType('new_deposit_endpoint')).toEqual(['dep1'])
    expect(byType('frontier_candidate')).toEqual(['mule2'])
  })

  it('unchanged snapshot yields zero movements (AC-11 second run)', () => {
    expect(diffSnapshots(PREV, { ...PREV, run_ms: 300 })).toEqual([])
  })
})

describe('traceCase (fake corridor)', () => {
  it('writes a snapshot, diffs against the previous one, maps alerts', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 50)
    const corridorOf = (addrs: Array<{ address: string; classification?: string }>) => async () => ({
      document: {
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
        status: 'complete', generated_at_ms: 0,
        findings: addrs.map((a) => ({ ...a, evidence: {}, truncated: false, inconclusive: false })),
      },
      summaryText: 'fake',
    })
    const first = await traceCase({} as Client, root, 'c1', 3, 100, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }]) })
    expect(first.movements_count).toBe(0) // baseline
    const second = await traceCase({} as Client, root, 'c1', 3, 200, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }, { address: 'exch1', classification: 'exchange_terminal' }]) })
    expect(second.movements_count).toBe(2) // new_hop + cashout_endpoint for exch1
    expect(second.alerts.map((a) => a.type).sort()).toEqual(['case_movement', 'cashout_endpoint'])
    expect(await readSnapshots(root, 'c1')).toHaveLength(2)
  })
})

describe('traceCase expansion seam (AC-13 approve → re-trace)', () => {
  it('an approved frontier candidate becomes a seed on the next trace, with no self movement', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 50)
    const corridorOf = (addrs: Array<{ address: string; classification?: string }>) => async () => ({
      document: {
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
        status: 'complete', generated_at_ms: 0,
        findings: addrs.map((a) => ({ ...a, evidence: {}, truncated: false, inconclusive: false })),
      },
      summaryText: 'fake',
    })

    // Run 1: baseline. No findings yet, so mule1 is not yet "known" — this is
    // the run that always emits zero movements regardless of content.
    const first = await traceCase({} as Client, root, 'c1', 3, 100, { corridor: corridorOf([]) })
    expect(first.movements_count).toBe(0)

    // Run 2: mule1 appears for the first time -> new_hop + frontier_candidate,
    // which is exactly the condition (frontier.length > 0) that makes
    // traceCase emit a case findings doc under detections/.
    const second = await traceCase({} as Client, root, 'c1', 3, 200, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }]) })
    expect(second.movements_count).toBeGreaterThan(0)
    expect(second.alerts.some((a) => a.type === 'frontier_candidate' && a.address === 'mule1')).toBe(true)

    const detDir = monitorPaths(root).detectionsDir
    const findingsDoc = (await readdir(detDir)).find((f) => f.includes('-case-c1-') && f.endsWith('.findings.json'))
    expect(findingsDoc).toBeDefined()

    // The human gate: approve the frontier candidate's findings doc.
    await approveDoc(root, path.join(detDir, findingsDoc!), 'ops', 250)

    // Run 3: mule1 is now an approved member of the case -> it joins the seed
    // set, and (being both known and a seed) generates no movement for itself.
    const third = await traceCase({} as Client, root, 'c1', 3, 300, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }]) })
    const latest = (await readSnapshots(root, 'c1')).at(-1)!
    expect(latest.seed_set).toContain('mule1')
    expect(third.movements_count).toBe(0)
    expect(third.alerts.some((a) => a.address === 'mule1')).toBe(false)
  })
})
