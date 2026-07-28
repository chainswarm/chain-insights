import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendTimeline, publishedCaseDir, writeAddressNotes } from '../../../src/monitor/render/notes.js'
import type { AlertEvent } from '../../../src/monitor/alerts.js'
import type { TraceV1Doc } from '../../../src/monitor/render/trace-io.js'

async function ws(): Promise<string> { return mkdtemp(path.join(tmpdir(), 'cia-notes-')) }

const DOC: TraceV1Doc = {
  schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds', network: 'bittensor',
  addresses: [
    { address: 'seed1', roles: ['victim'] },
    { address: 'dep1', roles: ['candidate_deposit'] },
    { address: 'exch1', roles: ['exchange'], labels: ['Binance'], is_exchange: true },
    { address: 'hop1', roles: ['candidate_intermediate'] },
  ],
  edges: [
    { edge_id: 'e1', from_address: 'seed1', to_address: 'dep1', first_seen_timestamp: 1000, last_seen_timestamp: 2000 },
    { edge_id: 'e2', from_address: 'dep1', to_address: 'exch1', first_seen_timestamp: 1500, last_seen_timestamp: 3000 },
  ],
  paths: [],
}

const alert = (id: string, type: AlertEvent['type']): AlertEvent => ({
  alert_id: id, type, network: 'bittensor', case_id: 'c1', address: 'dep1',
  run_timestamp: 1_753_000_000_000, emitted_at_timestamp: 1_753_000_000_000,
})

describe('writeAddressNotes', () => {
  it('writes a note per seed/deposit/exchange with role, seen range and dossier link', async () => {
    const root = await ws()
    const files = await writeAddressNotes(root, 'c1', [DOC], ['seed1'])
    const dir = path.join(publishedCaseDir(root, 'c1'), 'addresses')
    expect((await readdir(dir)).sort()).toEqual(['dep1.md', 'exch1.md', 'seed1.md'])
    const dep = await readFile(path.join(dir, 'dep1.md'), 'utf8')
    expect(dep).toContain('candidate_deposit')
    expect(dep).toContain('../dossier.md')
    const exch = await readFile(path.join(dir, 'exch1.md'), 'utf8')
    expect(exch).toContain('Binance')
    expect(files.length).toBe(3)
  })
})

describe('appendTimeline', () => {
  it('appends one line per alert and never duplicates an alert_id', async () => {
    const root = await ws()
    expect(await appendTimeline(root, 'c1', [alert('a1', 'case_movement'), alert('a2', 'cashout_endpoint')])).toBe(2)
    expect(await appendTimeline(root, 'c1', [alert('a1', 'case_movement'), alert('a3', 'frontier_candidate')])).toBe(1)
    const timeline = await readFile(path.join(publishedCaseDir(root, 'c1'), 'timeline.md'), 'utf8')
    expect(timeline.match(/\(a1\)/g)?.length).toBe(1)
    expect(timeline).toContain('(a3)')
    expect(timeline.startsWith('# Timeline — c1')).toBe(true)
  })
})
