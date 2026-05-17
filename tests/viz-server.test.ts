import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
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

  it('GET /graph-reports/:filename serves stored graph JSON', async () => {
    const graphsDir = join(workspace, 'reports', 'graphs')
    const graph = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Test' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    }
    await mkdir(graphsDir, { recursive: true })
    await writeFile(join(graphsDir, 'sample.graph.json'), JSON.stringify(graph))

    stop = await startTestServer(14405)
    const res = await fetch('http://127.0.0.1:14405/graph-reports/sample.graph.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual(graph)
  })

  it('GET /graph-reports/:filename returns 400 for invalid filename', async () => {
    stop = await startTestServer(14406)
    const res = await fetch('http://127.0.0.1:14406/graph-reports/test..attempt.graph.json')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid graph report filename')
  })

  it('GET /graph-reports/:filename rejects encoded path traversal', async () => {
    stop = await startTestServer(14408)
    const res = await fetch('http://127.0.0.1:14408/graph-reports/..%2Fsecret.graph.json')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid graph report filename')
  })

  it('GET /graph-reports/:filename does not follow symlink escapes', async () => {
    const outside = join(tmpdir(), `ci-viz-server-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'leak.graph.json'), '{"leaked":true}\n')
    await mkdir(join(workspace, 'reports', 'graphs'), { recursive: true })
    await symlink(join(outside, 'leak.graph.json'), join(workspace, 'reports', 'graphs', 'link.graph.json'))

    stop = await startTestServer(14410)
    const res = await fetch('http://127.0.0.1:14410/graph-reports/link.graph.json')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Graph report not found')

    await rm(outside, { recursive: true, force: true })
  })

  it('GET /graph-reports/:filename returns 404 for missing graph report', async () => {
    stop = await startTestServer(14407)
    const res = await fetch('http://127.0.0.1:14407/graph-reports/missing.graph.json')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Graph report not found')
  })

  it('GET /workspace/tree returns confined workspace entries', async () => {
    await mkdir(join(workspace, 'cases', 'case-001'), { recursive: true })
    await mkdir(join(workspace, 'reports', 'graphs'), { recursive: true })
    await mkdir(join(workspace, '.chain-insights', 'schema'), { recursive: true })
    await writeFile(join(workspace, 'cases', 'case-001', 'case.md'), 'case body\n')
    await writeFile(join(workspace, 'reports', 'summary.md'), 'summary\n')
    await writeFile(join(workspace, 'reports', 'graphs', 'sample.graph.json'), '{"nodes":[]}\n')
    await writeFile(join(workspace, '.chain-insights', 'schema', 'graph.json'), '{"schema":"test"}\n')
    await writeFile(join(workspace, '..', 'outside-secret.txt'), 'outside\n')

    stop = await startTestServer(14409)
    const res = await fetch('http://127.0.0.1:14409/workspace/tree')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      schema: string
      root: string
      entries: Array<{ path: string; type: string; size?: number }>
    }

    expect(body.schema).toBe('chain-insights.workspace-tree.v1')
    expect(body.root).toBe(workspace)
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'cases', type: 'directory' }),
        expect.objectContaining({ path: 'cases/case-001/case.md', type: 'file' }),
        expect.objectContaining({ path: 'reports/summary.md', type: 'file' }),
        expect.objectContaining({ path: 'reports/graphs/sample.graph.json', type: 'file' }),
        expect.objectContaining({ path: '.chain-insights/schema/graph.json', type: 'file' }),
      ])
    )
    expect(body.entries.every(entry => !entry.path.includes('outside-secret'))).toBe(true)
    expect(body.entries.every(entry => !entry.path.startsWith('..'))).toBe(true)
  })

  it('GET /workspace/tree does not descend into symlink escapes', async () => {
    const outside = join(tmpdir(), `ci-viz-tree-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'outside\n')
    await mkdir(join(workspace, 'cases'), { recursive: true })
    await symlink(outside, join(workspace, 'cases', 'case_link'))

    stop = await startTestServer(14411)
    const res = await fetch('http://127.0.0.1:14411/workspace/tree')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      entries: Array<{ path: string; type: string }>
    }

    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'cases/case_link', type: 'symlink' }),
      ])
    )
    expect(body.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'cases/case_link/secret.txt' }),
      ])
    )

    await rm(outside, { recursive: true, force: true })
  })

  it('GET /health still works after adding viz route', async () => {
    stop = await startTestServer(14404)
    const res = await fetch('http://127.0.0.1:14404/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
