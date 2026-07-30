// src/monitor/render/trace-io.ts
// Persisted chain-insights.trace.v1 artifacts per case. The renderer is pure
// over these docs (spec assumption: never re-queries the graph itself); this
// module is plain fs — no MCP client.
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from '../atomic.js'
import { monitorPaths } from '../paths.js'

export interface TraceV1Edge {
  edge_id: string
  from_address: string
  to_address: string
  // MONEY_TRAIL / TRAIL_ENDS_AT mark precomputed money-trail edges; the
  // renderer styles them as their own layer instead of a plain flow edge.
  edge_type?: string
  amount_usd_sum?: number
  tx_count?: number
  first_tx_id?: string
  last_tx_id?: string
  first_seen_timestamp?: number
  last_seen_timestamp?: number
}

export interface TraceV1Address {
  address: string
  roles: string[]
  labels?: string[]
  is_exchange?: boolean
  confidence?: string
  rationale?: string[]
}

export interface TraceV1Path {
  path_id: string
  direction: string
  source: string
  target: string
  addresses: string[]
  edge_ids: string[]
  hops: number
  terminal_role: string
  amount_usd_sum?: number
}

/** The subset of chain-insights.trace.v1 the renderer consumes. Unknown extra
 *  keys are preserved on disk but not modeled. */
export interface TraceV1Doc {
  schema: 'chain-insights.trace.v1'
  tool: string
  network: string
  addresses: TraceV1Address[]
  edges: TraceV1Edge[]
  paths: TraceV1Path[]
  artifacts?: Record<string, unknown>
  summary?: Record<string, unknown>
}

export type TraceRole = 'victim' | 'suspect'

const TRACE_FILE_RE = /^(\d+)\.(victim|suspect)\.trace\.json$/

export function caseTracesDir(workspaceRoot: string, caseId: string): string {
  return path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'traces')
}

export async function writeTraceDoc(
  workspaceRoot: string,
  caseId: string,
  role: TraceRole,
  runTimestamp: number,
  doc: Record<string, unknown>,
): Promise<string> {
  const dir = caseTracesDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${runTimestamp}.${role}.trace.json`)
  await writeJsonAtomic(file, doc)
  return file
}

/** Latest persisted doc per role (by run timestamp in the filename); a role
 *  with no persisted doc is absent from the result. Invalid JSON or a doc
 *  whose schema is not chain-insights.trace.v1 throws (fail-fast: a corrupt
 *  artifact must not silently render an empty dossier). */
export async function readLatestTraceDocs(
  workspaceRoot: string,
  caseId: string,
): Promise<Partial<Record<TraceRole, TraceV1Doc>>> {
  const dir = caseTracesDir(workspaceRoot, caseId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return {}
  }
  const newest = new Map<TraceRole, { ts: number; file: string }>()
  for (const f of files) {
    const m = TRACE_FILE_RE.exec(f)
    if (!m) continue
    const ts = Number(m[1])
    const role = m[2] as TraceRole
    const current = newest.get(role)
    if (!current || ts > current.ts) newest.set(role, { ts, file: path.join(dir, f) })
  }
  const result: Partial<Record<TraceRole, TraceV1Doc>> = {}
  for (const [role, { file }] of newest) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch (err) {
      throw new Error(`Corrupt trace artifact ${file}: ${(err as Error).message}`)
    }
    const doc = parsed as TraceV1Doc
    if (doc?.schema !== 'chain-insights.trace.v1') {
      throw new Error(`Trace artifact ${file} is not schema chain-insights.trace.v1 (got "${String((doc as { schema?: unknown })?.schema)}")`)
    }
    result[role] = doc
  }
  return result
}
