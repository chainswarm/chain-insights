// src/monitor/review.ts
// The human gate, client side (spec invariant 2). Approve NEVER mutates the
// original machine-produced doc — it writes a reviewer-stamped COPY under
// detections/reviewed/ (the exact input the curated-label import accepts) plus
// an append-only decision doc. RAW-JSON stamping is load-bearing: the zod
// findings schema strips unknown keys, and `reviewer` is deliberately not in
// the schema, so a parse→serialize round trip would silently drop it.
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { monitorPaths } from './paths.js'

export interface ReviewDecisionDoc {
  doc_path: string
  decision: 'approve' | 'reject'
  reviewer: string
  decided_at_timestamp: number
  reviewed_copy?: string
  addresses: string[]
  case_id: string | null
  /** Filename of the prior decision this one supersedes (--force only). The
   *  prior file is never rewritten or deleted — the trail is append-only. */
  supersedes?: string
}

export async function listDecisionEntries(workspaceRoot: string): Promise<Array<{ file: string; doc: ReviewDecisionDoc }>> {
  const dir = monitorPaths(workspaceRoot).reviewsDir
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.review.json'))
  } catch {
    return []
  }
  const entries: Array<{ file: string; doc: ReviewDecisionDoc }> = []
  for (const f of files.sort()) {
    // Per-file tolerance (R5): one torn decision file must not take down
    // review list, label export, or approvedAddressesForCase.
    try {
      entries.push({ file: f, doc: JSON.parse(await readFile(path.join(dir, f), 'utf8')) as ReviewDecisionDoc })
    } catch (err) {
      console.warn(`[monitor] skipping unreadable findings/decision file ${f}: ${(err as Error).message}`)
    }
  }
  return entries
}

export async function listDecisionDocs(workspaceRoot: string): Promise<ReviewDecisionDoc[]> {
  return (await listDecisionEntries(workspaceRoot)).map((e) => e.doc)
}

/** Decision entries (filename + doc) minus any that a later --force decision
 *  names in `supersedes`. The filename is the export's decision_id source. */
export async function effectiveDecisionEntries(workspaceRoot: string): Promise<Array<{ file: string; doc: ReviewDecisionDoc }>> {
  const entries = await listDecisionEntries(workspaceRoot)
  const superseded = new Set(entries.map((e) => e.doc.supersedes).filter(Boolean))
  return entries.filter((e) => !superseded.has(e.file))
}

/** Decisions minus any that a later --force decision names in `supersedes`. */
export async function effectiveDecisions(workspaceRoot: string): Promise<ReviewDecisionDoc[]> {
  return (await effectiveDecisionEntries(workspaceRoot)).map((e) => e.doc)
}

// Relative doc paths are workspace-relative, NOT cwd-relative: the paths
// listPending prints are built from the discovered workspace root, so
// `cia monitor review approve detections/x.findings.json` must mean the same
// document whether it is run from the workspace root or from any subdirectory
// of it. Resolving against process.cwd() silently pointed at the wrong base
// from a subdirectory.
export function resolveDocPath(workspaceRoot: string, docPath: string): string {
  return path.isAbsolute(docPath) ? path.normalize(docPath) : path.resolve(workspaceRoot, docPath)
}

/** Workspace-relative, forward-slash-normalized doc identity. Idempotent on
 *  already-relative input (resolveDocPath re-anchors, relative re-strips). */
export function docKey(workspaceRoot: string, docPath: string): string {
  return path.relative(path.resolve(workspaceRoot), resolveDocPath(workspaceRoot, docPath)).split(path.sep).join('/')
}

/** Content address for decision files/reviewed copies: first 8 hex chars of the
 *  SHA-256 of the workspace-relative doc path — stable across machines,
 *  collision-free across same-millisecond decisions. */
export function docHash8(workspaceRoot: string, docPath: string): string {
  return createHash('sha256').update(docKey(workspaceRoot, docPath)).digest('hex').slice(0, 8)
}

function caseIdFromDocPath(docPath: string): string | null {
  // emit.ts filename: <ms>-<detector>-<network>.findings.json; tracker uses
  // detector `case-<id>`, so a case doc looks like 1700-case-c1-bittensor....
  const match = path.basename(docPath).match(/^\d+-case-(.+)-[^-]+\.findings\.json$/)
  return match ? match[1] : null
}

