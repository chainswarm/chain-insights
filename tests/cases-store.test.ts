import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('CaseStore (CASE-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-cases-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('generateCaseId creates correct format', async () => {
    const { generateCaseId } = await import('../src/cases/index.js')
    const id = generateCaseId('Tornado Mixer Investigation', [])
    expect(id).toMatch(/^\d{8}_001_tornado-mixer-investigation$/)
  })

  it('generateCaseId increments sequence for same date', async () => {
    const { generateCaseId } = await import('../src/cases/index.js')
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const existing = [`${today}_001_test`]
    const id = generateCaseId('test', existing)
    expect(id).toMatch(new RegExp(`^${today}_002_test$`))
  })

  it('CaseStore.create() creates directory structure', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()

    const c = await CaseStore.create({ name: 'Test Case', tags: [], description: '' })
    const caseDir = join(fakeHome, '.chain-insights', 'cases', c.id)
    await expect(stat(caseDir)).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'evidence'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'dossiers'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'case.md'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'manifest.json'))).resolves.toBeTruthy()
  })

  it('case.md has correct YAML frontmatter', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()

    const c = await CaseStore.create({ name: 'AML Test', tags: ['aml', 'defi'], description: 'Test investigation' })
    const caseDir = join(fakeHome, '.chain-insights', 'cases', c.id)
    const content = await readFile(join(caseDir, 'case.md'), 'utf8')
    expect(content).toContain('id: ')
    expect(content).toContain('name: AML Test')
    expect(content).toContain('status: open')
    expect(content).toContain('tags: aml,defi')
    expect(content).toContain('description: Test investigation')
  })

  it('case.md has 0o600 permissions', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()

    const c = await CaseStore.create({ name: 'Perm Test', tags: [], description: '' })
    const caseDir = join(fakeHome, '.chain-insights', 'cases', c.id)
    const st = await stat(join(caseDir, 'case.md'))
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('CaseStore.setStatus() updates case.md and returns updated case', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()

    const c = await CaseStore.create({ name: 'Status Test', tags: [], description: '' })
    const updated = await CaseStore.setStatus(c.id, 'active')
    expect(updated.status).toBe('active')

    const caseDir = join(fakeHome, '.chain-insights', 'cases', c.id)
    const content = await readFile(join(caseDir, 'case.md'), 'utf8')
    expect(content).toContain('status: active')
  })

  it('CaseStore.list() returns cases from DuckDB', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()

    await CaseStore.create({ name: 'Case Alpha', tags: [], description: '' })
    await CaseStore.create({ name: 'Case Beta', tags: [], description: '' })
    const cases = await CaseStore.list()
    expect(cases.length).toBeGreaterThanOrEqual(2)
    const names = cases.map(c => c.name)
    expect(names).toContain('Case Alpha')
    expect(names).toContain('Case Beta')
  })

  it('migrateCasesTable is idempotent (no throw on double call)', async () => {
    const { getDb, initSchema } = await import('../src/db/init.js')
    const conn = await getDb()
    await expect(initSchema(conn)).resolves.not.toThrow()
    await expect(initSchema(conn)).resolves.not.toThrow()
    conn.closeSync()
  })
})
