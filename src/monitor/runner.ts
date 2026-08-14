// src/monitor/runner.ts
// The monitor run loop (case tracking only): one pass per open case, rendering
// its dossier from the case document. No detection cells, no ingest, no alert
// delivery — the run document carries one outcome per case.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { listCases } from './cases.js'
import type { MonitorConfig } from './config.js'
import { renderCaseFromDoc } from './render/index.js'

export interface CaseOutcome {
  case_id: string
  rendered?: boolean
  skipped_reason?: string
  duration_ms: number
  error?: string
}

export interface MonitorRunDoc {
  run_timestamp: number
  cases: CaseOutcome[]
}

export async function runMonitorOnce(
  client: Client,
  workspaceRoot: string,
  config: MonitorConfig,
  nowTimestamp: number,
): Promise<MonitorRunDoc> {
  const cases = await listCases(workspaceRoot, { openOnly: true })
  const outcomes: CaseOutcome[] = []
  for (const c of cases) {
    const started = Date.now()
    try {
      const r = await renderCaseFromDoc(workspaceRoot, c.case_id, config, nowTimestamp)
      outcomes.push({ case_id: c.case_id, rendered: r.rendered, skipped_reason: r.skipped_reason, duration_ms: Date.now() - started })
    } catch (err) {
      outcomes.push({ case_id: c.case_id, duration_ms: Date.now() - started, error: (err as Error).message })
    }
  }
  return { run_timestamp: nowTimestamp, cases: outcomes }
}