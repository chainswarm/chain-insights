// src/monitor/report.ts
// Human-readable rollup over derived store state (scan_runs, case_movements)
// plus the canonical review/alert readers. Never writes to the store —
// report/status are read-only views, safe to call any time.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listAlerts } from './alerts.js'
import { listCases } from './cases.js'
import { caseClosableStatus } from './closable.js'
import { resolvedProfile, resolvedTraceMode, type MonitorConfig } from './config.js'
import { monitorPaths } from './paths.js'
import { listPending } from './review.js'
import { withStore } from './store.js'

interface ScanRunRow {
  run_timestamp: bigint | number
  cell: string
  network: string | null
  findings_count: number | null
  movements_count: number | null
  duration_ms: bigint | number | null
  error: string | null
}

interface CaseMovementRow {
  case_id: string
  run_timestamp: bigint | number
  movement: string
  address: string
}

interface WatchlistRow {
  network: string
  address: string
  findings: bigint | number | null
  movements: bigint | number | null
  dust: bigint | number | null
}

function num(value: bigint | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

// A `|` or newline in a value (e.g. an error message) would break the Markdown
// table row it is interpolated into — escape/flatten before interpolation.
function mdCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export async function renderReport(workspaceRoot: string): Promise<string> {
  // readOnly: report never writes, and a read-write open would needlessly
  // conflict with any other concurrent reader on the same DuckDB file.
  const { runs, movements, watchlist } = await withStore(workspaceRoot, async (store) => ({
    runs: (await store.all(
      'SELECT run_timestamp, cell, network, findings_count, movements_count, duration_ms, error FROM scan_runs ORDER BY run_timestamp DESC LIMIT 10',
    )) as unknown as ScanRunRow[],
    movements: (await store.all(
      'SELECT case_id, run_timestamp, movement, address FROM case_movements ORDER BY case_id, run_timestamp',
    )) as unknown as CaseMovementRow[],
    watchlist: (await store.all(
      `SELECT w.network AS network, w.address AS address,
              sum(CASE WHEN h.trigger = 'finding' THEN 1 ELSE 0 END) AS findings,
              sum(CASE WHEN h.trigger = 'movement' THEN 1 ELSE 0 END) AS movements,
              sum(CASE WHEN h.trigger = 'dust' THEN 1 ELSE 0 END) AS dust
         FROM watchlist w
         LEFT JOIN watchlist_hits h ON h.address = w.address AND h.network = w.network
        GROUP BY w.network, w.address
        ORDER BY w.network, w.address`,
    )) as unknown as WatchlistRow[],
  }), { readOnly: true })
  const pending = await listPending(workspaceRoot)
  const alerts = await listAlerts(workspaceRoot, { unackedOnly: true })

  const lines: string[] = ['# Chain Insights Monitor Report', '', '## Runs', '']
  if (runs.length === 0) {
    lines.push('(no runs yet)')
  } else {
    lines.push(
      '| run_timestamp | cell | network | findings | movements | duration_ms | error |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const r of runs) {
      lines.push(
        `| ${num(r.run_timestamp)} | ${mdCell(r.cell)} | ${mdCell(r.network)} | ${r.findings_count ?? ''} | ${r.movements_count ?? ''} | ${num(r.duration_ms) ?? ''} | ${mdCell(r.error)} |`,
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

  // Omitted entirely when nothing is watched, so a report from a workspace
  // without the feature is unchanged.
  if (watchlist.length > 0) {
    lines.push('', '## Watchlist', '')
    lines.push('| network | address | findings | movements | dust |', '| --- | --- | --- | --- | --- |')
    for (const w of watchlist) {
      lines.push(
        `| ${mdCell(w.network)} | ${mdCell(w.address)} | ${num(w.findings) ?? 0} | ${num(w.movements) ?? 0} | ${num(w.dust) ?? 0} |`,
      )
    }
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
      for (const m of byCase.get(caseId) ?? []) lines.push(`${num(m.run_timestamp)} — ${m.movement} — ${m.address}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

export async function writeReport(workspaceRoot: string, nowTimestamp: number): Promise<string> {
  const md = await renderReport(workspaceRoot)
  const dir = monitorPaths(workspaceRoot).reportsDir
  await mkdir(dir, { recursive: true })
  const reportPath = path.join(dir, `report-${nowTimestamp}.md`)
  await writeFile(reportPath, md, 'utf8')
  return reportPath
}

export async function statusText(workspaceRoot: string, config: MonitorConfig, nowTimestamp: number = Date.now()): Promise<string> {
  const [cases, pending, alerts, lastRunRows] = await Promise.all([
    listCases(workspaceRoot, { openOnly: true }),
    listPending(workspaceRoot),
    listAlerts(workspaceRoot, { unackedOnly: true }),
    withStore(workspaceRoot, (store) => store.all('SELECT MAX(run_timestamp) AS last_run FROM scan_runs'), { readOnly: true }),
  ])
  const lastRun = num(lastRunRows[0]?.last_run as bigint | number | null | undefined)
  const lastRunText = lastRun === null ? 'never' : String(lastRun)
  const lines = [
    `profile: ${resolvedProfile(config)} | trace_mode: ${resolvedTraceMode(config)} | cells: ${config.cells.length} | open cases: ${cases.length} | pending reviews: ${pending.length} | unacked alerts: ${alerts.length} | last run: ${lastRunText}`,
  ]
  // Per-case lines (label-lifecycle spec req 2): scam-topology cases carry
  // the labeled/dormant flags and the `-> closable` marker; other case types
  // are listed without a marker. Close remains a human action.
  if (cases.length > 0) {
    lines.push('open cases:')
    for (const c of cases) {
      if (c.type === 'scam-topology') {
        const s = await caseClosableStatus(workspaceRoot, c, config.render.dormant_after_days, nowTimestamp)
        lines.push(`  ${c.case_id} [${c.type}/${c.network}] labeled=${s.labeled ? 'yes' : 'no'} dormant=${s.dormant ? 'yes' : 'no'}${s.closable ? ' -> closable' : ''}`)
      } else {
        lines.push(`  ${c.case_id} [${c.type}/${c.network}]`)
      }
    }
  }
  return lines.join('\n')
}