export async function listPending(workspaceRoot: string): Promise<Array<{ doc_path: string; tool: string; network: string; findings_count: number }>> {
  const p = monitorPaths(workspaceRoot)
  let files: string[]
  try {
    files = (await readdir(p.detectionsDir)).filter((f) => f.endsWith('.findings.json'))
  } catch {
    return []
  }
  // Compare by workspace-relative doc identity so legacy absolute-path
  // decisions and new relative-path decisions both count as decided.
  const decided = new Set((await listDecisionDocs(workspaceRoot)).map((d) => docKey(workspaceRoot, d.doc_path)))
  const pending: Array<{ doc_path: string; tool: string; network: string; findings_count: number }> = []
  for (const f of files.sort()) {
    const docPath = path.join(p.detectionsDir, f)
    if (decided.has(docKey(workspaceRoot, docPath))) continue
    // Per-file tolerance (R5): a malformed findings file costs that file only,
    // with a warning — never the whole review queue. A doc whose `findings` is
    // not an array is malformed too, not "zero findings".
    let doc: { tool: string; network: string; findings: unknown[] }
    try {
      doc = JSON.parse(await readFile(docPath, 'utf8')) as typeof doc
      if (!Array.isArray(doc.findings)) throw new Error('findings is not an array')
    } catch (err) {
      console.warn(`[monitor] skipping unreadable findings/decision file ${f}: ${(err as Error).message}`)
      continue
    }
    // A document with no findings has nothing to review. Full-state detectors
    // emit one per suppressed cell on every run (they record the suppression
    // count in `warnings`), so enqueueing them buries the real items: a live
    // workspace reached 64 pending reviews of which only 10 carried findings.
    // The document is still written and still replayed by `rebuild` — it is
    // provenance, not review work.
    if (doc.findings.length === 0) continue
    pending.push({ doc_path: docPath, tool: doc.tool, network: doc.network, findings_count: doc.findings.length })
  }
  return pending
}

async function writeDecision(workspaceRoot: string, decision: ReviewDecisionDoc): Promise<void> {
  const dir = monitorPaths(workspaceRoot).reviewsDir
  await mkdir(dir, { recursive: true })
  // Content-addressed by doc identity: same-millisecond decisions on
  // DIFFERENT docs cannot collide (the old <timestamp>-<decision> name lost
  // one of them silently). A --force supersede adds the timestamp so it can
  // never clobber the base name or a prior supersede.
  const hash8 = docHash8(workspaceRoot, decision.doc_path)
  const name = decision.supersedes
    ? `${hash8}-${decision.decision}-${decision.decided_at_timestamp}.review.json`
    : `${hash8}-${decision.decision}.review.json`
  await writeFile(path.join(dir, name), JSON.stringify(decision, null, 2) + '\n', 'utf8')
}

// Only detection findings documents may be reviewed: anything outside the
// workspace detections/ tree (traversal input, arbitrary files) is refused
// before any read or write happens.
function assertInDetections(workspaceRoot: string, resolved: string, docPath: string): void {
  const rel = path.relative(monitorPaths(workspaceRoot).detectionsDir, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${docPath}" is not inside the workspace detections/ tree; only detection findings documents can be reviewed`)
  }
}

/** Prior decisions for a doc, by workspace-relative identity. */
async function decisionsForDoc(workspaceRoot: string, resolved: string): Promise<Array<{ file: string; doc: ReviewDecisionDoc }>> {
  const key = docKey(workspaceRoot, resolved)
  return (await listDecisionEntries(workspaceRoot)).filter((e) => docKey(workspaceRoot, e.doc.doc_path) === key)
}

/** Refuses a double decision unless forced; forced returns the newest prior
 *  entry's filename for the new decision's `supersedes` field. */
async function assertUndecidedOrForced(
  workspaceRoot: string, resolved: string, force: boolean | undefined,
): Promise<string | undefined> {
  const prior = await decisionsForDoc(workspaceRoot, resolved)
  if (prior.length === 0) return undefined
  const newest = prior.reduce((a, b) => {
    if (a.doc.decided_at_timestamp !== b.doc.decided_at_timestamp) return a.doc.decided_at_timestamp > b.doc.decided_at_timestamp ? a : b
    return a.file > b.file ? a : b
  })
  if (!force) {
    throw new Error(
      `"${docKey(workspaceRoot, resolved)}" already has a review decision (${newest.doc.decision} by ${newest.doc.reviewer}); pass --force to supersede it`,
    )
  }
  return newest.file
}

