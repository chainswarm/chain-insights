// src/monitor/cases.ts
// Case registry (spec UC-6/UC-7). cases/<id>/case.json is canonical; the store
// `cases` table is derived. A case is incident-centric (a theft, a scam
// cluster) — distinct from the phase-2 my-address watchlist.
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from './atomic.js'
import { monitorPaths } from './paths.js'
import { loadWatchlist } from './watchlist.js'

/** One mutation of the seed set, in order. The case timeline's explanation for
 *  a corridor that suddenly got wider or narrower between two runs. */
export interface CaseSeedEvent {
  action: 'add' | 'remove'
  addresses: string[]
  at_timestamp: number
  note?: string
}

export interface MonitorCase {
  case_id: string
  type: 'stolen-funds' | 'scam-topology'
  network: string
  seeds: string[]
  status: 'open' | 'closed'
  created_at_timestamp: number
  closed_at_timestamp?: number
  note?: string
  /** address -> when it became a seed, for seeds added after creation. Reading a
   *  snapshot next to this map is how a reader tells "the corridor grew because
   *  the aperture widened" from "the corridor grew because funds moved". */
  seeds_added_at_timestamp?: Record<string, number>
  seed_events?: CaseSeedEvent[]
  /** Victim lane (event-driven tracing, spec req 2/4): set by the activity
   *  probe when a hit lands on a watchlist entry this case manages; cleared
   *  by markCaseTraced after a successful trace. The EARLIEST pending hit
   *  wins so a burst of hits reads as one pending window. */
  dirty_since_timestamp?: number
  /** Stamped by the runner after every successful trace (both trace modes). */
  last_traced_at_timestamp?: number
}

const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

// Same allow-list as the watchlist (src/monitor/watchlist.ts): chain addresses
// are alphanumeric, SS58 base58 or 0x-prefixed H160. Seeds are interpolated
// into corridor traversal queries downstream, so nothing outside this shape may
// ever be persisted as a seed. Validate on the way IN — never hand-escape on
// the way out.
const ADDRESS_RE = /^(0x)?[A-Za-z0-9]{1,128}$/

function assertAddresses(addresses: string[]): string[] {
  if (addresses.length === 0) throw new Error('at least one --address is required')
  for (const a of addresses) {
    if (!ADDRESS_RE.test(a)) {
      throw new Error(`"${a}" is not a chain address (alphanumeric, optionally 0x-prefixed, max 128 chars)`)
    }
  }
  return [...new Set(addresses)]
}

// The case id is a path segment. Enforced before EVERY path join (readCase
// covers addCaseSeeds/removeCaseSeeds/closeCase; addCase validates directly),
// so caseFile can never be reached with a traversal id.
function assertCaseId(caseId: string): void {
  if (!CASE_ID_RE.test(caseId)) throw new Error(`case_id must match ${CASE_ID_RE}, got "${caseId}"`)
}

async function readCase(workspaceRoot: string, caseId: string): Promise<MonitorCase> {
  assertCaseId(caseId)
  const file = caseFile(workspaceRoot, caseId)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as MonitorCase
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`no such case "${caseId}"`)
    throw err
  }
}

// Mutating a closed case would rewrite the record of what was investigated and
// when, and the next run does not even re-trace it (the runner only walks OPEN
// cases), so the change would sit in canonical JSON with no snapshot behind it.
// Refusing outright, with no reopen path: a closed case that needs to grow is a
// new case, seeded from the old one.
function assertOpen(current: MonitorCase, verb: string): void {
  if (current.status !== 'open') {
    throw new Error(
      `case "${current.case_id}" is closed and cannot ${verb}. A closed case is a historical record; open a new case with the wider seed set instead.`,
    )
  }
}

async function writeCase(workspaceRoot: string, next: MonitorCase): Promise<MonitorCase> {
  const file = caseFile(workspaceRoot, next.case_id)
  await mkdir(path.dirname(file), { recursive: true })
  await writeJsonAtomic(file, next)
  return next
}

function caseFile(workspaceRoot: string, caseId: string): string {
  return path.join(monitorPaths(workspaceRoot).casesDir, caseId, 'case.json')
}

export async function addCase(
  workspaceRoot: string,
  input: { case_id: string; type: MonitorCase['type']; network: string; seeds: string[]; note?: string },
  nowTimestamp: number,
): Promise<MonitorCase> {
  assertCaseId(input.case_id)
  if (input.seeds.length === 0) throw new Error('a case needs at least one seed address')
  const seeds = assertAddresses(input.seeds)
  const file = caseFile(workspaceRoot, input.case_id)
  const exists = await readFile(file, 'utf8').then(() => true).catch(() => false)
  if (exists) throw new Error(`case "${input.case_id}" already exists`)
  const created: MonitorCase = { ...input, seeds, status: 'open', created_at_timestamp: nowTimestamp }
  await mkdir(path.dirname(file), { recursive: true })
  await writeJsonAtomic(file, created)
  return created
}

/** Widen an open case. Idempotent by address: re-adding an existing seed is a
 *  no-op that neither errors nor records an event, so a scripted `case add-seed`
 *  is safe to re-run (same contract as `watchlist add`). */
