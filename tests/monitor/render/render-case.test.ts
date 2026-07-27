import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { caseRenderKey, renderCase } from '../../../src/monitor/render/index.js'
import { addCase, closeCase } from '../../../src/monitor/cases.js'
import { DEFAULT_MONITOR_CONFIG } from '../../../src/monitor/config.js'
import { writeTraceDoc } from '../../../src/monitor/render/trace-io.js'
import { monitorPaths } from '../../../src/monitor/paths.js'

const client = {} as Client
const NOW = 1_753_600_000

async function ws(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cia-render-'))
  await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'] }, NOW - 100)
  return root
}

function fakeTraceStep(root: string) {
  return vi.fn(async () => {
    await writeTraceDoc(root, 'c1', 'victim', NOW, {
      schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds', network: 'bittensor',
      addresses: [{ address: 'seed1', roles: ['victim'] }, { address: 'exch1', roles: ['exchange'], labels: ['Binance'] }],
      edges: [{ edge_id: 'e1', from_address: 'seed1', to_address: 'exch1', amount_usd_sum: 9, last_seen_timestamp: NOW - 86400 }],
      paths: [{ path_id: 'p1', direction: 'forward', source: 'seed1', target: 'exch1', addresses: ['seed1', 'exch1'], edge_ids: ['e1'], hops: 1, terminal_role: 'exchange', amount_usd_sum: 9 }],
    })
    return { reportArtifacts: ['reports/fake.graph.html'] }
  })
}

describe('renderCase', () => {
  it('renders on first run: dossier, notes, state written', async () => {
    const root = await ws()
    const traceStep = fakeTraceStep(root)
    const outcome = await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW, {}, { traceStep })
    expect(outcome.rendered).toBe(true)
    expect(traceStep).toHaveBeenCalledOnce()
    const dossier = await readFile(path.join(root, 'published', 'cases', 'c1', 'dossier.md'), 'utf8')
    expect(dossier).toContain('ACTIVE (last movement')
    const state = JSON.parse(await readFile(monitorPaths(root).renderStatePath, 'utf8'))
    expect(state.cases.c1.rendered_key).toBeTruthy()
  })

  it('unchanged case skips tracing and rendering', async () => {
    const root = await ws()
    const traceStep = fakeTraceStep(root)
    await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW, {}, { traceStep })
    const second = await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW + 10, {}, { traceStep })
    expect(second.rendered).toBe(false)
    expect(second.skipped_reason).toBe('unchanged')
    expect(traceStep).toHaveBeenCalledOnce()
  })

  it('--force re-traces and re-renders an unchanged case', async () => {
    const root = await ws()
    const traceStep = fakeTraceStep(root)
    await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW, {}, { traceStep })
    const forced = await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW + 10, { force: true }, { traceStep })
    expect(forced.rendered).toBe(true)
    expect(traceStep).toHaveBeenCalledTimes(2)
  })

  it('case change (new snapshot) changes the render key and re-renders', async () => {
    const root = await ws()
    const before = await caseRenderKey(root, 'c1')
    const snapDir = path.join(monitorPaths(root).casesDir, 'c1', 'snapshots')
    await mkdir(snapDir, { recursive: true })
    await writeFile(path.join(snapDir, `${NOW}.snapshot.json`), JSON.stringify({ case_id: 'c1', run_timestamp: NOW, seed_set: ['seed1'], addresses: [] }), 'utf8')
    expect(await caseRenderKey(root, 'c1')).not.toBe(before)
  })

  it('closed case is skipped', async () => {
    const root = await ws()
    await closeCase(root, 'c1', NOW)
    const outcome = await renderCase(client, root, 'c1', DEFAULT_MONITOR_CONFIG, NOW, {}, { traceStep: fakeTraceStep(root) })
    expect(outcome).toMatchObject({ rendered: false, skipped_reason: 'closed' })
  })
})
