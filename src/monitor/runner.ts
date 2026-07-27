// src/monitor/runner.ts
// The monitor run loop (spec principle 1): a SEQUENCE of tool calls — detection
// cores, case tracker, ingest, alert emit — with per-cell isolation. No
// detection logic lives here.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runOneDetection } from '../detection/run.js'
import type { AlertEvent } from './alerts.js'
import { emitAlerts } from './alerts.js'
import type { MonitorConfig } from './config.js'
import { monitorPaths } from './paths.js'
import { ingestNewDocs, withStore } from './store.js'
import { listCases } from './cases.js'
import { runWatchlistPass } from './watchlist-run.js'

export const MONITOR_EXIT_ISOLATED = 2

export interface CellOutcome {
  cell: string
  detector?: string
  case_id?: string
  network: string
  findings_count?: number
  movements_count?: number
  scope_expansions_count?: number
  findings_path?: string
  duration_ms: number
  error?: string
}

export interface MonitorRunDoc {
  run_ms: number
  halted?: string
  usage_before?: unknown
  usage_after?: unknown
  cells: CellOutcome[]
  alerts_emitted: number
}

export interface RunnerHooks {
  runDetection?: typeof runOneDetection
  traceCase?: (client: Client, workspaceRoot: string, caseId: string, maxHops: number, nowMs: number, hooks?: unknown, limits?: { limits?: Record<string, number>; networkLimits?: Record<string, Record<string, number>> }) => Promise<{ movements_count: number; scope_expansions_count?: number; alerts: Omit<AlertEvent, 'alert_id' | 'emitted_at_ms'>[] }>
  usage?: (client: Client) => Promise<unknown | null>
}

// Remote usage_status is optional (devkit serves it unmetered; a backend that
// refuses it yields null and the guard is skipped with a warning in the doc).
async function defaultUsage(client: Client): Promise<unknown | null> {
  try {
    const result = (await client.callTool({ name: 'usage_status', arguments: {} })) as { structuredContent?: unknown }
    return result.structuredContent ?? null
  } catch {
    return null
  }
}

// Reads the backend's remaining quota. The real usage_status tool response
// (see src/mcp/proxy.ts structuredContent forwarding) nests it at
// `facts.usage.remaining_seconds`; a simpler top-level `remaining` shape is
// also accepted so synthetic/test usage hooks keep working. Neither present
// means the backend does not carry quota data, so the guard is skipped.
function remainingOf(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const nested = (usage as { facts?: { usage?: { remaining_seconds?: unknown } } }).facts?.usage?.remaining_seconds
  if (typeof nested === 'number') return nested
  const flat = (usage as { remaining?: unknown }).remaining
  return typeof flat === 'number' ? flat : null
}

export async function runMonitorOnce(
  client: Client,
  workspaceRoot: string,
  config: MonitorConfig,
  nowMs: number,
  hooks: RunnerHooks = {},
): Promise<MonitorRunDoc> {
  const detect = hooks.runDetection ?? runOneDetection
  const usage = hooks.usage ?? defaultUsage
  const doc: MonitorRunDoc = { run_ms: nowMs, cells: [], alerts_emitted: 0 }
  doc.usage_before = await usage(client)

  const remaining = remainingOf(doc.usage_before)
  if (config.stopIfRemainingBelow !== undefined && remaining !== null && remaining < config.stopIfRemainingBelow) {
    doc.halted = `usage guard: remaining ${remaining} below floor ${config.stopIfRemainingBelow}`
  } else {
    const alertsPending: Omit<AlertEvent, 'alert_id' | 'emitted_at_ms'>[] = []
    for (const cell of config.cells) {
      const started = Date.now()
      const outcome: CellOutcome = { cell: `${cell.detector}:${cell.network}`, detector: cell.detector, network: cell.network, duration_ms: 0 }
      try {
        const result = await detect(client, { detector: cell.detector, network: cell.network, full: false, workspaceRoot, nowMs, params: cell.params ?? {} })
        outcome.findings_count = result.findingsCount
        outcome.findings_path = result.findingsPath
        if (result.findingsCount > 0) {
          alertsPending.push({ type: 'new_findings', network: cell.network, detector: cell.detector, count: result.findingsCount, doc_path: result.findingsPath, run_ms: nowMs })
        }
      } catch (err) {
        outcome.error = (err as Error).message
      }
      outcome.duration_ms = Date.now() - started
      doc.cells.push(outcome)
    }
    if (hooks.traceCase) {
      for (const openCase of await listCases(workspaceRoot, { openOnly: true })) {
        const started = Date.now()
        const outcome: CellOutcome = { cell: `case:${openCase.case_id}`, case_id: openCase.case_id, network: openCase.network, duration_ms: 0 }
        try {
          const traced = await hooks.traceCase(client, workspaceRoot, openCase.case_id, config.caseMaxHops, nowMs, undefined, { limits: config.limits, networkLimits: config.networkLimits })
          outcome.movements_count = traced.movements_count
          outcome.scope_expansions_count = traced.scope_expansions_count ?? 0
          alertsPending.push(...traced.alerts)
        } catch (err) {
          outcome.error = (err as Error).message
        }
        outcome.duration_ms = Date.now() - started
        doc.cells.push(outcome)
      }
    }
    // The watchlist pass runs LAST, because two of its three triggers are
    // joins over what the detection and case cells just wrote. An empty
    // watchlist returns calls: 0 and no hits, so no cell is pushed and
    // behavior is byte-identical to a run without the feature (AC-7).
    if (config.watchlist) {
      const started = Date.now()
      const outcome: CellOutcome = { cell: 'watchlist', network: '(all)', duration_ms: 0 }
      try {
        const pass = await withStore(workspaceRoot, async (store) =>
          runWatchlistPass(client, workspaceRoot, store, config, nowMs),
        )
        if (pass.hits.length > 0 || pass.calls > 0) {
          outcome.findings_count = pass.hits.length
          if (pass.error) outcome.error = pass.error
          alertsPending.push(...pass.alerts)
          outcome.duration_ms = Date.now() - started
          doc.cells.push(outcome)
        }
      } catch (err) {
        outcome.error = (err as Error).message
        outcome.duration_ms = Date.now() - started
        doc.cells.push(outcome)
      }
    }
    const emitted = await emitAlerts(workspaceRoot, alertsPending, nowMs, { webhookUrl: config.webhookUrl, execHook: config.execHook })
    doc.alerts_emitted = emitted.length
  }

  doc.usage_after = await usage(client)
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.runsDir, { recursive: true })
  await writeFile(path.join(p.runsDir, `${nowMs}.run.json`), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  await withStore(workspaceRoot, async (store) => ingestNewDocs(store, workspaceRoot))
  return doc
}
