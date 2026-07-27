// Monitor config doc: operator-owned JSON (never derived, never ingested).
// Fail-fast validation; the only silent default is the documented A6 matrix.
import { readFile } from 'node:fs/promises'
import * as z from 'zod'
import { LimitsSchema, NetworkLimitsSchema } from '../config/schema.js'
import { monitorPaths } from './paths.js'

const CellSchema = z.object({
  detector: z.string().min(1),
  network: z.string().min(1),
  params: z.record(z.string(), z.string()).optional(),
})

// Watchlist. Absent = feature off. Present with {} = on with defaults.
// Nothing here scales with address count: the dust probe is one
// graph_query_batch per distinct network, and the other two triggers are
// local joins.
const WatchlistConfigSchema = z.object({
  dustMaxUsd: z.number().nonnegative().default(1.0),
  dustLookbackSeconds: z.number().int().positive().default(86400),
  enabled: z.boolean().default(true),
})

// Investigation-output rendering (spec 3): dormancy threshold for the
// ACTIVE/DORMANT dossier verdict. Always present on the parsed config —
// configs without a `render` block get the documented default.
const RenderConfigSchema = z.object({
  dormant_after_days: z.number().int().positive().default(30),
})

const MonitorConfigSchema = z.object({
  cells: z.array(CellSchema).min(1),
  intervalSeconds: z.number().int().positive().default(3600),
  // Usage guard floor (runner.ts): compared against the backend's remaining
  // quota — `facts.usage.remaining_seconds` on quota-bearing backends (the
  // real usage_status tool shape), or a top-level `remaining` on simpler
  // backends. A backend that reports neither skips the guard.
  stopIfRemainingBelow: z.number().nonnegative().optional(),
  reviewer: z.string().min(1).optional(),
  webhookUrl: z.string().url().optional(),
  execHook: z.string().min(1).optional(),
  caseMaxHops: z.number().int().min(1).max(4).default(3),
  // Config-file layer for the tunable search bounds (config/limits.ts), for
  // unattended runs. `limits` applies to every network, `networkLimits.<net>`
  // is more specific and wins. Per-cell `params` remain the most specific
  // layer of all and override both. Validated here so a bad bound fails at
  // config load, not eight hours into a watch loop.
  limits: LimitsSchema.optional(),
  networkLimits: NetworkLimitsSchema.optional(),
  watchlist: WatchlistConfigSchema.optional(),
  // Sink execution bound (R4): webhook fetches and exec hooks are killed after
  // hook_timeout_ms so a hung sink can never hang the run loop.
  alerts: z.object({ hook_timeout_ms: z.number().int().positive().default(30000) }).optional(),
  render: RenderConfigSchema.prefault({}),
})

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>

const DEFAULT_DETECTORS = ['fake-token', 'mixer', 'address-poisoning', 'attack-attribution'] as const
const DEFAULT_NETWORKS = ['bittensor', 'bittensor_evm'] as const

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = MonitorConfigSchema.parse({
  cells: DEFAULT_DETECTORS.flatMap((detector) => DEFAULT_NETWORKS.map((network) => ({ detector, network }))),
})

export async function loadMonitorConfig(workspaceRoot: string): Promise<MonitorConfig> {
  const { configPath } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    // "No config doc" is the ONLY condition that may fall back to the default
    // A6 matrix. A permission or IO error means the operator DID write a
    // config we simply cannot read — silently monitoring the default matrix
    // instead would be a wrong, unnoticed change of what is being scanned.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Cannot read monitor config ${configPath}: ${(err as Error).message}`)
    }
    return DEFAULT_MONITOR_CONFIG
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid monitor config ${configPath}: not valid JSON (${(err as Error).message})`)
  }
  const result = MonitorConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid monitor config ${configPath}: ${issues.join('; ')}`)
  }
  return result.data
}
