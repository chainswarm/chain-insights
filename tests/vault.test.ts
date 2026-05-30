import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

describe('Obsidian vault scaffold', () => {
  let workspace: string

  beforeEach(async () => {
    vi.resetModules()
    workspace = join(tmpdir(), `ci-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    vi.resetModules()
  })

  it('writes Obsidian-compatible vault files without replacing canonical case state', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')

    const result = await scaffoldVault({ workspaceRoot: workspace })

    expect(result.workspaceRoot).toBe(resolve(workspace))
    expect(result.filesWritten.every((file) => !isAbsolute(file))).toBe(true)
    expect(result.filesWritten).toContain('.obsidian/app.json')
    expect(result.filesWritten).toContain('.obsidian/graph.json')
    expect(result.filesWritten).toContain('.obsidian/templates.json')
    expect(result.filesWritten).toContain('.gitignore')
    expect(result.filesWritten).toContain('Home.md')
    expect(result.filesWritten).toContain('Cases.md')
    expect(result.filesWritten).toContain('Entities.md')
    expect(result.filesWritten).toContain('Evidence.md')
    expect(result.filesWritten).toContain('Graphs.md')
    expect(result.filesWritten).toContain('Agent Console.md')
    expect(result.filesWritten).toContain('Canvases/README.md')
    expect(result.filesWritten).toContain('Entities/README.md')
    expect(result.filesWritten).toContain('Evidence/README.md')
    expect(existsSync(join(workspace, '.obsidian'))).toBe(true)
    expect(existsSync(join(workspace, 'Canvases'))).toBe(true)
    expect(existsSync(join(workspace, 'Entities'))).toBe(true)
    expect(existsSync(join(workspace, 'Evidence'))).toBe(true)
    expect(existsSync(join(workspace, 'published'))).toBe(true)

    const home = await readFile(join(workspace, 'Home.md'), 'utf8')
    expect(home).toContain('type: "chain-insights-vault-home"')
    expect(home).toContain('contains_sensitive_data: true')
    expect(home).toContain('[[Cases]]')
    expect(home).toContain('[[Entities]]')
    expect(home).toContain('[[Evidence]]')
    expect(home).toContain('[[Graphs]]')

    const appConfig = JSON.parse(await readFile(join(workspace, '.obsidian/app.json'), 'utf8'))
    expect(appConfig).toMatchObject({
      useMarkdownLinks: false,
      newLinkFormat: 'shortest',
      alwaysUpdateLinks: true,
    })

    const graphConfig = JSON.parse(await readFile(join(workspace, '.obsidian/graph.json'), 'utf8'))
    expect(graphConfig['collapse-filter']).toBe(true)

    JSON.parse(await readFile(join(workspace, '.obsidian/templates.json'), 'utf8'))

    const gitignore = await readFile(join(workspace, '.gitignore'), 'utf8')
    expect(gitignore).not.toContain('cases/')
    expect(gitignore).not.toContain('reports/')
    expect(gitignore).not.toContain('artifacts/')
  })

  it('refuses to overwrite user-edited vault files unless forced', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')
    await writeFile(join(workspace, 'Home.md'), '# Existing Home\n', 'utf8')

    await expect(scaffoldVault({ workspaceRoot: workspace })).rejects.toThrow('Refusing to overwrite')

    const result = await scaffoldVault({ workspaceRoot: workspace, force: true })
    expect(result.filesWritten).toContain('Home.md')
    await expect(readFile(join(workspace, 'Home.md'), 'utf8')).resolves.toContain('# Chain Insights Vault')
  })

  it('preflights all vault files before writing any generated files', async () => {
    const { scaffoldVault } = await import('../src/vault/index.js')
    await mkdir(join(workspace, 'Evidence'), { recursive: true })
    await writeFile(join(workspace, 'Evidence/README.md'), '# Existing Evidence\n', 'utf8')

    await expect(scaffoldVault({ workspaceRoot: workspace })).rejects.toThrow('Refusing to overwrite')

    expect(existsSync(join(workspace, '.obsidian/app.json'))).toBe(false)
    expect(existsSync(join(workspace, 'Home.md'))).toBe(false)
    await expect(readFile(join(workspace, 'Evidence/README.md'), 'utf8')).resolves.toBe('# Existing Evidence\n')
  })

  it('refreshes live case notes from canonical case state', async () => {
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
    try {
      const { CaseStore, DossierStore, EvidenceStore } = await import('../src/cases/index.js')
      const { scaffoldVault, refreshCaseVault } = await import('../src/vault/index.js')
      await scaffoldVault({ workspaceRoot: workspace })

      const c = await CaseStore.create({
        name: 'Vault Case',
        tags: ['aml', 'bittensor'],
        description: 'Obsidian-first case notes.',
      })
      await EvidenceStore.append(c.id, {
        source: 'manual',
        queryParams: 'network=bittensor',
        content: 'Address 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 appears in the flow.',
      })
      await DossierStore.appendFinding(c.id, '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5', 'Appears in vault refresh.', 'unknown')

      const result = await refreshCaseVault({ caseId: c.id, force: true })

      expect(result.caseId).toBe(c.id)
      expect(result.nextFile).toBe(`cases/${c.id}/Case.md`)
      expect(result.filesWritten).toContain(`cases/${c.id}/Case.md`)
      expect(result.filesWritten).toContain(`cases/${c.id}/Agent Console.md`)
      expect(result.filesWritten).toContain(`cases/${c.id}/Evidence.md`)
      expect(result.filesWritten).toContain(`cases/${c.id}/Entities.md`)
      expect(result.filesWritten).toContain(`cases/${c.id}/Graph.canvas`)
      expect(existsSync(join(workspace, 'cases', c.id, 'Case.md'))).toBe(true)
      expect(existsSync(join(workspace, 'cases', c.id, 'Agent Console.md'))).toBe(true)
      expect(existsSync(join(workspace, 'cases', c.id, 'Evidence.md'))).toBe(true)
      expect(existsSync(join(workspace, 'cases', c.id, 'Entities.md'))).toBe(true)
      expect(existsSync(join(workspace, 'cases', c.id, 'Graph.canvas'))).toBe(true)
      expect(existsSync(join(workspace, 'Entities', '5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md'))).toBe(true)

      const caseMd = await readFile(join(workspace, 'cases', c.id, 'Case.md'), 'utf8')
      expect(caseMd).toContain('type: "chain-insights-case"')
      expect(caseMd).toContain(`case_id: ${JSON.stringify(c.id)}`)
      expect(caseMd).toContain('contains_sensitive_data: true')
      expect(caseMd).toContain(`source_of_truth: ${JSON.stringify(`cases/${c.id}/`)}`)
      expect(caseMd).toContain('[[Agent Console]]')
      expect(caseMd).toContain('[[Graph.canvas]]')
      expect(caseMd).toContain('[[Cases]]')
      expect(caseMd).toContain(`[[cases/${c.id}/Evidence|Evidence]]`)
      expect(caseMd).toContain(`[[cases/${c.id}/Entities|Entities]]`)
      expect(caseMd).toContain('[[Graphs]]')

      const evidenceIndex = await readFile(join(workspace, 'cases', c.id, 'Evidence.md'), 'utf8')
      expect(evidenceIndex).toContain('chain-insights-case-evidence-index')
      expect(evidenceIndex).toContain('manual')
      const evidenceFiles = await readdir(join(workspace, 'Evidence'))
      const evidenceNote = evidenceFiles.find(file => file.endsWith('.md') && file !== 'README.md')
      expect(evidenceNote).toBeDefined()
      const evidenceMd = await readFile(join(workspace, 'Evidence', evidenceNote as string), 'utf8')
      expect(evidenceMd).toContain('chain-insights-evidence')
      expect(evidenceMd).toContain(`cases/${c.id}/evidence/`)
      expect(evidenceMd).toContain('Address 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 appears in the flow.')

      const entity = await readFile(join(workspace, 'Entities', '5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md'), 'utf8')
      expect(entity).toContain('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')
      expect(entity).toContain(`[[cases/${c.id}/Case|${c.id}]]`)
      const entityIndex = await readFile(join(workspace, 'cases', c.id, 'Entities.md'), 'utf8')
      expect(entityIndex).toContain('chain-insights-case-entity-index')
      expect(entityIndex).toContain('5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5')

      const canvas = JSON.parse(await readFile(join(workspace, 'cases', c.id, 'Graph.canvas'), 'utf8')) as {
        nodes: Array<{ id: string; type: string; file?: string }>
        edges: unknown[]
      }
      expect(canvas.nodes.some(node => node.file === `cases/${c.id}/Case.md`)).toBe(true)
      expect(canvas.nodes.some(node => node.file === 'Entities/5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md')).toBe(true)
      expect(canvas.edges).toBeDefined()
    } finally {
      if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
      else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    }
  })

  it('does not include unrelated workspace report graphs in live case canvas', async () => {
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
    try {
      const { CaseStore, DossierStore } = await import('../src/cases/index.js')
      const { scaffoldVault, refreshCaseVault } = await import('../src/vault/index.js')
      await scaffoldVault({ workspaceRoot: workspace })

      await CaseStore.create({
        name: 'Unrelated Report Case',
        tags: ['base'],
        description: 'Owns an unrelated graph report.',
      })
      const c = await CaseStore.create({
        name: 'Dossier Only Case',
        tags: ['bittensor'],
        description: 'Should not import workspace reports.',
      })
      await DossierStore.appendFinding(c.id, '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5', 'Appears in vault refresh.', 'unknown')
      await mkdir(join(workspace, 'reports', 'graphs'), { recursive: true })
      await writeFile(join(workspace, 'reports', 'graphs', 'unrelated.graph.json'), JSON.stringify({
        schema: 'chain-insights.graph.v1',
        nodes: [{ id: 'unrelated-node', address: 'UNRELATED_REPORT_ADDRESS' }],
        edges: [],
        flows: [],
        edge_anchors: [],
      }) + '\n')

      await refreshCaseVault({ caseId: c.id, force: true })

      const canvas = JSON.parse(await readFile(join(workspace, 'cases', c.id, 'Graph.canvas'), 'utf8')) as {
        nodes: Array<{ file?: string }>
      }
      expect(canvas.nodes.some(node => node.file === 'Entities/unrelated-node.md')).toBe(false)
      expect(canvas.nodes.some(node => node.file === 'Entities/unrelated-report-address.md')).toBe(false)
      expect(canvas.nodes.some(node => node.file === 'Entities/5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md')).toBe(true)
    } finally {
      if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
      else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    }
  })

  it('preflights live case refresh targets before writing generated files', async () => {
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
    try {
      const { CaseStore, DossierStore } = await import('../src/cases/index.js')
      const { scaffoldVault, refreshCaseVault } = await import('../src/vault/index.js')
      await scaffoldVault({ workspaceRoot: workspace })

      const c = await CaseStore.create({
        name: 'Preflight Case',
        tags: ['aml'],
        description: 'Non-force refresh should be atomic.',
      })
      const address = '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5'
      await DossierStore.appendFinding(c.id, address, 'Appears in vault refresh.', 'unknown')
      await writeFile(join(workspace, 'Entities', '5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md'), '# User entity note\n', 'utf8')

      await expect(refreshCaseVault({ caseId: c.id })).rejects.toThrow('Refusing to overwrite')

      expect(existsSync(join(workspace, 'cases', c.id, 'Case.md'))).toBe(false)
      await expect(readFile(join(workspace, 'Entities', '5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md'), 'utf8')).resolves.toBe('# User entity note\n')
    } finally {
      if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
      else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    }
  })

  it('does not duplicate a dossier entity when graph node id differs from address', async () => {
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    const address = '5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5'
    vi.doMock('../src/viz/data-extractor.js', () => ({
      extractGraphFromCase: async () => ({
        nodes: [{ id: 'node-1', address, roles: ['suspect'], node_type: 'address' }],
        edges: [],
        metadata: { generatedAt: new Date().toISOString() },
      }),
    }))
    const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
    try {
      const { CaseStore, DossierStore } = await import('../src/cases/index.js')
      const { scaffoldVault, refreshCaseVault } = await import('../src/vault/index.js')
      await scaffoldVault({ workspaceRoot: workspace })

      const c = await CaseStore.create({
        name: 'Alias Case',
        tags: ['aml'],
        description: 'Graph id and address differ.',
      })
      await DossierStore.appendFinding(c.id, address, 'Appears in vault refresh.', 'unknown')

      await refreshCaseVault({ caseId: c.id, force: true })

      const canvas = JSON.parse(await readFile(join(workspace, 'cases', c.id, 'Graph.canvas'), 'utf8')) as {
        nodes: Array<{ file?: string }>
      }
      expect(canvas.nodes.filter(node => node.file === 'Entities/5gtjfjalpbnrgybhy24nqhdnkw9r94z72rsylxeodxjfskj5.md')).toHaveLength(1)
    } finally {
      if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
      else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
      vi.doUnmock('../src/viz/data-extractor.js')
    }
  })

  it('writes entity notes for graph-only canvas nodes without dossiers', async () => {
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    const address = '0x1111111111111111111111111111111111111111'
    vi.doMock('../src/viz/data-extractor.js', () => ({
      extractGraphFromCase: async () => ({
        nodes: [{ id: 'graph-only-node', address, roles: ['suspect'], node_type: 'address' }],
        edges: [],
        metadata: { generatedAt: new Date().toISOString() },
      }),
    }))
    const prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
    try {
      const { CaseStore } = await import('../src/cases/index.js')
      const { scaffoldVault, refreshCaseVault } = await import('../src/vault/index.js')
      await scaffoldVault({ workspaceRoot: workspace })

      const c = await CaseStore.create({
        name: 'Graph Only Entity Case',
        tags: ['aml'],
        description: 'Graph node has no dossier.',
      })

      await refreshCaseVault({ caseId: c.id, force: true })

      const entityPath = join(workspace, 'Entities', '0x1111111111111111111111111111111111111111.md')
      expect(existsSync(entityPath)).toBe(true)
      const entity = await readFile(entityPath, 'utf8')
      expect(entity).toContain(address)
      const canvas = JSON.parse(await readFile(join(workspace, 'cases', c.id, 'Graph.canvas'), 'utf8')) as {
        nodes: Array<{ file?: string }>
      }
      expect(canvas.nodes.some(node => node.file === 'Entities/0x1111111111111111111111111111111111111111.md')).toBe(true)
    } finally {
      if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
      else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
      vi.doUnmock('../src/viz/data-extractor.js')
    }
  })
})
