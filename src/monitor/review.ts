// src/monitor/review.ts
// The human gate, client side (spec invariant 2). Approve NEVER mutates the
// original machine-produced doc — it writes a reviewer-stamped COPY under
// detections/reviewed/ (the exact input the curated-label import accepts) plus
// an append-only decision doc. RAW-JSON stamping is load-bearing: the zod
// findings schema strips unknown keys, and `reviewer` is deliberately not in
// the schema, so a parse→serialize round trip would silently drop it.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { monitorPaths } from './paths.js'

interface ReviewDecisionDoc {
  doc_path: string
  decision: 'approve' | 'reject'
  reviewer: string
  decided_at_ms: number
  reviewed_copy?: string
  addresses: string[]
  case_id: string | null
}

async function listDecisionDocs(workspaceRoot: string): Promise<ReviewDecisionDoc[]> {
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
  const decided = new Set((await listDecisionDocs(workspaceRoot)).map((d) => d.doc_path))
  const pending: Array<{ doc_path: string; tool: string; network: string; findings_count: number }> = []
  for (const f of files.sort()) {
    const docPath = path.join(p.detectionsDir, f)
    if (decided.has(docPath)) continue
    const doc = JSON.parse(await readFile(docPath, 'utf8')) as { tool: string; network: string; findings: unknown[] }
    pending.push({ doc_path: docPath, tool: doc.tool, network: doc.network, findings_count: doc.findings.length })
  }
  return pending
}

async function writeDecision(workspaceRoot: string, decision: ReviewDecisionDoc): Promise<void> {
  const dir = monitorPaths(workspaceRoot).reviewsDir
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${decision.decided_at_ms}-${decision.decision}.review.json`), JSON.stringify(decision, null, 2) + '\n', 'utf8')
}

export async function approveDoc(workspaceRoot: string, docPath: string, reviewer: string, nowMs: number): Promise<{ reviewedCopy: string }> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to approve')
  const raw = JSON.parse(await readFile(docPath, 'utf8')) as Record<string, unknown>
  const p = monitorPaths(workspaceRoot)
  await mkdir(p.reviewedDir, { recursive: true })
  const reviewedCopy = path.join(p.reviewedDir, path.basename(docPath))
  await writeFile(reviewedCopy, JSON.stringify({ ...raw, reviewer }, null, 2) + '\n', 'utf8')
  const findings = (raw.findings as Array<{ address: string }> | undefined) ?? []
  await writeDecision(workspaceRoot, {
    doc_path: docPath, decision: 'approve', reviewer, decided_at_ms: nowMs, reviewed_copy: reviewedCopy,
    addresses: findings.map((f) => f.address), case_id: caseIdFromDocPath(docPath),
  })
  return { reviewedCopy }
}

export async function rejectDoc(workspaceRoot: string, docPath: string, reviewer: string, nowMs: number): Promise<void> {
  if (!reviewer.trim()) throw new Error('reviewer identity is required to reject')
  const raw = JSON.parse(await readFile(docPath, 'utf8')) as { findings?: Array<{ address: string }> }
  await writeDecision(workspaceRoot, {
    doc_path: docPath, decision: 'reject', reviewer, decided_at_ms: nowMs,
    addresses: (raw.findings ?? []).map((f) => f.address), case_id: caseIdFromDocPath(docPath),
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
