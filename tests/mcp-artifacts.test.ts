import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
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
    const graphData = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Addr' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }

    const artifact = await writeGraphArtifact(graphData, {
      dataDir: join(fakeHome, '.chain-insights'),
      serverPort: 4567,
    })

    expect(artifact.id).toMatch(/^[a-f0-9-]+$/)
    expect(artifact.url).toBe(`http://127.0.0.1:4567/artifacts/${artifact.id}/graph.json`)

    const raw = await readFile(join(fakeHome, '.chain-insights', 'artifacts', artifact.id, 'graph.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(graphData)
  })
})
