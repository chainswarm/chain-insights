// Alert events (spec principle 3: signals become alerts). Canonical append-only
// JSONL; sinks are best-effort — a dead webhook must never fail a run.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { monitorPaths } from './paths.js'

export interface AlertEvent {
  alert_id: string
  type: 'new_findings' | 'case_movement' | 'cashout_endpoint' | 'frontier_candidate'
  network: string
  detector?: string
  case_id?: string
  address?: string
  count?: number
  doc_path?: string
  run_ms: number
  emitted_at_ms: number
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
  } catch {
    return []
  }
}

export async function emitAlerts(
  workspaceRoot: string,
  events: Omit<AlertEvent, 'alert_id' | 'emitted_at_ms'>[],
  nowMs: number,
  sinks?: { webhookUrl?: string; execHook?: string },
): Promise<AlertEvent[]> {
  if (events.length === 0) return []
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.alertsDir, { recursive: true })
  const existing = await readJsonl<AlertEvent>(p.alertsLog)
  const seqBase = existing.filter((e) => e.run_ms === events[0].run_ms).length
  const stamped = events.map((e, i) => ({ ...e, alert_id: `${e.run_ms}-${seqBase + i}-${e.type}`, emitted_at_ms: nowMs }))
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

export async function ackAlert(workspaceRoot: string, alertId: string, nowMs: number): Promise<void> {
  const p = monitorPaths(workspaceRoot)
  const alerts = await readJsonl<AlertEvent>(p.alertsLog)
  if (!alerts.some((a) => a.alert_id === alertId)) throw new Error(`unknown alert "${alertId}"`)
  await mkdir(p.alertsDir, { recursive: true })
  await appendFile(p.acksLog, JSON.stringify({ alert_id: alertId, acked_at_ms: nowMs }) + '\n', 'utf8')
}
