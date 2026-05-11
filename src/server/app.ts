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
    const { healthCheck } = await import('../db/index.js')
    const db = await healthCheck()
    return c.json({
      database: db.ok ? 'healthy' : 'error',
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

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
