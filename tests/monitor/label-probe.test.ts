// tests/monitor/label-probe.test.ts
import { appendFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendLabelBaseline,
  extractFamilies,
  LABEL_SOURCE,
  labelHits,
  labelQuery,
  mergeLabelRows,
  pairKey,
  readLabelBaseline,
  severityForFamilies,
} from '../../src/monitor/label-probe.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { rebuildStore, withStore } from '../../src/monitor/store.js'
import { runWatchlistPass } from '../../src/monitor/watchlist-run.js'
import { addWatched } from '../../src/monitor/watchlist.js'
import type { MonitorConfig } from '../../src/monitor/config.js'

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

  // labelQuery shape pin (label-governance Plan 3 D2): the query gains
  // labels(a) AS families ALONGSIDE a.labels — the free-text property stays,
  // families is additive, never a replacement.
  it('pins the RETURN shape: a.labels AND labels(a) AS families both present', () => {
    const q = labelQuery(['5Aaa'])
    expect(q).toContain('RETURN a.address AS address, a.labels AS labels, labels(a) AS families')
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

// label-governance Plan 3 D2: labels(a) returns EVERY node label on the
// address — Address (on every node) and layer-2 knowledge labels (Neuron,
// Subnet) included. extractFamilies filters that raw list down to the
// overlay vocabulary the severity mapping understands; nothing else is
// alert-relevant.
describe('overlay family extraction (label-governance Plan 3 D2)', () => {
  it.each([
    ['Address only — no overlay family present', ['Address'], []],
    ['a verdict family alongside Address', ['Address', 'Scam'], ['Scam']],
    ['layer-2 knowledge labels are ignored (Neuron/Subnet)', ['Address', 'Neuron', 'Subnet'], []],
    ['Attributed alone', ['Address', 'Attributed'], ['Attributed']],
    ['a mixed scam+attributed address keeps BOTH', ['Address', 'Scam', 'Attributed'], ['Attributed', 'Scam']],
    ['Victim and Exchange both pass through', ['Victim', 'Exchange'], ['Exchange', 'Victim']],
    ['every vocabulary family at once', ['Scam', 'Mixer', 'Bridge', 'Victim', 'Exchange', 'Poisoned', 'Propagated', 'Attributed'],
      ['Attributed', 'Bridge', 'Exchange', 'Mixer', 'Poisoned', 'Propagated', 'Scam', 'Victim']],
    ['an empty node-label list', [], []],
    ['null is defensive-empty', null, []],
    ['undefined is defensive-empty', undefined, []],
    ['a non-array value is defensive-empty', 'not-an-array', []],
    ['non-vocabulary values never match', [1, 2, 'Foo'], []],
  ])('%s', (_name, raw, expected) => {
    expect([...extractFamilies(raw)].sort()).toEqual([...(expected as string[])].sort())
  })
})

// label-governance Plan 3 D2 mapping: any verdict family (Scam/Mixer/Bridge/
// Poisoned/Propagated) alerts; Attributed and/or Victim/Exchange ALONE is
// context; no families extracted at all (labels-text-only) is the
// conservative default — today's behavior, alert.
describe('severity mapping (label-governance Plan 3 D2)', () => {
  it.each([
    ['no families extracted at all is conservative alert (labels-text-only)', [], 'alert'],
    ['Scam alone alerts', ['Scam'], 'alert'],
    ['Mixer alone alerts', ['Mixer'], 'alert'],
    ['Bridge alone alerts', ['Bridge'], 'alert'],
    ['Poisoned alone alerts', ['Poisoned'], 'alert'],
    ['Propagated alone alerts', ['Propagated'], 'alert'],
    ['Attributed alone is context', ['Attributed'], 'context'],
    ['Victim alone is context', ['Victim'], 'context'],
    ['Exchange alone is context', ['Exchange'], 'context'],
    ['Attributed + Victim is still context', ['Attributed', 'Victim'], 'context'],
    ['Attributed + Exchange is still context', ['Attributed', 'Exchange'], 'context'],
    ['Attributed + Scam: any verdict family wins -> alert', ['Attributed', 'Scam'], 'alert'],
    ['Victim + Bridge: any verdict family wins -> alert', ['Victim', 'Bridge'], 'alert'],
  ])('%s', (_name, families, expected) => {
    expect(severityForFamilies(new Set(families))).toBe(expected)
  })
})

function stubClient(rowsByNetwork: Record<string, Array<Record<string, unknown>>>, calls: { n: number }) {
  return {
    async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
      if (name === 'aml_address_risk') throw new Error('address risk must never be called by the watchlist')
      calls.n += 1
      const network = String(args.network)
      const rows = rowsByNetwork[network]
      if (rows === undefined) throw new Error(`backend down for ${network}`)
      return { structuredContent: { facts: { queries: [{ id: 'labels', results: rows }] } } }
    },
  } as never
}

describe('labelHits (label-cutover spec req 1-2)', () => {
  const WATCHED = [{ address: '5Mine', network: 'bittensor' }]

  it('first sight seeds the baseline silently — even for an already-labeled address', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC'] }] }, calls)
    const out = await withStore(root, async (store) => labelHits(client, store, root, WATCHED, 1000))
    expect(out.hits).toEqual([])
    expect(out.calls).toBe(1)
    const baseline = await readLabelBaseline(root)
    expect(baseline.get('bittensor:5Mine')).toEqual([{ label: 'MEXC', source: 'topology' }])
  })

  it('an unlabeled watched address is ALSO seeded (empty set), so its first-ever label is a diff', async () => {
    const root = await ws()
    const client = stubClient({ bittensor: [] }, { n: 0 })
    await withStore(root, async (store) => labelHits(client, store, root, WATCHED, 1000))
    expect((await readLabelBaseline(root)).get('bittensor:5Mine')).toEqual([])
    // Second pass: the platform labeled the address.
    const calls = { n: 0 }
    const labeled = stubClient({ bittensor: [{ address: '5Mine', labels: ['mule'] }] }, calls)
    const out = await withStore(root, async (store) => labelHits(labeled, store, root, WATCHED, 2000))
    expect(out.hits).toEqual([
      {
        address: '5Mine', network: 'bittensor', trigger: 'label',
        source_ref: '5Mine|mule|topology', label: 'mule', source: 'topology',
        detail: 'label=mule source=topology', severity: 'alert',
      },
    ])
  })

  it('a known pair never re-hits; only the NEW pair of a grown set alerts, and the baseline grows monotonically', async () => {
    const root = await ws()
    const one = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC'] }] }, { n: 0 })
    await withStore(root, async (store) => labelHits(one, store, root, WATCHED, 1000)) // bootstrap
    const two = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC', 'mule'] }] }, { n: 0 })
    const out = await withStore(root, async (store) => labelHits(two, store, root, WATCHED, 2000))
    expect(out.hits.map((h) => h.source_ref)).toEqual(['5Mine|mule|topology'])
    expect((await readLabelBaseline(root)).get('bittensor:5Mine')).toEqual([
      { label: 'MEXC', source: 'topology' },
      { label: 'mule', source: 'topology' },
    ])
  })

  it('a label that disappears and reappears never re-alerts (baseline is monotone; removal is not an event)', async () => {
    const root = await ws()
    const one = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC'] }] }, { n: 0 })
    await withStore(root, async (store) => labelHits(one, store, root, WATCHED, 1000)) // bootstrap
    const gone = stubClient({ bittensor: [] }, { n: 0 })
    await withStore(root, async (store) => labelHits(gone, store, root, WATCHED, 2000))
    const back = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC'] }] }, { n: 0 })
    const out = await withStore(root, async (store) => labelHits(back, store, root, WATCHED, 3000))
    expect(out.hits).toEqual([])
  })

  it('an already-recorded source_ref never re-hits (dedup is store-backed, AC-11 shape)', async () => {
    const root = await ws()
    await appendLabelBaseline(root, { network: 'bittensor', address: '5Mine', pairs: [], run_timestamp: 500 })
    const client = stubClient({ bittensor: [{ address: '5Mine', labels: ['mule'] }] }, { n: 0 })
    const out = await withStore(root, async (store) => {
      await store.run("INSERT INTO watchlist_hits VALUES (900,'5Mine','bittensor','label','5Mine|mule|topology',NULL)")
      return labelHits(client, store, root, WATCHED, 1000)
    })
    expect(out.hits).toEqual([])
  })

  it("a hit's severity is the overlay-family verdict, not the label text (D2)", async () => {
    const root = await ws()
    const boot = stubClient({ bittensor: [{ address: '5Mine', labels: ['MEXC'], families: ['Address'] }] }, { n: 0 })
    await withStore(root, async (store) => labelHits(boot, store, root, WATCHED, 1000)) // bootstrap
    const verdict = stubClient(
      { bittensor: [{ address: '5Mine', labels: ['MEXC', 'attribution_transport'], families: ['Address', 'Scam'] }] },
      { n: 0 },
    )
    const out = await withStore(root, async (store) => labelHits(verdict, store, root, WATCHED, 2000))
    expect(out.hits.map((h) => ({ label: h.label, severity: h.severity }))).toEqual([
      { label: 'attribution_transport', severity: 'alert' },
    ])
  })

  it("Attributed-only families map to 'context' severity (D2)", async () => {
    const root = await ws()
    const boot = stubClient({ bittensor: [{ address: '5Mine', labels: [], families: ['Address'] }] }, { n: 0 })
    await withStore(root, async (store) => labelHits(boot, store, root, WATCHED, 1000)) // bootstrap
    const context = stubClient(
      { bittensor: [{ address: '5Mine', labels: ['attribution_hop'], families: ['Address', 'Attributed'] }] },
      { n: 0 },
    )
    const out = await withStore(root, async (store) => labelHits(context, store, root, WATCHED, 2000))
    expect(out.hits.map((h) => ({ label: h.label, severity: h.severity }))).toEqual([
      { label: 'attribution_hop', severity: 'context' },
    ])
  })

  it('makes ONE call per distinct network regardless of address count (spec req 2)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = stubClient({ bittensor: [], bittensor_evm: [] }, calls)
    const watched = [
      { address: '5A', network: 'bittensor' },
      { address: '5B', network: 'bittensor' },
      { address: '5C', network: 'bittensor' },
      { address: '0xAb1', network: 'bittensor_evm' },
    ]
    await withStore(root, async (store) => labelHits(client, store, root, watched, 1000))
    expect(calls.n).toBe(2)
  })

  it('a failed network degrades to error text and seeds NO baseline (no retro-flood on recovery)', async () => {
    const root = await ws()
    const client = stubClient({}, { n: 0 }) // every network throws
    const out = await withStore(root, async (store) => labelHits(client, store, root, WATCHED, 1000))
    expect(out.hits).toEqual([])
    expect(out.error).toMatch(/backend down for bittensor/)
    expect((await readLabelBaseline(root)).size).toBe(0)
  })

  it('an empty watchlist yields no hits and runs no query', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const out = await withStore(root, async (store) => labelHits(stubClient({}, calls), store, root, [], 1000))
    expect(out).toEqual({ hits: [], calls: 0 })
    expect(calls.n).toBe(0)
  })
})

