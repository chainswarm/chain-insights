import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fundsDestinationSummary, renderDossier, writeDossier } from '../../../src/monitor/render/dossier.js'
import type { TraceV1Doc } from '../../../src/monitor/render/trace-io.js'
import type { MonitorCase } from '../../../src/monitor/cases.js'

const DOC: TraceV1Doc = {
  schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds', network: 'bittensor',
  addresses: [
    { address: 'seed1', roles: ['victim'] },
    { address: 'dep1', roles: ['candidate_deposit'] },
    { address: 'exch1', roles: ['exchange'], labels: ['Binance'], is_exchange: true },
  ],
  edges: [
    { edge_id: 'e1', from_address: 'seed1', to_address: 'dep1', amount_usd_sum: 500 },
    { edge_id: 'e2', from_address: 'dep1', to_address: 'exch1', amount_usd_sum: 450 },
  ],
  paths: [
    { path_id: 'p1', direction: 'forward', source: 'seed1', target: 'exch1', addresses: ['seed1', 'dep1', 'exch1'], edge_ids: ['e1', 'e2'], hops: 2, terminal_role: 'exchange', amount_usd_sum: 450 },
    { path_id: 'p2', direction: 'forward', source: 'seed1', target: 'dep2', addresses: ['seed1', 'dep2'], edge_ids: [], hops: 1, terminal_role: 'deposit', amount_usd_sum: 50 },
  ],
}
const CASE: MonitorCase = { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1'], status: 'open', created_at_timestamp: 1_750_000_000 }
const VERDICT = { status: 'active' as const, lastMovementTimestamp: 1_753_500_000, headline: 'ACTIVE (last movement 2026-07-26)' }

const input = () => ({ monitorCase: CASE, verdict: VERDICT, docs: [DOC], reportArtifacts: ['reports/20260727T000000Z_aml_trace_victim_funds.graph.html'], mermaid: 'flowchart LR\n  a0["seed1"] --> a1["dep1"]', generatedAtTimestamp: 1_753_600_000 })

describe('fundsDestinationSummary', () => {
  it('groups traced value by terminal endpoint class', () => {
    const rows = fundsDestinationSummary([DOC])
    expect(rows).toContainEqual({ endpointClass: 'exchange', totalAmountUsd: 450, pathCount: 1 })
    expect(rows).toContainEqual({ endpointClass: 'deposit', totalAmountUsd: 50, pathCount: 1 })
  })
})

describe('renderDossier', () => {
  it('contains every required section', () => {
    const md = renderDossier(input())
    expect(md).toContain('ACTIVE (last movement 2026-07-26)')
    for (const section of ['## Funds destination summary', '## Exchange deposit endpoints', '## Scammer cluster', '## Money flow', '## Reports', '## Timeline']) {
      expect(md).toContain(section)
    }
    expect(md).toContain('```mermaid')
    expect(md).toContain('Binance')
    expect(md).toContain('reports/20260727T000000Z_aml_trace_victim_funds.graph.html')
    expect(md).toContain('timeline.md')
  })

  it('shows DORMANT headline verbatim', () => {
    const md = renderDossier({ ...input(), verdict: { status: 'dormant', lastMovementTimestamp: null, headline: 'DORMANT since 2026-06-01' } })
    expect(md).toContain('DORMANT since 2026-06-01')
  })

  it('escapes pipes in table cells', () => {
    const doc: TraceV1Doc = { ...DOC, addresses: [{ address: 'bad', roles: ['candidate_suspect'], labels: ['a|b'] }] }
    const md = renderDossier({ ...input(), docs: [doc] })
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
