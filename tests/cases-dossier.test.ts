import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('DossierStore (CASE-03)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let testCaseId: string

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-dossier-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
    const { CaseStore } = await import('../src/cases/index.js')
    const c = await CaseStore.create({ name: 'Dossier Test', tags: [], description: '' })
    testCaseId = c.id
    vi.resetModules()
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('appendFinding() creates dossier file for new address', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0x1234abcd5678ef90', 'Received ETH from mixer', 'eoa')
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers')
    const dossierFile = join(dossierDir, '0x1234abcd5678ef90.md')
    await expect(stat(dossierFile)).resolves.toBeTruthy()
  })

  it('appendFinding() dossier has correct YAML frontmatter', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0x1234abcd', 'First finding', 'eoa')
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers')
    const content = await readFile(join(dossierDir, '0x1234abcd.md'), 'utf8')
    expect(content).toContain('address: 0x1234abcd')
    expect(content).toContain('type: eoa')
    expect(content).toContain('firstSeen:')
    expect(content).toContain('lastSeen:')
  })

  it('appendFinding() has 0o600 permissions', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0xaabbcc', 'finding', 'eoa')
    const filePath = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers', '0xaabbcc'.replace(/[^a-zA-Z0-9]/g, '') + '.md')
    const st = await stat(filePath)
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('appendFinding() contains finding in ## Findings section', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0xtest', 'Received 5 ETH from Tornado', 'eoa')
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers')
    const safe = '0xtest'.replace(/[^a-zA-Z0-9]/g, '')
    const content = await readFile(join(dossierDir, `${safe}.md`), 'utf8')
    expect(content).toContain('## Findings')
    expect(content).toContain('Received 5 ETH from Tornado')
  })

  it('appendFinding() second call appends new finding', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0xaddr', 'First finding', 'eoa')
    await DossierStore.appendFinding(testCaseId, '0xaddr', 'Second finding', 'eoa')
    const safe = '0xaddr'.replace(/[^a-zA-Z0-9]/g, '')
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers')
    const content = await readFile(join(dossierDir, `${safe}.md`), 'utf8')
    expect(content).toContain('First finding')
    expect(content).toContain('Second finding')
  })

  it('appendFinding() deduplicates identical findings', async () => {
    const { DossierStore } = await import('../src/cases/index.js')
    await DossierStore.appendFinding(testCaseId, '0xdup', 'Duplicate finding', 'eoa')
    await DossierStore.appendFinding(testCaseId, '0xdup', 'Duplicate finding', 'eoa')
    const safe = '0xdup'.replace(/[^a-zA-Z0-9]/g, '')
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', testCaseId, 'dossiers')
    const content = await readFile(join(dossierDir, `${safe}.md`), 'utf8')
    const count = (content.match(/Duplicate finding/g) ?? []).length
    expect(count).toBe(1) // Only appears once — deduplication worked
  })
})
