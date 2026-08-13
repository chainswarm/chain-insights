// src/monitor/report.ts
// Human-readable monitor status: open cases + the last run timestamp. Read-only
// view, safe to call any time. The run log is written by the CLI run/watch
// actions (one JSON line per run).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { listCases } from './cases.js'
import { monitorPaths } from './paths.js'

async function lastRunTimestamp(workspaceRoot: string): Promise<number | null> {
  const file = path.join(monitorPaths(workspaceRoot).logsDir, 'monitor-runs.jsonl')
  let lines: string[]
  try {
    lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  } catch {
    return null
  }
  const last = lines.at(-1)
  if (!last) return null
  try {
    const ts = (JSON.parse(last) as { run_timestamp?: unknown }).run_timestamp
    return typeof ts === 'number' ? ts : null
  } catch {
    return null
  }
}

export async function statusText(workspaceRoot: string): Promise<string> {
  const [cases, lastRun] = await Promise.all([
    listCases(workspaceRoot, { openOnly: true }),
    lastRunTimestamp(workspaceRoot),
  ])
  const lastRunText = lastRun === null ? 'never' : String(lastRun)
  const lines = [`open cases: ${cases.length} | last run: ${lastRunText}`]
  if (cases.length > 0) {
    lines.push('open cases:')
    for (const c of cases) {
      lines.push(`  ${c.case_id} [${c.type}/${c.network}]`)
    }
  }
  return lines.join('\n')
}