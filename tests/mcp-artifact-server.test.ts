import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph artifact server', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-artifact-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    const { closeArtifactServers } = await import('../src/mcp/artifact-server.js')
    closeArtifactServers()
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('starts the local Hono server so MCP graph artifacts can be fetched', async () => {
    const port = 14600 + Math.floor(Math.random() * 200)
    const dataDir = join(fakeHome, '.chain-insights')
    const graphData = {
      schema: 'chain-insights.graph.v1' as const,
      nodes: [{ id: 'a' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }

    const { writeGraphArtifact } = await import('../src/mcp/artifacts.js')
    const { ensureArtifactServer } = await import('../src/mcp/artifact-server.js')
    const artifact = await writeGraphArtifact(graphData, { dataDir, serverPort: port })

    await ensureArtifactServer(port)

    const response = await fetch(artifact.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual(graphData)
  })
})
