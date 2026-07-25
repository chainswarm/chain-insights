import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ingestNewDocs, rebuildStore, withStore } from '../../src/monitor/store.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { addCase } from '../../src/monitor/cases.js'
import { traceCase } from '../../src/monitor/tracker.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-store-'))
}

const DOC = {
  schema: 'chain-insights.detection-findings.v1',
  tool: 'aml_fake_token',
  network: 'bittensor_evm',
  status: 'complete',
  generated_at_ms: 1111,
  findings: [
    { address: '0xspoof', classification: 'fake_token_contract', evidence: {}, truncated: false, inconclusive: false },
    { address: '0xspoof2', classification: 'fake_token_contract', evidence: {}, truncated: false, inconclusive: false },
  ],
}

async function seedFindingsDoc(root: string): Promise<string> {
  const dir = monitorPaths(root).detectionsDir
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, '1111-fake-token-bittensor_evm.findings.json')
  await writeFile(file, JSON.stringify(DOC))
  return file
}

describe('monitor store', () => {
  it('ingests findings docs into findings + finding_addresses, idempotently (AC-1)', async () => {
    const root = await ws()
    await seedFindingsDoc(root)
    const first = await withStore(root, async (store) => ingestNewDocs(store, root))
    expect(first).toBe(1)
    const second = await withStore(root, async (store) => ingestNewDocs(store, root))
    expect(second).toBe(0)
    const rows = await withStore(root, async (store) => store.all('SELECT COUNT(*) AS n FROM findings'))
    expect(Number(rows[0].n)).toBe(2)
    const addrs = await withStore(root, async (store) =>
      store.all("SELECT address FROM finding_addresses ORDER BY address"))
    expect(addrs.map((r) => r.address)).toEqual(['0xspoof', '0xspoof2'])
  })

  it('rebuild reproduces identical contents from workspace JSON (AC-2)', async () => {
    const root = await ws()
    await seedFindingsDoc(root)
    await withStore(root, async (store) => ingestNewDocs(store, root))
    const before = await withStore(root, async (store) =>
      store.all('SELECT doc_path, address, classification FROM findings ORDER BY address'))
    await rebuildStore(root)
    const after = await withStore(root, async (store) =>
      store.all('SELECT doc_path, address, classification FROM findings ORDER BY address'))
    expect(after).toEqual(before)
  })

  it('reviewed copies under detections/reviewed/ are NOT ingested as new findings', async () => {
    const root = await ws()
    await seedFindingsDoc(root)
    const reviewedDir = monitorPaths(root).reviewedDir
    await mkdir(reviewedDir, { recursive: true })
    await writeFile(path.join(reviewedDir, '1111-fake-token-bittensor_evm.findings.json'), JSON.stringify({ ...DOC, reviewer: 'ops' }))
    const n = await withStore(root, async (store) => ingestNewDocs(store, root))
    expect(n).toBe(1)
  })

  it('ingests case_snapshots and derives case_movements for the new snapshot only, reproducibly under rebuild (snapshot ingest wiring)', async () => {
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
    // Snapshot 1 (baseline): seed1 + mule1.
    await traceCase({} as Client, root, 'c1', 3, 100, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }]) })
    // Snapshot 2: same as before, plus a new exchange_terminal address.
    await traceCase({} as Client, root, 'c1', 3, 200, { corridor: corridorOf([{ address: 'mule1', classification: 'propagated_scam' }, { address: 'exch1', classification: 'exchange_terminal' }]) })

    await withStore(root, async (store) => ingestNewDocs(store, root))

    const snaps = await withStore(root, async (store) =>
      store.all('SELECT case_id, run_ms, address_count FROM case_snapshots ORDER BY run_ms'))
    expect(snaps.map((s) => ({ case_id: s.case_id, run_ms: Number(s.run_ms), address_count: s.address_count }))).toEqual([
      { case_id: 'c1', run_ms: 100, address_count: 2 }, // seed1, mule1
      { case_id: 'c1', run_ms: 200, address_count: 3 }, // seed1, mule1, exch1
    ])

    const moves = await withStore(root, async (store) =>
      store.all('SELECT run_ms, movement, address FROM case_movements ORDER BY run_ms, movement, address'))
    // Baseline (run_ms=100) has no predecessor -> no movements. Snapshot 2
    // only yields movements for the newly-appeared exch1 address.
    expect(moves.map((m) => ({ run_ms: Number(m.run_ms), movement: m.movement, address: m.address }))).toEqual([
      { run_ms: 200, movement: 'cashout_endpoint', address: 'exch1' },
      { run_ms: 200, movement: 'new_hop', address: 'exch1' },
    ])

    await rebuildStore(root)
    const snapsAfter = await withStore(root, async (store) =>
      store.all('SELECT case_id, run_ms, address_count FROM case_snapshots ORDER BY run_ms'))
    const movesAfter = await withStore(root, async (store) =>
      store.all('SELECT run_ms, movement, address FROM case_movements ORDER BY run_ms, movement, address'))
    expect(snapsAfter.map((s) => ({ case_id: s.case_id, run_ms: Number(s.run_ms), address_count: s.address_count }))).toEqual(
      snaps.map((s) => ({ case_id: s.case_id, run_ms: Number(s.run_ms), address_count: s.address_count })),
    )
    expect(movesAfter.map((m) => ({ run_ms: Number(m.run_ms), movement: m.movement, address: m.address }))).toEqual(
      moves.map((m) => ({ run_ms: Number(m.run_ms), movement: m.movement, address: m.address })),
    )
  })
})
