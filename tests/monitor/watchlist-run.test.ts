// tests/monitor/watchlist-run.test.ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dustHits, findingHits, movementHits, reactivationAlerts, runWatchlistPass, type WatchlistHit } from '../../src/monitor/watchlist-run.js'
import { rebuildStore, withStore } from '../../src/monitor/store.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import type { MonitorConfig } from '../../src/monitor/config.js'
import { addWatched, listWatched, syncManagedWatchlist } from '../../src/monitor/watchlist.js'
import { activityHits, appendProbeCursor, readProbeCursors } from '../../src/monitor/probe.js'
import { addCase, closeCase, type MonitorCase } from '../../src/monitor/cases.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-wlrun-'))
}

const WATCHED = [{ address: '5Mine', network: 'bittensor' }]

describe('watchlist free triggers', () => {
  it('a finding touching a watched address is a hit (AC-2)', async () => {
    const root = await ws()
    const hits = await withStore(root, async (store) => {
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5Mine')")
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5NotMine')")
      return findingHits(store, WATCHED, 1000)
    })
    expect(hits).toEqual([
      { address: '5Mine', network: 'bittensor', trigger: 'finding', source_ref: 'd1.json', detail: undefined },
    ])
  })

  it('a finding on another network is not a hit', async () => {
    const root = await ws()
    const hits = await withStore(root, async (store) => {
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor_evm','5Mine')")
      return findingHits(store, WATCHED, 1000)
    })
    expect(hits).toEqual([])
  })

  it('an already-recorded finding hit is not re-emitted (AC-11)', async () => {
    const root = await ws()
    const hits = await withStore(root, async (store) => {
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5Mine')")
      await store.run("INSERT INTO watchlist_hits VALUES (900,'5Mine','bittensor','finding','d1.json',NULL)")
      return findingHits(store, WATCHED, 1000)
    })
    expect(hits).toEqual([])
  })

  it('a case movement reaching a watched address is a hit (AC-3)', async () => {
    const root = await ws()
    const hits = await withStore(root, async (store) => {
      await store.run("INSERT INTO cases VALUES ('theft-1','stolen-funds','bittensor','open',1,10,NULL)")
      await store.run("INSERT INTO case_movements VALUES ('theft-1',1000,'new_address','5Mine','hop 2')")
      return movementHits(store, WATCHED, 1000)
    })
    expect(hits).toEqual([
      { address: '5Mine', network: 'bittensor', trigger: 'movement', source_ref: 'theft-1', detail: 'new_address' },
    ])
  })

  it('an empty watchlist yields no hits and runs no query (AC-7)', async () => {
    const root = await ws()
    const hits = await withStore(root, async (store) => findingHits(store, [], 1000))
    expect(hits).toEqual([])
  })
})

