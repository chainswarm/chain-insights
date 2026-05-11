import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'

function caseDir(caseId: string): string {
  return path.join(os.homedir(), '.chain-insights', 'cases', caseId)
}

function sanitizeAddress(address: string): string {
  // Security T-03-06: prevent path traversal by stripping all non-alphanumeric chars
  return address.replace(/[^a-zA-Z0-9]/g, '').slice(0, 66)
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export const DossierStore = {
  async appendFinding(
    caseId: string,
    address: string,
    finding: string,
    entityType: 'eoa' | 'contract' | 'exchange' | 'mixer' | 'unknown' = 'unknown'
  ): Promise<void> {
    const safeAddr = sanitizeAddress(address)
    const dossierDir = path.join(caseDir(caseId), 'dossiers')
    await mkdir(dossierDir, { recursive: true })
    const filePath = path.join(dossierDir, `${safeAddr}.md`)
    const now = new Date().toISOString()

    let raw: string
    let isNew = false
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code !== 'ENOENT') throw err
      // New dossier — create template
      const fm: Record<string, string> = {
        address,
        type: entityType,
        firstSeen: now,
        lastSeen: now,
        riskTags: '',
      }
      const body = `# Entity: ${address}\n\n## Summary\n\nEntity observed in case ${caseId}.\n\n## Findings\n\n## Links to Evidence\n\n## Related Entities\n\n`
      raw = serializeFrontmatter(fm, body)
      isNew = true
    }

    // Content-hash deduplication — skip if finding already present (text presence check)
    if (!isNew && raw.includes(finding)) {
      return
    }

    // Update frontmatter lastSeen
    const { frontmatter, body } = parseFrontmatter(raw)
    frontmatter['lastSeen'] = now
    if (!isNew) {
      frontmatter['type'] = entityType
    }

    // Append finding to ## Findings section
    const findingEntry = `- [${now}] ${finding}\n`
    const updatedBody = body.replace('## Findings\n', `## Findings\n\n${findingEntry}`)

    await writeFile(filePath, serializeFrontmatter(frontmatter, updatedBody), { mode: 0o600 })
  },

  async get(caseId: string, address: string): Promise<{ frontmatter: Record<string, string>; body: string } | null> {
    const safeAddr = sanitizeAddress(address)
    const filePath = path.join(caseDir(caseId), 'dossiers', `${safeAddr}.md`)
    try {
      const raw = await readFile(filePath, 'utf8')
      return parseFrontmatter(raw)
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') return null
      throw err
    }
  },

  async listSummaries(caseId: string): Promise<Array<{ address: string; type: string; riskTags: string; firstSeen: string; lastSeen: string }>> {
    const dossierDir = path.join(caseDir(caseId), 'dossiers')
    try {
      const files = await readdir(dossierDir)
      const summaries = []
      for (const file of files.filter(f => f.endsWith('.md'))) {
        const raw = await readFile(path.join(dossierDir, file), 'utf8')
        const { frontmatter } = parseFrontmatter(raw)
        summaries.push({
          address: frontmatter['address'] ?? file.replace('.md', ''),
          type: frontmatter['type'] ?? 'unknown',
          riskTags: frontmatter['riskTags'] ?? '',
          firstSeen: frontmatter['firstSeen'] ?? '',
          lastSeen: frontmatter['lastSeen'] ?? '',
        })
      }
      return summaries
    } catch {
      return []
    }
  },
}
