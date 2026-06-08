import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceOutputPaths } from '../workspace/output-root.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

const EXPOSURE_TABLE_ROW_KEYS = ['exposures', 'venues', 'top_exposures', 'pressure_bands', 'relationships', 'evidence', 'sides'] as const

function sanitizeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[._-]+|[._-]+$/g, '')
  return slug || 'exposure'
}

function exposureArtifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:.]/g, '').replace(/\.[0-9]{3}Z$/, 'Z')
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '""'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(String(value))
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function tableRowsFromExposureContent(structuredContent: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  for (const key of EXPOSURE_TABLE_ROW_KEYS) {
    const value = structuredContent[key]
    if (!Array.isArray(value) || value.length === 0) continue
    if (!value.every((row) => isRecord(row))) continue
    return value as Array<Record<string, unknown>>
  }
  return undefined
}

function exposureRowsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) headers.add(key)
  }
  const headerList = [...headers]
  const lines = [headerList.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(headerList.map((header) => csvEscape(row[header])).join(','))
  }
  return lines.join('\n') + '\n'
}

export type ExposureArtifactsInput = {
  toolName: string
  network: string
  subject: string
  summaryText: string
  structuredContent: Record<string, unknown>
  generatedAt?: Date
  outputPaths?: WorkspaceOutputPaths
}

export type ExposureArtifactPaths = {
  reportPath: string
  compactFactsPath: string
  tablePath?: string
}

export async function writeExposureArtifacts(input: ExposureArtifactsInput): Promise<ExposureArtifactPaths> {
  const outputPaths = input.outputPaths ?? workspaceOutputPaths()
  await Promise.all([
    mkdir(outputPaths.reportsRoot, { recursive: true, mode: 0o700 }),
    mkdir(outputPaths.reportTablesRoot, { recursive: true, mode: 0o700 }),
  ])

  const now = input.generatedAt ?? new Date()
  const timestamp = exposureArtifactTimestamp(now)
  const slug = `${timestamp}-${sanitizeSlug(input.toolName)}-${sanitizeSlug(input.subject)}-${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const reportPath = path.join(outputPaths.reportsRoot, `${slug}.exposure-report.md`)
  const compactFactsPath = path.join(outputPaths.reportTablesRoot, `${slug}.compact-facts.json`)
  const compactFacts = {
    schema: input.structuredContent['schema'],
    tool: input.structuredContent['tool'],
    network: input.network,
    subject: input.subject,
    generated_at: now.toISOString(),
    summary_text: input.summaryText,
    facts: input.structuredContent,
  }

  const reportLines = [
    `# ${input.toolName} Report`,
    '',
    `Network: ${input.network}`,
    `Generated: ${now.toISOString()}`,
    '',
    input.summaryText,
    '',
    '## Artifacts',
    `- Report: ${reportPath}`,
    `- Compact facts: ${compactFactsPath}`,
  ]

  const tableRows = tableRowsFromExposureContent(input.structuredContent)
  let tablePath: string | undefined
  if (tableRows) {
    tablePath = path.join(outputPaths.reportTablesRoot, `${slug}.table.csv`)
    reportLines.push(`- Table: ${tablePath}`)
    await writeFile(tablePath, exposureRowsToCsv(tableRows), { mode: 0o600 })
  }

  await Promise.all([
    writeFile(reportPath, reportLines.join('\n') + '\n', { mode: 0o600 }),
    writeFile(compactFactsPath, JSON.stringify(compactFacts, null, 2) + '\n', { mode: 0o600 }),
  ])

  return {
    reportPath,
    compactFactsPath,
    ...(tablePath ? { tablePath } : {}),
  }
}
