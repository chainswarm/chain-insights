// src/monitor/export.ts
// Curated-label export — the frozen chain-insights.curated-labels.v1
// contract (label-lifecycle spec req 1), consumed by the downstream curated
// import loop, which dedups by decision_id. Reads ONLY effective approve
// decisions and their reviewer-stamped reviewed_copy (never the original
// machine doc, never reject decisions) so the exported label set matches
// exactly what a human signed off on.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CASE_CLUSTER_ROLES, type CaseClusterRole } from '../investigation/detection-findings.js'
import { monitorPaths } from './paths.js'
import { docKey, effectiveDecisionEntries } from './review.js'

export const CURATED_LABELS_SCHEMA = 'chain-insights.curated-labels.v1' as const

/** One exported label row. decided_at_timestamp is epoch milliseconds;
 *  case_id is '' for lane-A detector docs; decision_id is the
 *  content-addressed decision filename stem (e.g. "a1b2c3d4-approve"). */
export interface CuratedLabelRow {
  address: string
  network: string
  label: string
  case_id: string
  decision_id: string
  doc_ref: string
  decided_at_timestamp: number
  reviewer: string
}

// Role -> label mapping (spec req 1). Fixed at the three case roles; an
// unknown role is SKIPPED with a warning, never guessed.
const ROLE_LABELS: Record<CaseClusterRole, string> = {
  seed: 'scam_seed',
  candidate_intermediate: 'mule',
  candidate_deposit: 'deposit_endpoint',
}

interface ReviewedFinding {
  address: string
  role?: string
  classification?: string
  exchange_like?: boolean | null
  gate?: string
}

interface ReviewedFindingsDoc {
  network: string
  reviewer: string
  findings: ReviewedFinding[]
}

function csvField(value: string | number): string {
  const s = String(value)
  // RFC 4180: quote on comma, double-quote, CR, or LF. A bare CR (no LF)
  // still terminates a record for strict readers, so it must be quoted too.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function labelOf(f: ReviewedFinding, docRef: string): string | null {
  if (f.role !== undefined) {
    const label = (ROLE_LABELS as Record<string, string | undefined>)[f.role]
    if (!label) {
      console.warn(`[monitor] skipping finding ${f.address} in ${docRef}: unknown case role "${f.role}" (known: ${CASE_CLUSTER_ROLES.join(', ')})`)
      return null
    }
    return label
  }
  // Lane-A detector docs: the detector's own classification IS the label.
  return f.classification ?? (f.exchange_like === true ? 'exchange candidate' : f.gate) ?? null
}

export async function exportLabels(workspaceRoot: string, nowTimestamp: number): Promise<{ jsonPath: string; csvPath: string; rows: CuratedLabelRow[] }> {
  const rows: CuratedLabelRow[] = []
  // effectiveDecisionEntries: a decision superseded by --force must not
  // export, and the surviving entry's FILENAME is the decision identity.
  for (const { file, doc: decision } of await effectiveDecisionEntries(workspaceRoot)) {
    if (decision.decision !== 'approve' || !decision.reviewed_copy) continue
    // One read per decision doc — reviewer, network, and findings all come
    // off this single parse. Per-decision tolerance (R5): an unreadable or
    // malformed reviewed copy costs that decision only, with a warning —
    // never the whole export.
    let doc: ReviewedFindingsDoc
    try {
      doc = JSON.parse(await readFile(decision.reviewed_copy, 'utf8')) as ReviewedFindingsDoc
      if (!Array.isArray(doc.findings)) throw new Error('findings is not an array')
    } catch (err) {
      console.warn(`[monitor] skipping unreadable findings/decision file ${decision.reviewed_copy}: ${(err as Error).message}`)
      continue
    }
    // docKey normalizes legacy absolute doc_path values; new decisions are
    // already workspace-relative (idempotent either way).
    const docRef = docKey(workspaceRoot, decision.doc_path)
    const decisionId = file.replace(/\.review\.json$/, '')
    for (const f of doc.findings) {
      const label = labelOf(f, docRef)
      if (!label) continue
      rows.push({
        address: f.address,
        network: doc.network,
        label,
        case_id: decision.case_id ?? '',
        decision_id: decisionId,
        doc_ref: docRef,
        decided_at_timestamp: decision.decided_at_timestamp,
        reviewer: doc.reviewer,
      })
    }
  }
  const dir = monitorPaths(workspaceRoot).reportsDir
  await mkdir(dir, { recursive: true })
  const jsonPath = path.join(dir, `labels-${nowTimestamp}.json`)
  const csvPath = path.join(dir, `labels-${nowTimestamp}.csv`)
  await writeFile(jsonPath, JSON.stringify({ schema: CURATED_LABELS_SCHEMA, generated_at_timestamp: nowTimestamp, rows }, null, 2) + '\n', 'utf8')
  const header = 'address,network,label,case_id,decision_id,doc_ref,decided_at_timestamp,reviewer'
  const csvLines = [
    header,
    ...rows.map((r) => [r.address, r.network, r.label, r.case_id, r.decision_id, r.doc_ref, r.decided_at_timestamp, r.reviewer].map(csvField).join(',')),
  ]
  await writeFile(csvPath, csvLines.join('\n') + '\n', 'utf8')
  return { jsonPath, csvPath, rows }
}
