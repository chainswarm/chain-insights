import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph artifact store', () => {
  let fakeHome: string
  let previousHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-artifacts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(fakeHome, { recursive: true })
    previousHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = previousHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('writes graph JSON under the configured data directory', async () => {
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
    const expectedPath = join(dataDir, 'artifacts', artifact.id, 'graph.json')

    expect(artifact.id).toMatch(/^[a-f0-9-]+$/)
    expect(artifact.url).toBe(`http://127.0.0.1:4567/artifacts/${artifact.id}/graph.json`)
    expect(artifact.path).toBe(expectedPath)

    const raw = await readFile(expectedPath, 'utf8')
    expect(JSON.parse(raw)).toEqual(graphData)

    if (process.platform !== 'win32') {
      const dataDirStat = await stat(dataDir)
      const artifactsDirStat = await stat(join(dataDir, 'artifacts'))
      const artifactDirStat = await stat(join(dataDir, 'artifacts', artifact.id))
      const fileStat = await stat(expectedPath)

      expect(dataDirStat.mode & 0o777).toBe(0o700)
      expect(artifactsDirStat.mode & 0o777).toBe(0o700)
      expect(artifactDirStat.mode & 0o777).toBe(0o700)
      expect(fileStat.mode & 0o777).toBe(0o600)
    }
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
    const artifactsDir = join(dataDir, 'artifacts')

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

    const dataDirStat = await stat(dataDir)
    const artifactsDirStat = await stat(artifactsDir)
    const artifactDirStat = await stat(join(artifactsDir, artifact.id))

    expect(dataDirStat.mode & 0o777).toBe(0o700)
    expect(artifactsDirStat.mode & 0o777).toBe(0o700)
    expect(artifactDirStat.mode & 0o777).toBe(0o700)
  })
})
