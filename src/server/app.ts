import { Hono } from 'hono'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

async function findVizHtml(vizId: string): Promise<string | null> {
  const home = os.homedir()
  const filename = `${vizId}.html`

  // 1. Check central standalone directory first (fast, single path)
  const centralPath = path.join(home, '.chain-insights', 'viz', filename)
  try {
    return await readFile(centralPath, 'utf-8')
  } catch { /* not found here, continue */ }

  // 2. Check per-case directory using vizId prefix (case-based vizs use <caseId>_<timestamp>)
  //    The vizId for case-based vizs is formatted as <case-id>_<timestamp>,
  //    so extract the case-id prefix to check its directory first.
  const underscoreIdx = vizId.lastIndexOf('_')
  if (underscoreIdx > 0) {
    const possibleCaseId = vizId.substring(0, underscoreIdx)
    const casePath = path.join(home, '.chain-insights', 'cases', possibleCaseId, 'viz', filename)
    try {
      return await readFile(casePath, 'utf-8')
    } catch { /* not found here, continue */ }
  }

  // 3. Fallback: scan all case directories (CONTEXT.md: ~/.chain-insights/cases/<case-id>/viz/)
  const casesDir = path.join(home, '.chain-insights', 'cases')
  try {
    const cases = await readdir(casesDir)
    for (const caseId of cases) {
      const casePath = path.join(casesDir, caseId, 'viz', filename)
      try {
        return await readFile(casePath, 'utf-8')
      } catch { /* not in this case dir */ }
    }
  } catch { /* cases dir doesn't exist */ }

  return null
}

export function createApp(): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

  app.get('/status', async (c) => {
    const { loadConfig } = await import('../config/index.js')
    const config = await loadConfig()
    return c.json({
      dataDir: config.dataDir,
      graphMcpMode: config.graphMcpMode,
      server: 'running',
    })
  })

  app.get('/viz/:id', async (c) => {
    const id = c.req.param('id')
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return c.json({ error: 'Invalid visualization ID' }, 400)
    }
    const html = await findVizHtml(id)
    if (!html) {
      return c.json({ error: 'Visualization not found' }, 404)
    }
    return c.html(html)
  })

  app.get('/artifacts/:artifactId/graph.json', async (c) => {
    const artifactId = c.req.param('artifactId')
    if (!/^[a-zA-Z0-9_-]+$/.test(artifactId)) {
      return c.json({ error: 'Invalid artifact ID' }, 400)
    }

    const { workspaceOutputPaths } = await import('../workspace/output-root.js')
    const paths = workspaceOutputPaths()
    const graphPath = path.join(paths.artifactsRoot, artifactId, 'graph.json')

    try {
      const graph = await readFile(graphPath, 'utf-8')
      return c.body(graph, 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
    } catch {
      return c.json({ error: 'Graph artifact not found' }, 404)
    }
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
