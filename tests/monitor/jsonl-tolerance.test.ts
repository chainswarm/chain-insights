// tests/monitor/jsonl-tolerance.test.ts
// Regression: a torn/corrupt line in alerts.jsonl (realistic after a kill
// mid-append) used to break the list path and the ingest path in OPPOSITE
// directions — list silently returned [] (every alert vanished), ingest threw
// (so every later `monitor run` exited 1 and `monitor rebuild` never
// recovered). Both paths must now skip exactly the torn line and agree.
import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ackAlert, emitAlerts, listAlerts } from '../../src/monitor/alerts.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { ingestNewDocs, rebuildStore, withStore } from '../../src/monitor/store.js'
import { parseJsonlLines } from '../../src/monitor/jsonl.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-jsonl-'))
}

/** Emit two good alerts, then tear the log with a truncated trailing append. */
async function seedTornAlertsLog(root: string): Promise<{ goodIds: string[]; alertsLog: string }> {
  const good = await emitAlerts(
    root,
    [
      { type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 3, run_timestamp: 500 },
      { type: 'cashout_endpoint', network: 'bittensor', address: '0xexchange', run_timestamp: 500 },
    ],
    1000,
  )
  const { alertsLog } = monitorPaths(root)
  // Exactly what a kill mid-appendFile leaves behind: a partial JSON object
  // with no closing brace and no trailing newline.
  await appendFile(alertsLog, '{"alert_id":"500-2-new_findings","type":"new_fin', 'utf8')
  return { goodIds: good.map((g) => g.alert_id), alertsLog }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('parseJsonlLines', () => {
  it('keeps good records, reports the torn line by 1-based line number, and warns', () => {
    const raw = '{"a":1}\n{"a":2}\n{"a":3\n{"a":4}\n'
    const { records, skipped } = parseJsonlLines<{ a: number }>(raw, '/tmp/x.jsonl')
    expect(records).toEqual([{ a: 1 }, { a: 2 }, { a: 4 }])
    expect(skipped.map((s) => s.lineNumber)).toEqual([3])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping unparseable line 3 in /tmp/x.jsonl'))
  })

  it('ignores blank lines without counting them as damage', () => {
    const { records, skipped } = parseJsonlLines<{ a: number }>('{"a":1}\n\n{"a":2}\n', '/tmp/x.jsonl')
    expect(records).toEqual([{ a: 1 }, { a: 2 }])
    expect(skipped).toEqual([])
  })
})

describe('torn alerts.jsonl (#212)', () => {
  it('list keeps every good alert instead of silently returning [] ', async () => {
    const root = await ws()
    const { goodIds } = await seedTornAlertsLog(root)
    // BEFORE the fix this was [] — total silent data loss to the user.
    expect((await listAlerts(root)).map((a) => a.alert_id)).toEqual(goodIds)
    expect((await listAlerts(root, { unackedOnly: true })).map((a) => a.alert_id)).toEqual(goodIds)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping unparseable line'))
  })

  it('ingest does not throw, so the run loop is not wedged', async () => {
    const root = await ws()
    const { goodIds } = await seedTornAlertsLog(root)
    // BEFORE the fix this rejected, and `cia monitor run` exited 1 at its
    // final ingest step on every subsequent pass.
    await expect(withStore(root, (store) => ingestNewDocs(store, root))).resolves.toBeGreaterThan(0)
    const rows = await withStore(root, (s) => s.all('SELECT alert_id FROM alerts ORDER BY alert_id'))
    expect(rows.map((r) => r.alert_id)).toEqual(goodIds)
  })

  it('list and ingest agree on exactly which alerts survived', async () => {
    const root = await ws()
    await seedTornAlertsLog(root)
    const listed = (await listAlerts(root)).map((a) => a.alert_id).sort()
    await withStore(root, (store) => ingestNewDocs(store, root))
    const ingested = (await withStore(root, (s) => s.all('SELECT alert_id FROM alerts'))).map((r) => String(r.alert_id)).sort()
    expect(ingested).toEqual(listed)
    expect(listed).not.toHaveLength(0)
  })

  it('rebuild recovers from the torn file without hand-editing it', async () => {
    const root = await ws()
    const { goodIds } = await seedTornAlertsLog(root)
    // BEFORE the fix rebuild replayed the same bad line and threw again.
    await expect(rebuildStore(root)).resolves.toBeGreaterThan(0)
    const rows = await withStore(root, (s) => s.all('SELECT alert_id FROM alerts ORDER BY alert_id'))
    expect(rows.map((r) => r.alert_id)).toEqual(goodIds)
  })

  it('a torn acks.jsonl line likewise costs only that ack', async () => {
    const root = await ws()
    const [event] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_timestamp: 500 }], 1000)
    await ackAlert(root, event.alert_id, 2000)
    await appendFile(monitorPaths(root).acksLog, '{"alert_id":"tor', 'utf8')
    expect(await listAlerts(root, { unackedOnly: true })).toHaveLength(0)
    await expect(rebuildStore(root)).resolves.toBeGreaterThan(0)
    const acks = await withStore(root, (s) => s.all('SELECT alert_id FROM alert_acks'))
    expect(acks.map((r) => r.alert_id)).toEqual([event.alert_id])
  })

  it('an intact log still parses with no warning at all', async () => {
    const root = await ws()
    await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_timestamp: 500 }], 1000)
    expect(await listAlerts(root)).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a torn line does not corrupt alert_id sequencing for the next emit', async () => {
    const root = await ws()
    await seedTornAlertsLog(root)
    const [next] = await emitAlerts(root, [{ type: 'new_findings', network: 'bittensor', detector: 'mixer', count: 1, run_timestamp: 500 }], 3000)
    // Two good run_timestamp=500 events survive, so the next sequence number is 2.
    expect(next.alert_id).toBe('500-2-new_findings')
    expect((await listAlerts(root)).map((a) => a.alert_id)).toContain(next.alert_id)
  })

  it('a findings doc is still strict — malformed detection JSON must NOT be silently skipped', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, '1-mixer-bittensor.findings.json'), '{ not json')
    // Tolerance is scoped to append-only JSONL logs only.
    await expect(withStore(root, (store) => ingestNewDocs(store, root))).rejects.toThrow()
  })
})
