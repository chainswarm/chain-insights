import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('case export graph and canvas files', () => {
  let workspace: string
  let prevWorkspace: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    workspace = join(tmpdir(), `ci-case-export-canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  it('exports canonical graph JSON and JSON Canvas with valid references', async () => {
    const { CaseStore } = await import('../src/cases/index.js')
    const { exportCase } = await import('../src/export/index.js')
    const c = await CaseStore.create({ name: 'Graph Export', tags: ['aml'], description: 'Graph case' })
    await mkdir(join(workspace, 'reports', 'graphs'), { recursive: true })
    await writeFile(join(workspace, 'reports', 'graphs', 'sample.graph.json'), JSON.stringify({
      schema: 'chain-insights.graph.v1',
      nodes: [
        { id: '5Seed', address: '5Seed', roles: ['victim'] },
        { id: '5Deposit', address: '5Deposit', roles: ['deposit'] },
      ],
      edges: [{ source: '5Seed', target: '5Deposit', edge_type: 'flows_to', amount_sum: 10 }],
      flows: [],
      edge_anchors: [],
    }, null, 2) + '\n')

    const result = await exportCase({ caseId: c.id, target: 'obsidian-llmwiki', mode: 'private' })
    const graph = JSON.parse(await readFile(join(result.outputDir, 'graph.chain-insights.json'), 'utf8')) as {
      schema: string
      nodes: unknown[]
      edges: unknown[]
    }
    const canvas = JSON.parse(await readFile(join(result.outputDir, 'Graph.canvas'), 'utf8')) as {
      nodes: Array<{ id: string; type: string; file?: string }>
      edges: Array<{ fromNode: string; toNode: string }>
    }

    expect(graph.schema).toBe('chain-insights.graph.v1')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(canvas.nodes.length).toBeGreaterThan(0)
    expect(Array.isArray(canvas.edges)).toBe(true)
    expect(canvas.nodes.some(node => node.file === 'Entities/5seed.md')).toBe(true)
    expect(existsSync(join(result.outputDir, 'Entities', '5seed.md'))).toBe(true)

    const nodeIds = new Set(canvas.nodes.map(node => node.id))
    for (const edge of canvas.edges) {
      expect(nodeIds.has(edge.fromNode)).toBe(true)
      expect(nodeIds.has(edge.toNode)).toBe(true)
    }
  })
})