describe('watchlist dust probe', () => {
  function stubClient(rowsByNetwork: Record<string, Array<Record<string, unknown>>>, calls: { n: number }) {
    return {
      async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
        if (name === 'aml_address_risk') throw new Error('address risk must never be called by the watchlist')
        calls.n += 1
        const network = String(args.network)
        return {
          structuredContent: {
            facts: { queries: [{ id: 'dust', results: rowsByNetwork[network] ?? [] }] },
          },
        }
      },
    } as never
  }

  it('an incoming transfer below the ceiling is a hit (AC-4)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = stubClient(
      { bittensor: [{ address: '5Mine', from_address: '5Attacker', amount_usd: 0.01, tx_ref: 'tx-1' }] },
      calls,
    )
    const out = await withStore(root, async (store) =>
      dustHits(client, store, WATCHED, { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000),
    )
    expect(out.hits).toEqual([
      { address: '5Mine', network: 'bittensor', trigger: 'dust', source_ref: 'tx-1', detail: 'from 5Attacker, 0.01 USD' },
    ])
  })

  it('a dust batch with duplicate tx_ref yields one hit (R6)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = stubClient(
      {
        bittensor: [
          { address: 'watched1', from_address: 'srcA', amount_usd: 0.5, tx_ref: 'tx-1' },
          { address: 'watched1', from_address: 'srcA', amount_usd: 0.5, tx_ref: 'tx-1' }, // duplicate row in one response
        ],
      },
      calls,
    )
    await withStore(root, async (store) => {
      const { hits } = await dustHits(client, store, [{ address: 'watched1', network: 'bittensor' }],
        { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000)
      expect(hits).toHaveLength(1)
      expect(hits[0].source_ref).toBe('tx-1')
    })
  })

  it('makes one call per distinct network regardless of address count (AC-6)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const many = [
      ...Array.from({ length: 50 }, (_, i) => ({ address: `5A${i}`, network: 'bittensor' })),
      ...Array.from({ length: 50 }, (_, i) => ({ address: `0xB${i}`, network: 'bittensor_evm' })),
    ]
    const client = stubClient({}, calls)
    const out = await withStore(root, async (store) =>
      dustHits(client, store, many, { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000),
    )
    expect(calls.n).toBe(2)
    expect(out.calls).toBe(2)
  })

  it('an already-recorded dust hit is not re-emitted on an overlapping window (AC-11)', async () => {
    const root = await ws()
    const calls = { n: 0 }
    const client = stubClient(
      { bittensor: [{ address: '5Mine', from_address: '5Attacker', amount_usd: 0.01, tx_ref: 'tx-1' }] },
      calls,
    )
    const out = await withStore(root, async (store) => {
      await store.run("INSERT INTO watchlist_hits VALUES (900,'5Mine','bittensor','dust','tx-1',NULL)")
      return dustHits(client, store, WATCHED, { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000)
    })
    expect(out.hits).toEqual([])
  })

  it('a probe failure degrades to no dust hits and records the error', async () => {
    const root = await ws()
    const client = {
      async callTool() {
        throw new Error('backend down')
      },
    } as never
    const out = await withStore(root, async (store) =>
      dustHits(client, store, WATCHED, { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000),
    )
    expect(out.hits).toEqual([])
    expect(out.error).toMatch(/backend down/)
  })
})

// AC-6 at WHOLE-PASS level. The per-probe test above covers dustHits in
// isolation; this covers what a `monitor run` actually executes, because the
// cost guarantee is a property of the pass, not of one helper. The devkit
// smoke cannot assert it -- the run document carries no per-cell call counter
// -- so it SKIPs with a pointer here (chain-insights#231).
describe('watchlist pass cost guarantee (AC-6)', () => {
  it('the watchlist pass never calls aml_address_risk (AC-6 cost guarantee)', async () => {
    const root = await ws()
    const called: string[] = []
    const client = {
      async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
        called.push(name)
        // Deliberately does NOT throw: a throwing stub would let a regression
        // that swallows the error still look green. The call list is asserted.
        void args
        return { structuredContent: { facts: { queries: [{ id: 'dust', results: [] }] } } }
      },
    } as never

    // 100 addresses over 2 networks. A per-address implementation would make
    // 100+ calls; the contract is ≤2 per network (dust + activity probes,
    // victim lane cost target), flat in address count.
    for (let i = 0; i < 50; i += 1) {
      await addWatched(root, { address: `5Watched${i}`, network: 'bittensor' })
      await addWatched(root, { address: `0x${'a'.repeat(38)}${String(i).padStart(2, '0')}`, network: 'bittensor_evm' })
    }
    expect(await listWatched(root)).toHaveLength(100)

    const pass = await withStore(root, async (store) =>
      runWatchlistPass(client, root, store, { cells: [], intervalSeconds: 3600, caseMaxHops: 3, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } }, 1000),
    )

    expect(pass.calls).toBe(4)
    expect(called).toEqual(['graph_query_batch', 'graph_query_batch', 'graph_query_batch', 'graph_query_batch'])
    expect(called).not.toContain('aml_address_risk')
  })
})

