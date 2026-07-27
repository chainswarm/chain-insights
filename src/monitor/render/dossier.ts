// src/monitor/render/dossier.ts
// The case dossier (spec req 3): headline verdict, funds-destination summary,
// exchange deposit endpoints, scammer cluster, bounded mermaid flow, report
// links. Pure renderer + one write helper — no MCP client.
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { MonitorCase } from '../cases.js'
import type { TraceV1Doc, TraceV1Address } from './trace-io.js'
import type { CaseVerdict } from './verdict.js'
import { publishedCaseDir } from './notes.js'

export interface DossierInput {
  monitorCase: MonitorCase
  verdict: CaseVerdict
  docs: TraceV1Doc[]
  /** report artifact paths (from trace structuredContent.artifacts / files
   *  under reports/), relative or absolute — linked verbatim. */
  reportArtifacts: string[]
  mermaid: string // from buildMermaidFlow (unfenced)
  generatedAtTimestamp: number
}

// Addresses and labels are chain data interpolated into Markdown tables.
function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

/** Traced value grouped by terminal endpoint class over docs[].paths:
 *  terminal_role 'exchange' | 'deposit' | anything else → 'unattributed'. */
export function fundsDestinationSummary(docs: TraceV1Doc[]): Array<{
  endpointClass: string
  totalAmountUsd: number
  pathCount: number
}> {
  const groups = new Map<string, { totalAmountUsd: number; pathCount: number }>()
  for (const doc of docs) {
    for (const p of doc.paths) {
      const endpointClass = p.terminal_role === 'exchange' || p.terminal_role === 'deposit' ? p.terminal_role : 'unattributed'
      let g = groups.get(endpointClass)
      if (!g) groups.set(endpointClass, (g = { totalAmountUsd: 0, pathCount: 0 }))
      g.totalAmountUsd += p.amount_usd_sum ?? 0
      g.pathCount += 1
    }
  }
  return [...groups.entries()]
    .map(([endpointClass, g]) => ({ endpointClass, ...g }))
    .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd)
}

function mergedAddresses(docs: TraceV1Doc[]): Map<string, TraceV1Address> {
  const byAddress = new Map<string, TraceV1Address>()
  for (const doc of docs) {
    for (const a of doc.addresses) {
      const existing = byAddress.get(a.address)
      if (!existing) {
        byAddress.set(a.address, { ...a, roles: [...a.roles], labels: a.labels ? [...a.labels] : undefined })
      } else {
        existing.roles = [...new Set([...existing.roles, ...a.roles])]
        if (a.labels?.length) existing.labels = [...new Set([...(existing.labels ?? []), ...a.labels])]
        if (a.is_exchange) existing.is_exchange = true
      }
    }
  }
  return byAddress
}

/** Pure: returns the full dossier.md content. */
export function renderDossier(input: DossierInput): string {
  const { monitorCase, verdict, docs, reportArtifacts, mermaid, generatedAtTimestamp } = input
  const addresses = mergedAddresses(docs)
  const lines: string[] = []
  lines.push(`# Case ${monitorCase.case_id} — ${verdict.headline}`, '')
  lines.push(`- Network: ${monitorCase.network}`)
  lines.push(`- Type: ${monitorCase.type}`)
  lines.push(`- Status: ${monitorCase.status}`)
  lines.push(`- Seeds: ${monitorCase.seeds.map(cell).join(', ')}`)
  lines.push(`- Generated: ${new Date(generatedAtTimestamp * 1000).toISOString()}`)
  if (verdict.lastMovementTimestamp !== null) lines.push(`- Last movement: ${utcDate(verdict.lastMovementTimestamp)}`)
  lines.push('')

  lines.push('## Funds destination summary', '')
  const summary = fundsDestinationSummary(docs)
  if (summary.length === 0) {
    lines.push('No traced paths.', '')
  } else {
    lines.push('| Terminal endpoint class | Total (USD) | Paths |', '| --- | ---: | ---: |')
    for (const row of summary) lines.push(`| ${cell(row.endpointClass)} | ${row.totalAmountUsd.toFixed(2)} | ${row.pathCount} |`)
    lines.push('')
  }

  lines.push('## Exchange deposit endpoints', '')
  const exchangePaths = docs.flatMap((d) => d.paths.filter((p) => p.terminal_role === 'exchange'))
  if (exchangePaths.length === 0) {
    lines.push('None identified.', '')
  } else {
    lines.push('| Deposit address | Exchange address | Exchange labels | Amount (USD) |', '| --- | --- | --- | ---: |')
    for (const p of exchangePaths) {
      const deposit = p.addresses.length >= 2 ? p.addresses[p.addresses.length - 2]! : p.source
      const meta = addresses.get(p.target)
      lines.push(`| ${cell(deposit)} | ${cell(p.target)} | ${cell(meta?.labels?.join(', ') ?? '')} | ${(p.amount_usd_sum ?? 0).toFixed(2)} |`)
    }
    lines.push('')
  }

  lines.push('## Scammer cluster', '')
  // Every traced address with roles minus pure exchanges (an exchange is a
  // destination, not a cluster member).
  const cluster = [...addresses.values()].filter((a) => a.roles.length > 0 && !(a.is_exchange || a.roles.every((r) => r === 'exchange')))
  if (cluster.length === 0) {
    lines.push('No cluster addresses traced.', '')
  } else {
    lines.push('| Address | Roles | Labels |', '| --- | --- | --- |')
    for (const a of cluster) lines.push(`| ${cell(a.address)} | ${cell(a.roles.join(', '))} | ${cell(a.labels?.join(', ') ?? '')} |`)
    lines.push('')
  }

  lines.push('## Money flow', '', '```mermaid', mermaid, '```', '')

  lines.push('## Reports', '')
  if (reportArtifacts.length === 0) {
    lines.push('No report artifacts.', '')
  } else {
    for (const artifact of reportArtifacts) lines.push(`- [${artifact}](${artifact})`)
    lines.push('')
  }

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
