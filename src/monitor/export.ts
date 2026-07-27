// src/monitor/export.ts
// Curated-label export (spec Review→Labels section). Reads ONLY approve
// decisions and their reviewer-stamped reviewed_copy (never the original
// machine doc, never reject decisions) so the exported label set matches
// exactly what a human signed off on.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { monitorPaths } from './paths.js'
import { effectiveDecisions } from './review.js'

export interface LabelRow {
  address: string
  network: string
  label: string
  source_tool: string
  reviewer: string
  decided_at_timestamp: number
}

interface ReviewedFinding {
  address: string
  classification?: string
  exchange_like?: boolean | null
  gate?: string
}

interface ReviewedFindingsDoc {
  tool: string
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

export async function exportLabels(workspaceRoot: string, nowTimestamp: number): Promise<{ jsonPath: string; csvPath: string; rows: LabelRow[] }> {
  const rows: LabelRow[] = []
  // effectiveDecisions: a decision superseded by --force must not export.
  for (const decision of await effectiveDecisions(workspaceRoot)) {
    if (decision.decision !== 'approve' || !decision.reviewed_copy) continue
    // One read per decision doc — reviewer, tool, network, and findings all
    // come off this single parse (do NOT re-read reviewed_copy per field).
    // Per-decision tolerance (R5): an unreadable/malformed reviewed copy costs
    // that decision only, with a warning — never the whole export.
    let doc: ReviewedFindingsDoc
    try {
      doc = JSON.parse(await readFile(decision.reviewed_copy, 'utf8')) as ReviewedFindingsDoc
      if (!Array.isArray(doc.findings)) throw new Error('findings is not an array')
    } catch (err) {
      console.warn(`[monitor] skipping unreadable findings/decision file ${decision.reviewed_copy}: ${(err as Error).message}`)
      continue
    }
    for (const f of doc.findings) {
      const label = f.classification ?? (f.exchange_like === true ? 'exchange candidate' : f.gate)
      if (!label) continue
      rows.push({
        address: f.address,
        network: doc.network,
        label,
        source_tool: doc.tool,
        reviewer: doc.reviewer,
        decided_at_timestamp: decision.decided_at_timestamp,
      })
    }
  }
  const dir = monitorPaths(workspaceRoot).reportsDir
  await mkdir(dir, { recursive: true })
  const jsonPath = path.join(dir, `labels-${nowTimestamp}.json`)
  const csvPath = path.join(dir, `labels-${nowTimestamp}.csv`)
  await writeFile(jsonPath, JSON.stringify(rows, null, 2) + '\n', 'utf8')
  const header = 'address,network,label,source_tool,reviewer,decided_at_timestamp'
  const csvLines = [
    header,
    ...rows.map((r) => [r.address, r.network, r.label, r.source_tool, r.reviewer, r.decided_at_timestamp].map(csvField).join(',')),
  ]
  await writeFile(csvPath, csvLines.join('\n') + '\n', 'utf8')
  return { jsonPath, csvPath, rows }
}
