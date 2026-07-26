// src/monitor/report.ts
// Human-readable rollup over derived store state (scan_runs, case_movements)
// plus the canonical review/alert readers. Never writes to the store —
// report/status are read-only views, safe to call any time.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listAlerts } from './alerts.js'
import { listCases } from './cases.js'
import type { MonitorConfig } from './config.js'
import { monitorPaths } from './paths.js'
import { listPending } from './review.js'
import { withStore } from './store.js'

interface ScanRunRow {
  run_ms: bigint | number
  cell: string
  network: string | null
  findings_count: number | null
  movements_count: number | null
  duration_ms: bigint | number | null
  error: string | null
}

interface CaseMovementRow {
  case_id: string
  run_ms: bigint | number
  movement: string
  address: string
}

function num(value: bigint | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

export async function renderReport(workspaceRoot: string): Promise<string> {
  // readOnly: report never writes, and a read-write open would needlessly
  // conflict with any other concurrent reader on the same DuckDB file.
  const { runs, movements } = await withStore(workspaceRoot, async (store) => ({
    runs: (await store.all(
      'SELECT run_ms, cell, network, findings_count, movements_count, duration_ms, error FROM scan_runs ORDER BY run_ms DESC LIMIT 10',
    )) as unknown as ScanRunRow[],
    movements: (await store.all(
      'SELECT case_id, run_ms, movement, address FROM case_movements ORDER BY case_id, run_ms',
    )) as unknown as CaseMovementRow[],
  }), { readOnly: true })
  const pending = await listPending(workspaceRoot)
  const alerts = await listAlerts(workspaceRoot, { unackedOnly: true })

  const lines: string[] = ['# Chain Insights Monitor Report', '', '## Runs', '']
  if (runs.length === 0) {
    lines.push('(no runs yet)')
  } else {
    lines.push(
      '| run_ms | cell | network | findings | movements | duration_ms | error |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const r of runs) {
      lines.push(
        `| ${num(r.run_ms)} | ${r.cell} | ${r.network ?? ''} | ${r.findings_count ?? ''} | ${r.movements_count ?? ''} | ${num(r.duration_ms) ?? ''} | ${r.error ?? ''} |`,
      )
    }
  }

  lines.push('', '## Pending review', '')
  if (pending.length === 0) {
    lines.push('(none)')
  } else {
    for (const p of pending) lines.push(`- ${p.doc_path} — ${p.tool}:${p.network} (${p.findings_count} findings)`)
  }

  lines.push('', '## Unacked alerts', '')
  if (alerts.length === 0) {
    lines.push('(none)')
  } else {
    for (const a of alerts) lines.push(`- ${a.alert_id} — ${a.type}:${a.network}${a.detector ? ` ${a.detector}` : ''}`)
  }

  lines.push('', '## Case timelines', '')
  if (movements.length === 0) {
    lines.push('(none)')
  } else {
    const byCase = new Map<string, CaseMovementRow[]>()
    for (const m of movements) {
      const list = byCase.get(m.case_id) ?? []
      list.push(m)
      byCase.set(m.case_id, list)
    }
    for (const caseId of [...byCase.keys()].sort()) {
      lines.push(`### ${caseId}`, '')
      for (const m of byCase.get(caseId) ?? []) lines.push(`${num(m.run_ms)} — ${m.movement} — ${m.address}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

export async function writeReport(workspaceRoot: string, nowMs: number): Promise<string> {
  const md = await renderReport(workspaceRoot)
  const dir = monitorPaths(workspaceRoot).reportsDir
  await mkdir(dir, { recursive: true })
  const reportPath = path.join(dir, `report-${nowMs}.md`)
  await writeFile(reportPath, md, 'utf8')
  return reportPath
}

export async function statusText(workspaceRoot: string, config: MonitorConfig): Promise<string> {
  const [cases, pending, alerts, lastRunRows] = await Promise.all([
    listCases(workspaceRoot, { openOnly: true }),
    listPending(workspaceRoot),
    listAlerts(workspaceRoot, { unackedOnly: true }),
    withStore(workspaceRoot, (store) => store.all('SELECT MAX(run_ms) AS last_run FROM scan_runs'), { readOnly: true }),
  ])
  const lastRun = num(lastRunRows[0]?.last_run as bigint | number | null | undefined)
  const lastRunText = lastRun === null ? 'never' : String(lastRun)
  return `cells: ${config.cells.length} | open cases: ${cases.length} | pending reviews: ${pending.length} | unacked alerts: ${alerts.length} | last run: ${lastRunText}`
}
