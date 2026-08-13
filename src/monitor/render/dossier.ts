// src/monitor/render/dossier.ts
// The case dossier (spec req 3): headline verdict, case facts, bounded
// seed-set diagram, timeline link. Pure renderer + one write helper — no MCP
// client, no trace data: everything is derived from the case document.
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { MonitorCase } from '../cases.js'
import type { CaseVerdict } from './verdict.js'
import { publishedCaseDir } from './notes.js'

export interface DossierInput {
  monitorCase: MonitorCase
  verdict: CaseVerdict
  mermaid: string // from buildMermaidFlow (unfenced)
  generatedAtTimestamp: number
}

// Addresses and labels are chain data interpolated into Markdown tables.
function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function utcDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10)
}

/** Pure: returns the full dossier.md content. */
export function renderDossier(input: DossierInput): string {
  const { monitorCase, verdict, mermaid, generatedAtTimestamp } = input
  const lines: string[] = []
  lines.push(`# Case ${monitorCase.case_id} — ${verdict.headline}`, '')
  lines.push(`- Network: ${monitorCase.network}`)
  lines.push(`- Type: ${monitorCase.type}`)
  lines.push(`- Status: ${monitorCase.status}`)
  lines.push(`- Seeds: ${monitorCase.seeds.map(cell).join(', ')}`)
  lines.push(`- Generated: ${new Date(generatedAtTimestamp).toISOString()}`)
  if (verdict.lastActivityTimestamp !== null) lines.push(`- Last activity: ${utcDate(verdict.lastActivityTimestamp)}`)
  lines.push('')

  lines.push('## Seed set', '', '```mermaid', mermaid, '```', '')

  lines.push('## Timeline', '', '[Case timeline](timeline.md)', '')
  return lines.join('\n')
}

export async function writeDossier(
  workspaceRoot: string,
  caseId: string,
  content: string,
): Promise<string> {
  const dir = publishedCaseDir(workspaceRoot, caseId)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'dossier.md')
  await writeFile(file, content, 'utf8')
  return file
}