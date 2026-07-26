// tests/monitor/review.test.ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveDoc, approvedAddressesForCase, listPending, rejectDoc } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { exportLabels } from '../../src/monitor/export.js'

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
    // Not part of DETECTION_FINDINGS_SCHEMA at all (unlike query_count, which
    // IS a defined optional field) — a zod parse→serialize round trip would
    // strip this key. Its survival is the only thing that distinguishes the
    // mandated raw-JSON stamping from a forbidden parse-then-stamp path.
    x_custom_provenance: 'keep-me',
    findings: [{ address: 'mule2', classification: 'propagated_scam', evidence: {}, truncated: false, inconclusive: false }],
    ...extra,
  }))
  return file
}

describe('review workflow (AC-3)', () => {
  it('pending → approve stamps reviewer on a RAW copy preserving every key', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '100-case-c1-bittensor.findings.json')
    const originalBefore = await readFile(doc, 'utf8')
    expect(await listPending(root)).toHaveLength(1)
    const { reviewedCopy } = await approveDoc(root, doc, 'ops', 500)
    const copied = JSON.parse(await readFile(reviewedCopy, 'utf8'))
    expect(copied.reviewer).toBe('ops')
    expect(copied.query_count).toBe(7)
    expect(copied.x_custom_provenance).toBe('keep-me') // truly non-schema key survives — proves raw-JSON stamping, not parse→serialize
    expect(await listPending(root)).toHaveLength(0)

    // approveDoc must never mutate the original machine-produced doc.
    const originalAfter = await readFile(doc, 'utf8')
    expect(originalAfter).toBe(originalBefore)
    expect(JSON.parse(originalAfter).reviewer).toBeUndefined()
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

  it('approveDoc/rejectDoc reject an empty or whitespace reviewer', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '103-case-c1-bittensor.findings.json')
    await expect(approveDoc(root, doc, '  ', 800)).rejects.toThrow()
    await expect(rejectDoc(root, doc, '', 800)).rejects.toThrow()
  })

  it('approve with a RELATIVE docPath still clears from pending and does not duplicate the decision', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '104-case-c1-bittensor.findings.json')
    // Exactly what devkit/scripts/smoke-monitor.sh does: pass a path relative
    // to the current working directory (e.g. via `ls detections/...`), not
    // the absolute path listPending compares decisions against.
    const relativeDoc = path.relative(process.cwd(), doc)
    await approveDoc(root, relativeDoc, 'ops', 900)
    expect(await listPending(root)).toHaveLength(0)
    const { rows } = await exportLabels(root, 950)
    expect(rows).toHaveLength(1) // no duplicate decision doc from the path mismatch
  })
})

describe('empty findings documents (#232)', () => {
  it('an empty findings doc is not a pending review item', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-review-empty-'))
    const p = monitorPaths(root)
    await mkdir(p.detectionsDir, { recursive: true })
    const empty = { tool: 'aml_mixer_likeness', network: 'bittensor', generated_at_ms: 1, findings: [], warnings: ['suppressed 819 already-emitted finding(s)'] }
    const real = { tool: 'aml_mixer_likeness', network: 'bittensor', generated_at_ms: 2, findings: [{ address: '5A' }] }
    await writeFile(path.join(p.detectionsDir, '1-mixer-bittensor.findings.json'), JSON.stringify(empty), 'utf8')
    await writeFile(path.join(p.detectionsDir, '2-mixer-bittensor.findings.json'), JSON.stringify(real), 'utf8')

    const pending = await listPending(root)
    expect(pending).toHaveLength(1)
    expect(pending[0].findings_count).toBe(1)
  })

  it('a run producing only empty docs does not grow the pending count', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-review-empty-'))
    const p = monitorPaths(root)
    await mkdir(p.detectionsDir, { recursive: true })
    const before = (await listPending(root)).length
    for (const cell of ['mixer', 'fake-token', 'address-poisoning', 'attack-attribution']) {
      await writeFile(
        path.join(p.detectionsDir, `9-${cell}-bittensor.findings.json`),
        JSON.stringify({ tool: `aml_${cell}`, network: 'bittensor', generated_at_ms: 9, findings: [] }),
        'utf8',
      )
    }
    expect((await listPending(root)).length).toBe(before)
  })
})