// Serves the label probe; the dust and activity probes get empty result sets.
function passClient(labelRows: Array<Record<string, unknown>>, calls: { n: number }) {
  return {
    async callTool({ name, arguments: args }: { name: string; arguments: { queries: Array<{ id: string }> } }) {
      if (name === 'aml_address_risk') throw new Error('address risk must never be called by the watchlist')
      calls.n += 1
      const id = args.queries[0].id
      return { structuredContent: { facts: { queries: [{ id, results: id === 'labels' ? labelRows : [] }] } } }
    },
  } as never
}

const CONFIG = { cells: [], intervalSeconds: 3600, caseMaxHops: 2, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true }, render: { dormant_after_days: 30 } } as unknown as MonitorConfig

describe('runWatchlistPass label wiring (label-cutover spec req 1)', () => {
  it('bootstrap pass emits NO watchlist_label alert; the delta pass emits one naming address, label, source', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    const boot = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: ['MEXC'] }], { n: 0 }), root, store, CONFIG, 1000))
    expect(boot.alerts.filter((a) => a.type === 'watchlist_label')).toEqual([])
    const delta = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: ['MEXC', 'mule'] }], { n: 0 }), root, store, CONFIG, 2000))
    expect(delta.alerts.filter((a) => a.type === 'watchlist_label')).toEqual([
      { type: 'watchlist_label', network: 'bittensor', address: '5Mine', label: 'mule', source: 'topology', case_id: undefined, doc_path: undefined, run_timestamp: 2000, severity: 'alert' },
    ])
    expect(delta.hits.find((h) => h.trigger === 'label')?.source_ref).toBe('5Mine|mule|topology')
  })

  it('AlertEvent.severity is populated for watchlist_label alerts from the overlay family (D2)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: [], families: ['Address'] }], { n: 0 }), root, store, CONFIG, 1000)) // bootstrap
    const alertPass = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: ['attribution_transport'], families: ['Address', 'Scam'] }], { n: 0 }), root, store, CONFIG, 2000))
    expect(alertPass.alerts.find((a) => a.type === 'watchlist_label')?.severity).toBe('alert')

    const root2 = await ws()
    await addWatched(root2, { address: '5Ctx', network: 'bittensor' })
    await withStore(root2, async (store) =>
      runWatchlistPass(passClient([{ address: '5Ctx', labels: [], families: ['Address'] }], { n: 0 }), root2, store, CONFIG, 1000)) // bootstrap
    const contextPass = await withStore(root2, async (store) =>
      runWatchlistPass(passClient([{ address: '5Ctx', labels: ['attribution_hop'], families: ['Address', 'Attributed'] }], { n: 0 }), root2, store, CONFIG, 2000))
    expect(contextPass.alerts.find((a) => a.type === 'watchlist_label')?.severity).toBe('context')
  })

  it('a managed entry names the owning case on the alert (victim-lane coverage)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mule', network: 'bittensor', managed_by: 'case:theft-1' })
    await withStore(root, async (store) =>
      runWatchlistPass(passClient([], { n: 0 }), root, store, CONFIG, 1000)) // silent bootstrap
    const out = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mule', labels: ['mule'] }], { n: 0 }), root, store, CONFIG, 2000))
    const alert = out.alerts.find((a) => a.type === 'watchlist_label')
    expect(alert?.case_id).toBe('theft-1')
    expect(alert?.address).toBe('5Mule')
    expect(alert?.label).toBe('mule')
  })

  it('dedup across runs AND across rebuild: rebuild-then-rerun re-alerts nothing', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    await withStore(root, async (store) =>
      runWatchlistPass(passClient([], { n: 0 }), root, store, CONFIG, 1000)) // bootstrap
    const first = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: ['mule'] }], { n: 0 }), root, store, CONFIG, 2000))
    expect(first.hits.filter((h) => h.trigger === 'label')).toHaveLength(1)
    await rebuildStore(root)
    const again = await withStore(root, async (store) =>
      runWatchlistPass(passClient([{ address: '5Mine', labels: ['mule'] }], { n: 0 }), root, store, CONFIG, 3000))
    expect(again.hits.filter((h) => h.trigger === 'label')).toHaveLength(0)
    expect(again.alerts.filter((a) => a.type === 'watchlist_label')).toHaveLength(0)
  })

  it('the pass makes exactly 3 remote calls per network (dust + activity + label): >=AC-6, spec req 2', async () => {
    const root = await ws()
    await addWatched(root, { address: '5A', network: 'bittensor' })
    await addWatched(root, { address: '5B', network: 'bittensor' })
    const calls = { n: 0 }
    await withStore(root, async (store) => runWatchlistPass(passClient([], calls), root, store, CONFIG, 1000))
    expect(calls.n).toBe(3)
  })
})
