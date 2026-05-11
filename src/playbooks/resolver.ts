import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access, readdir } from 'node:fs/promises'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Built-ins live alongside resolver in dist/playbooks/ (or src/playbooks/ in dev)
const BUILTIN_DIR = __dirname

function userDir(): string {
  return path.join(os.homedir(), '.chain-insights', 'playbooks')
}

/**
 * Resolve a playbook name to its absolute file path.
 * Checks user directory (~/.chain-insights/playbooks/) first, then built-in directory.
 * Security: sanitizes name to prevent path traversal (T-05-01).
 */
export async function resolvePlaybook(name: string): Promise<string> {
  // Security: sanitize name to prevent path traversal (per security threat T-05-01)
  const safeName = name.replace(/[^a-z0-9_-]/gi, '')
  if (!safeName) throw new Error(`Invalid playbook name: ${name}`)

  const userPath = path.join(userDir(), `${safeName}.md`)
  const builtinPath = path.join(BUILTIN_DIR, `${safeName}.md`)

  try {
    await access(userPath)
    return userPath
  } catch {
    // Fall through to built-in
  }

  try {
    await access(builtinPath)
    return builtinPath
  } catch {
    throw new Error(
      `Playbook not found: "${safeName}". Run \`chain-insights playbook list\` to see available playbooks.`
    )
  }
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

  // Built-in playbooks
  try {
    const builtinFiles = await readdir(BUILTIN_DIR)
    for (const file of builtinFiles) {
      if (!file.endsWith('.md')) continue
      const name = file.slice(0, -3)
      if (seen.has(name)) continue // user override takes precedence
      result.push({ name, source: 'builtin' })
    }
  } catch {
    // Built-in dir not readable
  }

  return result
}
