// src/monitor/render/verdict.ts
// ACTIVE/DORMANT headline verdict from the case document. Pure — no fs, no
// network. Without trace data, activity means changes to the case itself:
// creation and seed events (add/remove).
import type { MonitorCase } from '../cases.js'

export interface CaseVerdict {
  status: 'active' | 'dormant'
  /** Newest case-activity timestamp (epoch milliseconds): creation or the
   *  latest seed event. Null when the case carries neither. */
  lastActivityTimestamp: number | null
  /** Headline line for the dossier, e.g. "ACTIVE (last activity 2026-07-20)"
   *  or "DORMANT since 2026-06-01". */
  headline: string
}

const DAY_MS = 86_400_000

function utcDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10)
}

/** Newest of created_at and every seed event timestamp. Pure. */
export function lastCaseActivity(monitorCase: MonitorCase): number | null {
  let newest: number | null = monitorCase.created_at_timestamp
  for (const e of monitorCase.seed_events ?? []) {
    if (e.at_timestamp > newest) newest = e.at_timestamp
  }
  return newest
}

export function computeVerdict(
  monitorCase: MonitorCase,
  nowTimestamp: number,
  dormantAfterDays: number,
): CaseVerdict {
  const last = lastCaseActivity(monitorCase)
  // Boundary rule: age exactly equal to the threshold is DORMANT.
  if (last !== null && nowTimestamp - last < dormantAfterDays * DAY_MS) {
    return { status: 'active', lastActivityTimestamp: last, headline: `ACTIVE (last activity ${utcDate(last)})` }
  }
  if (last === null) {
    return {
      status: 'dormant',
      lastActivityTimestamp: null,
      headline: `DORMANT (no activity recorded since monitoring began ${utcDate(monitorCase.created_at_timestamp)})`,
    }
  }
  return { status: 'dormant', lastActivityTimestamp: last, headline: `DORMANT since ${utcDate(last)}` }
}