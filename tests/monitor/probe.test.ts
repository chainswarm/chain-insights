// tests/monitor/probe.test.ts
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendProbeCursor, initialProbeCursor, readProbeCursors } from '../../src/monitor/probe.js'
import { addCase } from '../../src/monitor/cases.js'
import { monitorPaths } from '../../src/monitor/paths.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-probe-'))
}

async function writeSnapshot(root: string, caseId: string, runTimestamp: number): Promise<void> {
  const dir = path.join(monitorPaths(root).casesDir, caseId, 'snapshots')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, `${runTimestamp}.snapshot.json`),
    JSON.stringify({ case_id: caseId, run_timestamp: runTimestamp, seed_set: ['5Seed'], addresses: [{ address: '5Seed' }] }),
    'utf8',
  )
}

describe('probe cursors (victim lane spec req 5)', () => {
  it('append + read round-trips; last line per network wins', async () => {
    const root = await ws()
    await appendProbeCursor(root, 'bittensor', 100, 1000)
    await appendProbeCursor(root, 'bittensor_evm', 50, 1000)
    await appendProbeCursor(root, 'bittensor', 300, 2000)
    const cursors = await readProbeCursors(root)
    expect(cursors.get('bittensor')).toBe(300)
    expect(cursors.get('bittensor_evm')).toBe(50)
  })

  it('no cursor file = empty map, and a torn line costs that line only', async () => {
    const root = await ws()
    expect((await readProbeCursors(root)).size).toBe(0)
    await appendProbeCursor(root, 'bittensor', 100, 1000)
    await appendFile(monitorPaths(root).probeCursorsLog, '{"network":"bittensor","since_', 'utf8')
    expect((await readProbeCursors(root)).get('bittensor')).toBe(100)
  })

  it('cursor lines are append-only JSONL on disk (rebuild-safe canonical log)', async () => {
    const root = await ws()
    await appendProbeCursor(root, 'bittensor', 100, 1000)
    await appendProbeCursor(root, 'bittensor', 200, 2000)
    const raw = await readFile(monitorPaths(root).probeCursorsLog, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(raw.trim().split('\n')[1])).toEqual({ network: 'bittensor', since_timestamp: 200, run_timestamp: 2000 })
  })

  it('initialProbeCursor = earliest first-trace timestamp on the network (pre-monitoring history never fires)', async () => {
    const root = await ws()
    await addCase(root, { case_id: 'c-a', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 10)
    await addCase(root, { case_id: 'c-b', type: 'stolen-funds', network: 'bittensor', seeds: ['5Seed'] }, 10)
    await addCase(root, { case_id: 'c-evm', type: 'stolen-funds', network: 'bittensor_evm', seeds: ['0xAb1'] }, 10)
    await writeSnapshot(root, 'c-a', 5000)
    await writeSnapshot(root, 'c-a', 9000)
    await writeSnapshot(root, 'c-b', 7000)
    await writeSnapshot(root, 'c-evm', 100)
    expect(await initialProbeCursor(root, 'bittensor', 99999)).toBe(5000)
  })

  it('initialProbeCursor falls back to NOW when no case on the network was ever traced', async () => {
    const root = await ws()
    expect(await initialProbeCursor(root, 'bittensor', 4242)).toBe(4242)
  })
})
