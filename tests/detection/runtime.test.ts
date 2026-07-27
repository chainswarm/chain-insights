import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCheckpoint, writeCheckpoint } from '../../src/detection/checkpoint.js'
import { commitCheckpoint, runDetection, type DetectorScan } from '../../src/detection/runtime.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-detect-'))
}

const fakeScanner: DetectorScan = {
  tool: 'aml_fake_token',
  id: 'fake-token',
  scan: async (window) => [
    {
      address: `0xspoof-${window.fromTimestamp}`,
      classification: 'fake_token_contract',
      evidence: { from_timestamp: window.fromTimestamp, full: window.full },
      truncated: false,
      inconclusive: false,
    },
  ],
  thresholds: () => ({ ported_from: 'internal/recipes/faketoken.go' }),
}

describe('detection checkpoint', () => {
  it('missing checkpoint reads as scan-from-genesis', async () => {
    const root = await ws()
    const cp = await readCheckpoint(root, 'fake-token', 'ethereum')
    expect(cp.last_block_timestamp).toBe(0)
  })

  it('round-trips and advances', async () => {
    const root = await ws()
    await writeCheckpoint(root, {
      detector: 'fake-token',
      network: 'ethereum',
      last_block_timestamp: 12345,
      last_scanned_at_timestamp: 999,
    })
    const cp = await readCheckpoint(root, 'fake-token', 'ethereum')
    expect(cp.last_block_timestamp).toBe(12345)
  })
})

describe('runDetection', () => {
  it('builds a valid v1 document with reviewer UNSET (import gate preserved)', async () => {
    const root = await ws()
    const res = await runDetection(fakeScanner, {} as never, root, {
      network: 'ethereum',
      full: true,
      nowTimestamp: 1000,
    })
    expect(res.document.schema).toBe('chain-insights.detection-findings.v1')
    expect(res.document.tool).toBe('aml_fake_token')
    expect(res.document.findings).toHaveLength(1)
    // The gate-preserving invariant: NO reviewer on a machine-produced doc.
    expect('reviewer' in res.document).toBe(false)
    expect(res.document.threshold_provenance).toEqual({ ported_from: 'internal/recipes/faketoken.go' })
  })

  it('full scan uses window from 0; incremental uses the checkpoint', async () => {
    const root = await ws()
    await writeCheckpoint(root, {
      detector: 'fake-token',
      network: 'ethereum',
      last_block_timestamp: 500,
      last_scanned_at_timestamp: 500,
    })
    const full = await runDetection(fakeScanner, {} as never, root, { network: 'ethereum', full: true, nowTimestamp: 1000 })
    expect(full.document.findings[0].evidence.from_timestamp).toBe(0)
    const incr = await runDetection(fakeScanner, {} as never, root, { network: 'ethereum', full: false, nowTimestamp: 1000 })
    expect(incr.document.findings[0].evidence.from_timestamp).toBe(500)
  })

  it('commitCheckpoint advances only when called (post-write)', async () => {
    const root = await ws()
    await runDetection(fakeScanner, {} as never, root, { network: 'ethereum', full: true, nowTimestamp: 2000 })
    // Not committed yet → still genesis.
    expect((await readCheckpoint(root, 'fake-token', 'ethereum')).last_block_timestamp).toBe(0)
    await commitCheckpoint(root, fakeScanner, 'ethereum', 2000)
    expect((await readCheckpoint(root, 'fake-token', 'ethereum')).last_block_timestamp).toBe(2000)
  })
})
