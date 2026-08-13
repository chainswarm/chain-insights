import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderDossier, writeDossier } from '../../../src/monitor/render/dossier.js'
import type { MonitorCase } from '../../../src/monitor/cases.js'

const CASE: MonitorCase = {
  case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1', 'seed2'],
  status: 'open', created_at_timestamp: 1_750_000_000_000,
}
const VERDICT = { status: 'active' as const, lastActivityTimestamp: 1_753_500_000_000, headline: 'ACTIVE (last activity 2026-07-26)' }

const input = () => ({ monitorCase: CASE, verdict: VERDICT, mermaid: 'flowchart LR\n  a0["seed1"]', generatedAtTimestamp: 1_753_600_000_000 })

describe('renderDossier', () => {
  it('contains every required section', () => {
    const md = renderDossier(input())
    expect(md).toContain('ACTIVE (last activity 2026-07-26)')
    for (const section of ['## Seed set', '## Timeline']) {
      expect(md).toContain(section)
    }
    expect(md).toContain('```mermaid')
    expect(md).toContain('seed1, seed2')
    expect(md).toContain('timeline.md')
  })

  it('shows DORMANT headline verbatim', () => {
    const md = renderDossier({ ...input(), verdict: { status: 'dormant', lastActivityTimestamp: null, headline: 'DORMANT since 2026-06-01' } })
    expect(md).toContain('DORMANT since 2026-06-01')
  })

  it('escapes pipes in seed cells', () => {
    const md = renderDossier({ ...input(), monitorCase: { ...CASE, seeds: ['seed1', 'a|b'] } })
    expect(md).toContain('a\\|b')
  })
})

describe('writeDossier', () => {
  it('writes published/cases/<id>/dossier.md', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cia-dossier-'))
    const file = await writeDossier(root, 'c1', renderDossier(input()))
    expect(file).toBe(path.join(root, 'published', 'cases', 'c1', 'dossier.md'))
    expect(await readFile(file, 'utf8')).toContain('# Case c1')
  })
})