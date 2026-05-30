import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('case export service', () => {
  let workspace: string
  let prevWorkspace: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    workspace = join(tmpdir(), `ci-case-export-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  })

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    await rm(workspace, { recursive: true, force: true })
    vi.resetModules()
  })

  it('exports a private Obsidian and LLMWiki bundle for a verified case', async () => {
    const { CaseStore, DossierStore, EvidenceStore, SessionStore } = await import('../src/cases/index.js')
    const { exportCase } = await import('../src/export/index.js')

    const c = await CaseStore.create({
      name: 'Export Test',
      tags: ['aml', 'bittensor'],
      description: 'Trace exported evidence',
    })
    await EvidenceStore.append(c.id, {
      source: 'manual',
      queryParams: 'network=bittensor',
      content: '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 observed in the flow.',
    })
    await DossierStore.appendFinding(c.id, '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5', 'Observed in exported flow.', 'unknown')
    await SessionStore.start(c.id, { title: 'Export dogfood' })
    await SessionStore.end(c.id, { findings: 'Exportable finding.', nextSteps: 'Review graph.' })

    const result = await exportCase({ caseId: c.id, target: 'obsidian-llmwiki', mode: 'private' })

    expect(result.outputDir).toBe(join(workspace, 'published', 'export-test'))
    expect(result.nextFile).toBe('Agent Console.md')
    expect(result.fileCount).toBeGreaterThan(8)
    expect(existsSync(join(result.outputDir, 'Case.md'))).toBe(true)
    expect(existsSync(join(result.outputDir, 'LLMWIKI.md'))).toBe(true)
    expect(existsSync(join(result.outputDir, 'llms.txt'))).toBe(true)
    expect(existsSync(join(result.outputDir, 'Agent Console.md'))).toBe(true)
    expect(existsSync(join(result.outputDir, 'Prompts', 'Codex.md'))).toBe(true)

    const readme = await readFile(join(result.outputDir, 'README.md'), 'utf8')
    expect(readme).toContain('Open this directory as an Obsidian vault')
    expect(readme).toContain('LLM Wiki')
    expect(readme).toContain('Agent Console.md')

    const agentConsole = await readFile(join(result.outputDir, 'Agent Console.md'), 'utf8')
    expect(agentConsole).toContain('Treat Chain Insights case evidence and manifests as canonical')
    expect(agentConsole).toContain('Preserve full blockchain addresses exactly')

    const manifest = JSON.parse(await readFile(join(result.outputDir, 'manifest.chain-insights.json'), 'utf8')) as {
      schema: string
      case_id: string
      verification: { evidence_manifest_verified: boolean }
      files: Array<{ path: string }>
    }
    expect(manifest.schema).toBe('chain-insights.case_export.v1')
    expect(manifest.case_id).toBe(c.id)
    expect(manifest.verification.evidence_manifest_verified).toBe(true)
    expect(manifest.files.map(f => f.path)).toContain('Case.md')

    const caseMd = await readFile(join(result.outputDir, 'Case.md'), 'utf8')
    expect(caseMd).toContain('# Export Test')
    expect(caseMd).toContain('Evidence manifest: verified')
    expect(caseMd).toContain('[[Agent Console]]')
  })

  it('aliases addresses in public exports', async () => {
    const { CaseStore, EvidenceStore } = await import('../src/cases/index.js')
    const { exportCase } = await import('../src/export/index.js')

    const c = await CaseStore.create({ name: 'Public Export', tags: ['aml'], description: 'Public redaction' })
    await EvidenceStore.append(c.id, {
      source: 'manual',
      queryParams: 'network=bittensor',
      content: 'Address 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 requires review.',
    })

    const result = await exportCase({ caseId: c.id, mode: 'public', target: 'obsidian-llmwiki' })
    const manifest = JSON.parse(await readFile(join(result.outputDir, 'manifest.chain-insights.json'), 'utf8')) as {
      files: Array<{ path: string }>
    }
    const evidenceFile = manifest.files.find(file => file.path.startsWith('Evidence/'))?.path

    expect(evidenceFile).toBeTruthy()
    const evidence = await readFile(join(result.outputDir, evidenceFile!), 'utf8')
    expect(evidence).toContain('addr_001')
    expect(evidence).not.toContain('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')
  })
})
