// tests/monitor/hardening.test.ts
// Regressions for the monitor hardening batch (#214): read-only store opens,
// workspace-relative review doc paths, loud config read errors, no leaked
// DuckDB instance handle, and strict RFC-4180 CSV quoting.
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadMonitorConfig } from '../../src/monitor/config.js'
import { exportLabels } from '../../src/monitor/export.js'
import { monitorPaths } from '../../src/monitor/paths.js'
import { renderReport, statusText } from '../../src/monitor/report.js'
import { approveDoc, listPending, rejectDoc, resolveDocPath, listDecisionDocs } from '../../src/monitor/review.js'
import { withStore } from '../../src/monitor/store.js'

async function ws(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cia-harden-'))
}

function findingsDoc(address: string, network = 'bittensor'): string {
  return JSON.stringify({
    schema: 'chain-insights.detection-findings.v1',
    tool: 'aml_mixer_likeness',
    network,
    status: 'complete',
    generated_at_ms: 1,
    findings: [{ address, classification: 'mixer_hourglass', evidence: {}, truncated: false, inconclusive: false }],
  })
}

describe('store read-only opens (#214.1)', () => {
  it('opens read-only once the DB exists and refuses writes through that handle', async () => {
    const root = await ws()
    await withStore(root, async (store) => store.run("INSERT INTO scan_runs VALUES (1,'c',NULL,NULL,'bittensor',0,0,5,NULL,NULL,NULL,NULL)"))
    const rows = await withStore(root, (s) => s.all('SELECT cell FROM scan_runs'), { readOnly: true })
    expect(rows.map((r) => r.cell)).toEqual(['c'])
    // Proof the handle really is read-only, not just labelled so.
    await expect(
      withStore(root, (s) => s.run('CREATE TABLE proof_of_readonly (x INT)'), { readOnly: true }),
    ).rejects.toThrow()
  })

  it('two concurrent read-only opens coexist (read-write opens conflict on the file lock)', async () => {
    const root = await ws()
    await withStore(root, async () => undefined)
    // The whole point of item 1: readers must not block readers. DuckDB allows
    // many READ_ONLY holders of one file but only one read-write holder.
    const results = await Promise.all(
      Array.from({ length: 4 }, () => withStore(root, (s) => s.all('SELECT count(*) AS n FROM scan_runs'), { readOnly: true })),
    )
    expect(results).toHaveLength(4)
  })

  it('falls back to a read-write create when the DB does not exist yet', async () => {
    const root = await ws()
    // READ_ONLY cannot create a database; a first-ever status/report must still
    // work rather than fail with a raw DuckDB error.
    const rows = await withStore(root, (s) => s.all('SELECT count(*) AS n FROM scan_runs'), { readOnly: true })
    expect(Number(rows[0].n)).toBe(0)
  })

  it('status and report run against a read-only handle and leave the DB unmodified', async () => {
    const root = await ws()
    await withStore(root, async (store) => store.run("INSERT INTO scan_runs VALUES (42,'cell-a',NULL,NULL,'bittensor',1,0,5,NULL,NULL,NULL,NULL)"))
    const { dbPath } = monitorPaths(root)
    const before = await readFile(dbPath)
    const config = await loadMonitorConfig(root)
    expect(await statusText(root, config)).toContain('last run: 42')
    expect(await renderReport(root)).toContain('cell-a')
    expect(await readFile(dbPath)).toEqual(before)
  })
})

