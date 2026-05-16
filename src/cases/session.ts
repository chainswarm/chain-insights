import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { workspaceOutputPaths } from '../workspace/output-root.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { type Session } from './schema.js'

function caseDir(caseId: string): string {
  return path.join(workspaceOutputPaths().casesRoot, caseId)
}

const MAX_SESSIONS = 5

function sessionNumber(filename: string): number {
  return parseInt(filename.replace('session_', '').replace('.md', ''), 10)
}

function sessionFromFrontmatter(frontmatter: Record<string, string>): Session {
  return {
    sessionId: frontmatter['sessionId'] ?? '',
    caseId:    frontmatter['caseId'] ?? '',
    startTime: frontmatter['startTime'] ?? new Date().toISOString(),
    endTime:   frontmatter['endTime'] || undefined,
    status:    frontmatter['status'] === 'ended' ? 'ended' : 'active',
  }
}

async function listSessionFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir)
  return files
    .filter(f => f.match(/^session_\d+\.md$/))
    .sort((a, b) => sessionNumber(b) - sessionNumber(a))
}

export const SessionStore = {
  async start(caseId: string, input: { title?: string } = {}): Promise<Session> {
    const dir = caseDir(caseId)
    let sessionFiles: string[] = []
    try {
      sessionFiles = await listSessionFiles(dir)
    } catch {
      sessionFiles = []
    }

    for (const filename of sessionFiles) {
      const raw = await readFile(path.join(dir, filename), 'utf8')
      const { frontmatter } = parseFrontmatter(raw)
      if (frontmatter['status'] !== 'ended') {
        return sessionFromFrontmatter(frontmatter)
      }
    }

    const seq = sessionFiles.length + 1
    const seqStr = String(seq).padStart(3, '0')
    const filename = `session_${seqStr}.md`
    const sessionId = `${caseId}_s${seqStr}`
    const now = new Date().toISOString()
    const title = input.title?.trim()

    const fm: Record<string, string> = {
      sessionId,
      caseId,
      startTime: now,
      endTime: '',
      status: 'active',
    }
    if (title) fm['title'] = title
    const heading = title || now.slice(0, 10)
    const body = `# Session ${seq}: ${heading}\n\n## Investigation Log\n\n## Key Findings\n\n## Next Steps\n\n`
    await writeFile(path.join(dir, filename), serializeFrontmatter(fm, body), { mode: 0o600 })

    return { sessionId, caseId, startTime: now, status: 'active' }
  },

  async end(
    caseId: string,
    input: { findings: string; nextSteps: string }
  ): Promise<void> {
    const dir = caseDir(caseId)
    const sessionFiles = await listSessionFiles(dir)
    if (sessionFiles.length === 0) throw new Error(`No active session for case ${caseId}`)
    let activeFile: string | null = null
    let activeFrontmatter: Record<string, string> | null = null
    let activeBody = ''
    for (const filename of sessionFiles) {
      const raw = await readFile(path.join(dir, filename), 'utf8')
      const { frontmatter, body } = parseFrontmatter(raw)
      if (frontmatter['status'] !== 'ended') {
        activeFile = filename
        activeFrontmatter = frontmatter
        activeBody = body
        break
      }
    }
    if (!activeFile || !activeFrontmatter) throw new Error(`No active session for case ${caseId}`)
    const now = new Date().toISOString()
    activeFrontmatter['endTime'] = now
    activeFrontmatter['status'] = 'ended'

    // Append findings and next steps to body
    const updatedBody = activeBody
      .replace('## Key Findings\n', `## Key Findings\n\n${input.findings}\n`)
      .replace('## Next Steps\n', `## Next Steps\n\n${input.nextSteps}\n`)

    await writeFile(path.join(dir, activeFile), serializeFrontmatter(activeFrontmatter, updatedBody), { mode: 0o600 })
  },

  async getLatest(caseId: string): Promise<{ frontmatter: Record<string, string>; body: string } | null> {
    const dir = caseDir(caseId)
    try {
      const sessionFiles = await listSessionFiles(dir)
      if (sessionFiles.length === 0) return null
      const raw = await readFile(path.join(dir, sessionFiles[0]!), 'utf8')
      return parseFrontmatter(raw)
    } catch {
      return null
    }
  },

  async archiveOldSessions(caseId: string): Promise<void> {
    const dir = caseDir(caseId)
    const sessionFiles = (await listSessionFiles(dir)).reverse()

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
