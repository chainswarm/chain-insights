import { appendFile, cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ingestNewDocs, rebuildStore, withStore } from '../../src/monitor/store.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { addCase } from '../../src/monitor/cases.js'
import { traceCase } from '../../src/monitor/tracker.js'
import { addWatched } from '../../src/monitor/watchlist.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-store-'))
}

const DOC = {
  schema: 'chain-insights.detection-findings.v1',
  tool: 'aml_fake_token',
  network: 'bittensor_evm',
  status: 'complete',
  generated_at_timestamp: 1111,
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
        status: 'complete', generated_at_timestamp: 0,
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
      store.all('SELECT case_id, run_timestamp, address_count FROM case_snapshots ORDER BY run_timestamp'))
    expect(snaps.map((s) => ({ case_id: s.case_id, run_timestamp: Number(s.run_timestamp), address_count: s.address_count }))).toEqual([
      { case_id: 'c1', run_timestamp: 100, address_count: 2 }, // seed1, mule1
      { case_id: 'c1', run_timestamp: 200, address_count: 3 }, // seed1, mule1, exch1
    ])

    const moves = await withStore(root, async (store) =>
      store.all('SELECT run_timestamp, movement, address FROM case_movements ORDER BY run_timestamp, movement, address'))
    // Baseline (run_timestamp=100) has no predecessor -> no movements. Snapshot 2
    // only yields movements for the newly-appeared exch1 address.
    expect(moves.map((m) => ({ run_timestamp: Number(m.run_timestamp), movement: m.movement, address: m.address }))).toEqual([
      { run_timestamp: 200, movement: 'cashout_endpoint', address: 'exch1' },
      { run_timestamp: 200, movement: 'new_hop', address: 'exch1' },
    ])

    await rebuildStore(root)
    const snapsAfter = await withStore(root, async (store) =>
      store.all('SELECT case_id, run_timestamp, address_count FROM case_snapshots ORDER BY run_timestamp'))
    const movesAfter = await withStore(root, async (store) =>
      store.all('SELECT run_timestamp, movement, address FROM case_movements ORDER BY run_timestamp, movement, address'))
    expect(snapsAfter.map((s) => ({ case_id: s.case_id, run_timestamp: Number(s.run_timestamp), address_count: s.address_count }))).toEqual(
      snaps.map((s) => ({ case_id: s.case_id, run_timestamp: Number(s.run_timestamp), address_count: s.address_count })),
    )
    expect(movesAfter.map((m) => ({ run_timestamp: Number(m.run_timestamp), movement: m.movement, address: m.address }))).toEqual(
      moves.map((m) => ({ run_timestamp: Number(m.run_timestamp), movement: m.movement, address: m.address })),
    )
  })

  it('watchlist.json populates the watchlist table and survives rebuild (AC-8)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Treasury', network: 'bittensor', note: 'cold' })
    await rebuildStore(root)
    const rows = await withStore(root, async (s) =>
      s.all('SELECT address, network, note FROM watchlist ORDER BY address'),
    )
    expect(rows).toEqual([{ address: '5Treasury', network: 'bittensor', note: 'cold' }])
  })

  it('rebuild does not duplicate watchlist rows', async () => {
    const root = await ws()
    await addWatched(root, { address: '5A', network: 'bittensor' })
    await rebuildStore(root)
    await rebuildStore(root)
    const rows = await withStore(root, async (s) => s.all('SELECT count(*) AS n FROM watchlist'))
    expect(Number(rows[0].n)).toBe(1)
  })
})

describe('ingestNewDocs quarantine', () => {
  it('renames a malformed doc to .corrupt and ingests the rest (torn doc proceeds)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-store-'))
    const p = monitorPaths(root)
    await mkdir(p.runsDir, { recursive: true })
    // Torn doc: truncated JSON, as left by a crash mid-write pre-atomic-writes.
    await writeFile(path.join(p.runsDir, '1000.run.json'), '{"run_timestamp": 1000, "cells": [', 'utf8')
    await writeFile(path.join(p.runsDir, '2000.run.json'), JSON.stringify({ run_timestamp: 2000, cells: [] }) + '\n', 'utf8')
    const n = await withStore(root, (s) => ingestNewDocs(s, root))
    expect(n).toBe(1)
    const files = (await readdir(p.runsDir)).sort()
    expect(files).toEqual(['1000.run.json.corrupt', '2000.run.json'])
    // Rebuild also proceeds and does not resurrect the corrupt doc.
    await rebuildStore(root)
    const rows = await withStore(root, (s) => s.all('SELECT run_timestamp FROM scan_runs'), { readOnly: true })
    expect(rows).toHaveLength(1)
  })
})

