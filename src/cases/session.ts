import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { type Session } from './schema.js'

function caseDir(caseId: string): string {
  return path.join(os.homedir(), '.chain-insights', 'cases', caseId)
}

const MAX_SESSIONS = 5

export const SessionStore = {
  async start(caseId: string): Promise<Session> {
    const dir = caseDir(caseId)
    // Count existing session files for sequence
    let seq = 1
    try {
      const files = await readdir(dir)
      const sessionFiles = files.filter(f => f.match(/^session_\d+\.md$/))
      seq = sessionFiles.length + 1
    } catch {
      seq = 1
    }
    const seqStr = String(seq).padStart(3, '0')
    const filename = `session_${seqStr}.md`
    const sessionId = `${caseId}_s${seqStr}`
    const now = new Date().toISOString()

    const fm: Record<string, string> = {
      sessionId,
      caseId,
      startTime: now,
      endTime: '',
      status: 'active',
    }
    const body = `# Session ${seq}: ${now.slice(0, 10)}\n\n## Investigation Log\n\n## Key Findings\n\n## Next Steps\n\n`
    await writeFile(path.join(dir, filename), serializeFrontmatter(fm, body), { mode: 0o600 })

    return { sessionId, caseId, startTime: now, status: 'active' }
  },

  async end(
    caseId: string,
    input: { findings: string; nextSteps: string }
  ): Promise<void> {
    const dir = caseDir(caseId)
    const files = await readdir(dir)
    const sessionFiles = files
      .filter(f => f.match(/^session_\d+\.md$/))
      .sort((a, b) => {
        const seqA = parseInt(a.replace('session_', '').replace('.md', ''), 10)
        const seqB = parseInt(b.replace('session_', '').replace('.md', ''), 10)
        return seqB - seqA // descending — latest first
      })
    if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`)
    const latestFile = sessionFiles[0]!
    const filePath = path.join(dir, latestFile)
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseFrontmatter(raw)
    const now = new Date().toISOString()
    frontmatter['endTime'] = now
    frontmatter['status'] = 'ended'

    // Append findings and next steps to body
    const updatedBody = body
      .replace('## Key Findings\n', `## Key Findings\n\n${input.findings}\n`)
      .replace('## Next Steps\n', `## Next Steps\n\n${input.nextSteps}\n`)

    await writeFile(filePath, serializeFrontmatter(frontmatter, updatedBody), { mode: 0o600 })
  },

  async getLatest(caseId: string): Promise<{ frontmatter: Record<string, string>; body: string } | null> {
    const dir = caseDir(caseId)
    try {
      const files = await readdir(dir)
      const sessionFiles = files
        .filter(f => f.match(/^session_\d+\.md$/))
        .sort((a, b) => {
          const seqA = parseInt(a.replace('session_', '').replace('.md', ''), 10)
          const seqB = parseInt(b.replace('session_', '').replace('.md', ''), 10)
          return seqB - seqA
        })
      if (sessionFiles.length === 0) return null
      const raw = await readFile(path.join(dir, sessionFiles[0]!), 'utf8')
      return parseFrontmatter(raw)
    } catch {
      return null
    }
  },

  async archiveOldSessions(caseId: string): Promise<void> {
    const dir = caseDir(caseId)
    const files = await readdir(dir)
    const sessionFiles = files
      .filter(f => f.match(/^session_\d+\.md$/))
      .sort((a, b) => {
        const seqA = parseInt(a.replace('session_', '').replace('.md', ''), 10)
        const seqB = parseInt(b.replace('session_', '').replace('.md', ''), 10)
        return seqA - seqB // ascending — oldest first
      })

    if (sessionFiles.length <= MAX_SESSIONS) return

    // Files to archive = everything beyond the 5 most recent (which are at the end)
    const toArchive = sessionFiles.slice(0, sessionFiles.length - MAX_SESSIONS)
    const historyPath = path.join(dir, 'history.md')

    // Pitfall 5 mitigation: ENOENT-safe read of history.md
    const existingHistory = await readFile(historyPath, 'utf8').catch(() => '')

    const summaries: string[] = []
    for (const filename of toArchive) {
      const raw = await readFile(path.join(dir, filename), 'utf8')
      const { frontmatter, body } = parseFrontmatter(raw)
      // Extract a one-paragraph summary: sessionId + key findings section
      const findingsMatch = body.match(/## Key Findings\n+([\s\S]*?)(?:\n## |$)/)
      const findings = findingsMatch ? findingsMatch[1]!.trim() : '(no findings recorded)'
      summaries.push(`### ${frontmatter['sessionId'] ?? filename} (${frontmatter['startTime'] ?? ''})\n\n${findings}\n`)
    }

    const newHistory = existingHistory + '\n' + summaries.join('\n') + '\n'
    await writeFile(historyPath, newHistory, { mode: 0o600 })

    // Delete archived session files
    for (const filename of toArchive) {
      await rm(path.join(dir, filename))
    }
  },
}
