import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Hono viz routes (VIZ-03)', () => {
  let stop: (() => void) | null = null
  let fakeHome: string
  let workspace: string
  let prevHome: string | undefined
  let prevWorkspace: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-viz-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspace = join(tmpdir(), `ci-viz-server-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
    if (stop) { stop(); stop = null }
    process.env['HOME'] = prevHome
    if (prevWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = prevWorkspace
    await rm(fakeHome, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
    vi.resetModules()
  })

  async function startTestServer(port: number): Promise<() => void> {
    const { startServer } = await import('../src/server/index.js')
    const stopFn = startServer(port)
    // Allow server to bind
    await new Promise(resolve => setTimeout(resolve, 100))
    return stopFn
  }

  it('GET /viz/:id returns 404 for missing viz', async () => {
    stop = await startTestServer(14400)
    const res = await fetch('http://127.0.0.1:14400/viz/nonexistent')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Visualization not found')
  })

  it('GET /viz/:id returns 400 for ID with dots (path traversal attempt)', async () => {
    stop = await startTestServer(14401)
    // Dots are not in the [a-zA-Z0-9_-]+ regex, so they should return 400
    const res = await fetch('http://127.0.0.1:14401/viz/test..attempt')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid visualization ID')
  })

  it('GET /viz/:id serves stored HTML from central dir', async () => {
    // Write test HTML to central standalone directory
    const centralDir = join(fakeHome, '.chain-insights', 'viz')
    await mkdir(centralDir, { recursive: true })
    await writeFile(join(centralDir, 'testviz.html'), '<html>test</html>')

    stop = await startTestServer(14402)
    const res = await fetch('http://127.0.0.1:14402/viz/testviz')
    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type')
    expect(contentType).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<html>test</html>')
  })

  it('GET /viz/:id serves stored HTML from per-case dir (CONTEXT.md locked decision)', async () => {
    // Write test HTML to per-case viz directory
    const caseVizDir = join(fakeHome, '.chain-insights', 'cases', 'CASE-001', 'viz')
    await mkdir(caseVizDir, { recursive: true })
    await writeFile(join(caseVizDir, 'CASE-001_12345.html'), '<html>case test</html>')

    stop = await startTestServer(14403)
    const res = await fetch('http://127.0.0.1:14403/viz/CASE-001_12345')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<html>case test</html>')
  })

  it('GET /artifacts/:artifactId/graph.json serves stored graph JSON', async () => {
    const artifactDir = join(workspace, 'artifacts', 'artifact_123')
    const graph = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Test' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'graph.json'), JSON.stringify(graph))

    stop = await startTestServer(14405)
    const res = await fetch('http://127.0.0.1:14405/artifacts/artifact_123/graph.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual(graph)
  })

  it('GET /artifacts/:artifactId/graph.json returns 400 for invalid artifact ID', async () => {
    stop = await startTestServer(14406)
    const res = await fetch('http://127.0.0.1:14406/artifacts/test..attempt/graph.json')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid artifact ID')
  })

  it('GET /artifacts/:artifactId/graph.json returns 404 for missing graph artifact', async () => {
    stop = await startTestServer(14407)
    const res = await fetch('http://127.0.0.1:14407/artifacts/missing/graph.json')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Graph artifact not found')
  })

  it('GET /health still works after adding viz route', async () => {
    stop = await startTestServer(14404)
    const res = await fetch('http://127.0.0.1:14404/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
