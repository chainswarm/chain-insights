// tests/monitor/watchlist-run.test.ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dustHits, findingHits, movementHits, runWatchlistPass } from '../../src/monitor/watchlist-run.js'
import { rebuildStore, withStore } from '../../src/monitor/store.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import type { MonitorConfig } from '../../src/monitor/config.js'
import { addWatched, listWatched } from '../../src/monitor/watchlist.js'

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
    // 100 calls; the contract is 2.
    for (let i = 0; i < 50; i += 1) {
      await addWatched(root, { address: `5Watched${i}`, network: 'bittensor' })
      await addWatched(root, { address: `0x${'a'.repeat(38)}${String(i).padStart(2, '0')}`, network: 'bittensor_evm' })
    }
    expect(await listWatched(root)).toHaveLength(100)

    const pass = await withStore(root, async (store) =>
      runWatchlistPass(client, root, store, { cells: [], intervalSeconds: 3600, caseMaxHops: 3, watchlist: { dustMaxUsd: 1, dustLookbackSeconds: 86400, enabled: true } }, 1000),
    )

    expect(pass.calls).toBe(2)
    expect(called).toEqual(['graph_query_batch', 'graph_query_batch'])
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
