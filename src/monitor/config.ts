// Monitor config doc: operator-owned JSON (never derived, never ingested).
// Fail-fast validation; the only silent default is the documented render
// dormancy threshold.
import { readFile } from 'node:fs/promises'
import * as z from 'zod'
import { monitorPaths } from './paths.js'

// Investigation-output rendering: dormancy threshold for the ACTIVE/DORMANT
// dossier verdict. Always present on the parsed config — configs without a
// `render` block get the documented default.
const RenderConfigSchema = z.object({
  dormant_after_days: z.number().int().positive().default(30),
})

const MonitorConfigSchema = z.object({
  intervalSeconds: z.number().int().positive().default(3600),
  render: RenderConfigSchema.prefault({}),
})

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = MonitorConfigSchema.parse({})

export async function loadMonitorConfig(workspaceRoot: string): Promise<MonitorConfig> {
  const { configPath } = monitorPaths(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    // "No config doc" is the ONLY condition that may fall back to the default.
    // A permission or IO error means the operator DID write a config we simply
    // cannot read — silently monitoring something else would be a wrong,
    // unnoticed change of what is being tracked.
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