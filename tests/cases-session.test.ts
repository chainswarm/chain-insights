import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('SessionStore (CASE-04)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let testCaseId: string

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
    const { getDb, initSchema } = await import('../src/db/init.js')
    const { CaseStore } = await import('../src/cases/index.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()
    const c = await CaseStore.create({ name: 'Session Test', tags: [], description: '' })
    testCaseId = c.id
    vi.resetModules()
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('start() creates session_001.md with YAML frontmatter', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    const s = await SessionStore.start(testCaseId)
    const caseDir = join(fakeHome, '.chain-insights', 'cases', testCaseId)
    await expect(stat(join(caseDir, 'session_001.md'))).resolves.toBeTruthy()
    expect(s.sessionId).toContain(testCaseId)
    expect(s.status).toBe('active')
  })

  it('start() second call creates session_002.md', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    await SessionStore.start(testCaseId)
    await SessionStore.start(testCaseId)
    const caseDir = join(fakeHome, '.chain-insights', 'cases', testCaseId)
    await expect(stat(join(caseDir, 'session_002.md'))).resolves.toBeTruthy()
  })

  it('end() updates session file with endTime and findings', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    await SessionStore.start(testCaseId)
    await SessionStore.end(testCaseId, {
      findings: 'Found mixer interaction at 0xabc',
      nextSteps: 'Trace funds to exchange',
    })
    const caseDir = join(fakeHome, '.chain-insights', 'cases', testCaseId)
    const content = await readFile(join(caseDir, 'session_001.md'), 'utf8')
    expect(content).toContain('status: ended')
    expect(content).toContain('endTime:')
    expect(content).toContain('Found mixer interaction at 0xabc')
    expect(content).toContain('Trace funds to exchange')
  })

  it('getLatest() returns null when no sessions', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    const result = await SessionStore.getLatest(testCaseId)
    expect(result).toBeNull()
  })

  it('getLatest() returns most recent session', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    await SessionStore.start(testCaseId)
    await SessionStore.end(testCaseId, { findings: 'Old session', nextSteps: '' })
    await SessionStore.start(testCaseId)
    const latest = await SessionStore.getLatest(testCaseId)
    expect(latest).not.toBeNull()
    expect(latest?.frontmatter['status']).toBe('active')
  })

  it('archiveOldSessions() compresses sessions beyond 5 to history.md', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    // Create 6 sessions
    for (let i = 0; i < 6; i++) {
      await SessionStore.start(testCaseId)
      await SessionStore.end(testCaseId, { findings: `Session ${i + 1} findings`, nextSteps: '' })
    }
    await SessionStore.archiveOldSessions(testCaseId)
    const caseDir = join(fakeHome, '.chain-insights', 'cases', testCaseId)
    // Only 5 session files should remain
    const files = await readdir(caseDir)
    const sessionFiles = files.filter(f => f.match(/^session_\d+\.md$/))
    expect(sessionFiles.length).toBeLessThanOrEqual(5)
    // history.md should exist
    await expect(stat(join(caseDir, 'history.md'))).resolves.toBeTruthy()
    // history.md should contain the archived session content
    const history = await readFile(join(caseDir, 'history.md'), 'utf8')
    expect(history).toContain('Session 1 findings')
  })

  it('archiveOldSessions() is ENOENT-safe for history.md (Pitfall 5)', async () => {
    const { SessionStore } = await import('../src/cases/index.js')
    // history.md does not exist yet — archive should not throw
    for (let i = 0; i < 6; i++) {
      await SessionStore.start(testCaseId)
      await SessionStore.end(testCaseId, { findings: `finding ${i}`, nextSteps: '' })
    }
    await expect(SessionStore.archiveOldSessions(testCaseId)).resolves.not.toThrow()
  })
})

describe('CaseStore.loadContext (CASE-04)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let testCaseId: string

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-context-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
    const { getDb, initSchema } = await import('../src/db/init.js')
    const { CaseStore } = await import('../src/cases/index.js')
    const conn = await getDb()
    await initSchema(conn)
    conn.closeSync()
    const c = await CaseStore.create({ name: 'Context Test', tags: ['aml'], description: 'Test' })
    testCaseId = c.id
    vi.resetModules()
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('loadContext() returns case metadata', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const ctx = await CaseStore.loadContext(testCaseId)
    expect(ctx.case.id).toBe(testCaseId)
    expect(ctx.case.name).toBe('Context Test')
    expect(ctx.case.status).toBe('open')
    expect(ctx.lastSession).toBeNull()
    expect(ctx.dossierSummaries).toEqual([])
    expect(ctx.evidenceCount).toBe(0)
  })

  it('loadContext() includes latest session and dossier summaries', async () => {
    const { CaseStore, SessionStore, EvidenceStore, DossierStore } = await import('../src/cases/index.js')
    await SessionStore.start(testCaseId)
    await SessionStore.end(testCaseId, { findings: 'Key finding X', nextSteps: 'Check Y' })
    await EvidenceStore.append(testCaseId, { source: 'get_tx', content: 'data', queryParams: '' })
    await DossierStore.appendFinding(testCaseId, '0xentity', 'Sent to mixer', 'eoa')

    const ctx = await CaseStore.loadContext(testCaseId)
    expect(ctx.lastSession).not.toBeNull()
    expect(ctx.lastSession?.body).toContain('Key finding X')
    expect(ctx.evidenceCount).toBe(1)
    expect(ctx.dossierSummaries).toHaveLength(1)
    expect(ctx.dossierSummaries[0]!.address).toBe('0xentity')
  })
})
