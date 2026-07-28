// tests/monitor/label-probe.test.ts
import { appendFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendLabelBaseline,
  LABEL_SOURCE,
  labelQuery,
  mergeLabelRows,
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

describe('label query + per-shard merge (label-cutover spec req 1-2)', () => {
  it('builds ONE topology query over all watched addresses returning the label overlay', () => {
    const q = labelQuery(['5Aaa', '0xAb12'])
    expect(q).toContain('USE topology')
    expect(q).toContain("a.address IN ['5Aaa','0xAb12']")
    expect(q).toContain('a.labels IS NOT NULL')
    expect(q).toContain('RETURN a.address AS address, a.labels AS labels')
    expect(q).toContain('LIMIT 500')
  })

  it('refuses a non-chain address instead of escaping it', () => {
    expect(() => labelQuery(["5Aaa' RETURN 1 //"])).toThrow(/not valid chain address/)
  })

  it('merges per-shard rows by UNION of labels per address, ignoring null/non-array labels', () => {
    const merged = mergeLabelRows([
      { address: '5Aaa', labels: ['MEXC'] },
      { address: '5Aaa', labels: ['MEXC', 'mule'] },
      { address: '5Aaa', labels: null },
      { address: '5Bbb', labels: 'not-an-array' },
      { address: '', labels: ['ghost'] },
    ])
    expect([...(merged.get('5Aaa') ?? [])].sort()).toEqual(['MEXC', 'mule'])
    expect(merged.has('5Bbb')).toBe(false)
    expect(merged.size).toBe(1)
  })

  it('coerces non-string label array members to strings and drops empties', () => {
    const merged = mergeLabelRows([{ address: '5Aaa', labels: ['ok', 7, ''] }])
    expect([...(merged.get('5Aaa') ?? [])].sort()).toEqual(['7', 'ok'])
  })
})