describe('review doc path base (#214.2)', () => {
  it('resolves a relative doc path against the workspace root, not process.cwd()', () => {
    const root = path.join(tmpdir(), 'some-workspace')
    expect(resolveDocPath(root, 'detections/x.findings.json')).toBe(path.join(root, 'detections', 'x.findings.json'))
    // Absolute paths pass through untouched.
    const abs = path.join(root, 'detections', 'y.findings.json')
    expect(resolveDocPath(root, abs)).toBe(abs)
  })

  it('approving by relative path from a SUBDIRECTORY of the workspace clears it from pending', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    const docPath = path.join(dir, '1-mixer-bittensor.findings.json')
    await writeFile(docPath, findingsDoc('mix1'))
    const subdir = path.join(root, 'cases')
    await mkdir(subdir, { recursive: true })

    const cwd = process.cwd()
    try {
      process.chdir(subdir)
      // BEFORE the fix this resolved against <root>/cases and threw ENOENT.
      await approveDoc(root, 'detections/1-mixer-bittensor.findings.json', 'ops', 100)
    } finally {
      process.chdir(cwd)
    }
    expect(await listPending(root)).toHaveLength(0)
    expect((await listDecisionDocs(root))[0].doc_path).toBe(docPath)
    // And the reviewed copy is the one the label export reads.
    const { rows } = await exportLabels(root, 999)
    expect(rows.map((r) => r.address)).toEqual(['mix1'])
  })

  it('rejecting by relative path from a subdirectory records the workspace-based doc_path', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    const docPath = path.join(dir, '2-mixer-bittensor.findings.json')
    await writeFile(docPath, findingsDoc('mix2'))
    const subdir = path.join(root, 'reports')
    await mkdir(subdir, { recursive: true })

    const cwd = process.cwd()
    try {
      process.chdir(subdir)
      await rejectDoc(root, 'detections/2-mixer-bittensor.findings.json', 'ops', 200)
    } finally {
      process.chdir(cwd)
    }
    expect((await listDecisionDocs(root))[0].doc_path).toBe(docPath)
    expect(await listPending(root)).toHaveLength(0)
  })
})

describe('loadMonitorConfig error surfacing (#214.3)', () => {
  it('still defaults to the A6 matrix when the config file is simply absent', async () => {
    const root = await ws()
    expect((await loadMonitorConfig(root)).cells).toHaveLength(8)
  })

  it('throws on a non-ENOENT read error instead of silently monitoring the default matrix', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    // A directory where the config file should be reproduces an EISDIR read
    // error deterministically, including as root (unlike a chmod 000 file).
    await mkdir(p.configPath, { recursive: true })
    await expect(loadMonitorConfig(root)).rejects.toThrow(/Cannot read monitor config/)
  })

  it('throws on an unreadable config file (permission error), when not running as root', async () => {
    const root = await ws()
    const p = monitorPaths(root)
    await mkdir(p.monitorDir, { recursive: true })
    await writeFile(p.configPath, JSON.stringify({ cells: [{ detector: 'mixer', network: 'bittensor' }] }))
    await chmod(p.configPath, 0o000)
    if (typeof process.getuid === 'function' && process.getuid() === 0) return // root bypasses the mode bits
    await expect(loadMonitorConfig(root)).rejects.toThrow(/Cannot read monitor config/)
  })
})

describe('withStore handle lifetime (#214.4)', () => {
  it('does not leak the DuckDB handle when the callback throws', async () => {
    const root = await ws()
    await expect(withStore(root, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // If the instance had leaked, it would still hold the file lock and this
    // second open would fail with a DuckDB lock IO error.
    await expect(withStore(root, (s) => s.all('SELECT 1 AS x'))).resolves.toHaveLength(1)
  })

  it('releases the instance when connect() fails after create() succeeded', async () => {
    const root = await ws()
    const { DuckDBInstance } = await import('@duckdb/node-api')
    const instances: Array<{ closed: boolean }> = []
    const realCreate = DuckDBInstance.create.bind(DuckDBInstance)
    const spy = vi.spyOn(DuckDBInstance, 'create').mockImplementation(async (...args: Parameters<typeof realCreate>) => {
      const inst = await realCreate(...args)
      const marker = { closed: false }
      instances.push(marker)
      const realClose = inst.closeSync.bind(inst)
      inst.closeSync = () => { marker.closed = true; realClose() }
      inst.connect = async () => { throw new Error('connect failed') }
      return inst
    })
    try {
      await expect(withStore(root, async () => undefined)).rejects.toThrow('connect failed')
    } finally {
      spy.mockRestore()
    }
    expect(instances).toHaveLength(1)
    expect(instances[0].closed).toBe(true)
  })
})

describe('csvField RFC-4180 quoting (#214.5)', () => {
  it('quotes a bare carriage return, not just LF/comma/quote', async () => {
    const root = await ws()
    const dir = monitorPaths(root).detectionsDir
    await mkdir(dir, { recursive: true })
    const docPath = path.join(dir, '1-mixer-bittensor.findings.json')
    await writeFile(docPath, findingsDoc('mix-cr'))
    // A reviewer id carrying a bare CR is the realistic vector (pasted value).
    await approveDoc(root, docPath, 'ops\rteam', 100)
    const { csvPath } = await exportLabels(root, 999)
    const csv = await readFile(csvPath, 'utf8')
    // BEFORE the fix this field was emitted unquoted, terminating the record
    // early for a strict RFC-4180 reader.
    expect(csv).toContain('"ops\rteam"')
  })
})
