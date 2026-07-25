// tests/monitor/cases.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { addCase, closeCase, listCases } from '../../src/monitor/cases.js'
import { rebuildStore, withStore } from '../../src/monitor/store.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-cases-'))
}

describe('case registry', () => {
  it('add → list → close lifecycle (AC-11)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'theft-77', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)
    expect(await listCases(root, { openOnly: true })).toHaveLength(1)
    const closed = await closeCase(root, 'theft-77', 200)
    expect(closed.status).toBe('closed')
    expect(await listCases(root, { openOnly: true })).toHaveLength(0)
    expect(await listCases(root)).toHaveLength(1)
  })

  it('rejects duplicates, empty seeds, bad ids', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c-1', type: 'scam-topology', network: 'bittensor', seeds: ['a'] }, 100)
    await expect(addCase(root, { case_id: 'c-1', type: 'scam-topology', network: 'bittensor', seeds: ['a'] }, 100)).rejects.toThrow(/already exists/)
    await expect(addCase(root, { case_id: 'c-2', type: 'scam-topology', network: 'bittensor', seeds: [] }, 100)).rejects.toThrow(/at least one seed/)
    await expect(addCase(root, { case_id: 'BAD ID', type: 'scam-topology', network: 'bittensor', seeds: ['a'] }, 100)).rejects.toThrow(/case_id/)
  })

  it('cases land in the store and survive rebuild (AC-2)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c-1', type: 'stolen-funds', network: 'bittensor', seeds: ['a', 'b'] }, 100)
    await rebuildStore(root)
    const rows = await withStore(root, async (s) => s.all('SELECT case_id, status, seed_count FROM cases'))
    expect(rows).toEqual([{ case_id: 'c-1', status: 'open', seed_count: 2 }])
  })
})
