import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('workspace output root', () => {
  let parent: string
  let prevWorkspace: string | undefined

  beforeEach(() => {
    vi.resetModules()
    parent = mkdtempSync(join(tmpdir(), 'ci-workspace-root-'))
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    delete process.env['CHAIN_INSIGHTS_WORKSPACE']
  })

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    await rm(parent, { recursive: true, force: true })
    vi.resetModules()
  })

  async function initWorkspace(root: string) {
    await mkdir(join(root, '.chain-insights'), { recursive: true })
    await writeFile(
      join(root, '.chain-insights', 'workspace.json'),
      JSON.stringify({
        schema: 'chain-insights.workspace.v1',
        workspace_root: root,
        cases_dir: 'cases',
      }) + '\n',
    )
  }

  it('requires an initialized workspace before returning investigation output root', async () => {
    const dir = join(parent, 'stolen')
    await mkdir(dir, { recursive: true })
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(() => requireWorkspaceRoot(dir)).toThrow(
      'No Chain Insights workspace found. Run: cia init .',
    )
  })

  it('returns the nearest initialized workspace root from a nested directory', async () => {
    const root = join(parent, 'stolen')
    const nested = join(root, 'notes', 'day-1')
    await initWorkspace(root)
    await mkdir(nested, { recursive: true })
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(requireWorkspaceRoot(nested)).toBe(root)
  })

  it('uses CHAIN_INSIGHTS_WORKSPACE when explicitly set', async () => {
    const root = join(parent, 'opened-in-vscode')
    const other = join(parent, 'other')
    await initWorkspace(root)
    await mkdir(other, { recursive: true })
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = root
    const { requireWorkspaceRoot } = await import('../src/workspace/output-root.js')

    expect(requireWorkspaceRoot(other)).toBe(root)
  })

  it('builds canonical workspace output paths', async () => {
    const root = join(parent, 'stolen')
    await initWorkspace(root)
    const { workspaceOutputPaths } = await import('../src/workspace/output-root.js')

    expect(workspaceOutputPaths(root)).toEqual({
      root,
      metadataDir: join(root, '.chain-insights'),
      schemaDir: join(root, '.chain-insights', 'schema'),
      runtimeDir: join(root, '.chain-insights', 'runtime'),
      casesRoot: join(root, 'cases'),
      reportsRoot: join(root, 'reports'),
      reportGraphsRoot: join(root, 'reports', 'graphs'),
      reportTablesRoot: join(root, 'reports', 'tables'),
      logsRoot: join(root, 'logs'),
    })
  })
})
