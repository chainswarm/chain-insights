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
    // Activity probe tripwire (victim lane spec req 4).
    | 'watchlist_activity'
    // Backend detection labeled a watched address (label-cutover spec req 1).
    // Diff-based: only a (label, source) pair NEW versus the canonical
    // last-seen baseline alerts; bootstrap is silent by design.
    | 'watchlist_label'
    // A managed entry of a CLOSED case moved again (label-lifecycle spec
    // req 4). Dedup rides the canonical hits log's source_ref dedup. The
    // case is NEVER auto-reopened — this alert is the whole mechanism.
    | 'case_reactivated'
  network: string
  detector?: string
  case_id?: string
  address?: string
  count?: number
  doc_path?: string
  // watchlist_label only: the new (label, source) pair. `source` is the
  // constant "topology" until the overlay exposes per-label provenance —
  // see the label-surface decision in the 2026-07-28 cutover plan.
  label?: string
  source?: string
  // watchlist_label only (label-governance Plan 3 D2): overlay-family-derived
  // severity. 'alert' = a verdict family (Scam/Mixer/Bridge/Poisoned/
  // Propagated) is present, OR no overlay family was extracted at all
  // (labels-text-only — today's behavior, conservative). 'context' = only
  // Attributed and/or Victim/Exchange are present. Other alert types leave
  // this undefined for now — not yet classified, never defaulted to 'alert'.
  severity?: 'alert' | 'context'
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

/** Canonical append only (outbox step 1). Stamps ids; delivers nothing. */
export async function appendAlerts(
  workspaceRoot: string,
  events: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[],
  nowTimestamp: number,
): Promise<AlertEvent[]> {
  if (events.length === 0) return []
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.alertsDir, { recursive: true })
  const existing = await readJsonl<AlertEvent>(p.alertsLog)
  // Sequence numbers are PER run_timestamp: a mixed-run batch (outbox
  // re-delivery + new work) must not mint an id that collides with a prior
  // emit for another run.
  const seq = new Map<number, number>()
  for (const e of existing) seq.set(e.run_timestamp, (seq.get(e.run_timestamp) ?? 0) + 1)
  const stamped = events.map((e) => {
    const n = seq.get(e.run_timestamp) ?? 0
    seq.set(e.run_timestamp, n + 1)
    return { ...e, alert_id: `${e.run_timestamp}-${n}-${e.type}`, emitted_at_timestamp: nowTimestamp }
  })
  // A torn final line (kill mid-append) has no trailing newline, so a plain
  // append would concatenate onto it and destroy the NEW record too — one
  // crash would then cost every alert emitted afterwards. Re-terminate first
  // so the damage stays confined to the single torn line.
  await appendFile(p.alertsLog, (await needsNewlineTerminator(p.alertsLog)) ? '\n' : '', 'utf8')
  await appendFile(p.alertsLog, stamped.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  return stamped
}

export const DEFAULT_HOOK_TIMEOUT_MS = 30000

/** Sink delivery + emitted marker (outbox step 3). Sinks stay best-effort; the
 *  marker is written per alert AFTER its sinks run, so a crash mid-delivery
 *  re-delivers only the tail (at-least-once). Every sink is bounded by
 *  hookTimeoutMs (R4): a hung webhook or hook script must never hang the run. */
export async function deliverAlerts(
  workspaceRoot: string,
  events: AlertEvent[],
  nowTimestamp: number,
  sinks?: { webhookUrl?: string; execHook?: string; hookTimeoutMs?: number },
): Promise<void> {
  if (events.length === 0) return
  const timeoutMs = sinks?.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.alertsDir, { recursive: true })
  for (const event of events) {
    if (sinks?.webhookUrl) {
      try {
        await fetch(sinks.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        // Best-effort sink: recorded in JSONL regardless; never fails the run.
        const name = (err as Error).name
        const isTimeout = name === 'TimeoutError' || name === 'AbortError'
        console.warn(`[monitor] webhook sink failed${isTimeout ? ` (timed out after ${timeoutMs}ms)` : ''}: ${(err as Error).message} (alert ${event.alert_id})`)
      }
    }
    if (sinks?.execHook) {
      let timedOut = false
      await new Promise<void>((resolve) => {
        const child = spawn(sinks.execHook as string, { shell: true, stdio: ['pipe', 'ignore', 'ignore'] })
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)
        child.on('error', () => { clearTimeout(timer); resolve() })
        child.on('exit', () => { clearTimeout(timer); resolve() })
        // A killed child's stdin raises EPIPE — swallow it, or the write throws.
        child.stdin.on('error', () => {})
        child.stdin.end(JSON.stringify(event) + '\n')
      })
      if (timedOut) console.warn(`[monitor] exec hook timed out after ${timeoutMs}ms and was killed (alert ${event.alert_id})`)
    }
    await appendFile(p.emittedLog, (await needsNewlineTerminator(p.emittedLog)) ? '\n' : '', 'utf8')
    await appendFile(p.emittedLog, JSON.stringify({ alert_id: event.alert_id, delivered_at_timestamp: nowTimestamp }) + '\n', 'utf8')
  }
}

/** Outbox read: alerts recorded canonically but never marked delivered. */
export async function listUndelivered(workspaceRoot: string): Promise<AlertEvent[]> {
  const p = monitorPaths(workspaceRoot)
  const alerts = await readJsonl<AlertEvent>(p.alertsLog)
  const delivered = new Set((await readJsonl<{ alert_id: string }>(p.emittedLog)).map((m) => m.alert_id))
  return alerts.filter((a) => !delivered.has(a.alert_id))
}

export async function emitAlerts(
  workspaceRoot: string,
  events: Omit<AlertEvent, 'alert_id' | 'emitted_at_timestamp'>[],
  nowTimestamp: number,
  sinks?: { webhookUrl?: string; execHook?: string; hookTimeoutMs?: number },
): Promise<AlertEvent[]> {
  const stamped = await appendAlerts(workspaceRoot, events, nowTimestamp)
  await deliverAlerts(workspaceRoot, stamped, nowTimestamp, sinks)
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
