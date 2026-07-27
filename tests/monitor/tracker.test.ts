// tests/monitor/tracker.test.ts
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { diffScopeExpansion, diffSnapshots, readSnapshots, traceCase, type CaseSnapshot } from '../../src/monitor/tracker.js'
import { addCase, addCaseSeeds } from '../../src/monitor/cases.js'
import { approveDoc } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-tracker-'))
}

const PREV: CaseSnapshot = {
  case_id: 'c1', run_timestamp: 100, seed_set: ['seed1'],
  addresses: [{ address: 'seed1' }, { address: 'mule1', classification: 'propagated_scam' }],
}

describe('diffSnapshots (AC-12)', () => {
  it('baseline (prev null) emits no movements', () => {
    expect(diffSnapshots(null, PREV)).toEqual([])
  })

  it('yields the exact expected movement set for a moved-funds pair', () => {
    const next: CaseSnapshot = {
      case_id: 'c1', run_timestamp: 200, seed_set: ['seed1'],
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
    expect(diffSnapshots(PREV, { ...PREV, run_timestamp: 300 })).toEqual([])
  })
})

// UAT U7 (spec-marked "(unit)"): the synthetic moved-funds snapshot pair. The
// devkit fixture is static, so no real case ever moves funds between two runs
// -- the devkit smoke asserts exactly that and SKIPs U7 with a pointer here.
// diffSnapshots above proves the movement set; this proves the movement set
// reaches the ALERT stream as a cashout, which is what an operator sees.
describe('U7 moved-funds snapshot pair -> cashout alert', () => {
  it('a moved-funds snapshot pair emits the cashout alert, not just the movement (U7)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'u7', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 50)
    const corridorOf = (addrs: Array<{ address: string; classification?: string; gate?: string }>) => async () => ({
      document: {
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
        status: 'complete', generated_at_timestamp: 0,
        findings: addrs.map((a) => ({ ...a, evidence: {}, truncated: false, inconclusive: false })),
      },
      summaryText: 'fake',
    })

    // Snapshot 1: funds sit one hop from the seed.
    const before = await traceCase({} as Client, root, 'u7', 3, 100, {
      corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }]),
    })
    expect(before.movements_count).toBe(0) // baseline emits nothing

    // Snapshot 2: the funds MOVED -- on to a second mule, into a shared
    // deposit endpoint, and out through an exchange terminal.
    const after = await traceCase({} as Client, root, 'u7', 3, 200, {
      corridor: corridorOf([
        { address: 'mule1', classification: 'propagated_scam' },
        { address: 'mule2', classification: 'propagated_scam' },
        { address: 'dep1', gate: 'shared_deposit_exchange_infra' },
        { address: 'exch1', classification: 'exchange_terminal' },
      ]),
    })

    // The exact expected movements for the pair: three new hops (dep1, exch1,
    // mule2), plus the deposit-endpoint, cashout and frontier classifications
    // layered on top of them.
    expect(after.movements_count).toBe(6)
    const byType = (t: string) =>
      after.alerts.filter((a) => a.type === t).map((a) => a.address).sort()
    // dep1 appears twice: once as a new hop, once as the deposit endpoint --
    // both map to the generic movement alert type.
    expect(byType('case_movement')).toEqual(['dep1', 'dep1', 'exch1', 'mule2'])
    // The cashout is its own alert type, addressed to the terminal -- not
    // folded into the generic movement stream.
    expect(byType('cashout_endpoint')).toEqual(['exch1'])
    expect(byType('frontier_candidate')).toEqual(['mule2'])
    expect(after.alerts.every((a) => a.case_id === 'u7' && a.network === 'bittensor' && a.run_timestamp === 200)).toBe(true)
  })
})

