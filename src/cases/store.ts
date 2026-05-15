import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { activeCasesRoot } from '../workspace/active.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { CaseSchema, type Case, type CaseStatus } from './schema.js'

export const casesRoot = activeCasesRoot

function caseDir(id: string): string {
  return path.join(casesRoot(), id)
}

export function generateCaseId(name: string, existingIds: string[]): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
  const todayNums = existingIds
    .filter(id => id.startsWith(date + '_'))
    .map(id => parseInt(id.split('_')[1] ?? '0', 10))
    .filter(n => !isNaN(n))
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1
  return `${date}_${String(next).padStart(3, '0')}_${slug}`
}

export const CaseStore = {
  async create(input: { name: string; tags: string[]; description: string }): Promise<Case> {
    const root = casesRoot()
    await mkdir(root, { recursive: true })
    const existingIds = await readdir(root).catch(() => [])
    const id = generateCaseId(input.name, existingIds)
    const slug = id.split('_').slice(2).join('_')
    const now = new Date().toISOString()
    const tags = input.tags

    const dir = caseDir(id)
    await mkdir(path.join(dir, 'evidence'), { recursive: true })
    await mkdir(path.join(dir, 'dossiers'), { recursive: true })

    const fm: Record<string, string> = {
      id,
      name: input.name,
      status: 'open',
      created: now,
      updated: now,
      tags: tags.join(','),
      description: input.description,
      slug,
    }
    const body = `# ${input.name}\n\n*Opened: ${now}*\n\nInvestigation notes added here by agent.\n`
    await writeFile(path.join(dir, 'case.md'), serializeFrontmatter(fm, body), { mode: 0o600 })

    const manifest = JSON.stringify({ caseId: id, entries: [] }, null, 2) + '\n'
    await writeFile(path.join(dir, 'manifest.json'), manifest, { mode: 0o600 })

    return CaseSchema.parse({ id, name: input.name, status: 'open', created: now, updated: now, tags, description: input.description, slug })
  },

  async setStatus(id: string, status: CaseStatus): Promise<Case> {
    const dir = caseDir(id)
    const filePath = path.join(dir, 'case.md')
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseFrontmatter(raw)
    const now = new Date().toISOString()
    frontmatter['status'] = status
    frontmatter['updated'] = now
    await writeFile(filePath, serializeFrontmatter(frontmatter, body), { mode: 0o600 })

    const tags = (frontmatter['tags'] ?? '').split(',').filter(Boolean)
    return CaseSchema.parse({
      id,
      name: frontmatter['name'] ?? '',
      status,
      created: frontmatter['created'] ?? now,
      updated: now,
      tags,
      description: frontmatter['description'] ?? '',
    })
  },

  async list(): Promise<Array<{ id: string; name: string; status: string }>> {
    const root = casesRoot()
    try {
      const ids = await readdir(root)
      const cases: Array<{ id: string; name: string; status: string; created: string }> = []
      for (const id of ids) {
        try {
          const raw = await readFile(path.join(caseDir(id), 'case.md'), 'utf8')
          const { frontmatter } = parseFrontmatter(raw)
          cases.push({
            id,
            name: frontmatter['name'] ?? id,
            status: frontmatter['status'] ?? 'open',
            created: frontmatter['created'] ?? '',
          })
        } catch (err: unknown) {
          const nodeErr = err as NodeJS.ErrnoException
          if (nodeErr.code !== 'ENOENT' && nodeErr.code !== 'ENOTDIR') throw err
        }
      }
      return cases
        .sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id))
        .map(({ id, name, status }) => ({ id, name, status }))
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') return []
      throw err
    }
  },

  async get(id: string): Promise<Case> {
    const dir = caseDir(id)
    const raw = await readFile(path.join(dir, 'case.md'), 'utf8')
    const { frontmatter } = parseFrontmatter(raw)
    const tags = (frontmatter['tags'] ?? '').split(',').filter(Boolean)
    return CaseSchema.parse({
      id,
      name: frontmatter['name'] ?? '',
      status: frontmatter['status'] ?? 'open',
      created: frontmatter['created'] ?? new Date().toISOString(),
      updated: frontmatter['updated'] ?? new Date().toISOString(),
      tags,
      description: frontmatter['description'] ?? '',
    })
  },

  async loadContext(id: string): Promise<{
    case: { id: string; name: string; status: string; created: string; updated: string; tags: string[] };
    lastSession: { sessionId: string; startTime: string; endTime?: string; body: string } | null;
    dossierSummaries: Array<{ address: string; type: string; riskTags: string; firstSeen: string; lastSeen: string }>;
    evidenceCount: number;
  }> {
    const dir = caseDir(id)

    // Read case.md
    const raw = await readFile(path.join(dir, 'case.md'), 'utf8')
    const { frontmatter } = parseFrontmatter(raw)
    const tags = (frontmatter['tags'] ?? '').split(',').filter(Boolean)

    // Lazy imports to avoid circular deps
    const { SessionStore } = await import('./session.js')
    const { DossierStore } = await import('./dossier.js')

    const [latestSession, dossierSummaries, manifest] = await Promise.all([
      SessionStore.getLatest(id),
      DossierStore.listSummaries(id),
      readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => '{"entries":[]}'),
    ])

    const manifestData = JSON.parse(manifest) as { entries: unknown[] }
    const evidenceCount = manifestData.entries.length

    const lastSession = latestSession
      ? {
          sessionId: latestSession.frontmatter['sessionId'] ?? '',
          startTime: latestSession.frontmatter['startTime'] ?? '',
          endTime: latestSession.frontmatter['endTime'] || undefined,
          body: latestSession.body,
        }
      : null

    return {
      case: {
        id,
        name: frontmatter['name'] ?? '',
        status: frontmatter['status'] ?? 'open',
        created: frontmatter['created'] ?? '',
        updated: frontmatter['updated'] ?? '',
        tags,
      },
      lastSession,
      dossierSummaries,
      evidenceCount,
    }
  },
}