describe('watchlist query-injection defences', () => {
  it('refuses to build a dust query for a non-address, rather than escaping it', async () => {
    const root = await ws()
    const calls = { n: 0 }
    // A trailing backslash is the payload that defeats the naive
    // replace(/'/g, "\\'") escaper: it escapes the closing quote and breaks
    // out of the Cypher string literal.
    const evil = [{ address: "5Mine\\", network: 'bittensor' }]
    const client = {
      async callTool() {
        calls.n += 1
        return { structuredContent: { facts: { queries: [{ id: 'dust', results: [] }] } } }
      },
    } as never
    const out = await withStore(root, async (store) =>
      dustHits(client, store, evil, { dustMaxUsd: 1, dustLookbackSeconds: 86400 }, 1000),
    )
    // Degrades to "no dust hits" with the error recorded; the malformed query
    // is never sent.
    expect(out.hits).toEqual([])
    expect(out.error).toMatch(/not valid chain addresses/)
    expect(calls.n).toBe(0)
  })

  it('rejects a non-address at the watchlist front door', async () => {
    const root = await ws()
    await expect(addWatched(root, { address: "5Mine'; MATCH (n) DETACH DELETE n //", network: 'bittensor' })).rejects.toThrow()
    await expect(addWatched(root, { address: '5Mine\\', network: 'bittensor' })).rejects.toThrow()
    expect(await listWatched(root)).toEqual([])
  })

  it('still accepts real SS58 and 0x-prefixed H160 addresses', async () => {
    const root = await ws()
    await addWatched(root, { address: '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5', network: 'bittensor' })
    await addWatched(root, { address: '0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24', network: 'bittensor_evm' })
    expect(await listWatched(root)).toHaveLength(2)
  })
})

describe('watchlist hit dedup survives rebuild (spec req 1)', () => {
  it('appends hits to logs/watchlist-hits.jsonl and re-runs zero re-alerts after rebuildStore', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    const client = { async callTool() { return { structuredContent: { facts: { queries: [{ id: 'dust', results: [] }] } } } } } as never
    const config = { cells: [], intervalSeconds: 3600, caseMaxHops: 3, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } } as MonitorConfig
    await withStore(root, async (store) => {
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5Mine')")
      const pass = await runWatchlistPass(client, root, store, config, 1000)
      expect(pass.hits).toHaveLength(1)
    })
    // Canonical JSONL exists and holds the hit.
    const raw = await readFile(monitorPaths(root).watchlistHitsLog, 'utf8')
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ run_timestamp: 1000, address: '5Mine', network: 'bittensor', trigger: 'finding', source_ref: 'd1.json' })
    // Rebuild drops the DB; the JSONL replays into watchlist_hits.
    await rebuildStore(root)
    await withStore(root, async (store) => {
      const rows = await store.all("SELECT * FROM watchlist_hits WHERE trigger = 'finding'")
      expect(rows).toHaveLength(1)
      // The finding is still present post-rebuild; dedup must hold: zero new hits.
      await store.run("INSERT INTO finding_addresses VALUES ('d1.json','bittensor','5Mine')")
      const rerun = await runWatchlistPass(client, root, store, config, 2000)
      expect(rerun.hits).toHaveLength(0)
      expect(rerun.alerts).toHaveLength(0)
    })
  })
})

