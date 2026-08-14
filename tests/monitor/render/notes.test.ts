import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAddressNotes, writeTimeline, publishedCaseDir } from '../../../src/monitor/render/notes.js'
import type { MonitorCase } from '../../../src/monitor/cases.js'

async function ws(): Promise<string> { return mkdtemp(path.join(tmpdir(), 'cia-notes-')) }

const CASE: MonitorCase = {
  case_id: 'c1', type: 'stolen-funds', network: 'bittensor', seeds: ['seed1', 'dep1'],
  status: 'open', created_at_timestamp: 1_750_000_000_000,
  seeds_added_at_timestamp: { dep1: 1_753_000_000_000 },
  seed_events: [
    { action: 'add', addresses: ['dep1'], at_timestamp: 1_753_000_000_000, note: 'second controlled wallet' },
    { action: 'remove', addresses: ['seed'], at_timestamp: 1_754_000_000_000 },
  ],
}

describe('writeAddressNotes', () => {
  it('writes one note per seed with a dossier link', async () => {
    const root = await ws()
    const files = await writeAddressNotes(root, 'c1', CASE)
    const dir = path.join(publishedCaseDir(root, 'c1'), 'addresses')
    expect((await readdir(dir)).sort()).toEqual(['dep1.md', 'seed1.md'])
    const dep = await readFile(path.join(dir, 'dep1.md'), 'utf8')
    expect(dep).toContain('../dossier.md')
    expect(dep).toContain('Added: 2025-07-20')
    expect(files.length).toBe(2)
  })
})

describe('writeTimeline', () => {
  it('overwrites the timeline from the case seed events', async () => {
    const root = await ws()
    await writeTimeline(root, 'c1', CASE)
    const file = await writeTimeline(root, 'c1', { ...CASE, seed_events: [...(CASE.seed_events ?? []), { action: 'add', addresses: ['dep2'], at_timestamp: 1_754_500_000_000 }] })
    const timeline = await readFile(file, 'utf8')
    expect(timeline.startsWith('# Timeline — c1')).toBe(true)
    expect(timeline).toContain('case created with 2 seed(s)')
    expect(timeline).toContain('add dep1')
    expect(timeline).toContain('remove seed')
    expect(timeline).toContain('add dep2')
    expect(timeline.match(/dep1/g)?.length).toBe(1)
  })
})