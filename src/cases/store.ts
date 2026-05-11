import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { getDb } from '../db/init.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { CaseSchema, type Case, type CaseStatus } from './schema.js'

function casesRoot(): string {
  return path.join(os.homedir(), '.chain-insights', 'cases')
}
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
    const conn = await getDb()
    try {
      const r = await conn.runAndReadAll('SELECT id FROM cases')
      const existingIds = r.getRows().map((row: unknown[]) => row[0] as string)
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

      const stmt = await conn.prepare(
        'INSERT INTO cases (id, name, status, created_at, updated_at, tags, description, slug) VALUES ($id, $name, $status, $created_at, $updated_at, $tags, $description, $slug)'
      )
      await stmt.bind({ id, name: input.name, status: 'open', created_at: now, updated_at: now, tags: tags.join(','), description: input.description, slug })
      await stmt.run()
      stmt.destroySync()

      return CaseSchema.parse({ id, name: input.name, status: 'open', created: now, updated: now, tags, description: input.description, slug })
    } finally {
      conn.closeSync()
    }
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

    const conn = await getDb()
    try {
      const stmt = await conn.prepare('UPDATE cases SET status=$status, updated_at=$updated_at WHERE id=$id')
      await stmt.bind({ status, updated_at: now, id })
      await stmt.run()
      stmt.destroySync()
    } finally {
      conn.closeSync()
    }

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
    const conn = await getDb()
    try {
      const r = await conn.runAndReadAll('SELECT id, name, status FROM cases ORDER BY created_at DESC')
      return r.getRows().map((row: unknown[]) => ({
        id: row[0] as string,
        name: row[1] as string,
        status: row[2] as string,
      }))
    } finally {
      conn.closeSync()
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
}
