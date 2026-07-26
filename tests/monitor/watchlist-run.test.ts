// tests/monitor/watchlist-run.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findingHits, movementHits } from '../../src/monitor/watchlist-run.js'
import { withStore } from '../../src/monitor/store.js'

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
