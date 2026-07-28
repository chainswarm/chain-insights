// src/monitor/init.ts
// Victim bootstrap (victim lane spec req 7): one command from "my wallet was
// drained" to a configured event-driven monitor. Ordering is deliberate —
// case first (its validators run before anything is written), managed
// watchlist second, config LAST as the commit point: a crash mid-init never
// leaves a configured monitor that is missing its case.
import { mkdir, readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './atomic.js'
import { addCase, type MonitorCase } from './cases.js'
import { monitorPaths } from './paths.js'
import { syncManagedWatchlist } from './watchlist.js'

export interface VictimInitOptions {
  caseId: string
  network: string
  seeds: string[]
  note?: string
}

export interface VictimInitResult {
  configPath: string
  monitorCase: MonitorCase
  watchlisted: string[]
}

// The minimal victim config (spec req 7). `watchlist: {}` is REQUIRED, not
// decoration: the activity probe lives inside the watchlist pass, which is
// feature-gated on this block being present — without it the movement
// tripwire would never arm and an on_movement case would never re-trace.
const VICTIM_CONFIG = { profile: 'victim', trace_mode: 'on_movement', cells: [], watchlist: {} } as const

export async function initVictimWorkspace(
  workspaceRoot: string,
  opts: VictimInitOptions,
  nowTimestamp: number,
): Promise<VictimInitResult> {
  const { configPath, monitorDir } = monitorPaths(workspaceRoot)
  const exists = await readFile(configPath, 'utf8').then(() => true).catch(() => false)
  if (exists) {
    throw new Error(
      `monitor config already exists at ${configPath} — this workspace is already initialized. Edit the config directly, or run init in a fresh workspace.`,
    )
  }
  const monitorCase = await addCase(
    workspaceRoot,
    { case_id: opts.caseId, type: 'stolen-funds', network: opts.network, seeds: opts.seeds, ...(opts.note ? { note: opts.note } : {}) },
    nowTimestamp,
  )
  const { added } = await syncManagedWatchlist(workspaceRoot, monitorCase.case_id, monitorCase.network, monitorCase.seeds)
  await mkdir(monitorDir, { recursive: true })
  await writeJsonAtomic(configPath, VICTIM_CONFIG)
  return { configPath, monitorCase, watchlisted: added }
}
