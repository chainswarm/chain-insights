import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { workspaceOutputPaths } from '../workspace/output-root.js'
import { serializeFrontmatter } from './frontmatter.js'

const MAX_INLINE_JSON_BYTES = 8 * 1024

function caseDir(caseId: string): string {
  return path.join(workspaceOutputPaths().casesRoot, caseId)
}

function sanitizeSource(source: string): string {
  return source.replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
}

function formatTimestamp(): string {
  // Returns timestamp like 20260511T142300 (no colons, no dots)
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15)
}

function parseJsonContent(content: string): unknown | null {
  const trimmed = content.trim()
  if (trimmed.startsWith('```')) return null
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function compactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactJsonValue)
  if (!value || typeof value !== 'object') return value

  const compact: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue
    compact[key] = compactJsonValue(entry)
  }
  return compact
}

function summarizeJsonValue(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      count: value.length,
      sample: value.slice(0, 3).map(compactJsonValue),
    }
  }

  if (!value || typeof value !== 'object') {
    return { kind: typeof value, value }
  }

  const record = compactJsonValue(value) as Record<string, unknown>
  const summary: Record<string, unknown> = {
    kind: 'object',
    keys: Object.keys(record).slice(0, 50),
  }
  for (const key of ['schema', 'source', 'tool', 'network', 'seed_address', 'address']) {
    if (typeof record[key] === 'string') summary[key] = record[key]
  }
  for (const key of ['files', 'outputs', 'facts']) {
    const entry = record[key]
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) summary[key] = compactJsonValue(entry)
  }
  const counts = Object.fromEntries(
    Object.entries(record)
      .filter(([, entry]) => Array.isArray(entry))
      .map(([key, entry]) => [key, (entry as unknown[]).length]),
  )
  if (Object.keys(counts).length > 0) summary['array_counts'] = counts
  return summary
}

async function formatEvidenceContent(
  evidenceId: string,
  source: string,
  timestamp: string,
  content: string,
): Promise<string> {
  const parsedJson = parseJsonContent(content)
  if (parsedJson === null) return content

  const compactJson = compactJsonValue(parsedJson)
  const prettyJson = JSON.stringify(compactJson, null, 2)
  if (Buffer.byteLength(prettyJson, 'utf8') <= MAX_INLINE_JSON_BYTES) {
    return `\`\`\`json\n${prettyJson}\n\`\`\``
  }

  const paths = workspaceOutputPaths()
  await mkdir(paths.reportTablesRoot, { recursive: true, mode: 0o700 })
  const safeSource = sanitizeSource(source) || 'evidence'
  const tableFilename = `${evidenceId}_${safeSource}_${timestamp}_${Math.random().toString(36).slice(2, 8)}.json`
  const tablePath = path.join(paths.reportTablesRoot, tableFilename)
  await writeFile(tablePath, prettyJson + '\n', { mode: 0o600, flag: 'wx' })
  const relativeTablePath = path.relative(paths.root, tablePath)
  const summary = {
    schema: 'chain-insights.evidence_summary.v1',
    omitted_inline_json: true,
    stored_json: relativeTablePath,
    summary: summarizeJsonValue(compactJson),
  }
  return [
    'Large JSON evidence was stored as an analyst table extract instead of inline Markdown.',
    '',
    `Stored JSON: \`${relativeTablePath}\``,
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
  ].join('\n')
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function appendToManifest(
  manifestPath: string,
  entry: { file: string; sha256: string }
): Promise<void> {
  const existing = JSON.parse(
    await readFile(manifestPath, 'utf8').catch(() => '{"entries":[]}')
  ) as { caseId?: string; entries: Array<{ file: string; sha256: string }> }
  existing.entries.push(entry)
  await writeFile(manifestPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 })
}

export const EvidenceStore = {
  async append(
    caseId: string,
    input: { source: string; content: string; queryParams: string }
  ): Promise<{ filename: string; sha256: string }> {
    const dir = caseDir(caseId)
    const evidenceDir = path.join(dir, 'evidence')
    await mkdir(evidenceDir, { recursive: true })
    const safeSource = sanitizeSource(input.source)
    const timestamp = formatTimestamp()

    // Determine sequence number
    let seq = 1
    try {
      const files = await readdir(evidenceDir)
      const evidenceFiles = files.filter(f => f.endsWith('.md'))
      seq = evidenceFiles.length + 1
    } catch {
      seq = 1
    }
    const seqStr = String(seq).padStart(3, '0')
    let filename = `${seqStr}_${safeSource}_${timestamp}.md`

    // Build file content
    const now = new Date().toISOString()
    const fm: Record<string, string> = {
      id: `${caseId}_ev${seqStr}`,
      caseId,
      source: input.source,
      timestamp: now,
      queryParams: input.queryParams,
    }
    const evidenceId = `${caseId}_ev${seqStr}`
    const formattedContent = await formatEvidenceContent(evidenceId, input.source, timestamp, input.content)
    const body = [
      `## Evidence: ${input.source}`,
      '',
      `**Source:** ${input.source}`,
      `**Captured:** ${now}`,
      '',
      formattedContent,
      '',
    ].join('\n')
    const fileContent = serializeFrontmatter(fm, body)

    // Write with exclusive flag to prevent sequence collision (Pitfall 4)
    const filePath = path.join(evidenceDir, filename)
    try {
      await writeFile(filePath, fileContent, { mode: 0o600, flag: 'wx' })
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EEXIST') {
        // Retry with timestamp-unique suffix
        filename = `${seqStr}_${safeSource}_${timestamp}_${Math.random().toString(36).slice(2, 6)}.md`
        await writeFile(path.join(evidenceDir, filename), fileContent, { mode: 0o600, flag: 'wx' })
      } else {
        throw err
      }
    }

    // Compute SHA-256 of written content and append to manifest
    const sha256 = hashContent(fileContent)
    await appendToManifest(path.join(dir, 'manifest.json'), { file: filename, sha256 })

    return { filename, sha256 }
  },

  async verifyManifest(caseId: string): Promise<{ ok: boolean; count: number; tampered?: string[] }> {
    const dir = caseDir(caseId)
    const manifestPath = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8').catch(() => '{"entries":[]}')
    ) as { entries: Array<{ file: string; sha256: string }> }

    const tampered: string[] = []
    for (const entry of manifest.entries) {
      const filePath = path.join(dir, 'evidence', entry.file)
      try {
        const content = await readFile(filePath, 'utf8')
        const actual = hashContent(content)
        if (actual !== entry.sha256) {
          tampered.push(entry.file)
        }
      } catch {
        tampered.push(entry.file) // File missing = tampered
      }
    }

    return {
      ok: tampered.length === 0,
      count: manifest.entries.length,
      ...(tampered.length > 0 ? { tampered } : {}),
    }
  },
}
