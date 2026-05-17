import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph artifact store', () => {
  let fakeHome: string
  let workspace: string
  let previousHome: string | undefined
  let previousWorkspace: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-artifacts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspace = join(tmpdir(), `ci-artifacts-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(fakeHome, { recursive: true })
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    previousHome = process.env['HOME']
    previousWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['HOME'] = fakeHome
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  })

  afterEach(async () => {
    process.env['HOME'] = previousHome
    if (previousWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = previousWorkspace
    await rm(fakeHome, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes graph JSON under workspace artifacts', async () => {
    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const dataDir = join(fakeHome, '.chain-insights')
    const graphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Addr' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }

    const artifact = await writeGraphArtifact(graphData, {
      dataDir,
      serverPort: 4567,
    })
    const expectedPath = join(workspace, 'artifacts', artifact.id, 'graph.json')

    expect(artifact.id).toMatch(/^[a-f0-9-]+$/)
    expect(artifact.url).toBe(`http://127.0.0.1:4567/artifacts/${artifact.id}/graph.json`)
    expect(artifact.path).toBe(expectedPath)

    const raw = await readFile(expectedPath, 'utf8')
    expect(JSON.parse(raw)).toEqual({
      ...graphData,
      nodes: [{
        address: '5Addr',
        labels: [],
      }],
    })

    if (process.platform !== 'win32') {
      const artifactsDirStat = await stat(join(workspace, 'artifacts'))
      const artifactDirStat = await stat(join(workspace, 'artifacts', artifact.id))
      const fileStat = await stat(expectedPath)

      expect(artifactsDirStat.mode & 0o777).toBe(0o700)
      expect(artifactDirStat.mode & 0o777).toBe(0o700)
      expect(fileStat.mode & 0o777).toBe(0o600)
    }

    await expect(stat(join(dataDir, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('normalizes graph JSON before writing artifacts', async () => {
    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const dataDir = join(fakeHome, '.chain-insights')

    const artifact = await writeGraphArtifact({
      schema: 'chain-insights.graph.v1',
      nodes: [{
        id: '5Exchange',
        labels: ['Address', 'Exchange', 'Kraken'],
        address_type: 'exchange',
        risk_level: null,
        pattern_flags: [],
      }],
      edges: [{ source: '5Seed', target: '5Exchange', amount_usd_sum: 42 }],
      flows: [],
      edge_anchors: [],
    }, {
      dataDir,
      serverPort: 4567,
    })

    expect(artifact.path).toContain(join(workspace, 'artifacts'))
    const raw = await readFile(artifact.path, 'utf8')
    const graph = JSON.parse(raw) as {
      nodes: Array<Record<string, unknown>>
      edges: Array<Record<string, unknown>>
    }

    expect(graph.nodes[0]).toMatchObject({
      id: '5Exchange',
      address: '5Exchange',
      labels: ['Exchange', 'Kraken'],
      role: 'exchange',
    })
    expect(graph.nodes[0]).not.toHaveProperty('address_type')
    expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
    expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
    expect(graph.nodes[0]).not.toHaveProperty('risk_level')
    expect(graph.nodes[0]).not.toHaveProperty('pattern_flags')
    expect(graph.edges[0]).toMatchObject({
      source: '5Seed',
      target: '5Exchange',
      from_address: '5Seed',
      to_address: '5Exchange',
    })
  })

  it('rejects unsupported graph schemas', async () => {
    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')

    await expect(writeGraphArtifact({
      schema: 'chain-insights.graph.v2',
      nodes: [],
      edges: [],
      flows: [],
      edge_anchors: [],
    }, {
      dataDir: join(fakeHome, '.chain-insights'),
      serverPort: 4567,
    })).rejects.toThrow('Unsupported graph payload schema')
  })

  it('rejects malformed graph arrays', async () => {
    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')

    await expect(writeGraphArtifact({
      schema: 'chain-insights.graph.v1',
      nodes: 'not-array',
      edges: [],
      flows: [],
      edge_anchors: [],
    }, {
      dataDir: join(fakeHome, '.chain-insights'),
      serverPort: 4567,
    })).rejects.toThrow('Invalid graph payload')
  })

  it('hardens existing artifact parent directories', async () => {
    if (process.platform === 'win32') {
      return
    }

    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const dataDir = join(fakeHome, '.chain-insights')
    const artifactsDir = join(workspace, 'artifacts')

    await mkdir(artifactsDir, { recursive: true, mode: 0o755 })

    const artifact = await writeGraphArtifact({
      schema: 'chain-insights.graph.v1',
      nodes: [],
      edges: [],
      flows: [],
      edge_anchors: [],
    }, {
      dataDir,
      serverPort: 4567,
    })

    const artifactsDirStat = await stat(artifactsDir)
    const artifactDirStat = await stat(join(artifactsDir, artifact.id))

    expect(artifactsDirStat.mode & 0o777).toBe(0o700)
    expect(artifactDirStat.mode & 0o777).toBe(0o700)
    await expect(stat(join(dataDir, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
