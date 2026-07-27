// tests/monitor/review.test.ts
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { approveDoc, approvedAddressesForCase, docHash8, docKey, effectiveDecisions, listDecisionDocs, listPending, rejectDoc } from '../../src/monitor/review.js'
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
    status: 'complete', generated_at_timestamp: 1, query_count: 7,
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

describe('decision identity (lifecycle hardening R1)', () => {
  it('names decision files <docHash8>-<decision>.review.json from the workspace-relative path', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '100-mixer-bittensor.findings.json')
    await approveDoc(root, doc, 'ops', 500)
    const expected = createHash('sha256')
      .update('detections/100-mixer-bittensor.findings.json')
      .digest('hex').slice(0, 8)
    expect(docHash8(root, doc)).toBe(expected)
    const files = await readdir(monitorPaths(root).reviewsDir)
    expect(files).toContain(`${expected}-approve.review.json`)
  })

  it('same-millisecond decisions on different docs do not collide', async () => {
    const root = await ws()
    const a = await seedDoc(root, '100-mixer-bittensor.findings.json')
    const b = await seedDoc(root, '101-mixer-bittensor.findings.json')
    await approveDoc(root, a, 'ops', 500)
    await approveDoc(root, b, 'ops', 500) // identical timestamp — the old naming lost one
    expect(await listDecisionDocs(root)).toHaveLength(2)
    expect(await listPending(root)).toHaveLength(0)
  })

  it('records workspace-relative doc_path and still clears pending', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '102-mixer-bittensor.findings.json')
    await rejectDoc(root, doc, 'ops', 600)
    const [d] = await listDecisionDocs(root)
    expect(d.doc_path).toBe('detections/102-mixer-bittensor.findings.json')
    expect(await listPending(root)).toHaveLength(0)
  })

  it('a legacy decision with an ABSOLUTE doc_path still counts as decided', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '103-mixer-bittensor.findings.json')
    const dir = monitorPaths(root).reviewsDir
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, '600-reject.review.json'), JSON.stringify({
      doc_path: doc, decision: 'reject', reviewer: 'ops', decided_at_timestamp: 600, addresses: [], case_id: null,
    }) + '\n')
    expect(await listPending(root)).toHaveLength(0)
  })
})

describe('decision idempotency + --force supersede (R1)', () => {
  it('double-approve is refused', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '110-mixer-bittensor.findings.json')
    await approveDoc(root, doc, 'ops', 500)
    await expect(approveDoc(root, doc, 'ops', 600)).rejects.toThrow(/already has a review decision/)
    expect(await listDecisionDocs(root)).toHaveLength(1)
  })

  it('approve-after-reject is refused without --force', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '111-mixer-bittensor.findings.json')
    await rejectDoc(root, doc, 'ops', 500)
    await expect(approveDoc(root, doc, 'ops', 600)).rejects.toThrow(/already has a review decision/)
  })

  it('--force writes a NEW superseding decision, never overwriting the old file', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '112-mixer-bittensor.findings.json')
    await rejectDoc(root, doc, 'ops', 500)
    const before = await readdir(monitorPaths(root).reviewsDir)
    await approveDoc(root, doc, 'ops2', 600, { force: true })
    const after = await readdir(monitorPaths(root).reviewsDir)
    expect(after).toEqual(expect.arrayContaining(before)) // old file untouched
    expect(after.length).toBe(before.length + 1)
    const entries = await listDecisionDocs(root)
    const forced = entries.find((d) => d.decision === 'approve')!
    expect(forced.supersedes).toBe(before[0])
  })

  it('effectiveDecisions drops superseded decisions; export follows the live decision', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '113-mixer-bittensor.findings.json')
    await approveDoc(root, doc, 'ops', 500)
    await rejectDoc(root, doc, 'ops', 600, { force: true })
    const effective = await effectiveDecisions(root)
    expect(effective).toHaveLength(1)
    expect(effective[0].decision).toBe('reject')
    const { rows } = await exportLabels(root, 700)
    expect(rows).toHaveLength(0) // superseded approve no longer exports
  })
})

describe('reviewed-copy keying + detections guard (R1)', () => {
  it('keys the reviewed copy by doc identity, not bare basename', async () => {
    const root = await ws()
    const doc = await seedDoc(root, '120-mixer-bittensor.findings.json')
    const { reviewedCopy } = await approveDoc(root, doc, 'ops', 500)
    expect(path.basename(reviewedCopy)).toBe(`${docHash8(root, doc)}-120-mixer-bittensor.findings.json`)
    expect(path.dirname(reviewedCopy)).toBe(monitorPaths(root).reviewedDir)
  })

  it('refuses to approve a path outside the workspace detections/ tree', async () => {
    const root = await ws()
    await mkdir(path.join(root, 'elsewhere'), { recursive: true })
    const outside = path.join(root, 'elsewhere', 'x.findings.json')
    await writeFile(outside, JSON.stringify({ findings: [] }))
    await expect(approveDoc(root, outside, 'ops', 500)).rejects.toThrow(/detections\//)
    await expect(approveDoc(root, '../../../etc/passwd', 'ops', 500)).rejects.toThrow(/detections\//)
  })
})

describe('read-path tolerance (R5)', () => {
  it('listPending skips a malformed findings file with a warning instead of throwing', async () => {
    const root = await ws()
    await seedDoc(root, '130-mixer-bittensor.findings.json')
    await writeFile(path.join(monitorPaths(root).detectionsDir, '131-mixer-bittensor.findings.json'), '{ not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = await listPending(root)
    expect(pending).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('131-mixer-bittensor.findings.json'))
    warn.mockRestore()
  })
})

describe('empty findings documents (#232)', () => {
  it('an empty findings doc is not a pending review item', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-review-empty-'))
    const p = monitorPaths(root)
    await mkdir(p.detectionsDir, { recursive: true })
    const empty = { tool: 'aml_mixer_likeness', network: 'bittensor', generated_at_timestamp: 1, findings: [], warnings: ['suppressed 819 already-emitted finding(s)'] }
    const real = { tool: 'aml_mixer_likeness', network: 'bittensor', generated_at_timestamp: 2, findings: [{ address: '5A' }] }
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
        JSON.stringify({ tool: `aml_${cell}`, network: 'bittensor', generated_at_timestamp: 9, findings: [] }),
        'utf8',
      )
    }
    expect((await listPending(root)).length).toBe(before)
  })
})
