import { Hono } from 'hono'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { workspaceOutputPaths } from '../workspace/output-root.js'

const WORKSPACE_TREE_ROOTS = ['artifacts', 'entities', 'reports', 'sessions', '.chain-insights/schema']
const WORKSPACE_TREE_MAX_DEPTH = 4

interface WorkspaceTreeEntry {
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
}

function withinRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function realPathWithinRoot(root: string, target: string): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
    return withinRoot(realRoot, realTarget)
  } catch {
    return false
  }
}

function toWorkspaceRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/')
}

async function listWorkspaceEntries(
  workspaceRoot: string,
  roots = WORKSPACE_TREE_ROOTS,
  maxDepth = WORKSPACE_TREE_MAX_DEPTH
): Promise<WorkspaceTreeEntry[]> {
  const entries: WorkspaceTreeEntry[] = []
  const root = path.resolve(workspaceRoot)

  async function visit(target: string, depth: number): Promise<void> {
    const resolved = path.resolve(target)
    if (!withinRoot(root, resolved)) return

    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(resolved)
    } catch {
      return
    }

    const type = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null
    if (!type) return

    const entry: WorkspaceTreeEntry = {
      path: toWorkspaceRelative(root, resolved),
      type,
    }
    if (type === 'file') entry.size = info.size
    entries.push(entry)

    if (type !== 'directory' || depth >= maxDepth) return
    if (!await realPathWithinRoot(root, resolved)) return

    let children: string[]
    try {
      children = await readdir(resolved)
    } catch {
      return
    }

    for (const child of children.sort()) {
      await visit(path.join(resolved, child), depth + 1)
    }
  }

  for (const rootName of roots) {
    const target = path.resolve(root, rootName)
    if (withinRoot(root, target)) await visit(target, 0)
  }

  return entries
}

async function findVizHtml(vizId: string): Promise<string | null> {
  const filename = `${vizId}.html`
  const paths = workspaceOutputPaths()
  const vizPath = path.join(paths.publishedRoot, 'viz', filename)
  try {
    return await readFile(vizPath, 'utf-8')
  } catch {
    return null
  }
}

function isSafeGraphReportFilename(filename: string): boolean {
  return (
    filename.endsWith('.graph.json') &&
    /^[A-Za-z0-9._-]+$/.test(filename) &&
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\')
  )
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

  app.get('/graph-reports/:filename', async (c) => {
    const filename = c.req.param('filename')
    if (!isSafeGraphReportFilename(filename)) {
      return c.json({ error: 'Invalid graph report filename' }, 400)
    }

    const { workspaceOutputPaths } = await import('../workspace/output-root.js')
    const paths = workspaceOutputPaths()
    const graphPath = path.resolve(paths.reportGraphsRoot, filename)
    if (!withinRoot(paths.reportGraphsRoot, graphPath)) {
      return c.json({ error: 'Invalid graph report filename' }, 400)
    }
    if (!await realPathWithinRoot(paths.reportGraphsRoot, graphPath)) {
      return c.json({ error: 'Graph report not found' }, 404)
    }

    try {
      const graph = await readFile(graphPath, 'utf-8')
      return c.body(graph, 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
    } catch {
      return c.json({ error: 'Graph report not found' }, 404)
    }
  })

  app.get('/graph-reports/*', (c) => {
    return c.json({ error: 'Invalid graph report filename' }, 400)
  })

  app.get('/workspace/tree', async (c) => {
    const { workspaceOutputPaths } = await import('../workspace/output-root.js')
    const paths = workspaceOutputPaths()
    const entries = await listWorkspaceEntries(paths.root, WORKSPACE_TREE_ROOTS)
    return c.json({
      schema: 'chain-insights.workspace-tree.v1',
      root: paths.root,
      entries,
    })
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
