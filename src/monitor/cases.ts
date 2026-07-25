// src/monitor/cases.ts
// Case registry (spec UC-6/UC-7). cases/<id>/case.json is canonical; the store
// `cases` table is derived. A case is incident-centric (a theft, a scam
// cluster) — distinct from the phase-2 my-address watchlist.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { monitorPaths } from './paths.js'

export interface MonitorCase {
  case_id: string
  type: 'stolen-funds' | 'scam-topology'
  network: string
  seeds: string[]
  status: 'open' | 'closed'
  created_at_ms: number
  closed_at_ms?: number
  note?: string
}

const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

function caseFile(workspaceRoot: string, caseId: string): string {
  return path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'case.json')
}

export async function addCase(
  workspaceRoot: string,
  input: { case_id: string; type: MonitorCase['type']; network: string; seeds: string[]; note?: string },
  nowMs: number,
): Promise<MonitorCase> {
  if (!CASE_ID_RE.test(input.case_id)) throw new Error(`case_id must match ${CASE_ID_RE}, got "${input.case_id}"`)
  if (input.seeds.length === 0) throw new Error('a case needs at least one seed address')
  const file = caseFile(workspaceRoot, input.case_id)
  const exists = await readFile(file, 'utf8').then(() => true).catch(() => false)
  if (exists) throw new Error(`case "${input.case_id}" already exists`)
  const created: MonitorCase = { ...input, status: 'open', created_at_ms: nowMs }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(created, null, 2) + '\n', 'utf8')
  return created
}

export async function listCases(workspaceRoot: string, opts?: { openOnly?: boolean }): Promise<MonitorCase[]> {
  const dir = monitorPaths(workspaceRoot).casesDir
  let ids: string[]
  try {
    ids = await readdir(dir)
  } catch {
    return []
  }
  const cases: MonitorCase[] = []
  for (const id of ids.sort()) {
    try {
      cases.push(JSON.parse(await readFile(caseFile(workspaceRoot, id), 'utf8')) as MonitorCase)
    } catch {
      // A cases/ subdir without case.json (e.g. an investigation case dir from
      // the wider workspace) is not a monitor case — skip, never throw.
    }
  }
  return opts?.openOnly ? cases.filter((c) => c.status === 'open') : cases
}

export async function closeCase(workspaceRoot: string, caseId: string, nowMs: number): Promise<MonitorCase> {
  const file = caseFile(workspaceRoot, caseId)
  const current = JSON.parse(await readFile(file, 'utf8')) as MonitorCase
  const closed: MonitorCase = { ...current, status: 'closed', closed_at_ms: nowMs }
  await writeFile(file, JSON.stringify(closed, null, 2) + '\n', 'utf8')
  return closed
}