describe('incremental JSONL replay (spec req 5)', () => {
  const line = (i: number) => JSON.stringify({ alert_id: `a-${i}`, type: 'new_findings', network: 'bittensor', run_timestamp: i, emitted_at_timestamp: i })

  it('ingests only new bytes on the second pass and holds back a torn tail', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-inc-'))
    const p = monitorPaths(root)
    await mkdir(p.alertsDir, { recursive: true })
    await writeFile(p.alertsLog, line(1) + '\n' + line(2) + '\n', 'utf8')
    await withStore(root, async (s) => {
      await ingestNewDocs(s, root)
      expect(await s.all('SELECT alert_id FROM alerts ORDER BY alert_id')).toHaveLength(2)
      // Cursor keys are workspace-relative (R6).
      const [cur] = await s.all('SELECT byte_offset FROM replay_cursors WHERE doc_path = $1', ['.chain-insights/monitor/alerts/alerts.jsonl'])
      expect(Number(cur.byte_offset)).toBe(Buffer.byteLength(line(1) + '\n' + line(2) + '\n'))
    })
    // Append one full line and one torn (no newline) line.
    await appendFile(p.alertsLog, line(3) + '\n' + line(4).slice(0, 10), 'utf8')
    await withStore(root, async (s) => {
      await ingestNewDocs(s, root)
      const rows = await s.all('SELECT alert_id FROM alerts ORDER BY alert_id')
      expect(rows.map((r) => r.alert_id)).toEqual(['a-1', 'a-2', 'a-3'])
    })
    // Complete the torn line; only it is ingested (no duplicates of 1-3).
    await appendFile(p.alertsLog, line(4).slice(10) + '\n', 'utf8')
    await withStore(root, async (s) => {
      await ingestNewDocs(s, root)
      const rows = await s.all('SELECT alert_id FROM alerts ORDER BY alert_id')
      expect(rows.map((r) => r.alert_id)).toEqual(['a-1', 'a-2', 'a-3', 'a-4'])
    })
  })

  it('rebuildStore remains full replay from zero', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-inc-'))
    const p = monitorPaths(root)
    await mkdir(p.alertsDir, { recursive: true })
    await writeFile(p.alertsLog, line(1) + '\n' + line(2) + '\n', 'utf8')
    await withStore(root, (s) => ingestNewDocs(s, root))
    await rebuildStore(root)
    const rows = await withStore(root, (s) => s.all('SELECT alert_id FROM alerts'), { readOnly: true })
    expect(rows).toHaveLength(2)
  })
})

describe('workspace-relative doc keys (R6)', () => {
  it('ingest records relative keys, and moving the workspace does not re-ingest', async () => {
    const rootA = await ws()
    await seedFindingsDoc(rootA)
    await withStore(rootA, (s) => ingestNewDocs(s, rootA))
    const rootB = path.join(await ws(), 'moved')
    await cp(rootA, rootB, { recursive: true })
    await rm(path.join(rootB, '.chain-insights', 'monitor', 'monitor.duckdb.wal'), { force: true })
    const again = await withStore(rootB, (s) => ingestNewDocs(s, rootB))
    expect(again).toBe(0) // relative key matches at the new location — no duplicate ingest
    await withStore(rootB, async (s) => {
      const rows = await s.all('SELECT doc_path FROM ingested_docs')
      for (const r of rows) expect(path.isAbsolute(String(r.doc_path))).toBe(false)
    }, { readOnly: true })
  })

  it('migrates legacy absolute keys transparently on store open', async () => {
    const root = await ws()
    const abs = path.join(root, 'detections', '201-mixer-bittensor.findings.json')
    await withStore(root, async (s) => {
      await s.run('INSERT INTO ingested_docs VALUES ($1,$2)', [abs, 'findings'])
      await s.run('INSERT INTO finding_addresses VALUES ($1,$2,$3)', [abs, 'bittensor', 'mule2'])
      await s.run('INSERT INTO watchlist_hits VALUES ($1,$2,$3,$4,$5,$6)', [1, 'mule2', 'bittensor', 'finding', abs, null])
    })
    await withStore(root, async (s) => {
      const [d] = await s.all('SELECT doc_path FROM ingested_docs')
      expect(d.doc_path).toBe('detections/201-mixer-bittensor.findings.json')
      const [h] = await s.all(`SELECT source_ref FROM watchlist_hits WHERE trigger = 'finding'`)
      expect(h.source_ref).toBe('detections/201-mixer-bittensor.findings.json')
    })
  })
})
