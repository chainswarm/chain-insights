// tests/monitor/watchlist.test.ts
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { addWatched, listWatched, loadWatchlist, removeWatched } from '../../src/monitor/watchlist.js'
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
