// tests/monitor/label-probe.test.ts
import { appendFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendLabelBaseline,
  LABEL_SOURCE,
  pairKey,
  readLabelBaseline,
} from '../../src/monitor/label-probe.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-lblprobe-'))
}

describe('label baseline canonical log (label-cutover spec req 1)', () => {
  it('append + read round-trips; last line per (network, address) wins', async () => {
    const root = await ws()
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [], run_timestamp: 1000 })
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Bbb', pairs: [{ label: 'MEXC', source: 'topology' }], run_timestamp: 1000 })
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [{ label: 'mule', source: 'topology' }], run_timestamp: 2000 })
    const baseline = await readLabelBaseline(root)
    expect(baseline.get('bittensor:5Aaa')).toEqual([{ label: 'mule', source: 'topology' }])
    expect(baseline.get('bittensor:5Bbb')).toEqual([{ label: 'MEXC', source: 'topology' }])
  })

  it('an empty pair set is a real baseline entry, not absence (silent-bootstrap seed)', async () => {
    const root = await ws()
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [], run_timestamp: 1000 })
    const baseline = await readLabelBaseline(root)
    expect(baseline.has('bittensor:5Aaa')).toBe(true)
    expect(baseline.get('bittensor:5Aaa')).toEqual([])
  })

  it('no baseline file = empty map, and a torn line costs that line only', async () => {
    const root = await ws()
    expect((await readLabelBaseline(root)).size).toBe(0)
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [], run_timestamp: 1000 })
    await appendFile(monitorPaths(root).labelBaselineLog, '{"network":"bittensor","addr', 'utf8')
    expect((await readLabelBaseline(root)).has('bittensor:5Aaa')).toBe(true)
  })

  it('baseline lines are append-only JSONL on disk (rebuild-safe canonical doc)', async () => {
    const root = await ws()
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [], run_timestamp: 1000 })
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Aaa', pairs: [{ label: 'mule', source: 'topology' }], run_timestamp: 2000 })
    const raw = await readFile(monitorPaths(root).labelBaselineLog, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(raw.trim().split('\n')[1])).toEqual({
      network: 'bittensor', address: '5Aaa', pairs: [{ label: 'mule', source: 'topology' }], run_timestamp: 2000,
    })
  })

  it('pairKey and LABEL_SOURCE pin the contract shape', () => {
    expect(LABEL_SOURCE).toBe('topology')
    expect(pairKey('MEXC', 'topology')).toBe('MEXC|topology')
  })
})