describe('watchlist activity probe (victim lane spec req 4-5)', () => {
  function activityClient(rowsByNetwork: Record<string, Array<Record<string, unknown>>>, seen: { calls: number; queries: string[] }) {
    return {
      async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
        if (name === 'aml_address_risk') throw new Error('address risk must never be called by the watchlist')
        seen.calls += 1
        const network = String(args.network)
        const queries = (args.queries as Array<{ id: string; query: string }>) ?? []
        for (const q of queries) seen.queries.push(q.query)
        const id = queries[0]?.id
        return {
          structuredContent: {
            facts: { queries: [{ id, results: id === 'activity' ? (rowsByNetwork[network] ?? []) : [] }] },
          },
        }
      },
    } as never
  }

  const WL_CFG: MonitorConfig = {
    cells: [], intervalSeconds: 3600, caseMaxHops: 3, render: { dormant_after_days: 30 },
    watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true },
  }

  it('one call per network; merged MAX row becomes ONE hit with the natural source_ref', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    // Production-faithful cursor: the backend only returns rows with
    // last_activity_timestamp > $since, so the persisted cursor sits BELOW
    // the stub rows (the real query would never return rows at/under it).
    await appendProbeCursor(root, 'bittensor', 50, 900)
    const seen = { calls: 0, queries: [] as string[] }
    const client = activityClient({
      bittensor: [
        { address: '5Mine', last_activity_timestamp: 100 },
        { address: '5Mine', last_activity_timestamp: 250 },
        { address: '5Mine', last_activity_timestamp: null },
      ],
    }, seen)
    const hits = await withStore(root, async (store) => activityHits(client, store, root, await listWatched(root), 1000))
    expect(hits.calls).toBe(1)
    expect(hits.hits).toEqual([
      { address: '5Mine', network: 'bittensor', trigger: 'activity', source_ref: '5Mine|250', detail: 'last_activity_timestamp=250' },
    ])
    // Cursor advanced to MAX(last_activity_timestamp) seen.
    expect((await readProbeCursors(root)).get('bittensor')).toBe(250)
  })

  it('an already-recorded activity source_ref never re-hits (dedup is store-backed)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    const seen = { calls: 0, queries: [] as string[] }
    const client = activityClient({ bittensor: [{ address: '5Mine', last_activity_timestamp: 250 }] }, seen)
    const first = await withStore(root, async (store) => {
      await store.run("INSERT INTO watchlist_hits VALUES (900,'5Mine','bittensor','activity','5Mine|250',NULL)")
      return activityHits(client, store, root, await listWatched(root), 1000)
    })
    expect(first.hits).toEqual([])
  })

  it('runWatchlistPass records activity hits canonically, emits watchlist_activity, and marks the owning case dirty', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'v1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Mine'] }, 10)
    await syncManagedWatchlist(root, 'v1', 'bittensor', ['5Mine'])
    await addWatched(root, { address: '5Manual', network: 'bittensor' })
    const seen = { calls: 0, queries: [] as string[] }
    const client = activityClient({
      bittensor: [
        { address: '5Mine', last_activity_timestamp: 500 },
        { address: '5Manual', last_activity_timestamp: 600 },
      ],
    }, seen)
    const pass = await withStore(root, async (store) => runWatchlistPass(client, root, store, WL_CFG, 1000))
    expect(pass.hits.filter((h) => h.trigger === 'activity')).toHaveLength(2)
    expect(pass.alerts.map((a) => a.type)).toContain('watchlist_activity')
    // Canonical log line for the hit (rebuild source of truth).
    const raw = await readFile(monitorPaths(root).watchlistHitsLog, 'utf8')
    expect(raw).toContain('"source_ref":"5Mine|500"')
    // The managed hit marked the owning case dirty; the manual hit marked nothing.
    const caseDoc = JSON.parse(await readFile(path.join(monitorPaths(root).casesDir, 'v1', 'case.json'), 'utf8'))
    expect(caseDoc.dirty_since_timestamp).toBe(1000)
  })

  it('rebuild-then-rerun does not re-alert (source_ref dedup survives rebuildStore)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    const seen = { calls: 0, queries: [] as string[] }
    const client = activityClient({ bittensor: [{ address: '5Mine', last_activity_timestamp: 250 }] }, seen)
    const first = await withStore(root, async (store) => runWatchlistPass(client, root, store, WL_CFG, 1000))
    expect(first.hits).toHaveLength(1)
    await rebuildStore(root)
    const second = await withStore(root, async (store) => runWatchlistPass(client, root, store, WL_CFG, 2000))
    expect(second.hits).toEqual([])
    expect(second.alerts).toEqual([])
  })

  it('a probe failure degrades to error text — free triggers still report', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Mine', network: 'bittensor' })
    const client = {
      async callTool() {
        throw new Error('backend down')
      },
    } as never
    const pass = await withStore(root, async (store) => runWatchlistPass(client, root, store, WL_CFG, 1000))
    expect(pass.error).toMatch(/backend down/)
    expect(pass.hits).toEqual([])
  })
})

