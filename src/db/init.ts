import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// Path derived at call time so tests can override HOME.
function dataDir(): string {
  return path.join(os.homedir(), '.chain-insights')
}
function dbPath(): string {
  return path.join(dataDir(), 'chain-insights.db')
}

// Module-level singleton — DuckDB holds a file lock per instance.
// Two instances on the same path = IO Error: Could not set lock on file.
let _instance: DuckDBInstance | null = null

export async function getDb(): Promise<DuckDBConnection> {
  if (!_instance) {
    fs.mkdirSync(dataDir(), { recursive: true })
    _instance = await DuckDBInstance.create(dbPath())
    // SECURITY T-01-03: restrict DB file to owner-readable only (investigation data)
    fs.chmodSync(dbPath(), 0o600)
  }
  return _instance.connect()
}

export async function initSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id         VARCHAR PRIMARY KEY,
      name       VARCHAR NOT NULL,
      status     VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn   = await getDb()
    await initSchema(conn)
    const reader = await conn.runAndReadAll('SELECT 1 AS ping')
    const rows   = reader.getRows()
    conn.closeSync()
    return { ok: rows.length === 1 }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// Reset for test isolation (vi.resetModules() is preferred; this is a fallback).
export function resetDbInstance(): void {
  _instance = null
}