// chain-insights#250: the aperture widened, the funds did not move.
describe('seed addition is scope expansion, not movement', () => {
  const PREV_1SEED: CaseSnapshot = {
    case_id: 'c1', run_timestamp: 100, seed_set: ['seedA'],
    addresses: [{ address: 'seedA' }, { address: 'mule1', classification: 'propagated_scam', via_seeds: ['seedA'] }],
  }
  // seedB was added between the two runs; its corridor exposes two addresses
  // that were ALWAYS there and one hop that the OLD aperture also now reaches.
  const NEXT_2SEEDS: CaseSnapshot = {
    case_id: 'c1', run_timestamp: 200, seed_set: ['seedA', 'seedB'],
    seeds_added_at_timestamp: { seedB: 150 },
    addresses: [
      { address: 'seedA' }, { address: 'seedB' },
      { address: 'mule1', classification: 'propagated_scam', via_seeds: ['seedA', 'seedB'] },
      { address: 'onlyViaB', classification: 'propagated_scam', via_seeds: ['seedB'] },
      { address: 'depViaB', gate: 'shared_deposit_exchange_infra', via_seeds: ['seedB'] },
      { address: 'realHop', classification: 'exchange_terminal', via_seeds: ['seedA'] },
    ],
  }

  it('reports no movement for addresses visible only through the new seed', () => {
    const moves = diffSnapshots(PREV_1SEED, NEXT_2SEEDS)
    // Only realHop moved: the pre-existing seedA reaches it now and did not
    // before. onlyViaB / depViaB are aperture, not movement.
    expect(moves.filter((m) => m.type === 'new_hop').map((m) => m.address)).toEqual(['realHop'])
    expect(moves.map((m) => m.address).sort()).toEqual(['realHop', 'realHop'])
    expect(moves.some((m) => m.address === 'onlyViaB' || m.address === 'depViaB')).toBe(false)
  })

  it('reports those addresses as scope expansion, with the seed and its timestamp', () => {
    const grown = diffScopeExpansion(PREV_1SEED, NEXT_2SEEDS)
    expect(grown.map((m) => m.address).sort()).toEqual(['depViaB', 'onlyViaB'])
    expect(grown.every((m) => m.type === 'scope_expansion')).toBe(true)
    expect(grown.find((m) => m.address === 'onlyViaB')!.details).toMatchObject({
      via_seeds: ['seedB'], seeds_added_at_timestamp: [150],
    })
    // Genuine movement is never double-counted as expansion.
    expect(grown.some((m) => m.address === 'realHop')).toBe(false)
  })

  it('an address reachable from a PRE-EXISTING seed stays a movement', () => {
    const moves = diffSnapshots(PREV_1SEED, NEXT_2SEEDS)
    expect(moves.some((m) => m.type === 'cashout_endpoint' && m.address === 'realHop')).toBe(true)
  })

  it('legacy snapshots without via_seeds are not suppressed (no silent under-reporting)', () => {
    const legacy: CaseSnapshot = {
      ...NEXT_2SEEDS,
      addresses: NEXT_2SEEDS.addresses.map(({ via_seeds: _ignored, ...rest }) => rest),
    }
    expect(diffSnapshots(PREV_1SEED, legacy).filter((m) => m.type === 'new_hop').map((m) => m.address).sort())
      .toEqual(['depViaB', 'onlyViaB', 'realHop'])
    expect(diffScopeExpansion(PREV_1SEED, legacy)).toEqual([])
  })

  it('end to end: addCaseSeeds then re-trace emits zero movements and a scope_expansion alert', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'e2e', type: 'stolen-funds', network: 'bittensor', seeds: ['seedA'] }, 50)
    // The corridor is a pure function of the seed: seedA sees mule1, seedB sees
    // a hidden branch. Nothing MOVES between the two runs.
    const corridor = async (_c: unknown, o: { seedAddress: string }) => ({
      document: {
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
        status: 'complete', generated_at_timestamp: 0,
        findings: (o.seedAddress === 'seedA'
          ? [{ address: 'mule1', classification: 'propagated_scam' }]
          : [{ address: 'hidden1', classification: 'propagated_scam' }, { address: 'hiddenExch', classification: 'exchange_terminal' }]
        ).map((a) => ({ ...a, evidence: {}, truncated: false, inconclusive: false })),
      },
      summaryText: 'fake',
    })

    const first = await traceCase({} as Client, root, 'e2e', 3, 100, { corridor: corridor as never })
    expect(first.movements_count).toBe(0)

    await addCaseSeeds(root, 'e2e', ['seedB'], 150, { note: 'operator wallet identified' })

    const second = await traceCase({} as Client, root, 'e2e', 3, 200, { corridor: corridor as never })
    // THE assertion: a widened aperture manufactures no movement.
    expect(second.movements_count).toBe(0)
    expect(second.alerts.some((a) => a.type === 'case_movement')).toBe(false)
    // It is still surfaced — as expansion, and as the review-worthy signals.
    expect(second.scope_expansions_count).toBe(2)
    expect(second.alerts.filter((a) => a.type === 'case_scope_expansion').map((a) => a.address).sort())
      .toEqual(['hidden1', 'hiddenExch'])
    expect(second.alerts.some((a) => a.type === 'frontier_candidate' && a.address === 'hidden1')).toBe(true)
    expect(second.alerts.some((a) => a.type === 'cashout_endpoint' && a.address === 'hiddenExch')).toBe(true)

    // A third, unchanged run is quiet again: the expansion is baseline now.
    const third = await traceCase({} as Client, root, 'e2e', 3, 300, { corridor: corridor as never })
    expect(third.movements_count).toBe(0)
    expect(third.scope_expansions_count).toBe(0)
    expect(third.alerts).toEqual([])
  })
})

describe('traceCase (fake corridor)', () => {
  it('writes a snapshot, diffs against the previous one, maps alerts', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, 50)
    const corridorOf = (addrs: Array<{ address: string; classification?: string }>) => async () => ({
      document: {
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
        status: 'complete', generated_at_timestamp: 0,
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
        status: 'complete', generated_at_timestamp: 0,
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
