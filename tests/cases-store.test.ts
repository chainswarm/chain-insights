import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('CaseStore (CASE-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let prevWorkspace: string | undefined
  let prevCasesRoot: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-cases-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    await writeFile(join(fakeHome, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: fakeHome,
      cases_dir: 'cases',
    }) + '\n')
    prevHome = process.env['HOME']
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    prevCasesRoot = process.env['CHAIN_INSIGHTS_CASES_ROOT']
    process.env['HOME'] = fakeHome
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = fakeHome
    delete process.env['CHAIN_INSIGHTS_CASES_ROOT']
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    if (prevCasesRoot === undefined) delete process.env['CHAIN_INSIGHTS_CASES_ROOT']
    else process.env['CHAIN_INSIGHTS_CASES_ROOT'] = prevCasesRoot
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

    const c = await CaseStore.create({ name: 'Test Case', tags: [], description: '' })
    const caseDir = join(fakeHome, 'cases', c.id)
    await expect(stat(caseDir)).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'evidence'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'dossiers'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'case.md'))).resolves.toBeTruthy()
    await expect(stat(join(caseDir, 'manifest.json'))).resolves.toBeTruthy()
  })

  it('case.md has correct YAML frontmatter', async () => {
    const { CaseStore } = await import('../src/cases/index.js')

    const c = await CaseStore.create({ name: 'AML Test', tags: ['aml', 'defi'], description: 'Test investigation' })
    const caseDir = join(fakeHome, 'cases', c.id)
    const content = await readFile(join(caseDir, 'case.md'), 'utf8')
    expect(content).toContain('id: ')
    expect(content).toContain('name: AML Test')
    expect(content).toContain('status: open')
    expect(content).toContain('tags: aml,defi')
    expect(content).toContain('description: Test investigation')
  })

  it('case.md has 0o600 permissions', async () => {
    const { CaseStore } = await import('../src/cases/index.js')

    const c = await CaseStore.create({ name: 'Perm Test', tags: [], description: '' })
    const caseDir = join(fakeHome, 'cases', c.id)
    const st = await stat(join(caseDir, 'case.md'))
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('CaseStore.setStatus() updates case.md and returns updated case', async () => {
    const { CaseStore } = await import('../src/cases/index.js')

    const c = await CaseStore.create({ name: 'Status Test', tags: [], description: '' })
    const updated = await CaseStore.setStatus(c.id, 'active')
    expect(updated.status).toBe('active')

    const caseDir = join(fakeHome, 'cases', c.id)
    const content = await readFile(join(caseDir, 'case.md'), 'utf8')
    expect(content).toContain('status: active')
  })

  it('CaseStore.create() fails outside an initialized workspace', async () => {
    const cleanCwd = join(tmpdir(), `ci-no-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const prevCwd = process.cwd()
    await mkdir(cleanCwd, { recursive: true })
    delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    delete process.env['CHAIN_INSIGHTS_CASES_ROOT']
    process.chdir(cleanCwd)
    vi.resetModules()
    try {
      const { CaseStore } = await import('../src/cases/index.js')

      await expect(CaseStore.create({ name: 'No Workspace', tags: [], description: '' }))
        .rejects.toThrow('No Chain Insights workspace found. Run: cia init .')
    } finally {
      process.chdir(prevCwd)
      await rm(cleanCwd, { recursive: true, force: true })
    }
  })

  it('CaseStore.list() returns filesystem-backed cases', async () => {
    const { CaseStore } = await import('../src/cases/index.js')

    await CaseStore.create({ name: 'Case Alpha', tags: [], description: '' })
    await CaseStore.create({ name: 'Case Beta', tags: [], description: '' })
    const cases = await CaseStore.list()
    expect(cases.length).toBeGreaterThanOrEqual(2)
    const names = cases.map(c => c.name)
    expect(names).toContain('Case Alpha')
    expect(names).toContain('Case Beta')
  })

})
