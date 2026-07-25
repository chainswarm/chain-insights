// tests/monitor/tracker.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { diffSnapshots, readSnapshots, traceCase, type CaseSnapshot } from '../../src/monitor/tracker.js'
import { addCase } from '../../src/monitor/cases.js'

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
