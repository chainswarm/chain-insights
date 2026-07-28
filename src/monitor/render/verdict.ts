// src/monitor/render/verdict.ts
// ACTIVE/DORMANT headline verdict from persisted trace timestamps. Pure — no
// fs, no network (spec req 3: verdict computed from the newest movement
// timestamp across the traced topology).
import type { TraceV1Doc } from './trace-io.js'

export interface CaseVerdict {
  status: 'active' | 'dormant'
  /** Newest movement timestamp (epoch milliseconds) across all traced edges;
   *  null when no traced edge carries a timestamp. */
  lastMovementTimestamp: number | null
  /** Headline line for the dossier, e.g. "ACTIVE (last movement 2026-07-20)"
   *  or "DORMANT since 2026-06-01". */
  headline: string
}

const DAY_MS = 86_400_000

function utcDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10)
}

/** Newest of first_seen_timestamp/last_seen_timestamp over every edge of every
 *  provided doc. All `_timestamp` fields are epoch milliseconds. Pure. */
export function lastMovementTimestamp(docs: TraceV1Doc[]): number | null {
  let newest: number | null = null
  for (const doc of docs) {
    for (const edge of doc.edges) {
      for (const ts of [edge.first_seen_timestamp, edge.last_seen_timestamp]) {
        if (typeof ts === 'number' && (newest === null || ts > newest)) newest = ts
      }
    }
  }
  return newest
}

export function computeVerdict(
  docs: TraceV1Doc[],
  nowTimestamp: number,
  dormantAfterDays: number,
  caseCreatedAtTimestamp: number,
): CaseVerdict {
  const last = lastMovementTimestamp(docs)
  // Boundary rule: age exactly equal to the threshold is DORMANT.
  if (last !== null && nowTimestamp - last < dormantAfterDays * DAY_MS) {
    return { status: 'active', lastMovementTimestamp: last, headline: `ACTIVE (last movement ${utcDate(last)})` }
  }
  if (last === null) {
    // Trace edges carry no timestamps: we cannot date the last movement, only
    // say none was observed while monitoring.
    return {
      status: 'dormant',
      lastMovementTimestamp: null,
      headline: `DORMANT (no movement observed since monitoring began ${utcDate(caseCreatedAtTimestamp)})`,
    }
  }
  return { status: 'dormant', lastMovementTimestamp: last, headline: `DORMANT since ${utcDate(last)}` }
}
