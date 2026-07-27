// Alert events (spec principle 3: signals become alerts). Canonical append-only
// JSONL; sinks are best-effort — a dead webhook must never fail a run.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'

export interface AlertEvent {
  alert_id: string
  type:
    | 'new_findings'
    | 'case_movement'
    // Corridor grew because seeds were added, not because funds moved (#250).
    | 'case_scope_expansion'
    | 'cashout_endpoint'
    | 'frontier_candidate'
    | 'watchlist_finding'
    | 'watchlist_movement'
    | 'watchlist_dust'
  network: string
  detector?: string
  case_id?: string
  address?: string
  count?: number
  doc_path?: string
  run_timestamp: number
  emitted_at_timestamp: number
}

// A missing log is "no alerts yet" (normal). A torn line inside an existing log
// costs that line only — never the whole file. See jsonl.ts for why.
async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  return parseJsonlLines<T>(raw, filePath).records
}

/** True when the log exists, is non-empty, and does not end in a newline. */
async function needsNewlineTerminator(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw.length > 0 && !raw.endsWith('\n')
  } catch {
    return false
  }
}

export async function emitAlerts(
  workspaceRoot: string,
  events: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[],
  nowTimestamp: number,
  sinks?: { webhookUrl?: string; execHook?: string },
): Promise<AlertEvent[]> {
  if (events.length === 0) return []
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.alertsDir, { recursive: true })
  const existing = await readJsonl<AlertEvent>(p.alertsLog)
  const seqBase = existing.filter((e) => e.run_timestamp === events[0].run_timestamp).length
  const stamped = events.map((e, i) => ({ ...e, alert_id: `${e.run_timestamp}-${seqBase + i}-${e.type}`, emitted_at_timestamp: nowTimestamp }))
  // A torn final line (kill mid-append) has no trailing newline, so a plain
  // append would concatenate onto it and destroy the NEW record too — one
  // crash would then cost every alert emitted afterwards. Re-terminate first
  // so the damage stays confined to the single torn line.
  await appendFile(p.alertsLog, (await needsNewlineTerminator(p.alertsLog)) ? '\n' : '', 'utf8')
  await appendFile(p.alertsLog, stamped.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  for (const event of stamped) {
    if (sinks?.webhookUrl) {
      try {
        await fetch(sinks.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
      } catch {
        // Best-effort sink: recorded in JSONL regardless; never fails the run.
      }
    }
    if (sinks?.execHook) {
      await new Promise<void>((resolve) => {
        const child = spawn(sinks.execHook as string, { shell: true, stdio: ['pipe', 'ignore', 'ignore'] })
        child.on('error', () => resolve())
        child.on('exit', () => resolve())
        child.stdin.end(JSON.stringify(event) + '\n')
      })
    }
  }
  return stamped
}

export async function listAlerts(workspaceRoot: string, opts?: { unackedOnly?: boolean }): Promise<AlertEvent[]> {
  const p = monitorPaths(workspaceRoot)
  const alerts = await readJsonl<AlertEvent>(p.alertsLog)
  if (!opts?.unackedOnly) return alerts
  const acked = new Set((await readJsonl<{ alert_id: string }>(p.acksLog)).map((a) => a.alert_id))
  return alerts.filter((a) => !acked.has(a.alert_id))
}

export async function ackAlert(workspaceRoot: string, alertId: string, nowTimestamp: number): Promise<void> {
  const p = monitorPaths(workspaceRoot)
  const alerts = await readJsonl<AlertEvent>(p.alertsLog)
  if (!alerts.some((a) => a.alert_id === alertId)) throw new Error(`unknown alert "${alertId}"`)
  await mkdir(p.alertsDir, { recursive: true })
  await appendFile(p.acksLog, JSON.stringify({ alert_id: alertId, acked_at_timestamp: nowTimestamp }) + '\n', 'utf8')
}
