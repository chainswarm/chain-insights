import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

interface SchemaCache {
  tools: McpTool[]
  cachedAt: number
  endpoint?: string
}

// Derived at call time so tests can override HOME via process.env['HOME']
function schemaPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'mcp-schema.json')
}

export async function loadSchema(endpoint?: string): Promise<McpTool[] | null> {
  try {
    const raw = await readFile(schemaPath(), 'utf8')
    const cache = JSON.parse(raw) as SchemaCache // JSON parse errors propagate
    if (Date.now() - cache.cachedAt > TTL_MS) return null // TTL expired
    if (endpoint && cache.endpoint !== endpoint) return null
    return cache.tools
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err // re-throw JSON parse or other errors
  }
}

export async function saveSchema(tools: McpTool[], endpoint?: string): Promise<void> {
  const p = schemaPath()
  await mkdir(path.dirname(p), { recursive: true })
  const cache: SchemaCache = { tools, cachedAt: Date.now(), ...(endpoint ? { endpoint } : {}) }
  await writeFile(p, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 })
}
