// tests/monitor/cases.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addCase, addCaseSeeds, closeCase, listCases, removeCaseSeeds } from '../../src/monitor/cases.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-cases-'))
}

describe('case registry', () => {
  it('add → list → close lifecycle (AC-11)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'theft-77', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)
    expect(await listCases(root, { openOnly: true })).toHaveLength(1)
    const closed = await closeCase(root, 'theft-77', 200)
    expect(closed.monitorCase.status).toBe('closed')
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

  it('add-seed widens an open case, is idempotent, and timestamps the addition (#250)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'grow-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)

    const first = await addCaseSeeds(root, 'grow-1', ['5Operator'], 200, { note: 'second controlled wallet' })
    expect(first.added).toEqual(['5Operator'])
    expect(first.monitorCase.seeds).toEqual(['5Victim', '5Operator'])
    expect(first.monitorCase.seeds_added_at_timestamp).toEqual({ '5Operator': 200 })
    expect(first.monitorCase.seed_events).toEqual([
      { action: 'add', addresses: ['5Operator'], at_timestamp: 200, note: 'second controlled wallet' },
    ])

    // Idempotent: a re-add is a no-op, not an error, and records no event.
    const again = await addCaseSeeds(root, 'grow-1', ['5Operator', '5Victim'], 300)
    expect(again.added).toEqual([])
    expect(again.monitorCase.seeds).toEqual(['5Victim', '5Operator'])
    expect(again.monitorCase.seed_events).toHaveLength(1)

    // Partial add: only the genuinely new address is recorded.
    const mixed = await addCaseSeeds(root, 'grow-1', ['5Operator', '5Mid'], 400)
    expect(mixed.added).toEqual(['5Mid'])
    expect(mixed.monitorCase.seeds_added_at_timestamp).toEqual({ '5Operator': 200, '5Mid': 400 })
  })

  it('remove-seed narrows a case but can never empty it', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'shrink-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)
    await addCaseSeeds(root, 'shrink-1', ['5Operator'], 200)

    const removed = await removeCaseSeeds(root, 'shrink-1', ['5Operator'], 300)
    expect(removed.removed).toEqual(['5Operator'])
    expect(removed.monitorCase.seeds).toEqual(['5Victim'])
    expect(removed.monitorCase.seeds_added_at_timestamp).toBeUndefined()

    // Idempotent: removing a non-seed changes nothing.
    expect((await removeCaseSeeds(root, 'shrink-1', ['5Operator'], 400)).removed).toEqual([])
    await expect(removeCaseSeeds(root, 'shrink-1', ['5Victim'], 500)).rejects.toThrow(/at least one seed/)
  })

  it('refuses to mutate the seed set of a CLOSED case', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'sealed-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)
    await closeCase(root, 'sealed-1', 200)
    await expect(addCaseSeeds(root, 'sealed-1', ['5Operator'], 300)).rejects.toThrow(/closed/)
    await expect(removeCaseSeeds(root, 'sealed-1', ['5Victim'], 300)).rejects.toThrow(/closed/)
    // ...and the canonical record is untouched.
    expect((await listCases(root))[0].seeds).toEqual(['5Victim'])
  })

  it('refuses seed addresses outside the chain-address allow-list', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'safe-1', type: 'stolen-funds', network: 'bittensor', seeds: ['5Victim'] }, 100)
    for (const bad of ["5Victim' RETURN 1 //", '5Victim OR 1=1', '5Victim\n', '']) {
      await expect(addCaseSeeds(root, 'safe-1', [bad], 200)).rejects.toThrow()
    }
    await expect(addCaseSeeds(root, 'safe-1', [], 200)).rejects.toThrow(/at least one --address/)
    expect((await listCases(root))[0].seeds).toEqual(['5Victim'])
  })

  it('reports a missing case by id rather than an ENOENT stack', async () => {
    const root = await ws()
    await expect(addCaseSeeds(root, 'nope', ['5Victim'], 100)).rejects.toThrow(/no such case "nope"/)
  })

  it('close of a missing case gives "no such case", not an ENOENT stack (R2)', async () => {
    const root = await ws()
    await expect(closeCase(root, 'ghost', 100)).rejects.toThrow('no such case "ghost"')
  })

  it('re-close is a warning no-op that preserves the original closed_at_timestamp (R2)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['a1'] }, 100)
    const first = await closeCase(root, 'c1', 200)
    expect(first.alreadyClosed).toBe(false)
    expect(first.monitorCase.closed_at_timestamp).toBe(200)
    const second = await closeCase(root, 'c1', 999)
    expect(second.alreadyClosed).toBe(true)
    expect(second.monitorCase.closed_at_timestamp).toBe(200) // NOT rewritten
  })

  describe('case-id validation everywhere (R3)', () => {
    const traversal = '../../etc/passwd'
    let ws1: string
    beforeEach(async () => {
      ws1 = await ws()
    })
    it.each([
      ['addCaseSeeds', () => addCaseSeeds(ws1, traversal, ['a1'], 100)],
      ['removeCaseSeeds', () => removeCaseSeeds(ws1, traversal, ['a1'], 100)],
      ['closeCase', () => closeCase(ws1, traversal, 100)],
    ])('%s rejects a traversal case id before touching the filesystem', async (_name, run) => {
      await expect(run()).rejects.toThrow(/case_id must match/)
    })
  })

  it('cases land in the store and survive rebuild (AC-2)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c-1', type: 'stolen-funds', network: 'bittensor', seeds: ['a', 'b'] }, 100)
    expect((await listCases(root, { openOnly: true }))[0].seeds).toEqual(['a', 'b'])
  })
})
