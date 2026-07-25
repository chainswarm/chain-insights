import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ingestNewDocs, rebuildStore, withStore } from '../../src/monitor/store.js'
import { monitorPaths } from '../../src/monitor/paths.js'

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
})
