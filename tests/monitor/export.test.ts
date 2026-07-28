// tests/monitor/export.test.ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CURATED_LABELS_SCHEMA, exportLabels } from '../../src/monitor/export.js'
import { approveDoc, docHash8 } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-export-'))
}

const HEADER = 'address,network,label,case_id,decision_id,doc_ref,decided_at_timestamp,reviewer'

async function writeDoc(root: string, name: string, doc: Record<string, unknown>): Promise<string> {
  const dir = monitorPaths(root).detectionsDir
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify(doc))
  return file
}

describe('curated-labels.v1 export (label-lifecycle spec req 1)', () => {
  it('golden: an approved case doc exports role rows with full provenance columns; unknown roles are skipped with a warning', async () => {
    const root = await ws()
    const doc = await writeDoc(root, '1-case-ring1-bittensor.findings.json', {
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_scam_corridor_trace', network: 'bittensor',
      status: 'complete', generated_at_timestamp: 1,
      findings: [
        { address: 'seedX', role: 'seed', evidence: {}, truncated: false, inconclusive: false },
        { address: 'muleX', role: 'candidate_intermediate', classification: 'propagated_scam', evidence: {}, truncated: false, inconclusive: false },
        { address: 'depX', role: 'candidate_deposit', gate: 'shared_deposit_exchange_infra', evidence: {}, truncated: false, inconclusive: false },
        { address: 'oddX', role: 'made_up_role', evidence: {}, truncated: false, inconclusive: false },
      ],
    })
    await approveDoc(root, doc, 'ops', 100)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rows, jsonPath, csvPath } = await exportLabels(root, 999)
    const decisionId = `${docHash8(root, doc)}-approve`
    const docRef = 'detections/1-case-ring1-bittensor.findings.json'
    expect(rows).toEqual([
      { address: 'seedX', network: 'bittensor', label: 'scam_seed', case_id: 'ring1', decision_id: decisionId, doc_ref: docRef, decided_at_timestamp: 100, reviewer: 'ops' },
      { address: 'muleX', network: 'bittensor', label: 'mule', case_id: 'ring1', decision_id: decisionId, doc_ref: docRef, decided_at_timestamp: 100, reviewer: 'ops' },
      { address: 'depX', network: 'bittensor', label: 'deposit_endpoint', case_id: 'ring1', decision_id: decisionId, doc_ref: docRef, decided_at_timestamp: 100, reviewer: 'ops' },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('made_up_role'))
    warn.mockRestore()
    const envelope = JSON.parse(await readFile(jsonPath, 'utf8'))
    expect(envelope.schema).toBe(CURATED_LABELS_SCHEMA)
    expect(envelope.generated_at_timestamp).toBe(999)
    expect(envelope.rows).toEqual(rows)
    const csv = (await readFile(csvPath, 'utf8')).split('\n')
    expect(csv[0]).toBe(HEADER)
    expect(csv[1]).toBe(`seedX,bittensor,scam_seed,ring1,${decisionId},${docRef},100,ops`)
  })

  it('golden: an approved lane-A detector doc keeps its classification as the label, with an EMPTY case_id', async () => {
    const root = await ws()
    const doc = await writeDoc(root, '1-mixer-bittensor.findings.json', {
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor',
      status: 'complete', generated_at_timestamp: 1,
      findings: [{ address: 'mix1', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    })
    await writeDoc(root, '2-mixer-bittensor.findings.json', {
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor',
      status: 'complete', generated_at_timestamp: 2,
      findings: [{ address: 'notapproved', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    })
    await approveDoc(root, doc, 'ops', 100)
    const { rows, csvPath } = await exportLabels(root, 999)
    expect(rows).toEqual([{
      address: 'mix1', network: 'bittensor', label: 'mixer_hourglass', case_id: '',
      decision_id: `${docHash8(root, doc)}-approve`, doc_ref: 'detections/1-mixer-bittensor.findings.json',
      decided_at_timestamp: 100, reviewer: 'ops',
    }])
    const csv = await readFile(csvPath, 'utf8')
    expect(csv).toContain('mix1,bittensor,mixer_hourglass,,')
  })

  it('skips a decision whose reviewed copy is unreadable, keeping the rest (R5 tolerance preserved)', async () => {
    const root = await ws()
    const mkDoc = (address: string) => ({
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor',
      status: 'complete', generated_at_timestamp: 1,
      findings: [{ address, classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    })
    const good = await writeDoc(root, '140-mixer-bittensor.findings.json', mkDoc('mule2'))
    const bad = await writeDoc(root, '141-mixer-bittensor.findings.json', mkDoc('mule3'))
    await approveDoc(root, good, 'ops', 500)
    const { reviewedCopy } = await approveDoc(root, bad, 'ops', 600)
    await rm(reviewedCopy) // decision exists, copy gone
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rows } = await exportLabels(root, 700)
    expect(rows.map((r) => r.address)).toEqual(['mule2'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
