import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph artifact server', () => {
  let fakeHome: string
  let workspace: string
  let prevHome: string | undefined
  let prevWorkspace: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-artifact-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspace = join(tmpdir(), `ci-artifact-server-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    prevHome = process.env['HOME']
    prevWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['HOME'] = fakeHome
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  })

  afterEach(async () => {
    const { closeArtifactServers } = await import('../src/mcp/artifact-server.js')
    closeArtifactServers()
    process.env['HOME'] = prevHome
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    await rm(fakeHome, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  it('starts the local Hono server so MCP graph artifacts can be fetched', async () => {
    const port = 14600 + Math.floor(Math.random() * 200)
    const graphData = {
      schema: 'chain-insights.graph.v1' as const,
      nodes: [{ id: 'a' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }

    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const { ensureArtifactServer } = await import('../src/mcp/artifact-server.js')
    const artifact = await writeGraphArtifact(graphData, { serverPort: port })
    expect(artifact.path).toContain(join(workspace, 'artifacts'))

    await ensureArtifactServer(port)

    const response = await fetch(artifact.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({
      ...graphData,
      nodes: [{
        id: 'a',
        address: 'a',
        entity_kind: 'address',
        labels: [],
        raw_labels: [],
      }],
    })
    await expect(stat(join(fakeHome, '.chain-insights', 'artifacts'))).rejects.toThrow()
  })
})
