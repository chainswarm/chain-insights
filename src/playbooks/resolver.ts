import path from 'node:path'
import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import { BUILTIN_PLAYBOOKS } from './builtins.js'

function userDir(): string {
  return path.join(os.homedir(), '.chain-insights', 'playbooks')
}

/**
 * Resolve a playbook name to its absolute file path.
 * Checks user directory (~/.chain-insights/playbooks/) first, then built-in directory.
 * Security: sanitizes name to prevent path traversal (T-05-01).
 *
 * @deprecated Prefer resolvePlaybookContent() which returns markdown directly.
 */
export async function resolvePlaybook(name: string): Promise<string> {
  // Security: sanitize name to prevent path traversal (per security threat T-05-01)
  const safeName = name.replace(/[^a-z0-9_-]/gi, '')
  if (!safeName) throw new Error(`Invalid playbook name: ${name}`)

  const userPath = path.join(userDir(), `${safeName}.md`)

  try {
    await access(userPath)
    return userPath
  } catch {
    // Fall through to built-in check
  }

  // Check built-in playbooks map (T-05-01: no filesystem path exposure for built-ins)
  if (safeName in BUILTIN_PLAYBOOKS) {
    // Return a sentinel path for legacy callers — content comes from BUILTIN_PLAYBOOKS
    return `builtin:${safeName}`
  }

  throw new Error(
    `Playbook not found: "${safeName}". Run \`chain-insights playbook list\` to see available playbooks.`
  )
}

/**
 * Resolve a playbook name to its markdown content.
 * Checks user directory (~/.chain-insights/playbooks/<name>.md) first,
 * then falls back to the built-in BUILTIN_PLAYBOOKS map.
 * Security: sanitizes name to prevent path traversal (T-05-01).
 */
export async function resolvePlaybookContent(name: string): Promise<string> {
  // Security: sanitize name to prevent path traversal (per security threat T-05-01)
  const safeName = name.replace(/[^a-z0-9_-]/gi, '')
  if (!safeName) throw new Error(`Invalid playbook name: ${name}`)

  // 1. Check user directory first (user playbooks override built-ins)
  const userPath = path.join(userDir(), `${safeName}.md`)
  try {
    return await readFile(userPath, 'utf8')
  } catch {
    // Not in user dir — fall through
  }

  // 2. Fall back to built-in map
  const builtin = BUILTIN_PLAYBOOKS[safeName]
  if (builtin !== undefined) return builtin

  throw new Error(
    `Playbook not found: "${safeName}". Run \`chain-insights playbook list\` to see available playbooks.`
  )
}

/**
 * List all available playbooks — user dir first (overrides), then built-ins.
 * Returns array of { name, source } objects.
 */
export async function listPlaybooks(): Promise<Array<{ name: string; source: 'builtin' | 'user' }>> {
  const result: Array<{ name: string; source: 'builtin' | 'user' }> = []
  const seen = new Set<string>()

  // User playbooks first
  try {
    const userFiles = await readdir(userDir())
    for (const file of userFiles) {
      if (!file.endsWith('.md')) continue
      const name = file.slice(0, -3) // remove .md
      seen.add(name)
      result.push({ name, source: 'user' })
    }
  } catch {
    // User dir doesn't exist — that's fine
  }

  // Built-in playbooks from the embedded map (not filesystem)
  for (const name of Object.keys(BUILTIN_PLAYBOOKS)) {
    if (seen.has(name)) continue // user override takes precedence
    result.push({ name, source: 'builtin' })
  }

  return result
}
