// src/monitor/closable.ts
// Closable signal (label-lifecycle spec req 2): per open scam-topology case,
// "cluster labeled" (>=1 effective approve decision carrying this case_id)
// AND "dormant" (no canonical activity-probe hit on the case's managed
// watchlist entries within render.dormant_after_days). Computed from
// canonical files ONLY — decisions, watchlist.json, logs/watchlist-hits.jsonl
// — so it is correct on a freshly rebuilt store too. Close remains a human
// action; this only surfaces the marker.
import { readFile } from 'node:fs/promises'
import type { MonitorCase } from './cases.js'
import { parseJsonlLines } from './jsonl.js'
import { monitorPaths } from './paths.js'
import { effectiveDecisions } from './review.js'
import { loadWatchlist } from './watchlist.js'

const DAY_MS = 86_400_000

interface HitLine {
  run_timestamp: number
  address: string
  network: string
  trigger: string
  source_ref: string
}

export interface CaseClosableStatus {
  case_id: string
  labeled: boolean
  dormant: boolean
  closable: boolean
}

export function isClosable(s: { labeled: boolean; dormant: boolean }): boolean {
  return s.labeled && s.dormant
}

export async function caseClosableStatus(
  workspaceRoot: string,
  monitorCase: MonitorCase,
  dormantAfterDays: number,
  nowTimestamp: number,
): Promise<CaseClosableStatus> {
  const labeled = (await effectiveDecisions(workspaceRoot)).some(
    (d) => d.decision === 'approve' && d.case_id === monitorCase.case_id,
  )
  // Managed entries = the tripwire set the victim-lane trace sync maintains.
  // A case with NO managed entries is vacuously dormant — the closable gate
  // still requires `labeled`, and in practice every traced case has at least
  // its seeds managed.
  const managed = new Set(
    (await loadWatchlist(workspaceRoot))
      .filter((w) => w.managed_by === `case:${monitorCase.case_id}`)
      .map((w) => `${w.network}:${w.address}`),
  )
  // Dormancy is judged on when the probe RECORDED the hit (run_timestamp,
  // epoch ms): the probe runs hourly, so record time tracks chain activity
  // closely enough for a days-scale window, and it keeps this reader
  // decoupled from the source_ref encoding.
  let raw = ''
  try {
    raw = await readFile(monitorPaths(workspaceRoot).watchlistHitsLog, 'utf8')
  } catch {
    // No hits log yet = no activity ever recorded.
  }
  const hits = raw ? parseJsonlLines<HitLine>(raw, 'watchlist-hits.jsonl').records : []
  const since = nowTimestamp - dormantAfterDays * DAY_MS
  const dormant = !hits.some(
    (h) => h.trigger === 'activity' && Number(h.run_timestamp) > since && managed.has(`${h.network}:${h.address}`),
  )
  return { case_id: monitorCase.case_id, labeled, dormant, closable: isClosable({ labeled, dormant }) }
}
