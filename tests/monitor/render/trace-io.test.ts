import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { caseTracesDir, readLatestTraceDocs, writeTraceDoc } from '../../../src/monitor/render/trace-io.js'

const doc = (ts: number) => ({
  schema: 'chain-insights.trace.v1', tool: 'aml_trace_victim_funds', network: 'bittensor',
  addresses: [{ address: 'seed1', roles: ['victim'] }],
  edges: [{ edge_id: 'e1', from_address: 'seed1', to_address: 'hop1', amount_usd_sum: 10, last_seen_timestamp: ts }],
  paths: [],
})

async function ws(): Promise<string> { return mkdtemp(path.join(tmpdir(), 'cia-trace-io-')) }

describe('trace-io', () => {
  it('writes under cases/<id>/traces/<ts>.<role>.trace.json', async () => {
    const root = await ws()
    const file = await writeTraceDoc(root, 'c1', 'victim', 100, doc(100))
    expect(file).toBe(path.join(caseTracesDir(root, 'c1'), '100.victim.trace.json'))
    expect(JSON.parse(await readFile(file, 'utf8')).schema).toBe('chain-insights.trace.v1')
  })

  it('readLatestTraceDocs returns the newest doc per role', async () => {
    const root = await ws()
    await writeTraceDoc(root, 'c1', 'victim', 100, doc(100))
    await writeTraceDoc(root, 'c1', 'victim', 200, doc(200))
    await writeTraceDoc(root, 'c1', 'suspect', 150, { ...doc(150), tool: 'aml_trace_suspect_funds' })
    const latest = await readLatestTraceDocs(root, 'c1')
    expect(latest.victim?.edges[0]?.last_seen_timestamp).toBe(200)
    expect(latest.suspect?.tool).toBe('aml_trace_suspect_funds')
  })

  it('returns {} for a case with no traces', async () => {
    expect(await readLatestTraceDocs(await ws(), 'nope')).toEqual({})
  })

  it('throws on a persisted doc with the wrong schema', async () => {
    const root = await ws()
    await writeTraceDoc(root, 'c1', 'victim', 100, { ...doc(100), schema: 'other.v9' })
    await expect(readLatestTraceDocs(root, 'c1')).rejects.toThrow(/chain-insights\.trace\.v1/)
  })
})
