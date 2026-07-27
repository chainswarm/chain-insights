// src/mcp/action-log.ts
// Optional append-only record of every MCP tool invocation, for operators
// running cia unattended who need to audit what ran and why a result looked
// the way it did. Off unless CIA_ACTION_LOG names a path.
//
// `warnings` and `search_limits` are captured deliberately: they are how a
// reader tells "found nothing" from "hit a cap", which is invisible in the
// result alone.
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface ActionLogEntry {
  ts_ms: number
  tool: string
  args: Record<string, unknown>
  outcome: 'ok' | 'error'
  duration_ms: number
  result_counts?: Record<string, number>
  warnings?: string[]
  search_limits?: Record<string, unknown>
  error?: string
}

export function actionLogPath(): string | undefined {
  const configured = process.env.CIA_ACTION_LOG?.trim()
  return configured ? configured : undefined
}

// Some special filesystems (notably /proc) answer a recursive mkdir's probe
// with ENOENT instead of EACCES/EROFS, which trips Node's mkdirp retry loop
// into spinning forever rather than rejecting. A bounded wait keeps that
// pathological case from blocking the tool call awaiting us.
const WRITE_TIMEOUT_MS = 2000

async function writeEntry(file: string, entry: ActionLogEntry): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
}

// Never throws, and never hangs beyond WRITE_TIMEOUT_MS. A failure (or a
// stall) recording an action must not fail (or stall) the action:
// observability that can break the thing it observes is worse than none.
export async function appendActionLog(entry: ActionLogEntry): Promise<void> {
  const file = actionLogPath()
  if (!file) return
  try {
    await Promise.race([
      writeEntry(file, entry),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, WRITE_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
  } catch {
    // Intentionally swallowed.
  }
}
