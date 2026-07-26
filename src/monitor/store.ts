// DuckDB derived index (spec invariant 1): NEVER authoritative. Everything in
// here is reproducible from canonical workspace JSON via rebuildStore(). The
// writer holds the DB only inside withStore() (one-writer-many-readers rule).
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { parseFindingsDocument } from '../investigation/detection-findings.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import { diffSnapshots, readSnapshots, type CaseSnapshot } from './tracker.js'

export interface MonitorStore {
  run(sql: string, params?: unknown[]): Promise<void>
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

export interface DocIngestor {
  kind: string
  listDocs(workspaceRoot: string): Promise<string[]>
  ingest(store: MonitorStore, workspaceRoot: string, filePath: string): Promise<void>
}

// Later tasks register their canonical sources here (runs, alerts, cases,
// snapshots, reviews). Order matters only for foreign-key-free inserts, so
// plain append is fine.
export const INGESTORS: DocIngestor[] = []

const DDL = `
CREATE TABLE IF NOT EXISTS ingested_docs (doc_path VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL);
CREATE TABLE IF NOT EXISTS findings (
  doc_path VARCHAR, tool VARCHAR, detector VARCHAR, network VARCHAR,
  generated_at_ms BIGINT, address VARCHAR, classification VARCHAR, gate VARCHAR,
  truncated BOOLEAN, inconclusive BOOLEAN
);
CREATE TABLE IF NOT EXISTS finding_addresses (doc_path VARCHAR, network VARCHAR, address VARCHAR);
CREATE TABLE IF NOT EXISTS scan_runs (
  run_ms BIGINT, cell VARCHAR, detector VARCHAR, case_id VARCHAR, network VARCHAR,
  findings_count INTEGER, movements_count INTEGER, duration_ms BIGINT,
  error VARCHAR, usage_before VARCHAR, usage_after VARCHAR, halted VARCHAR
);
CREATE TABLE IF NOT EXISTS cases (
  case_id VARCHAR, type VARCHAR, network VARCHAR, status VARCHAR,
  seed_count INTEGER, created_at_ms BIGINT, closed_at_ms BIGINT
);
CREATE TABLE IF NOT EXISTS case_snapshots (
  case_id VARCHAR, run_ms BIGINT, doc_path VARCHAR, address_count INTEGER, seed_count INTEGER
);
CREATE TABLE IF NOT EXISTS case_movements (
  case_id VARCHAR, run_ms BIGINT, movement VARCHAR, address VARCHAR, details VARCHAR
);
CREATE TABLE IF NOT EXISTS review_decisions (
  doc_path VARCHAR, decision VARCHAR, reviewer VARCHAR, decided_at_ms BIGINT, reviewed_copy VARCHAR
);
CREATE TABLE IF NOT EXISTS alerts (
  alert_id VARCHAR, type VARCHAR, network VARCHAR, detector VARCHAR, case_id VARCHAR,
  address VARCHAR, run_ms BIGINT, emitted_at_ms BIGINT
);
CREATE TABLE IF NOT EXISTS alert_acks (alert_id VARCHAR, acked_at_ms BIGINT);
-- Reserved for phase 2 (spec): created empty, never written in v1.
CREATE TABLE IF NOT EXISTS watchlist (address VARCHAR, network VARCHAR, note VARCHAR);
`

export interface WithStoreOptions {
  /**
   * Open the derived DB read-only. Read paths (`monitor status`, `monitor
   * report`) MUST use this: DuckDB permits many concurrent read-only holders
   * of one file but only ONE read-write holder, so two read-write readers
   * conflict with each other for no reason (verified cross-process against
   * @duckdb/node-api: RO+RO succeeds, RO+RW fails on the file lock).
   *
   * It does NOT make a read survive a concurrent WRITER — DuckDB's
   * read-write lock is exclusive against read-only opens too. That window is
   * handled by the bounded retry below, which is also what turns the raw
   * "Could not set lock on file" IO error into an actionable message.
   */
  readOnly?: boolean
}

const LOCK_RETRIES = 5
const LOCK_RETRY_DELAY_MS = 200

function isLockError(err: unknown): boolean {
  return /Could not set lock on file|Conflicting lock/i.test((err as Error)?.message ?? '')
}

export async function withStore<T>(
  workspaceRoot: string,
  fn: (store: MonitorStore) => Promise<T>,
  options?: WithStoreOptions,
): Promise<T> {
  const { dbPath } = monitorPaths(workspaceRoot)
  await mkdir(path.dirname(dbPath), { recursive: true })
  // Read-only is only possible once the file exists — DuckDB cannot create a
  // database in READ_ONLY mode. A first-ever `status`/`report` therefore falls
  // back to a normal read-write open, which also lays down the DDL.
  const readOnly = options?.readOnly === true && existsSync(dbPath)
  const { instance, connection } = await openStore(dbPath, readOnly)
  const store: MonitorStore = {
    async run(sql, params) {
      await connection.run(sql, params as never)
    },
    async all(sql, params) {
      const reader = await connection.runAndReadAll(sql, params as never)
      return reader.getRowObjects() as Record<string, unknown>[]
    },
  }
  try {
    // A read-only handle cannot run DDL, and does not need to: the file only
    // exists because some earlier read-write open already created every table.
    if (!readOnly) {
      for (const stmt of DDL.split(';').map((s) => s.trim()).filter(Boolean)) await store.run(stmt)
    }
    return await fn(store)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

/**
 * Open instance + connection, retrying past a transient file-lock conflict
 * (a concurrent `monitor run` ingest window). Two things matter here:
 *  - if connect() throws after create() succeeded, the instance handle must be
 *    closed, or the process leaks it AND keeps holding the file lock;
 *  - a lock conflict that outlives the retries gets a message that names the
 *    cause instead of a raw DuckDB IO error.
 */
async function openStore(
  dbPath: string,
  readOnly: boolean,
): Promise<{ instance: DuckDBInstance; connection: Awaited<ReturnType<DuckDBInstance['connect']>> }> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
    let instance: DuckDBInstance | undefined
    try {
      instance = await DuckDBInstance.create(dbPath, readOnly ? { access_mode: 'READ_ONLY' } : undefined)
      const connection = await instance.connect()
      return { instance, connection }
    } catch (err) {
      // create() may have succeeded and connect() thrown — never leak it.
      instance?.closeSync()
      lastErr = err
      if (!isLockError(err) || attempt === LOCK_RETRIES) break
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
    }
  }
  if (isLockError(lastErr)) {
    throw new Error(
      `monitor store ${dbPath} is locked by another Chain Insights process (likely a "cia monitor run" ingest in progress). Retry in a moment.`,
    )
  }
  throw lastErr
}

async function listFindingsDocs(workspaceRoot: string): Promise<string[]> {
  const dir = monitorPaths(workspaceRoot).detectionsDir
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  // Reviewed copies live in detections/reviewed/ — readdir(dir) does not
  // recurse, so they are naturally excluded from sweep-findings ingest.
  return entries.filter((f) => f.endsWith('.findings.json')).map((f) => path.join(dir, f)).sort()
}

// Filename shape (emit.ts): <generated_at_ms>-<detector>-<network>.findings.json
function detectorFromFilename(filePath: string): string {
  const base = path.basename(filePath, '.findings.json')
  const parts = base.split('-')
  return parts.slice(1, -1).join('-') || 'unknown'
}

const findingsIngestor: DocIngestor = {
  kind: 'findings',
  listDocs: listFindingsDocs,
  async ingest(store, _workspaceRoot, filePath) {
    const doc = parseFindingsDocument(JSON.parse(await readFile(filePath, 'utf8')))
    const detector = detectorFromFilename(filePath)
    for (const f of doc.findings) {
      await store.run(
        'INSERT INTO findings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [filePath, doc.tool, detector, doc.network, doc.generated_at_ms, f.address, f.classification ?? null, f.gate ?? null, f.truncated, f.inconclusive],
      )
      await store.run('INSERT INTO finding_addresses VALUES ($1,$2,$3)', [filePath, doc.network, f.address])
    }
  },
}
INGESTORS.push(findingsIngestor)

function jsonlIngestor(kind: 'alerts' | 'acks', logPathOf: (root: string) => string, insert: (store: MonitorStore, line: Record<string, unknown>) => Promise<void>): DocIngestor {
  return {
    kind,
    async listDocs(workspaceRoot) {
      const log = logPathOf(workspaceRoot)
      try {
        await readFile(log, 'utf8')
        return [log]
      } catch {
        return []
      }
    },
    // Line-tolerant, exactly like the alerts.ts list path: a torn final line
    // (kill mid-append) must not wedge the run loop's final ingest step, and
    // must not make `monitor rebuild` unable to recover.
    async ingest(store, _workspaceRoot, filePath) {
      const raw = await readFile(filePath, 'utf8')
      const { records } = parseJsonlLines<Record<string, unknown>>(raw, filePath)
      for (const line of records) await insert(store, line)
    },
  }
}

INGESTORS.push(
  jsonlIngestor('alerts', (root) => monitorPaths(root).alertsLog, async (store, e) => {
    await store.run('INSERT INTO alerts VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [e.alert_id, e.type, e.network, e.detector ?? null, e.case_id ?? null, e.address ?? null, e.run_ms, e.emitted_at_ms])
  }),
  jsonlIngestor('acks', (root) => monitorPaths(root).acksLog, async (store, a) => {
    await store.run('INSERT INTO alert_acks VALUES ($1,$2)', [a.alert_id, a.acked_at_ms])
  }),
)

INGESTORS.push({
  kind: 'runs',
  async listDocs(workspaceRoot) {
    const dir = monitorPaths(workspaceRoot).runsDir
    try {
      return (await readdir(dir)).filter((f) => f.endsWith('.run.json')).map((f) => path.join(dir, f)).sort()
    } catch {
      return []
    }
  },
  async ingest(store, _workspaceRoot, filePath) {
    const doc = JSON.parse(await readFile(filePath, 'utf8')) as { run_ms: number; halted?: string; usage_before?: unknown; usage_after?: unknown; cells: Array<Record<string, unknown>> }
    if (doc.cells.length === 0) {
      await store.run('INSERT INTO scan_runs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [doc.run_ms, '(run)', null, null, null, null, null, null, null, JSON.stringify(doc.usage_before ?? null), JSON.stringify(doc.usage_after ?? null), doc.halted ?? null])
      return
    }
    for (const c of doc.cells) {
      await store.run('INSERT INTO scan_runs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [doc.run_ms, c.cell, c.detector ?? null, c.case_id ?? null, c.network, c.findings_count ?? null, c.movements_count ?? null, c.duration_ms, c.error ?? null, JSON.stringify(doc.usage_before ?? null), JSON.stringify(doc.usage_after ?? null), doc.halted ?? null])
    }
  },
})

interface CaseDoc {
  case_id: string
  type: string
  network: string
  status: string
  seeds: string[]
  created_at_ms: number
  closed_at_ms?: number
}

INGESTORS.push({
  kind: 'cases',
  async listDocs(workspaceRoot) {
    const dir = monitorPaths(workspaceRoot).casesDir
    let ids: string[]
    try {
      ids = await readdir(dir)
    } catch {
      return []
    }
    const docs: string[] = []
    for (const id of ids.sort()) {
      const file = path.join(dir, id, 'case.json')
      try {
        await readFile(file, 'utf8')
        docs.push(file)
      } catch {
        // A cases/ subdir without case.json is not a monitor case — skip.
      }
    }
    return docs
  },
  async ingest(store, _workspaceRoot, filePath) {
    const doc = JSON.parse(await readFile(filePath, 'utf8')) as CaseDoc
    await store.run(
      'INSERT INTO cases VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [doc.case_id, doc.type, doc.network, doc.status, doc.seeds.length, doc.created_at_ms, doc.closed_at_ms ?? null],
    )
  },
})

INGESTORS.push({
  kind: 'snapshots',
  async listDocs(workspaceRoot) {
    const dir = monitorPaths(workspaceRoot).casesDir
    let ids: string[]
    try {
      ids = await readdir(dir)
    } catch {
      return []
    }
    const docs: string[] = []
    for (const id of ids.sort()) {
      const snapDir = path.join(dir, id, 'snapshots')
      try {
        const files = (await readdir(snapDir)).filter((f) => f.endsWith('.snapshot.json')).sort()
        for (const f of files) docs.push(path.join(snapDir, f))
      } catch {
        // A case with no snapshots yet — skip.
      }
    }
    return docs
  },
  async ingest(store, workspaceRoot, filePath) {
    const doc = JSON.parse(await readFile(filePath, 'utf8')) as CaseSnapshot
    await store.run(
      'INSERT INTO case_snapshots VALUES ($1,$2,$3,$4,$5)',
      [doc.case_id, doc.run_ms, filePath, doc.addresses.length, doc.seed_set.length],
    )
    // Movements are DERIVED, not canonical: recompute from the case's full
    // ordered snapshot list and insert rows for THIS snapshot only. Diffing
    // against the same predecessor every time this doc is ingested keeps the
    // result deterministic per doc_path, so re-ingest (never happens under
    // ingested_docs, but rebuildStore replays every doc) is idempotent.
    const all = await readSnapshots(workspaceRoot, doc.case_id)
    const index = all.findIndex((s) => s.run_ms === doc.run_ms)
    const prev = index > 0 ? all[index - 1] : null
    const movements = diffSnapshots(prev, doc)
    for (const m of movements) {
      await store.run(
        'INSERT INTO case_movements VALUES ($1,$2,$3,$4,$5)',
        [doc.case_id, doc.run_ms, m.type, m.address, JSON.stringify(m.details)],
      )
    }
  },
})

interface ReviewDecisionDoc {
  doc_path: string
  decision: 'approve' | 'reject'
  reviewer: string
  decided_at_ms: number
  reviewed_copy?: string
}

// Decision docs are IMMUTABLE (unique <decided_at_ms>-<decision>.review.json
// filenames per approveDoc/rejectDoc, never rewritten in place), so this is
// plain seen-once ingest — not one of the REPLAY_TABLES below.
INGESTORS.push({
  kind: 'reviews',
  async listDocs(workspaceRoot) {
    const dir = monitorPaths(workspaceRoot).reviewsDir
    try {
      return (await readdir(dir)).filter((f) => f.endsWith('.review.json')).map((f) => path.join(dir, f)).sort()
    } catch {
      return []
    }
  },
  async ingest(store, _workspaceRoot, filePath) {
    const doc = JSON.parse(await readFile(filePath, 'utf8')) as ReviewDecisionDoc
    await store.run(
      'INSERT INTO review_decisions VALUES ($1,$2,$3,$4,$5)',
      [doc.doc_path, doc.decision, doc.reviewer, doc.decided_at_ms, doc.reviewed_copy ?? null],
    )
  },
})

// Rewritable/growing sources: their canonical doc is appended-to (alerts,
// acks logs) or rewritten in place (case.json via closeCase), so the derived
// table cannot be trusted to already hold a prior ingest's rows — wipe the
// table and re-ingest from scratch every pass.
const REPLAY_TABLES: Partial<Record<string, string>> = { alerts: 'alerts', acks: 'alert_acks', cases: 'cases' }

export async function ingestNewDocs(store: MonitorStore, workspaceRoot: string): Promise<number> {
  for (const ingestor of INGESTORS) {
    const table = REPLAY_TABLES[ingestor.kind]
    if (!table) continue
    for (const filePath of await ingestor.listDocs(workspaceRoot)) {
      await store.run(`DELETE FROM ${table}`)
      await store.run('DELETE FROM ingested_docs WHERE doc_path = $1', [filePath])
    }
  }
  const seen = new Set(
    (await store.all('SELECT doc_path FROM ingested_docs')).map((r) => String(r.doc_path)),
  )
  let ingested = 0
  for (const ingestor of INGESTORS) {
    for (const filePath of await ingestor.listDocs(workspaceRoot)) {
      if (seen.has(filePath)) continue
      await ingestor.ingest(store, workspaceRoot, filePath)
      await store.run('INSERT INTO ingested_docs VALUES ($1,$2)', [filePath, ingestor.kind])
      ingested += 1
    }
  }
  return ingested
}

export async function rebuildStore(workspaceRoot: string): Promise<number> {
  const { dbPath } = monitorPaths(workspaceRoot)
  await rm(dbPath, { force: true })
  return withStore(workspaceRoot, async (store) => ingestNewDocs(store, workspaceRoot))
}
