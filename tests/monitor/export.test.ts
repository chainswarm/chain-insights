// tests/monitor/export.test.ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { exportLabels } from '../../src/monitor/export.js'
import { approveDoc } from '../../src/monitor/review.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-export-'))
}

describe('exportLabels (AC-4)', () => {
  it('exports approved findings only, JSON + CSV', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    const approved = path.join(dir, '1-mixer-bittensor.findings.json')
    await writeFile(approved, JSON.stringify({
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor', status: 'complete', generated_at_timestamp: 1,
      findings: [{ address: 'mix1', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    }))
    await writeFile(path.join(dir, '2-mixer-bittensor.findings.json'), JSON.stringify({
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor', status: 'complete', generated_at_timestamp: 2,
      findings: [{ address: 'notapproved', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    }))
    await approveDoc(root, approved, 'ops', 100)
    const { rows, csvPath } = await exportLabels(root, 999)
    expect(rows).toEqual([{ address: 'mix1', network: 'bittensor', label: 'mixer_hourglass', source_tool: 'aml_mixer_likeness', reviewer: 'ops', decided_at_timestamp: 100 }])
    const csv = await readFile(csvPath, 'utf8')
    expect(csv.split('\n')[0]).toBe('address,network,label,source_tool,reviewer,decided_at_timestamp')
    expect(csv).toContain('mix1,bittensor,mixer_hourglass')
  })

  it('exportLabels skips a decision whose reviewed copy is unreadable, keeping the rest (R5)', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    const seed = async (name: string, address: string): Promise<string> => {
      const file = path.join(dir, name)
      await writeFile(file, JSON.stringify({
        schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor', status: 'complete', generated_at_timestamp: 1,
        findings: [{ address, classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
      }))
      return file
    }
    const good = await seed('140-mixer-bittensor.findings.json', 'mule2')
    const bad = await seed('141-mixer-bittensor.findings.json', 'mule3')
    await approveDoc(root, good, 'ops', 500)
    const { reviewedCopy } = await approveDoc(root, bad, 'ops', 600)
    await rm(reviewedCopy) // decision exists, copy gone
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rows } = await exportLabels(root, 700)
    expect(rows.map((r) => r.address)).toEqual(['mule2']) // only the good doc's finding
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
