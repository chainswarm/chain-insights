// src/monitor/init.ts
// Victim bootstrap (victim lane spec req 7): one command from "my wallet was
// drained" to a configured case-tracking monitor. Ordering is deliberate —
// case first (its validators run before anything is written), config LAST as
// the commit point: a crash mid-init never leaves a configured monitor that
// is missing its case.
import { mkdir, readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './atomic.js'
import { addCase, type MonitorCase } from './cases.js'
import { monitorPaths } from './paths.js'

export interface VictimInitOptions {
  caseId: string
  network: string
  seeds: string[]
  note?: string
}

export interface VictimInitResult {
  configPath: string
  monitorCase: MonitorCase
}

// The minimal victim config (spec req 7): case tracking only — no detector
// cells, no watchlist, no alerts.
const VICTIM_CONFIG = { intervalSeconds: 3600 } as const

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
  await mkdir(monitorDir, { recursive: true })
  await writeJsonAtomic(configPath, VICTIM_CONFIG)
  return { configPath, monitorCase }
}