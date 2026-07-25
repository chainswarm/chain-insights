// tests/monitor/export.test.ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor', status: 'complete', generated_at_ms: 1,
      findings: [{ address: 'mix1', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    }))
    await writeFile(path.join(dir, '2-mixer-bittensor.findings.json'), JSON.stringify({
      schema: 'chain-insights.detection-findings.v1', tool: 'aml_mixer_likeness', network: 'bittensor', status: 'complete', generated_at_ms: 2,
      findings: [{ address: 'notapproved', classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
    }))
    await approveDoc(root, approved, 'ops', 100)
    const { rows, csvPath } = await exportLabels(root, 999)
    expect(rows).toEqual([{ address: 'mix1', network: 'bittensor', label: 'mixer_hourglass', source_tool: 'aml_mixer_likeness', reviewer: 'ops', decided_at_ms: 100 }])
    const csv = await readFile(csvPath, 'utf8')
    expect(csv.split('\n')[0]).toBe('address,network,label,source_tool,reviewer,decided_at_ms')
    expect(csv).toContain('mix1,bittensor,mixer_hourglass')
  })
})
