// tests/monitor/watchlist.test.ts
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { addWatched, listWatched, loadWatchlist, removeWatched, syncManagedWatchlist } from '../../src/monitor/watchlist.js'
import { addCase, closeCase } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-watchlist-'))
}

describe('watchlist canonical state', () => {
  it('add → list → remove round-trips (AC-1)', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Treasury', network: 'bittensor', note: 'cold' })
    expect(await listWatched(root)).toEqual([{ address: '5Treasury', network: 'bittensor', note: 'cold' }])
    await removeWatched(root, '5Treasury', 'bittensor')
    expect(await listWatched(root)).toEqual([])
  })

  it('adding a duplicate is idempotent, not an error', async () => {
    const root = await ws()
    await addWatched(root, { address: '5A', network: 'bittensor' })
    await addWatched(root, { address: '5A', network: 'bittensor', note: 'updated' })
    const list = await listWatched(root)
    expect(list).toHaveLength(1)
    expect(list[0].note).toBe('updated')
  })

  it('same address on a different network is a distinct entry', async () => {
    const root = await ws()
    await addWatched(root, { address: '5A', network: 'bittensor' })
    await addWatched(root, { address: '5A', network: 'bittensor_evm' })
    expect(await listWatched(root)).toHaveLength(2)
  })

  it('a missing file means no watchlist, silently', async () => {
    const root = await ws()
    expect(await loadWatchlist(root)).toEqual([])
  })

  it('a malformed watchlist.json fails loudly', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(path.dirname(p.watchlistPath), { recursive: true })
    await writeFile(p.watchlistPath, '{ not json', 'utf8')
    await expect(loadWatchlist(root)).rejects.toThrow(/not valid JSON/)
  })

  it('a schema-invalid watchlist.json fails loudly', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(path.dirname(p.watchlistPath), { recursive: true })
    await writeFile(p.watchlistPath, JSON.stringify({ addresses: [{ address: '', network: 'bittensor' }] }), 'utf8')
    await expect(loadWatchlist(root)).rejects.toThrow(/Invalid watchlist/)
  })

  it('a non-ENOENT read error fails loudly rather than reading as empty', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(path.dirname(p.watchlistPath), { recursive: true })
    await writeFile(p.watchlistPath, JSON.stringify({ addresses: [] }), 'utf8')
    await chmod(p.watchlistPath, 0o000)
    // Running as root ignores file permissions; skip rather than assert falsely.
    let readable = true
    try {
      await loadWatchlist(root)
    } catch {
      readable = false
    }
    if (readable) return
    await expect(loadWatchlist(root)).rejects.toThrow(/Cannot read watchlist/)
  })
})

describe('managed watchlist entries (victim lane spec req 3)', () => {
  it('upserts cluster addresses with managed_by case:<id>', async () => {
    const root = await ws()
    await syncManagedWatchlist(root, 'theft-1', 'bittensor', ['5Seed', '5Hop1'])
    const list = await loadWatchlist(root)
    expect(list).toHaveLength(2)
    for (const e of list) expect(e.managed_by).toBe('case:theft-1')
  })

  it('refresh prunes managed entries that left the cluster and keeps the rest', async () => {
    const root = await ws()
    await syncManagedWatchlist(root, 'theft-1', 'bittensor', ['5Seed', '5Hop1'])
    const { added, pruned, kept } = await syncManagedWatchlist(root, 'theft-1', 'bittensor', ['5Seed', '5Hop2'])
    expect(kept).toEqual(['5Seed'])
    expect(pruned).toEqual(['5Hop1'])
    expect(added).toEqual(['5Hop2'])
    expect((await loadWatchlist(root)).map((e) => e.address).sort()).toEqual(['5Hop2', '5Seed'])
  })

  it('never touches manual entries or another case\'s managed entries', async () => {
    const root = await ws()
    await addWatched(root, { address: '5Manual', network: 'bittensor', note: 'mine' })
    await syncManagedWatchlist(root, 'other-case', 'bittensor', ['5Other'])
    // 5Manual is also in this cluster: the manual entry must survive as-is,
    // with no managed duplicate minted next to it.
    await syncManagedWatchlist(root, 'theft-1', 'bittensor', ['5Manual', '5Hop1'])
    let list = await loadWatchlist(root)
    const manual = list.find((e) => e.address === '5Manual')
    expect(manual?.managed_by).toBeUndefined()
    expect(manual?.note).toBe('mine')
    expect(list.filter((e) => e.address === '5Manual')).toHaveLength(1)
    expect(list.find((e) => e.address === '5Other')?.managed_by).toBe('case:other-case')
    // Empty-cluster refresh prunes ONLY theft-1's entries.
    await syncManagedWatchlist(root, 'theft-1', 'bittensor', [])
    list = await loadWatchlist(root)
    expect(list.map((e) => e.address).sort()).toEqual(['5Manual', '5Other'])
  })

  it('case close KEEPS managed entries (dormancy tripwire, spec req 3)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'theft-2', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 1000)
    await syncManagedWatchlist(root, 'theft-2', 'bittensor', ['5Seed', '5Hop1'])
    await closeCase(root, 'theft-2', 2000)
    const list = await loadWatchlist(root)
    expect(list.filter((e) => e.managed_by === 'case:theft-2')).toHaveLength(2)
  })

  it('refuses non-chain addresses in the cluster (allow-list, never escape)', async () => {
    const root = await ws()
    await expect(syncManagedWatchlist(root, 'theft-1', 'bittensor', ["5Seed' RETURN 1 //"])).rejects.toThrow(/chain address/)
  })
})