describe('case_reactivated derivation (label-lifecycle spec req 4)', () => {
  const activityHit = (over: Partial<WatchlistHit> = {}): WatchlistHit => ({
    address: '5Mule', network: 'bittensor', trigger: 'activity' as WatchlistHit['trigger'],
    source_ref: '5Mule|1700', detail: undefined, ...over,
  })
  const MANAGED = [{ address: '5Mule', network: 'bittensor', managed_by: 'case:ring1' }]
  const casesWith = (status: 'open' | 'closed'): MonitorCase[] => [{
    case_id: 'ring1', type: 'scam-topology', network: 'bittensor', seeds: ['5Seed'], status, created_at_timestamp: 1,
  }]

  it('an activity hit on a managed entry of a CLOSED case yields the alert, naming case and address', () => {
    expect(reactivationAlerts([activityHit()], MANAGED, casesWith('closed'), 2000)).toEqual([
      { type: 'case_reactivated', network: 'bittensor', case_id: 'ring1', address: '5Mule', run_timestamp: 2000 },
    ])
  })

  it('an OPEN case never reactivates (open-case activity is the dirty-mark path)', () => {
    expect(reactivationAlerts([activityHit()], MANAGED, casesWith('open'), 2000)).toEqual([])
  })

  it('a hit on a manual (unmanaged) entry never reactivates', () => {
    expect(reactivationAlerts([activityHit()], [{ address: '5Mule', network: 'bittensor' }], casesWith('closed'), 2000)).toEqual([])
  })

  it('non-activity triggers never reactivate', () => {
    expect(reactivationAlerts([activityHit({ trigger: 'dust' as WatchlistHit['trigger'], source_ref: 'tx-1' })], MANAGED, casesWith('closed'), 2000)).toEqual([])
  })

  it('a managed_by pointing at a case that does not exist is ignored', () => {
    expect(reactivationAlerts([activityHit()], [{ address: '5Mule', network: 'bittensor', managed_by: 'case:ghost' }], casesWith('closed'), 2000)).toEqual([])
  })

  it('duplicate hits for one address collapse to one alert per case+address', () => {
    const hits = [activityHit(), activityHit({ source_ref: '5Mule|1800' })]
    expect(reactivationAlerts(hits, MANAGED, casesWith('closed'), 2000)).toHaveLength(1)
  })
})

// End-to-end dedup: the canonical hits log's source_ref dedup (victim-lane
// spec mechanics) is what makes reactivation exactly-once per observation.
// The fake below mirrors the landed activity-probe fake above (per-network
// graph_query_batch returning address+last_activity_timestamp rows for the
// 'activity' query id, nothing for 'dust').
describe('case_reactivated end-to-end dedup across passes', () => {
  it('the same probe observation alerts once, not once per pass', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'ring1', type: 'scam-topology', network: 'bittensor', seeds: ['5Mule'] }, 100)
    await closeCase(root, 'ring1', 150)
    await addWatched(root, { address: '5Mule', network: 'bittensor', managed_by: 'case:ring1' })
    const ROW = { address: '5Mule', last_activity_timestamp: 1_700_000_000_500 }
    const client = {
      async callTool({ arguments: args }: { name: string; arguments: Record<string, unknown> }) {
        const queries = (args.queries as Array<{ id: string }> | undefined) ?? [{ id: 'activity' }]
        return {
          structuredContent: {
            facts: {
              queries: queries.map((q) => ({ id: q.id, results: q.id === 'dust' ? [] : [ROW] })),
              results: [ROW],
            },
          },
        }
      },
    } as never
    const config = { cells: [], intervalSeconds: 3600, caseMaxHops: 3, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } }
    const pass1 = await withStore(root, (store) => runWatchlistPass(client, root, store, config as never, 1_700_000_001_000))
    expect(pass1.alerts.filter((a) => a.type === 'case_reactivated')).toEqual([
      { type: 'case_reactivated', network: 'bittensor', case_id: 'ring1', address: '5Mule', run_timestamp: 1_700_000_001_000 },
    ])
    const pass2 = await withStore(root, (store) => runWatchlistPass(client, root, store, config as never, 1_700_000_002_000))
    expect(pass2.alerts.filter((a) => a.type === 'case_reactivated')).toEqual([])
  })
})
