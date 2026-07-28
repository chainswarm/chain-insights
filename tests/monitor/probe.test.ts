// tests/monitor/probe.test.ts
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { activityQuery, appendProbeCursor, initialProbeCursor, mergeActivityRows, readProbeCursors } from '../../src/monitor/probe.js'
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

describe('activity query + per-shard merge (victim lane spec req 4)', () => {
  it('builds ONE query over all watched addresses with the strict > $since bound', () => {
    const q = activityQuery(['5Aaa', '0xAb12'], 12345)
    expect(q).toContain('USE topology')
    expect(q).toContain("a.address IN ['5Aaa','0xAb12']")
    expect(q).toContain('a.last_activity_timestamp > 12345')
    expect(q).toContain('RETURN a.address AS address, a.last_activity_timestamp AS last_activity_timestamp')
  })

  it('refuses a non-chain address instead of escaping it', () => {
    expect(() => activityQuery(["5Aaa' RETURN 1 //"], 0)).toThrow(/not valid chain address/)
  })

  it('merges per-shard rows by MAX(last_activity_timestamp) per address', () => {
    const merged = mergeActivityRows([
      { address: '5Aaa', last_activity_timestamp: 100 },
      { address: '5Aaa', last_activity_timestamp: 300 },
      { address: '5Aaa', last_activity_timestamp: 200 },
      { address: '5Bbb', last_activity_timestamp: 50 },
    ])
    expect(merged.get('5Aaa')).toBe(300)
    expect(merged.get('5Bbb')).toBe(50)
  })

  it('ignores null/absent/non-numeric per-shard timestamps (spec assumption)', () => {
    const merged = mergeActivityRows([
      { address: '5Aaa', last_activity_timestamp: null },
      { address: '5Aaa' },
      { address: '5Aaa', last_activity_timestamp: 'soon' },
      { address: '5Bbb', last_activity_timestamp: null },
      { address: '5Aaa', last_activity_timestamp: 77 },
    ])
    expect(merged.get('5Aaa')).toBe(77)
    expect(merged.has('5Bbb')).toBe(false)
  })
})