export async function addCaseSeeds(
  workspaceRoot: string,
  caseId: string,
  addresses: string[],
  nowTimestamp: number,
  opts: { note?: string } = {},
): Promise<{ monitorCase: MonitorCase; added: string[] }> {
  const requested = assertAddresses(addresses)
  const current = await readCase(workspaceRoot, caseId)
  assertOpen(current, 'take new seeds')
  const known = new Set(current.seeds)
  const added = requested.filter((a) => !known.has(a))
  if (added.length === 0) return { monitorCase: current, added: [] }
  const seedsAddedAtTimestamp = { ...(current.seeds_added_at_timestamp ?? {}) }
  for (const a of added) seedsAddedAtTimestamp[a] = nowTimestamp
  const next: MonitorCase = {
    ...current,
    seeds: [...current.seeds, ...added],
    seeds_added_at_timestamp: seedsAddedAtTimestamp,
    seed_events: [...(current.seed_events ?? []), { action: 'add', addresses: added, at_timestamp: nowTimestamp, ...(opts.note ? { note: opts.note } : {}) }],
  }
  return { monitorCase: await writeCase(workspaceRoot, next), added }
}

/** Narrow an open case. Idempotent: removing an address that is not a seed is a
 *  no-op. A case may never be left with zero seeds — `addCase` refuses to create
 *  one, so removal must not be able to produce one either. */
export async function removeCaseSeeds(
  workspaceRoot: string,
  caseId: string,
  addresses: string[],
  nowTimestamp: number,
): Promise<{ monitorCase: MonitorCase; removed: string[] }> {
  const requested = assertAddresses(addresses)
  const current = await readCase(workspaceRoot, caseId)
  assertOpen(current, 'have seeds removed')
  const drop = new Set(requested)
  const removed = current.seeds.filter((s) => drop.has(s))
  if (removed.length === 0) return { monitorCase: current, removed: [] }
  const seeds = current.seeds.filter((s) => !drop.has(s))
  if (seeds.length === 0) throw new Error(`case "${caseId}" needs at least one seed address; removing all ${removed.length} would empty it`)
  const seedsAddedAtTimestamp = { ...(current.seeds_added_at_timestamp ?? {}) }
  for (const a of removed) delete seedsAddedAtTimestamp[a]
  const next: MonitorCase = {
    ...current,
    seeds,
    ...(Object.keys(seedsAddedAtTimestamp).length > 0 ? { seeds_added_at_timestamp: seedsAddedAtTimestamp } : {}),
    seed_events: [...(current.seed_events ?? []), { action: 'remove', addresses: removed, at_timestamp: nowTimestamp }],
  }
  if (Object.keys(seedsAddedAtTimestamp).length === 0) delete next.seeds_added_at_timestamp
  return { monitorCase: await writeCase(workspaceRoot, next), removed }
}

export async function listCases(workspaceRoot: string, opts?: { openOnly?: boolean }): Promise<MonitorCase[]> {
  const dir = monitorPaths(workspaceRoot).casesDir
  let ids: string[]
  try {
    ids = await readdir(dir)
  } catch {
    return []
  }
  const cases: MonitorCase[] = []
  for (const id of ids.sort()) {
    try {
      cases.push(JSON.parse(await readFile(caseFile(workspaceRoot, id), 'utf8')) as MonitorCase)
    } catch {
      // A cases/ subdir without case.json (e.g. an investigation case dir from
      // the wider workspace) is not a monitor case — skip, never throw.
    }
  }
  return opts?.openOnly ? cases.filter((c) => c.status === 'open') : cases
}

export async function closeCase(
  workspaceRoot: string, caseId: string, nowTimestamp: number,
): Promise<{ monitorCase: MonitorCase; alreadyClosed: boolean; managedKept: number }> {
  // Through readCase: a missing case reports `no such case`, not an ENOENT
  // stack. Re-closing is a no-op — rewriting closed_at_timestamp would
  // falsify when the investigation actually ended.
  const current = await readCase(workspaceRoot, caseId)
  // Close KEEPS the case's managed watchlist entries (label-lifecycle spec
  // req 3): they are the dormancy tripwire behind the case_reactivated
  // alert. Nothing here touches watchlist.json — the count is reported so
  // the close output can say so. (The trace-time managed refresh only runs
  // for OPEN cases, so these entries are never pruned after close either.)
  const managedKept = (await loadWatchlist(workspaceRoot)).filter((w) => w.managed_by === `case:${caseId}`).length
  if (current.status === 'closed') return { monitorCase: current, alreadyClosed: true, managedKept }
  const closed: MonitorCase = { ...current, status: 'closed', closed_at_timestamp: nowTimestamp }
  return { monitorCase: await writeCase(workspaceRoot, closed), alreadyClosed: false, managedKept }
}

// The dirty/traced markers go through readCase, so case-id validation and the
// `no such case` error come for free. assertOpen is deliberately NOT applied —
// a closed case may be marked dirty (dormancy tripwire forward-compat); only
// the runner refuses to trace it.
export async function markCaseDirty(workspaceRoot: string, caseId: string, nowTimestamp: number): Promise<MonitorCase> {
  const current = await readCase(workspaceRoot, caseId)
  if (current.dirty_since_timestamp !== undefined) return current
  return writeCase(workspaceRoot, { ...current, dirty_since_timestamp: nowTimestamp })
}

export async function markCaseTraced(workspaceRoot: string, caseId: string, nowTimestamp: number): Promise<MonitorCase> {
  const current = await readCase(workspaceRoot, caseId)
  const next: MonitorCase = { ...current, last_traced_at_timestamp: nowTimestamp }
  delete next.dirty_since_timestamp
  return writeCase(workspaceRoot, next)
}
