// DuckDB derived index (spec invariant 1): NEVER authoritative. Everything in
// here is reproducible from canonical workspace JSON via rebuildStore(). The
// writer holds the DB only inside withStore() (one-writer-many-readers rule).
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { parseFindingsDocument } from '../investigation/detection-findings.js'
import { monitorPaths } from './paths.js'

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

export async function withStore<T>(workspaceRoot: string, fn: (store: MonitorStore) => Promise<T>): Promise<T> {
  const { dbPath } = monitorPaths(workspaceRoot)
  await mkdir(path.dirname(dbPath), { recursive: true })
  const instance = await DuckDBInstance.create(dbPath)
  const connection = await instance.connect()
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
    for (const stmt of DDL.split(';').map((s) => s.trim()).filter(Boolean)) await store.run(stmt)
    return await fn(store)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
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

export async function ingestNewDocs(store: MonitorStore, workspaceRoot: string): Promise<number> {
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