export async function approveDoc(
  workspaceRoot: string, docPath: string, reviewer: string, nowTimestamp: number,
  opts?: { force?: boolean },
): Promise<{ reviewedCopy: string; superseded?: string }> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to approve')
  // Normalize BEFORE any read/write so a relative-path approval (e.g. `cia
  // monitor review approve detections/foo.findings.json`) records the same
  // doc_path that listPending matches against (absolute, via monitorPaths'
  // path.join). Without this, a relative approval never clears from pending,
  // and a later absolute-path retry writes a duplicate decision doc —
  // duplicate rows in export labels.
  const resolved = resolveDocPath(workspaceRoot, docPath)
  assertInDetections(workspaceRoot, resolved, docPath)
  const superseded = await assertUndecidedOrForced(workspaceRoot, resolved, opts?.force)
  const raw = JSON.parse(await readFile(resolved, 'utf8')) as Record<string, unknown>
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.reviewedDir, { recursive: true })
  // Keyed by doc identity, not bare basename: two docs with the same basename
  // in future subtrees can no longer clobber each other's reviewed copy.
  const reviewedCopy = path.join(p.reviewedDir, `${docHash8(workspaceRoot, resolved)}-${path.basename(resolved)}`)
  await writeFile(reviewedCopy, JSON.stringify({ ...raw, reviewer }, null, 2) + '\n', 'utf8')
  const findings = (raw.findings as Array<{ address: string }> | undefined) ?? []
  await writeDecision(workspaceRoot, {
    doc_path: docKey(workspaceRoot, resolved), decision: 'approve', reviewer, decided_at_timestamp: nowTimestamp, reviewed_copy: reviewedCopy,
    addresses: findings.map((f) => f.address), case_id: caseIdFromDocPath(resolved),
    ...(superseded ? { supersedes: superseded } : {}),
  })
  return { reviewedCopy, ...(superseded ? { superseded } : {}) }
}

export async function rejectDoc(
  workspaceRoot: string, docPath: string, reviewer: string, nowTimestamp: number,
  opts?: { force?: boolean },
): Promise<{ superseded?: string }> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to reject')
  // See approveDoc: normalize before use so relative-path rejects also match
  // listPending's absolute doc_path comparison.
  const resolved = resolveDocPath(workspaceRoot, docPath)
  assertInDetections(workspaceRoot, resolved, docPath)
  const superseded = await assertUndecidedOrForced(workspaceRoot, resolved, opts?.force)
  const raw = JSON.parse(await readFile(resolved, 'utf8')) as { findings?: Array<{ address: string }> }
  await writeDecision(workspaceRoot, {
    doc_path: docKey(workspaceRoot, resolved), decision: 'reject', reviewer, decided_at_timestamp: nowTimestamp,
    addresses: (raw.findings ?? []).map((f) => f.address), case_id: caseIdFromDocPath(resolved),
    ...(superseded ? { supersedes: superseded } : {}),
  })
  return superseded ? { superseded } : {}
}

export async function approvedAddressesForCase(workspaceRoot: string, caseId: string): Promise<string[]> {
  // effectiveDecisions: a superseded approve must no longer feed the case.
  // Role scoping (label-lifecycle spec): only candidate_intermediate findings
  // widen the corridor aperture. Feeding seed-role entries back is redundant
  // (they are already seeds) and feeding candidate_deposit entries would
  // trace onward FROM deposit endpoints into exchange infrastructure.
  // Legacy roleless docs (pre-role frontier docs) keep the old behavior:
  // every address was a frontier candidate then.
  const decisions = await effectiveDecisions(workspaceRoot)
  const addresses = new Set<string>()
  for (const d of decisions) {
    if (d.decision !== 'approve' || d.case_id !== caseId) continue
    let corridorFeed = d.addresses
    if (d.reviewed_copy) {
      try {
        const doc = JSON.parse(await readFile(d.reviewed_copy, 'utf8')) as { findings?: Array<{ address: string; role?: string }> }
        if (Array.isArray(doc.findings)) {
          corridorFeed = doc.findings.filter((f) => !f.role || f.role === 'candidate_intermediate').map((f) => f.address)
        }
      } catch (err) {
        // Per-decision tolerance (R5): fall back to the decision's own address
        // list — the pre-role behavior — rather than dropping the approval.
        console.warn(`[monitor] skipping unreadable findings/decision file ${d.reviewed_copy}: ${(err as Error).message} (falling back to the decision's address list for case ${caseId})`)
      }
    }
    for (const a of corridorFeed) addresses.add(a)
  }
  return [...addresses].sort()
}
