// DuckDB derived index (spec invariant 1): NEVER authoritative. Everything in
// here is reproducible from canonical workspace JSON via rebuildStore(). The
// writer holds the DB only inside withStore() (one-writer-many-readers rule).
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { parseFindingsDocument } from '../investigation/detection-findings.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import { diffScopeExpansion, diffSnapshots, type CaseSnapshot } from './tracker.js'
import { loadWatchlist } from './watchlist.js'

export interface MonitorStore {
  run(sql: string, params?: unknown[]): Promise<void>
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

export interface DocIngestor {
  kind: string
  listDocs(workspaceRoot: string): Promise<string[]>
  ingest(store: MonitorStore, workspaceRoot: string, filePath: string): Promise<void>
  /** Cursor-managed JSONL source: ingest() consumes only bytes past replay_cursors. */
  incremental?: boolean
}

// Later tasks register their canonical sources here (runs, alerts, cases,
// snapshots, reviews). Order matters only for foreign-key-free inserts, so
// plain append is fine.
export const INGESTORS: DocIngestor[] = []

const DDL = `
CREATE TABLE IF NOT EXISTS ingested_docs (doc_path VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL);
CREATE TABLE IF NOT EXISTS findings (
  doc_path VARCHAR, tool VARCHAR, detector VARCHAR, network VARCHAR,
  generated_at_timestamp BIGINT, address VARCHAR, classification VARCHAR, gate VARCHAR,
  truncated BOOLEAN, inconclusive BOOLEAN
);
CREATE TABLE IF NOT EXISTS finding_addresses (doc_path VARCHAR, network VARCHAR, address VARCHAR);
CREATE TABLE IF NOT EXISTS scan_runs (
  run_timestamp BIGINT, cell VARCHAR, detector VARCHAR, case_id VARCHAR, network VARCHAR,
  findings_count INTEGER, movements_count INTEGER, duration_ms BIGINT,
  error VARCHAR, usage_before VARCHAR, usage_after VARCHAR, halted VARCHAR
);
CREATE TABLE IF NOT EXISTS cases (
  case_id VARCHAR, type VARCHAR, network VARCHAR, status VARCHAR,
  seed_count INTEGER, created_at_timestamp BIGINT, closed_at_timestamp BIGINT
);
CREATE TABLE IF NOT EXISTS case_snapshots (
  case_id VARCHAR, run_timestamp BIGINT, doc_path VARCHAR, address_count INTEGER, seed_count INTEGER
);
CREATE TABLE IF NOT EXISTS case_movements (
  case_id VARCHAR, run_timestamp BIGINT, movement VARCHAR, address VARCHAR, details VARCHAR
);
CREATE TABLE IF NOT EXISTS review_decisions (
  doc_path VARCHAR, decision VARCHAR, reviewer VARCHAR, decided_at_timestamp BIGINT, reviewed_copy VARCHAR
);
CREATE TABLE IF NOT EXISTS alerts (
  alert_id VARCHAR, type VARCHAR, network VARCHAR, detector VARCHAR, case_id VARCHAR,
  address VARCHAR, run_timestamp BIGINT, emitted_at_timestamp BIGINT
);
CREATE TABLE IF NOT EXISTS alert_acks (alert_id VARCHAR, acked_at_timestamp BIGINT);
-- Watchlist: derived from the operator-owned watchlist.json.
CREATE TABLE IF NOT EXISTS watchlist (address VARCHAR, network VARCHAR, note VARCHAR);
CREATE TABLE IF NOT EXISTS watchlist_hits (
  run_timestamp BIGINT, address VARCHAR, network VARCHAR, trigger VARCHAR,
  source_ref VARCHAR, detail VARCHAR
);
-- Incremental-ingest cursors (durability spec req 5). They live in the same
-- DB file, so rebuildStore's rm resets them and rebuild stays full replay.
CREATE TABLE IF NOT EXISTS replay_cursors (doc_path VARCHAR PRIMARY KEY, byte_offset BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_cursors (case_id VARCHAR PRIMARY KEY, last_run_timestamp BIGINT NOT NULL);
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

/** Workspace-relative, forward-slash-normalized store doc key (R6): survives a
 *  workspace move/rename without re-ingesting or losing dedup state. */
function relDocKey(workspaceRoot: string, filePath: string): string {
  return path.relative(path.resolve(workspaceRoot), filePath).split(path.sep).join('/')
}

// Transparent legacy migration (spec assumption): rows written before R6 hold
// absolute paths under the CURRENT workspace root — strip the prefix in place.
// Runs on every read-write open; rebuildStore produces relative keys natively.
async function migrateAbsoluteDocKeys(store: MonitorStore, workspaceRoot: string): Promise<void> {
  const prefix = path.resolve(workspaceRoot) + path.sep
  const targets: Array<[table: string, column: string, extra: string]> = [
    ['ingested_docs', 'doc_path', ''],
    ['findings', 'doc_path', ''],
    ['finding_addresses', 'doc_path', ''],
    ['replay_cursors', 'doc_path', ''],
    ['watchlist_hits', 'source_ref', " AND trigger = 'finding'"],
  ]
  for (const [table, column, extra] of targets) {
    // substr only (1-based): the store only ever wrote path.join output on the
    // current platform, so no separator rewrite is needed beyond the strip.
    await store.run(
      `UPDATE ${table} SET ${column} = substr(${column}, $2) WHERE ${column} LIKE $1 || '%'${extra}`,
      [prefix, prefix.length + 1],
    )
  }
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
      // "On store open" migration contract (lifecycle spec R6): both monitor
      // run and rebuild pass through a read-write open, so any legacy
      // absolute keys are relativized before they can miss a dedup match.
      await migrateAbsoluteDocKeys(store, workspaceRoot)
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

// Filename shape (emit.ts): <generated_at_timestamp>-<detector>-<network>.findings.json
function detectorFromFilename(filePath: string): string {
  const base = path.basename(filePath, '.findings.json')
  const parts = base.split('-')
  return parts.slice(1, -1).join('-') || 'unknown'
}

const findingsIngestor: DocIngestor = {
  kind: 'findings',
  listDocs: listFindingsDocs,
  async ingest(store, workspaceRoot, filePath) {
    const doc = parseFindingsDocument(JSON.parse(await readFile(filePath, 'utf8')))
    const detector = detectorFromFilename(filePath)
    // Relative doc keys (R6): findingHits' source_ref is workspace-relative
    // from day one, so a moved workspace keeps its dedup history.
    const key = relDocKey(workspaceRoot, filePath)
    for (const f of doc.findings) {
      await store.run(
        'INSERT INTO findings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [key, doc.tool, detector, doc.network, doc.generated_at_timestamp, f.address, f.classification ?? null, f.gate ?? null, f.truncated, f.inconclusive],
      )
      await store.run('INSERT INTO finding_addresses VALUES ($1,$2,$3)', [key, doc.network, f.address])
    }
  },
}
INGESTORS.push(findingsIngestor)

function jsonlIngestor(kind: 'alerts' | 'acks' | 'watchlist_hits', logPathOf: (root: string) => string, insert: (store: MonitorStore, line: Record<string, unknown>) => Promise<void>): DocIngestor {
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
    incremental: true,
    // Cursor-managed (spec req 5): read only bytes past the stored offset and
    // advance the cursor to the last COMPLETE line — a torn tail (no trailing
    // newline yet) stays unconsumed and is picked up whole on the next pass.
    // Still line-tolerant like the alerts.ts list path: a malformed complete
    // line costs that line only, never the run or the rebuild.
    async ingest(store, workspaceRoot, filePath) {
      const raw = await readFile(filePath)
      // Cursor keys are workspace-relative too (R6), so a moved workspace
      // does not restart every JSONL log from byte 0.
      const key = relDocKey(workspaceRoot, filePath)
      const [cur] = await store.all('SELECT byte_offset FROM replay_cursors WHERE doc_path = $1', [key])
      const offset = cur ? Number(cur.byte_offset) : 0
      if (raw.length <= offset) return
      const chunk = raw.subarray(offset)
      const lastNewline = chunk.lastIndexOf(0x0a)
      if (lastNewline < 0) return
      const complete = chunk.subarray(0, lastNewline + 1)
      const { records } = parseJsonlLines<Record<string, unknown>>(complete.toString('utf8'), filePath)
      for (const line of records) await insert(store, line)
      await store.run(
        'INSERT INTO replay_cursors VALUES ($1,$2) ON CONFLICT (doc_path) DO UPDATE SET byte_offset = excluded.byte_offset',
        [key, offset + complete.length],
      )
    },
  }
}

INGESTORS.push(
  jsonlIngestor('alerts', (root) => monitorPaths(root).alertsLog, async (store, e) => {
    await store.run('INSERT INTO alerts VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [e.alert_id, e.type, e.network, e.detector ?? null, e.case_id ?? null, e.address ?? null, e.run_timestamp, e.emitted_at_timestamp])
  }),
  jsonlIngestor('acks', (root) => monitorPaths(root).acksLog, async (store, a) => {
    await store.run('INSERT INTO alert_acks VALUES ($1,$2)', [a.alert_id, a.acked_at_timestamp])
  }),
  // Replay index for the canonical watchlist-hits log (durability spec req 1):
  // rebuildStore repopulates watchlist_hits from here, so dedup survives it.
  jsonlIngestor('watchlist_hits', (root) => monitorPaths(root).watchlistHitsLog, async (store, h) => {
    await store.run('INSERT INTO watchlist_hits VALUES ($1,$2,$3,$4,$5,$6)', [h.run_timestamp, h.address, h.network, h.trigger, h.source_ref, h.detail ?? null])
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
    const doc = JSON.parse(await readFile(filePath, 'utf8')) as { run_timestamp: number; halted?: string; usage_before?: unknown; usage_after?: unknown; cells: Array<Record<string, unknown>> }
    if (doc.cells.length === 0) {
      await store.run('INSERT INTO scan_runs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [doc.run_timestamp, '(run)', null, null, null, null, null, null, null, JSON.stringify(doc.usage_before ?? null), JSON.stringify(doc.usage_after ?? null), doc.halted ?? null])
      return
    }
    for (const c of doc.cells) {
      await store.run('INSERT INTO scan_runs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [doc.run_timestamp, c.cell, c.detector ?? null, c.case_id ?? null, c.network, c.findings_count ?? null, c.movements_count ?? null, c.duration_ms, c.error ?? null, JSON.stringify(doc.usage_before ?? null), JSON.stringify(doc.usage_after ?? null), doc.halted ?? null])
    }
  },
})

interface CaseDoc {
  case_id: string
  type: string
  network: string
  status: string
  seeds: string[]
  created_at_timestamp: number
  closed_at_timestamp?: number
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
      [doc.case_id, doc.type, doc.network, doc.status, doc.seeds.length, doc.created_at_timestamp, doc.closed_at_timestamp ?? null],
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
      [doc.case_id, doc.run_timestamp, filePath, doc.addresses.length, doc.seed_set.length],
    )
    // Movements are DERIVED, not canonical. O(1) predecessor lookup (spec
    // req 5): list filenames, parse ONLY the immediate predecessor snapshot
    // instead of the whole history. Snapshots are append-only, so a given
    // doc's predecessor never changes — the diff stays deterministic per
    // doc_path and rebuildStore replay is idempotent.
    const snapDir = path.join(monitorPaths(workspaceRoot).casesDir, doc.case_id, 'snapshots')
    const stamps = (await readdir(snapDir))
      .filter((f) => f.endsWith('.snapshot.json'))
      .map((f) => Number(f.replace('.snapshot.json', '')))
      .filter((t) => Number.isFinite(t) && t < doc.run_timestamp)
      .sort((a, b) => a - b)
    const prevStamp = stamps.at(-1)
    const prev = prevStamp === undefined
      ? null
      : (JSON.parse(await readFile(path.join(snapDir, `${prevStamp}.snapshot.json`), 'utf8')) as CaseSnapshot)
    // Both halves of the diff land in case_movements, distinguished by the
    // `movement` value: scope_expansion rows explain a widened aperture and
    // must never be read as funds having moved (#250).
    const movements = [...diffSnapshots(prev, doc), ...diffScopeExpansion(prev, doc)]
    for (const m of movements) {
      await store.run(
        'INSERT INTO case_movements VALUES ($1,$2,$3,$4,$5)',
        [doc.case_id, doc.run_timestamp, m.type, m.address, JSON.stringify(m.details)],
      )
    }
    await store.run(
      'INSERT INTO snapshot_cursors VALUES ($1,$2) ON CONFLICT (case_id) DO UPDATE SET last_run_timestamp = excluded.last_run_timestamp',
      [doc.case_id, doc.run_timestamp],
    )
  },
})

interface ReviewDecisionDoc {
  doc_path: string
  decision: 'approve' | 'reject'
  reviewer: string
  decided_at_timestamp: number
  reviewed_copy?: string
}

// Decision docs are IMMUTABLE (unique <decided_at_timestamp>-<decision>.review.json
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
      [doc.doc_path, doc.decision, doc.reviewer, doc.decided_at_timestamp, doc.reviewed_copy ?? null],
    )
  },
})

// The watchlist is small, operator-owned, and fully replaced on every ingest —
// it is a REPLAY_TABLES source (below) so an edited or shrunk watchlist
// re-syncs instead of a removed address lingering.
INGESTORS.push({
  kind: 'watchlist',
  async listDocs(workspaceRoot) {
    const { watchlistPath } = monitorPaths(workspaceRoot)
    try {
      await readFile(watchlistPath, 'utf8')
      return [watchlistPath]
    } catch {
      return []
    }
  },
  async ingest(store, workspaceRoot) {
    for (const entry of await loadWatchlist(workspaceRoot)) {
      await store.run('INSERT INTO watchlist VALUES ($1,$2,$3)', [entry.address, entry.network, entry.note ?? null])
    }
  },
})

// Rewritable/growing sources: their canonical doc is appended-to (alerts,
// acks logs) or rewritten in place (case.json via closeCase), so the derived
// table cannot be trusted to already hold a prior ingest's rows — wipe the
// table and re-ingest from scratch every pass.
const REPLAY_TABLES: Partial<Record<string, string>> = { cases: 'cases', watchlist: 'watchlist' }

// Per-doc quarantine (durability spec req 3): a malformed doc costs THAT doc,
// never the run or the rebuild. Rename-to-.corrupt makes the wedge cause
// visible and stops the doc being retried forever. JSONL logs are exempt —
// parseJsonlLines already tolerates torn lines, and renaming a whole log
// would destroy its good records.
const QUARANTINE_EXEMPT = new Set(['alerts', 'acks', 'watchlist_hits'])

export async function ingestNewDocs(store: MonitorStore, workspaceRoot: string): Promise<number> {
  for (const ingestor of INGESTORS) {
    const table = REPLAY_TABLES[ingestor.kind]
    if (!table) continue
    for (const filePath of await ingestor.listDocs(workspaceRoot)) {
      await store.run(`DELETE FROM ${table}`)
      await store.run('DELETE FROM ingested_docs WHERE doc_path = $1', [relDocKey(workspaceRoot, filePath)])
    }
  }
  // Cursor-managed JSONL sources run every pass, outside the seen-set: their
  // ingest() is O(new bytes) by construction. A pass that consumed new bytes
  // (cursor advanced) counts as one ingested doc toward the return value.
  let ingested = 0
  const cursorOf = async (filePath: string): Promise<number> => {
    const [cur] = await store.all('SELECT byte_offset FROM replay_cursors WHERE doc_path = $1', [relDocKey(workspaceRoot, filePath)])
    return cur ? Number(cur.byte_offset) : 0
  }
  for (const ingestor of INGESTORS) {
    if (!ingestor.incremental) continue
    for (const filePath of await ingestor.listDocs(workspaceRoot)) {
      const before = await cursorOf(filePath)
      await ingestor.ingest(store, workspaceRoot, filePath)
      if ((await cursorOf(filePath)) > before) ingested += 1
    }
  }
  const seen = new Set(
    (await store.all('SELECT doc_path FROM ingested_docs')).map((r) => String(r.doc_path)),
  )
  for (const ingestor of INGESTORS) {
    if (ingestor.incremental) continue
    for (const filePath of await ingestor.listDocs(workspaceRoot)) {
      const key = relDocKey(workspaceRoot, filePath)
      if (seen.has(key)) continue
      try {
        await ingestor.ingest(store, workspaceRoot, filePath)
      } catch (err) {
        if (QUARANTINE_EXEMPT.has(ingestor.kind)) throw err
        console.warn(`[monitor] quarantining malformed ${ingestor.kind} doc ${filePath}: ${(err as Error).message}`)
        await rename(filePath, `${filePath}.corrupt`)
        continue
      }
      await store.run('INSERT INTO ingested_docs VALUES ($1,$2)', [key, ingestor.kind])
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
