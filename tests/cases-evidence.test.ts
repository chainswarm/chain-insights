import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

describe('EvidenceStore (CASE-02)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  let prevWorkspace: string | undefined
  let prevCasesRoot: string | undefined
  let testCaseId: string

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-evidence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
    const { CaseStore } = await import('../src/cases/index.js')
    const c = await CaseStore.create({ name: 'Evidence Test', tags: [], description: '' })
    testCaseId = c.id
    vi.resetModules()
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

  it('append() creates evidence file in evidence/ directory', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const result = await EvidenceStore.append(testCaseId, {
      source: 'get_transaction_details',
      content: 'Transaction data here',
      queryParams: 'address=0x1234 chain=ethereum',
    })
    const evidenceDir = join(fakeHome, 'cases', testCaseId, 'evidence')
    const st = await stat(join(evidenceDir, result.filename))
    expect(st).toBeTruthy()
    expect(result.filename).toMatch(/^\d{3}_get_transaction_details_\d+T\d+\.md$/)
  })

  it('append() evidence file has 0o600 permissions', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const result = await EvidenceStore.append(testCaseId, {
      source: 'get_tx', content: 'data', queryParams: '',
    })
    const evidencePath = join(fakeHome, 'cases', testCaseId, 'evidence', result.filename)
    const st = await stat(evidencePath)
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('append() adds SHA-256 entry to manifest.json', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const result = await EvidenceStore.append(testCaseId, {
      source: 'get_tx', content: 'some content', queryParams: 'addr=0xabc',
    })
    const manifestPath = join(fakeHome, 'cases', testCaseId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: Array<{ file: string; sha256: string }> }
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0]!.file).toBe(result.filename)
    expect(manifest.entries[0]!.sha256).toHaveLength(64)

    // Verify SHA-256 matches actual file content
    const evidencePath = join(fakeHome, 'cases', testCaseId, 'evidence', result.filename)
    const content = await readFile(evidencePath, 'utf8')
    const expected = createHash('sha256').update(content).digest('hex')
    expect(manifest.entries[0]!.sha256).toBe(expected)
  })

  it('append() wraps small JSON content in a pretty json code fence', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const result = await EvidenceStore.append(testCaseId, {
      source: 'topology_query_batch_compact',
      content: '{"schema":"chain-insights.compact_evidence.v1","unused":null,"outgoing_flows":[]}',
      queryParams: 'network=bittensor',
    })
    const evidencePath = join(fakeHome, 'cases', testCaseId, 'evidence', result.filename)
    const content = await readFile(evidencePath, 'utf8')
    expect(content).toContain('```json')
    expect(content).toContain('"chain-insights.compact_evidence.v1"')
    expect(content).toContain('{\n  "schema"')
    expect(content).not.toContain('"unused"')
  })

  it('append() stores large JSON in reports/tables and keeps evidence markdown compact', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const largeRows = Array.from({ length: 250 }, (_, index) => ({
      address: `5Address${index}`,
      degree_in: null,
      amount_sum: index,
    }))
    const result = await EvidenceStore.append(testCaseId, {
      source: 'topology_query_batch_compact',
      content: JSON.stringify({
        schema: 'chain-insights.compact_evidence.v1',
        network: 'bittensor',
        results: largeRows,
      }),
      queryParams: 'network=bittensor',
    })

    const evidencePath = join(fakeHome, 'cases', testCaseId, 'evidence', result.filename)
    const evidence = await readFile(evidencePath, 'utf8')
    expect(evidence).toContain('Large JSON evidence was stored')
    expect(evidence).toContain('reports/tables/')
    expect(evidence.length).toBeLessThan(4000)
    expect(evidence).not.toContain('5Address249')

    const match = evidence.match(/Stored JSON: `([^`]+)`/)
    expect(match?.[1]).toBeTruthy()
    const storedJson = await readFile(join(fakeHome, match![1]!), 'utf8')
    expect(storedJson).toContain('5Address249')
    expect(storedJson).not.toContain('degree_in')
  })

  it('append() twice produces two manifest entries', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    await EvidenceStore.append(testCaseId, { source: 'tool_a', content: 'data 1', queryParams: '' })
    await EvidenceStore.append(testCaseId, { source: 'tool_b', content: 'data 2', queryParams: '' })
    const manifestPath = join(fakeHome, 'cases', testCaseId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: unknown[] }
    expect(manifest.entries).toHaveLength(2)
  })

  it('verifyManifest() returns ok:true for untampered case', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    await EvidenceStore.append(testCaseId, { source: 'get_tx', content: 'original', queryParams: '' })
    const result = await EvidenceStore.verifyManifest(testCaseId)
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
  })

  it('verifyManifest() returns ok:false when file is tampered', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const appended = await EvidenceStore.append(testCaseId, { source: 'get_tx', content: 'original', queryParams: '' })
    const evidencePath = join(fakeHome, 'cases', testCaseId, 'evidence', appended.filename)
    // Tamper with the file after it was appended
    await writeFile(evidencePath, 'TAMPERED CONTENT', { mode: 0o600 })
    const result = await EvidenceStore.verifyManifest(testCaseId)
    expect(result.ok).toBe(false)
    expect(result.tampered).toContain(appended.filename)
  })

  it('sequence numbers increment: 001, 002, 003', async () => {
    const { EvidenceStore } = await import('../src/cases/index.js')
    const r1 = await EvidenceStore.append(testCaseId, { source: 'a', content: 'c1', queryParams: '' })
    const r2 = await EvidenceStore.append(testCaseId, { source: 'b', content: 'c2', queryParams: '' })
    expect(r1.filename).toMatch(/^001_/)
    expect(r2.filename).toMatch(/^002_/)
  })
})
