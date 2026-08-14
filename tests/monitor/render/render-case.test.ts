import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { caseRenderKey, renderAllCasesFromDoc, renderCaseFromDoc } from '../../../src/monitor/render/index.js'
import { addCase, addCaseSeeds, closeCase } from '../../../src/monitor/cases.js'
import { monitorPaths } from '../../../src/monitor/paths.js'

const NOW = 1_753_600_000_000
const CFG = { render: { dormant_after_days: 30 } }

async function ws(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cia-render-'))
  await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, NOW - 100)
  return root
}

describe('renderCaseFromDoc', () => {
  it('renders on first run: dossier, notes, timeline, state written; no client', async () => {
    const root = await ws()
    const outcome = await renderCaseFromDoc(root, 'c1', CFG, NOW)
    expect(outcome.rendered).toBe(true)
    const dossier = await readFile(path.join(root, 'published', 'cases', 'c1', 'dossier.md'), 'utf8')
    expect(dossier).toContain('# Case c1')
    expect(dossier).toContain('ACTIVE (last activity')
    const state = JSON.parse(await readFile(monitorPaths(root).renderStatePath, 'utf8'))
    expect(state.cases.c1.rendered_key).toBeTruthy()
  })

  it('unchanged case doc skips re-rendering', async () => {
    const root = await ws()
    await renderCaseFromDoc(root, 'c1', CFG, NOW)
    const second = await renderCaseFromDoc(root, 'c1', CFG, NOW + 10)
    expect(second.rendered).toBe(false)
    expect(second.skipped_reason).toBe('unchanged')
  })

  it('--force re-renders an unchanged case', async () => {
    const root = await ws()
    await renderCaseFromDoc(root, 'c1', CFG, NOW)
    const forced = await renderCaseFromDoc(root, 'c1', CFG, NOW + 10, { force: true })
    expect(forced.rendered).toBe(true)
  })

  it('a case-doc change (seed event) changes the render key and re-renders', async () => {
    const root = await ws()
    await renderCaseFromDoc(root, 'c1', CFG, NOW)
    const before = await caseRenderKey(root, 'c1')
    await addCaseSeeds(root, 'c1', ['seed2'], NOW + 1)
    expect(await caseRenderKey(root, 'c1')).not.toBe(before)
    expect((await renderCaseFromDoc(root, 'c1', CFG, NOW + 10)).rendered).toBe(true)
  })

  it('closed case is skipped with a reason', async () => {
    const root = await ws()
    await closeCase(root, 'c1', NOW)
    const outcome = await renderCaseFromDoc(root, 'c1', CFG, NOW)
    expect(outcome).toMatchObject({ rendered: false, skipped_reason: 'closed' })
  })
})

describe('renderAllCasesFromDoc', () => {
  it('walks open cases only and reports their outcomes', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c2', type: 'scam-topology', network: 'bittensor', seeds: ['s1'] }, NOW - 50)
    await closeCase(root, 'c2', NOW)
    const outcomes = await renderAllCasesFromDoc(root, CFG, NOW)
    expect(outcomes.map((o) => o.case_id)).toEqual(['c1'])
    expect(outcomes[0].rendered).toBe(true)
  })
})

describe('caseRenderKey', () => {
  it('is stable for an unchanged doc and flips on content change', async () => {
    const root = await ws()
    const a = await caseRenderKey(root, 'c1')
    const b = await caseRenderKey(root, 'c1')
    expect(a).toBe(b)
    const caseFile = path.join(monitorPaths(root).casesDir, 'c1', 'case.json')
    await writeFile(caseFile, '{"broken":true}', 'utf8')
    expect(await caseRenderKey(root, 'c1')).not.toBe(a)
  })
})