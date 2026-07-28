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
  timestamp: number
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

// Some special filesystems (notably /proc) answer mkdir on a child with
// ENOENT even though the parent visibly exists. Node's fs.mkdir(dir,
// {recursive: true}) treats that as a transient race and retries with no
// cap, which spins forever rather than rejecting — confirmed via strace
// (an unbounded, rapid mkdir/statx loop; the event loop stays live and the
// process never blocks, it just never stops). Walking the path ourselves,
// one plain mkdir per component with no retry, makes every case settle in
// a bounded number of syscalls: EEXIST is expected and skipped, anything
// else (including that ENOENT-on-existing-parent case) fails once instead
// of retrying.
async function ensureDir(dir: string): Promise<void> {
  const segments = dir.split(path.sep).filter(Boolean)
  let current = path.isAbsolute(dir) ? path.sep : ''
  for (const segment of segments) {
    current = current ? path.join(current, segment) : segment
    try {
      await mkdir(current)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
}

// A residual, undemonstrated risk remains distinct from the mkdir retry loop
// above: a single mkdir/appendFile syscall genuinely wedged on a stalled
// filesystem (e.g. a hung network mount) blocks like any normal blocking I/O
// would. Node's fs promises do not support cancelling an in-flight mkdir, so
// a bounded wait here only frees the *caller* — the wedged operation itself
// keeps running in the background until the OS/filesystem gives up on its
// own. That is an accepted, documented limitation, not a bug this module can
// fix from userland; it is unrelated to (and much rarer than) the retry-loop
// case ensureDir() eliminates above.
const WRITE_TIMEOUT_MS = 2000

async function writeEntry(file: string, entry: ActionLogEntry): Promise<void> {
  await ensureDir(path.dirname(file))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Exported so BOTH client paths log identically: the MCP proxy's remote client
// and the CLI's own client. They are separate clients, and wiring only one is how
// an unattended instance ends up with an empty log while the mechanism 'works'.
export function actionLogSignalsFromResult(result: unknown): { warnings?: string[]; search_limits?: Record<string, unknown> } {
  const structuredContent = isRecord(result) ? result['structuredContent'] : undefined
  if (!isRecord(structuredContent)) return {}
  const warnings = Array.isArray(structuredContent['warnings'])
    ? (structuredContent['warnings'] as string[])
    : undefined
  const input = structuredContent['input']
  const search_limits = isRecord(input) && isRecord(input['search_limits'])
    ? (input['search_limits'] as Record<string, unknown>)
    : undefined
  return { warnings, search_limits }
}

type CallToolFn = (...args: never[]) => Promise<unknown>

// Wrap a client's callTool so every invocation is recorded. Returns the client.
// Idempotent-unsafe: call once per client.
export function installActionLogging<T extends { callTool: CallToolFn }>(client: T): T {
  const original = client.callTool.bind(client) as CallToolFn
  const wrapped = (async (...args: never[]) => {
    const startedAt = Date.now()
    const input = (args[0] ?? {}) as { name?: unknown; arguments?: Record<string, unknown> }
    const tool = String(input.name ?? 'unknown')
    const toolArgs = input.arguments ?? {}
    try {
      const result = await original(...args)
      const { warnings, search_limits } = actionLogSignalsFromResult(result)
      await appendActionLog({ timestamp: startedAt, tool, args: toolArgs, outcome: 'ok', duration_ms: Date.now() - startedAt, warnings, search_limits })
      return result
    } catch (err) {
      await appendActionLog({ timestamp: startedAt, tool, args: toolArgs, outcome: 'error', duration_ms: Date.now() - startedAt, error: (err as Error).message })
      throw err
    }
  }) as CallToolFn
  client.callTool = wrapped as T['callTool']
  return client
}
