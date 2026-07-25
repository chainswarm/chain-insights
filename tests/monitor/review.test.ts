// tests/monitor/review.test.ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveDoc, approvedAddressesForCase, listPending, rejectDoc } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-review-'))
}

async function seedDoc(root: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = monitorPaths(root).detectionsDir
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify({
    schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
    status: 'complete', generated_at_ms: 1, query_count: 7,
    findings: [{ address: 'mule2', classification: 'propagated_scam', evidence: {}, truncated: false, inconclusive: false }],
    ...extra,
  }))
  return file
}

describe('review workflow (AC-3)', () => {
  it('pending → approve stamps reviewer on a RAW copy preserving every key', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '100-case-c1-bittensor.findings.json')
    expect(await listPending(root)).toHaveLength(1)
    const { reviewedCopy } = await approveDoc(root, doc, 'ops', 500)
    const copied = JSON.parse(await readFile(reviewedCopy, 'utf8'))
    expect(copied.reviewer).toBe('ops')
    expect(copied.query_count).toBe(7) // no zod round-trip stripped anything
    expect(await listPending(root)).toHaveLength(0)
  })

  it('reject records a decision without a reviewed copy', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '101-mixer-bittensor.findings.json')
    await rejectDoc(root, doc, 'ops', 600)
    expect(await listPending(root)).toHaveLength(0)
  })

  it('approvedAddressesForCase unions approve decisions for case docs (AC-13 input)', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '102-case-c1-bittensor.findings.json')
    await approveDoc(root, doc, 'ops', 700)
    expect(await approvedAddressesForCase(root, 'c1')).toEqual(['mule2'])
    expect(await approvedAddressesForCase(root, 'other')).toEqual([])
  })
})
