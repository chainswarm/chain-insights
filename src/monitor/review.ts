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
}

export async function listDecisionDocs(workspaceRoot: string): Promise<ReviewDecisionDoc[]> {
  const dir = monitorPaths(workspaceRoot).reviewsDir
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.review.json'))
  } catch {
    return []
  }
  const docs: ReviewDecisionDoc[] = []
  for (const f of files.sort()) docs.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')) as ReviewDecisionDoc)
  return docs
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
    const doc = JSON.parse(await readFile(docPath, 'utf8')) as { tool: string; network: string; findings: unknown[] }
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
  // one of them silently).
  await writeFile(path.join(dir, `${docHash8(workspaceRoot, decision.doc_path)}-${decision.decision}.review.json`), JSON.stringify(decision, null, 2) + '\n', 'utf8')
}

export async function approveDoc(workspaceRoot: string, docPath: string, reviewer: string, nowTimestamp: number): Promise<{ reviewedCopy: string }> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to approve')
  // Normalize BEFORE any read/write so a relative-path approval (e.g. `cia
  // monitor review approve detections/foo.findings.json`) records the same
  // doc_path that listPending matches against (absolute, via monitorPaths'
  // path.join). Without this, a relative approval never clears from pending,
  // and a later absolute-path retry writes a duplicate decision doc —
  // duplicate rows in export labels.
  const resolved = resolveDocPath(workspaceRoot, docPath)
  const raw = JSON.parse(await readFile(resolved, 'utf8')) as Record<string, unknown>
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.reviewedDir, { recursive: true })
  const reviewedCopy = path.join(p.reviewedDir, path.basename(resolved))
  await writeFile(reviewedCopy, JSON.stringify({ ...raw, reviewer }, null, 2) + '\n', 'utf8')
  const findings = (raw.findings as Array<{ address: string }> | undefined) ?? []
  await writeDecision(workspaceRoot, {
    doc_path: docKey(workspaceRoot, resolved), decision: 'approve', reviewer, decided_at_timestamp: nowTimestamp, reviewed_copy: reviewedCopy,
    addresses: findings.map((f) => f.address), case_id: caseIdFromDocPath(resolved),
  })
  return { reviewedCopy }
}

export async function rejectDoc(workspaceRoot: string, docPath: string, reviewer: string, nowTimestamp: number): Promise<void> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to reject')
  // See approveDoc: normalize before use so relative-path rejects also match
  // listPending's absolute doc_path comparison.
  const resolved = resolveDocPath(workspaceRoot, docPath)
  const raw = JSON.parse(await readFile(resolved, 'utf8')) as { findings?: Array<{ address: string }> }
  await writeDecision(workspaceRoot, {
    doc_path: docKey(workspaceRoot, resolved), decision: 'reject', reviewer, decided_at_timestamp: nowTimestamp,
    addresses: (raw.findings ?? []).map((f) => f.address), case_id: caseIdFromDocPath(resolved),
  })
}

export async function approvedAddressesForCase(workspaceRoot: string, caseId: string): Promise<string[]> {
  const decisions = await listDecisionDocs(workspaceRoot)
  const addresses = new Set<string>()
  for (const d of decisions) {
    if (d.decision === 'approve' && d.case_id === caseId) for (const a of d.addresses) addresses.add(a)
  }
  return [...addresses].sort()
}
