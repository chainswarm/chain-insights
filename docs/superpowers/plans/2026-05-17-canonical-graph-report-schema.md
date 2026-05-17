# Canonical Graph Report Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated graph artifacts with canonical `reports/graphs/*.graph.json` output served by Hono, and enforce the approved `chain-insights.graph.v1` graph model.

**Architecture:** `src/viz/graph-normalizer.ts` becomes the schema boundary for canonical graph JSON. A new report writer in `src/mcp/graph-reports.ts` writes graph reports under `reports/graphs/` and returns `/graph-reports/<filename>.graph.json` URLs. MCP graph-capable tools use that writer; generic query results only produce graph metadata when an upstream graph payload is explicit.

**Tech Stack:** TypeScript, Vitest, Hono, MCP SDK, Node filesystem APIs.

---

## File Structure

- Modify `src/viz/graph-normalizer.ts`: enforce canonical node/edge fields.
- Modify `tests/graph-normalizer.test.ts`: lock schema rules.
- Create `src/mcp/graph-reports.ts`: write canonical graph JSON to `reports/graphs/`.
- Replace `tests/mcp-artifacts.test.ts` with report-writer coverage, or create `tests/mcp-graph-reports.test.ts` and delete old artifact-specific expectations.
- Modify `src/server/app.ts`: add `GET /graph-reports/:filename`.
- Modify `tests/viz-server.test.ts`: replace `/artifacts/:id/graph.json` tests with `/graph-reports/:filename`.
- Modify `src/mcp/proxy.ts`: use graph report writer and report-backed metadata.
- Modify `src/viz/templates/graph.html`: accept `/graph-reports/*.graph.json` URLs and stop accepting `/artifacts/.../graph.json`.
- Modify `src/investigation/public-tools.ts`: emit canonical graph nodes for `address_risk` and combined `track_funds`.
- Modify `src/investigation/trace-funds.ts`: emit canonical graph nodes/edges and capture source labels/address type where available.
- Modify tests that assert artifact URLs or old fields: primarily `tests/mcp-proxy.test.ts`, `tests/mcp-artifact-server.test.ts`, `tests/viz-html-generator.test.ts`, and any artifact-specific assertions found by `rg "/artifacts|writeGraphArtifact|entity_kind|raw_labels|address_type.*wallet" tests src`.
- Modify docs/contracts only where they describe graph artifact storage: `README.md`, `skills/chain-insights-investigation/SKILL.md`, and any current workspace output guidance that says graph data belongs in `artifacts/`.

---

### Task 1: Enforce Canonical Graph Normalization

**Files:**
- Modify: `tests/graph-normalizer.test.ts`
- Modify: `src/viz/graph-normalizer.ts`

- [ ] **Step 1: Write failing normalizer tests**

Replace `tests/graph-normalizer.test.ts` with tests for the approved schema:

```ts
import { describe, expect, it } from 'vitest'

describe('normalizeGraphPayload', () => {
  it('emits canonical node_type, labels, roles, and source address_type', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5Seed',
          labels: ['Address'],
          system_labels: ['Address'],
          role: 'seed',
          address_type: 'wallet',
          entity_kind: 'address',
          raw_labels: ['Address'],
        },
        {
          id: '5Exchange',
          address: '5Exchange',
          labels: ['Binance', 'exchange'],
          system_labels: ['Address', 'Exchange'],
          address_type: 'substrate',
          address_subtypes: [],
          role: 'source_exchange',
          pattern_flags: ['layering'],
        },
        {
          address: '0xabc',
          labels: null,
          system_labels: ['Address'],
          address_type: 'evm',
          address_subtypes: null,
        },
      ],
      edges: [
        {
          source: '5Seed',
          target: '5Exchange',
          type: 'FLOWS_TO',
          from_address: '5Seed',
          to_address: '5Exchange',
          amount_sum: 12,
        },
      ],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      id: '5Seed',
      address: '5Seed',
      node_type: 'address',
      labels: [],
      roles: ['seed'],
    })
    expect(result.nodes[0]).not.toHaveProperty('address_type')
    expect(result.nodes[0]).not.toHaveProperty('entity_kind')
    expect(result.nodes[0]).not.toHaveProperty('raw_labels')
    expect(result.nodes[0]).not.toHaveProperty('role')

    expect(result.nodes[1]).toMatchObject({
      id: '5Exchange',
      address: '5Exchange',
      node_type: 'address',
      address_type: 'substrate',
      labels: ['Binance'],
      roles: ['exchange'],
      flags: ['layering'],
    })
    expect(result.nodes[1]).not.toHaveProperty('address_subtypes')
    expect(result.nodes[1]).not.toHaveProperty('pattern_flags')

    expect(result.nodes[2]).toMatchObject({
      id: '0xabc',
      address: '0xabc',
      node_type: 'address',
      address_type: 'evm',
      labels: [],
    })

    expect(result.edges[0]).toMatchObject({
      source: '5Seed',
      target: '5Exchange',
      edge_type: 'flows_to',
      amount_sum: 12,
    })
    expect(result.edges[0]).not.toHaveProperty('from_address')
    expect(result.edges[0]).not.toHaveProperty('to_address')
    expect(result.edges[0]).not.toHaveProperty('type')
  })

  it('preserves optional address_subtypes only when non-empty', async () => {
    const { normalizeGraphPayload } = await import('../src/viz/graph-normalizer.js')

    const result = normalizeGraphPayload({
      schema: 'chain-insights.graph.v1',
      nodes: [{
        address: '5Validator',
        labels: ['validator'],
        address_type: 'substrate',
        address_subtypes: ['validator_hotkey'],
      }],
      edges: [],
      flows: [],
      edge_anchors: [],
    })

    expect(result.nodes[0]).toMatchObject({
      address: '5Validator',
      address_type: 'substrate',
      address_subtypes: ['validator_hotkey'],
    })
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/graph-normalizer.test.ts
```

Expected: fail because current normalizer emits `role`, strips source `address_type`, may keep `from_address`/`to_address`, and does not emit `node_type` / `edge_type`.

- [ ] **Step 3: Implement canonical normalization**

Replace `src/viz/graph-normalizer.ts` with:

```ts
const GRAPH_TYPE_LABELS = new Set(['Address', 'Exchange', 'Miner', 'Validator', 'Hotkey', 'Subnet', 'IPAddress', 'Entity', 'GlobalState'])
const SOURCE_ADDRESS_TYPES = new Set(['substrate', 'evm'])

type GraphRecord = Record<string, unknown>

export type NormalizedGraphPayload = {
  schema: 'chain-insights.graph.v1'
  nodes: GraphRecord[]
  edges: GraphRecord[]
  flows: unknown[]
  edge_anchors: unknown[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is GraphRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function lowerSnake(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function displayLabels(node: GraphRecord): string[] {
  const labels = stringArray(node['labels'])
  return unique(labels).filter((label) => !GRAPH_TYPE_LABELS.has(label) && lowerSnake(label) !== 'exchange')
}

function systemLabels(node: GraphRecord): string[] {
  return unique([
    ...stringArray(node['system_labels']),
    ...stringArray(node['graph_labels']),
    ...stringArray(node['raw_labels']),
    ...stringArray(node['labels']).filter((label) => GRAPH_TYPE_LABELS.has(label)),
  ])
}

function normalizeRoles(node: GraphRecord): string[] {
  const roles = stringArray(node['roles'])
  const role = typeof node['role'] === 'string' ? node['role'] : ''
  if (role === 'source_exchange') roles.push('exchange')
  else if (role === 'deposit_candidate') roles.push('deposit_candidate')
  else if (role) roles.push(role)

  const labels = systemLabels(node)
  const display = stringArray(node['labels']).map(lowerSnake)
  if (labels.includes('Exchange') || display.includes('exchange')) roles.push('exchange')

  return unique(roles.map(lowerSnake).filter(Boolean))
}

function normalizeNodeType(node: GraphRecord): string {
  if (typeof node['node_type'] === 'string' && node['node_type'].trim()) {
    return lowerSnake(node['node_type'])
  }
  if (typeof node['address'] === 'string' || typeof node['id'] === 'string') return 'address'
  const labels = systemLabels(node)
  if (labels.length > 0) return lowerSnake(labels[0]!)
  return 'unknown'
}

function normalizeNode(node: unknown): GraphRecord {
  if (!isRecord(node)) return {}

  const normalized: GraphRecord = {}
  for (const [key, value] of Object.entries(node)) {
    if ([
      'address_type',
      'address_subtypes',
      'entity_kind',
      'graph_labels',
      'labels',
      'node_type',
      'pattern_flags',
      'raw_labels',
      'role',
      'roles',
      'system_labels',
      'type',
    ].includes(key)) continue
    normalized[key] = value
  }

  const id = typeof node['id'] === 'string'
    ? node['id']
    : typeof node['address'] === 'string'
      ? node['address']
      : undefined
  if (id) normalized['id'] = id
  const address = typeof node['address'] === 'string' ? node['address'] : id
  if (address) normalized['address'] = address
  normalized['node_type'] = normalizeNodeType(node)
  normalized['labels'] = displayLabels(node)

  if (typeof node['address_type'] === 'string' && SOURCE_ADDRESS_TYPES.has(node['address_type'])) {
    normalized['address_type'] = node['address_type']
  }
  const addressSubtypes = stringArray(node['address_subtypes'])
  if (addressSubtypes.length > 0) normalized['address_subtypes'] = unique(addressSubtypes)

  const roles = normalizeRoles(node)
  if (roles.length > 0) normalized['roles'] = roles

  if (typeof node['risk_level'] === 'string') normalized['risk_level'] = node['risk_level']
  if (!Array.isArray(node['flags']) && Array.isArray(node['pattern_flags']) && node['pattern_flags'].length > 0) {
    normalized['flags'] = node['pattern_flags'].map(String)
  }

  return normalized
}

function normalizeEdgeType(edge: GraphRecord): string {
  if (typeof edge['edge_type'] === 'string' && edge['edge_type'].trim()) return lowerSnake(edge['edge_type'])
  if (typeof edge['type'] === 'string' && edge['type'].trim()) return lowerSnake(edge['type'])
  if (typeof edge['relationship_type'] === 'string' && edge['relationship_type'].trim()) return lowerSnake(edge['relationship_type'])
  return 'related_to'
}

function normalizeEdge(edge: unknown): GraphRecord {
  if (!isRecord(edge)) return {}
  const normalized: GraphRecord = {}
  for (const [key, value] of Object.entries(edge)) {
    if (['edge_type', 'from_address', 'relationship_type', 'to_address', 'type'].includes(key)) continue
    normalized[key] = value
  }
  if (typeof normalized['source'] !== 'string' && typeof edge['from_address'] === 'string') {
    normalized['source'] = edge['from_address']
  }
  if (typeof normalized['target'] !== 'string' && typeof edge['to_address'] === 'string') {
    normalized['target'] = edge['to_address']
  }
  normalized['edge_type'] = normalizeEdgeType(edge)
  return normalized
}

export function normalizeGraphPayload(payload: unknown): NormalizedGraphPayload {
  if (!isRecord(payload) || payload['schema'] !== 'chain-insights.graph.v1') {
    throw new Error('Unsupported graph payload schema')
  }

  return {
    ...payload,
    schema: 'chain-insights.graph.v1',
    nodes: Array.isArray(payload['nodes']) ? payload['nodes'].map(normalizeNode) : [],
    edges: Array.isArray(payload['edges']) ? payload['edges'].map(normalizeEdge) : [],
    flows: Array.isArray(payload['flows']) ? payload['flows'] : [],
    edge_anchors: Array.isArray(payload['edge_anchors']) ? payload['edge_anchors'] : [],
  }
}
```

- [ ] **Step 4: Run normalizer tests**

Run:

```bash
npm test -- tests/graph-normalizer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/viz/graph-normalizer.ts tests/graph-normalizer.test.ts
git commit -m "fix: enforce canonical graph schema"
```

---

### Task 2: Replace Artifact Writer With Graph Report Writer

**Files:**
- Create: `src/mcp/graph-reports.ts`
- Create: `tests/mcp-graph-reports.test.ts`
- Later delete or stop importing: `src/mcp/artifacts.ts`, `tests/mcp-artifacts.test.ts`

- [ ] **Step 1: Write failing graph report writer tests**

Create `tests/mcp-graph-reports.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph report store', () => {
  let workspace: string
  let previousWorkspace: string | undefined

  beforeEach(async () => {
    workspace = join(tmpdir(), `ci-graph-report-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(join(workspace, '.chain-insights', 'workspace.json'), JSON.stringify({
      schema: 'chain-insights.workspace.v1',
      workspace_root: workspace,
      cases_dir: 'cases',
    }) + '\n')
    previousWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  })

  afterEach(async () => {
    if (previousWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = previousWorkspace
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes canonical graph JSON under reports/graphs and returns a Hono graph report URL', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    const report = await writeGraphReport({
      schema: 'chain-insights.graph.v1',
      nodes: [{ address: '5Exchange', labels: ['Address', 'Exchange', 'Binance'], address_type: 'substrate' }],
      edges: [{ source: '5Seed', target: '5Exchange', type: 'FLOWS_TO' }],
      flows: [],
      edge_anchors: [],
    }, {
      serverPort: 4567,
      slug: 'address-risk-5seed',
    })

    expect(report.schema).toBe('chain-insights.graph.v1')
    expect(report.filename).toMatch(/address-risk-5seed\\.graph\\.json$/)
    expect(report.path).toBe(join(workspace, 'reports', 'graphs', report.filename))
    expect(report.url).toBe(`http://127.0.0.1:4567/graph-reports/${report.filename}`)

    const raw = await readFile(report.path, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({
      schema: 'chain-insights.graph.v1',
      nodes: [{
        address: '5Exchange',
        node_type: 'address',
        address_type: 'substrate',
        labels: ['Binance'],
        roles: ['exchange'],
      }],
      edges: [{
        source: '5Seed',
        target: '5Exchange',
        edge_type: 'flows_to',
      }],
    })

    await expect(stat(join(workspace, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects malformed graph arrays before writing a report file', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    await expect(writeGraphReport({
      schema: 'chain-insights.graph.v1',
      nodes: 'not-array',
      edges: [],
      flows: [],
      edge_anchors: [],
    }, {
      serverPort: 4567,
      slug: 'bad',
    })).rejects.toThrow('Invalid graph payload')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/mcp-graph-reports.test.ts
```

Expected: fail because `src/mcp/graph-reports.ts` does not exist.

- [ ] **Step 3: Implement graph report writer**

Create `src/mcp/graph-reports.ts`:

```ts
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

const GraphReportInputSchema = z.object({
  schema: z.literal('chain-insights.graph.v1'),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  flows: z.array(z.unknown()).optional(),
  edge_anchors: z.array(z.unknown()).optional(),
}).passthrough()

export type GraphReportRef = {
  schema: 'chain-insights.graph.v1'
  filename: string
  url: string
  path: string
}

export type WriteGraphReportOptions = {
  serverPort: number
  slug: string
}

function graphPayloadSchema(graphData: unknown): string {
  return typeof graphData === 'object' && graphData !== null && 'schema' in graphData
    ? String(graphData.schema)
    : 'unknown'
}

function sanitizeSlug(slug: string): string {
  const sanitized = slug.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'graph'
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}

export async function writeGraphReport(
  graphData: unknown,
  options: WriteGraphReportOptions,
): Promise<GraphReportRef> {
  const parsed = GraphReportInputSchema.safeParse(graphData)
  if (!parsed.success) {
    const schema = graphPayloadSchema(graphData)
    if (schema !== 'chain-insights.graph.v1') {
      throw new Error(`Unsupported graph payload schema: ${schema}`)
    }
    throw new Error('Invalid graph payload: nodes and edges must be arrays')
  }

  const normalized = normalizeGraphPayload({
    flows: [],
    edge_anchors: [],
    ...graphData as Record<string, unknown>,
  })
  const paths = workspaceOutputPaths()
  const filename = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}Z$/, 'Z')}_${sanitizeSlug(options.slug)}.graph.json`
  const filePath = path.join(paths.reportGraphsRoot, filename)

  await ensurePrivateDirectory(paths.reportsRoot)
  await ensurePrivateDirectory(paths.reportGraphsRoot)
  await writeFile(filePath, JSON.stringify(normalized, null, 2) + '\n', { mode: 0o600 })

  return {
    schema: normalized.schema,
    filename,
    path: filePath,
    url: `http://127.0.0.1:${options.serverPort}/graph-reports/${filename}`,
  }
}
```

- [ ] **Step 4: Run report writer tests**

Run:

```bash
npm test -- tests/mcp-graph-reports.test.ts
```

Expected: pass.

- [ ] **Step 5: Remove old artifact writer tests**

Delete `tests/mcp-artifacts.test.ts` after all imports of `writeGraphArtifact` are removed in later tasks. If this task is implemented before later tasks, leave the file in place and delete it in Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/graph-reports.ts tests/mcp-graph-reports.test.ts
git commit -m "feat: write canonical graph reports"
```

---

### Task 3: Serve Graph Reports Through Hono

**Files:**
- Modify: `src/server/app.ts`
- Modify: `tests/viz-server.test.ts`

- [ ] **Step 1: Write failing server route tests**

In `tests/viz-server.test.ts`, replace the artifact route tests with graph report route tests:

```ts
  it('GET /graph-reports/:filename serves stored graph report JSON', async () => {
    const graphDir = join(workspace, 'reports', 'graphs')
    const graph = {
      schema: 'chain-insights.graph.v1',
      nodes: [{ id: '5Test', node_type: 'address', address: '5Test', labels: [] }],
      edges: [],
    }
    await mkdir(graphDir, { recursive: true })
    await writeFile(join(graphDir, 'sample.graph.json'), JSON.stringify(graph))

    stop = await startTestServer(14405)
    const res = await fetch('http://127.0.0.1:14405/graph-reports/sample.graph.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual(graph)
  })

  it('GET /graph-reports/:filename returns 400 for invalid filenames', async () => {
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
    await symlink(join(outside, 'leak.graph.json'), join(workspace, 'reports', 'graphs', 'leak.graph.json'))

    stop = await startTestServer(14410)
    const res = await fetch('http://127.0.0.1:14410/graph-reports/leak.graph.json')
    expect(res.status).toBe(404)

    await rm(outside, { recursive: true, force: true })
  })

  it('GET /graph-reports/:filename returns 404 for missing graph report', async () => {
    stop = await startTestServer(14407)
    const res = await fetch('http://127.0.0.1:14407/graph-reports/missing.graph.json')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Graph report not found')
  })
```

- [ ] **Step 2: Run server tests to verify RED**

Run:

```bash
npm test -- tests/viz-server.test.ts
```

Expected: fail because `/graph-reports/:filename` does not exist.

- [ ] **Step 3: Implement Hono graph report route**

In `src/server/app.ts`, add the route near the existing `/artifacts/:artifactId/graph.json` route:

```ts
  app.get('/graph-reports/:filename', async (c) => {
    const filename = c.req.param('filename')
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.graph\.json$/.test(filename) || filename.includes('..')) {
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
```

Keep `/artifacts/:artifactId/graph.json` only until Task 7 removes artifact usage and tests. If removing it now breaks unrelated tests, remove it in Task 7.

- [ ] **Step 4: Run server tests**

Run:

```bash
npm test -- tests/viz-server.test.ts
```

Expected: pass after updating old artifact expectations.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/viz-server.test.ts
git commit -m "feat: serve graph reports from workspace"
```

---

### Task 4: Point Graph App And MCP Metadata At Report URLs

**Files:**
- Modify: `src/viz/templates/graph.html`
- Modify: `tests/viz-html-generator.test.ts`
- Modify: `src/mcp/proxy.ts`
- Modify: `tests/mcp-proxy.test.ts`

- [ ] **Step 1: Write failing graph app URL validation test**

In `tests/viz-html-generator.test.ts`, update the expected route text:

```ts
expect(html).toContain('/graph-reports/')
expect(html).not.toContain('/artifacts/')
```

If the file currently only checks for `_meta.chainInsights.graph.url`, add a new assertion that the template allows `/graph-reports/` URLs and no longer hardcodes `/artifacts/`.

- [ ] **Step 2: Update proxy tests for report metadata**

In `tests/mcp-proxy.test.ts`, replace artifact metadata expectations:

```ts
expect(result._meta.chainInsights.graph.url).toContain('/graph-reports/')
expect(result._meta.chainInsights.graph.id).toBeUndefined()
expect(result._meta.chainInsights.graph.data).toBeUndefined()
```

For tests that read a file from artifact id, change them to parse the report filename:

```ts
const graphUrl = result._meta.chainInsights.graph.url as string
const filename = graphUrl.split('/graph-reports/')[1]
expect(filename).toMatch(/\.graph\.json$/)
const graphPath = join(workspace, 'reports', 'graphs', filename)
const graph = JSON.parse(await readFile(graphPath, 'utf8'))
expect(graph.schema).toBe('chain-insights.graph.v1')
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm test -- tests/viz-html-generator.test.ts tests/mcp-proxy.test.ts
```

Expected: fail because the graph app only accepts `/artifacts/` URLs and the proxy still calls `writeGraphArtifact`.

- [ ] **Step 4: Update graph app URL validator**

In `src/viz/templates/graph.html`, replace `isLocalGraphArtifactUrl` body with:

```js
function isLocalGraphArtifactUrl(graphUrl) {
  try {
    var parsed = new URL(graphUrl);
    if (parsed.protocol !== 'http:') return false;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return false;
    return /^\/graph-reports\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.graph\.json$/.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}
```

Keep the function name for a smaller diff, or rename it to `isLocalGraphReportUrl` only if all references are updated in the same step.

- [ ] **Step 5: Update proxy metadata writing**

In `src/mcp/proxy.ts`, replace dynamic imports of `./artifacts.js` with `./graph-reports.js` in:

- `normalizeRemoteToolResult`
- local `address_risk` handler
- local `track_funds` handler

Use this pattern:

```ts
const { writeGraphReport } = await import('./graph-reports.js')
const { ensureArtifactServer } = await import('./artifact-server.js')
const report = await writeGraphReport(result.graphData as never, {
  serverPort: config.serverPort,
  slug: `${toolName}-${network}-${addressOrSeed}`,
})
await ensureArtifactServer(config.serverPort)
```

Return metadata without an artifact id:

```ts
_meta: {
  chainInsights: {
    graph: {
      schema: report.schema,
      url: report.url,
    },
  },
},
```

For `normalizeRemoteToolResult`, derive the slug from the remote tool name when available. If the helper does not know the tool name, use `remote-graph`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/viz-html-generator.test.ts tests/mcp-proxy.test.ts
```

Expected: pass after test updates are complete.

- [ ] **Step 7: Commit**

```bash
git add src/viz/templates/graph.html src/mcp/proxy.ts tests/viz-html-generator.test.ts tests/mcp-proxy.test.ts
git commit -m "fix: return graph report urls from mcp tools"
```

---

### Task 5: Emit Canonical Graphs From Investigation Builders

**Files:**
- Modify: `src/investigation/public-tools.ts`
- Modify: `src/investigation/trace-funds.ts`
- Modify: `tests/mcp-proxy.test.ts`

- [ ] **Step 1: Add failing assertions for canonical tool graph nodes**

In `tests/mcp-proxy.test.ts`, update graph assertions for `address_risk` and `track_funds`:

```ts
expect(graph.nodes[0]).toHaveProperty('node_type', 'address')
expect(graph.nodes[0]).not.toHaveProperty('entity_kind')
expect(graph.nodes[0]).not.toHaveProperty('raw_labels')
expect(graph.nodes[0]).not.toHaveProperty('address_type', 'wallet')
expect(graph.edges[0]).toHaveProperty('edge_type', 'flows_to')
expect(graph.edges[0]).not.toHaveProperty('from_address')
expect(graph.edges[0]).not.toHaveProperty('to_address')
```

For exchange examples:

```ts
const exchangeNode = graph.nodes.find((node) => node.address === '5Exchange')
expect(exchangeNode?.roles).toContain('exchange')
expect(exchangeNode?.labels).toEqual(['Binance'])
expect(exchangeNode?.address_type).toBe('substrate')
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tests/mcp-proxy.test.ts
```

Expected: fail because builders still use old role/label/address fields in some paths.

- [ ] **Step 3: Update `address_risk` graph builder**

In `src/investigation/public-tools.ts`, update `buildRiskGraph` node creation:

```ts
nodes.set(address, {
  id: address,
  address,
  node_type: 'address',
  labels: [],
  roles: ['subject'],
})
```

When adding path entries:

```ts
if (!nodes.has(entry)) {
  nodes.set(entry, {
    id: entry,
    address: entry,
    node_type: 'address',
    labels: [],
  })
}
```

When adding exchange nodes:

```ts
const exchangeLabels = Array.isArray(row['exchange_labels'])
  ? row['exchange_labels'].map(String)
  : []
const displayLabels = exchangeLabels.filter((label) => !['Address', 'Exchange'].includes(label))
if (exchange) {
  nodes.set(exchange, {
    id: exchange,
    address: exchange,
    node_type: 'address',
    labels: displayLabels,
    system_labels: exchangeLabels,
    address_type: row['exchange_address_type'],
    address_subtypes: row['exchange_address_subtypes'],
    roles: ['exchange'],
  })
}
```

Update `exchangeOutflowsQuery` and `exchangeInflowsQuery` to return source-backed fields:

```cypher
exchange.address_type AS exchange_address_type,
exchange.address_subtypes AS exchange_address_subtypes,
exchange.labels AS exchange_display_labels,
labels(exchange) AS exchange_labels
```

Use `exchange_display_labels` for JSON `labels` and `exchange_labels` as `system_labels`.

Update edges to emit:

```ts
edge_type: 'flows_to',
source: path[index],
target: path[index + 1],
```

and remove `from_address`, `to_address`, and `type`.

- [ ] **Step 4: Update `track_funds` / `trace-funds` graph builder**

In `src/investigation/trace-funds.ts`, update Cypher projections so path node metadata is available:

```cypher
[n IN nodes(p) | {
  address: n.address,
  system_labels: labels(n),
  labels: n.labels,
  address_type: n.address_type,
  address_subtypes: n.address_subtypes
}] AS path_nodes
```

Keep the existing `addresses` and `node_labels` projections during the migration if parsing is easier, but canonical graph construction should prefer `path_nodes`.

Update `TraceFlow` to carry optional source/destination metadata:

```ts
src_node?: Record<string, unknown>
dst_node?: Record<string, unknown>
```

In `buildGraph`, store node data as:

```ts
{
  id: address,
  address,
  node_type: 'address',
  labels: displayLabels,
  system_labels: systemLabels,
  address_type,
  address_subtypes,
  roles,
  flow_in_usd: data.in,
  flow_out_usd: data.out,
}
```

Use `roles: ['seed']`, `roles: ['deposit_candidate']`, `roles: ['exchange']`, and `roles: ['lead']` instead of `role`.

Edges from flows should emit:

```ts
{
  source: flow.src,
  target: flow.dst,
  edge_type: 'flows_to',
  usd_amount: flow.amount_usd_sum ?? flow.amount_sum,
  amount_sum: flow.amount_sum,
  tx_count: flow.tx_count ?? 0,
  first_tx_id: flow.first_tx_id,
  last_tx_id: flow.last_tx_id,
  terminal_exchange: flow.terminal_exchange,
}
```

Source-match and reverse-lead edges should also use `source`, `target`, and `edge_type`.

- [ ] **Step 5: Run investigation/proxy tests**

Run:

```bash
npm test -- tests/mcp-proxy.test.ts tests/graph-normalizer.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/investigation/public-tools.ts src/investigation/trace-funds.ts tests/mcp-proxy.test.ts
git commit -m "fix: emit canonical investigation graphs"
```

---

### Task 6: Preserve Graph/Table Discriminator For Generic Queries

**Files:**
- Create: `src/viz/graph-shape.ts`
- Create: `tests/graph-shape.test.ts`
- Modify: `src/mcp/proxy.ts` only if generic row-to-graph logic already exists or is introduced by another task.

- [ ] **Step 1: Write graph/table discriminator tests**

Create `tests/graph-shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('graph result shape detection', () => {
  it('treats aggregate schema rows as table-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([
      { label: 'Address', count: 387504 },
      { label: 'Exchange', count: 17 },
    ])).toBe('table')
  })

  it('treats explicit source target relationship rows as graph-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([
      { source: '5Seed', target: '5Exchange', relationship_type: 'FLOWS_TO', amount_sum: 12 },
    ])).toBe('graph')
  })

  it('treats ambiguous address rows as table-shaped', async () => {
    const { classifyGraphResultShape } = await import('../src/viz/graph-shape.js')

    expect(classifyGraphResultShape([
      { address: '5Seed', degree_in: 1, degree_out: 2 },
    ])).toBe('table')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/graph-shape.test.ts
```

Expected: fail because `src/viz/graph-shape.ts` does not exist.

- [ ] **Step 3: Implement discriminator**

Create `src/viz/graph-shape.ts`:

```ts
type GraphShape = 'graph' | 'table'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function classifyGraphResultShape(rows: unknown): GraphShape {
  if (!Array.isArray(rows) || rows.length === 0) return 'table'
  return rows.some((row) => {
    if (!isRecord(row)) return false
    const hasSourceTarget = typeof row['source'] === 'string' && typeof row['target'] === 'string'
    const hasSrcDst = typeof row['src'] === 'string' && typeof row['dst'] === 'string'
    const hasPath = Array.isArray(row['path']) || Array.isArray(row['nodes']) || Array.isArray(row['relationships'])
    return hasSourceTarget || hasSrcDst || hasPath
  }) ? 'graph' : 'table'
}
```

- [ ] **Step 4: Wire only if needed**

If `src/mcp/proxy.ts` or another tool path tries to auto-create graph JSON from generic query rows, call `classifyGraphResultShape(rows)` before writing graph reports. If current proxy only persists explicit `_meta.chainInsights.graph.data`, leave proxy behavior unchanged and keep this helper for the implementation boundary.

- [ ] **Step 5: Run discriminator tests**

Run:

```bash
npm test -- tests/graph-shape.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/viz/graph-shape.ts tests/graph-shape.test.ts
git commit -m "feat: classify graph query result shape"
```

---

### Task 7: Remove Graph Artifact Contract And Update Docs

**Files:**
- Delete or stop using: `src/mcp/artifacts.ts`
- Delete or rewrite: `tests/mcp-artifacts.test.ts`, `tests/mcp-artifact-server.test.ts`
- Modify: `src/workspace/init.ts`
- Modify: `README.md`
- Modify: `skills/chain-insights-investigation/SKILL.md`
- Modify: `skills/test-chain-insights-graphrag-mcp/SKILL.md`
- Modify: `skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh`

- [ ] **Step 1: Find remaining artifact graph references**

Run:

```bash
rg -n "/artifacts|writeGraphArtifact|graph artifact|artifacts/<|artifactsRoot|_meta\\.chainInsights\\.graph\\.id" src tests README.md skills docs/superpowers/specs/2026-05-17-canonical-graph-report-schema-design.md
```

Expected: list remaining references to update. Keep unrelated wallet/topup uses if they are not graph JSON.

- [ ] **Step 2: Remove artifact graph tests**

Delete `tests/mcp-artifacts.test.ts` and `tests/mcp-artifact-server.test.ts` if their only purpose is `artifacts/<id>/graph.json`. If either file has reusable Hono server lifecycle coverage, rewrite it to call `writeGraphReport` and `/graph-reports/:filename`.

- [ ] **Step 3: Update workspace initialization copy**

In `src/workspace/init.ts`, remove or revise text that says graph JSON belongs in `artifacts/`. Keep `reports/graphs/` and `reports/tables/` as the graph/table destinations.

If the workspace tree still creates `artifacts/.keep`, remove that entry unless another non-graph app feature uses it.

- [ ] **Step 4: Update README and skills**

Replace graph artifact wording with graph report wording:

```text
Graph visualization JSON is stored under reports/graphs/*.graph.json.
The local Hono server serves graph reports at /graph-reports/<filename>.graph.json.
MCP graph metadata returns _meta.chainInsights.graph.url pointing to that local report URL.
```

Remove claims that graph data is stored under `~/.chain-insights/artifacts` or workspace `artifacts/`.

- [ ] **Step 5: Run reference scan again**

Run:

```bash
rg -n "/artifacts|writeGraphArtifact|graph artifact|artifacts/<|_meta\\.chainInsights\\.graph\\.id" src tests README.md skills
```

Expected: no active graph JSON references. If `artifacts` remains only for non-graph functionality, add a short comment in the final summary explaining why.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/mcp-graph-reports.test.ts tests/viz-server.test.ts tests/mcp-proxy.test.ts tests/workspace-output-root.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src tests README.md skills
git add -u
git commit -m "chore: remove graph artifact storage contract"
```

---

### Task 8: End-To-End Verification

**Files:**
- No code files unless verification exposes a bug.

- [ ] **Step 1: Run full TypeScript verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 2: Verify local Go MCP endpoint is healthy**

Run:

```bash
curl -fsS http://localhost:8012/health
cia debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
cia mcp tools --refresh
```

Expected:

- health returns `{"status":"ok"}`;
- tools include `graph_query` and `graph_query_batch`.

- [ ] **Step 3: Run table-shaped generic query**

Run:

```bash
cia mcp call graph_query_batch network=bittensor 'queries=[{"id":"address_types","query":"MATCH (n:Address) RETURN n.address_type AS address_type, count(*) AS count ORDER BY count DESC LIMIT 5"}]'
```

Expected:

- command succeeds;
- no `_meta.chainInsights.graph.url`;
- no new file under `reports/graphs/` for this aggregate-only query.

- [ ] **Step 4: Run graph-producing high-level tool**

Run a bounded address risk call with a known address from the live query output:

```bash
cia mcp call address_risk network=bittensor address=5HbDZ6ULuwZegAMSPaS2kaUfBLMDaht5t48RcDrQATSgGCAR
```

Expected:

- response includes `_meta.chainInsights.graph.url`;
- URL contains `/graph-reports/`;
- URL does not contain `/artifacts/`.

- [ ] **Step 5: Fetch returned graph report URL**

Use the URL returned by Step 4:

```bash
curl -fsS 'http://127.0.0.1:<port>/graph-reports/<filename>.graph.json' | jq '{schema, node0:.nodes[0], edge0:.edges[0]}'
```

Expected:

- `schema` is `chain-insights.graph.v1`;
- nodes have `node_type`;
- edges have `edge_type`;
- no `entity_kind`, `raw_labels`, `from_address`, or `to_address`.

- [ ] **Step 6: Verify no graph JSON is written under artifacts**

Run:

```bash
find artifacts -type f -name 'graph.json' -newer docs/superpowers/specs/2026-05-17-canonical-graph-report-schema-design.md -print 2>/dev/null
```

Expected: no output.

- [ ] **Step 7: Commit verification-only doc updates if any**

If verification required docs or test fixture updates:

```bash
git add <changed-files>
git commit -m "test: verify canonical graph reports"
```

If no files changed, do not commit.

---

## Self-Review Checklist

- Spec coverage:
  - Canonical `chain-insights.graph.v1` schema: Task 1.
  - Report-backed graph storage: Task 2.
  - Hono `/graph-reports/` serving: Task 3.
  - MCP metadata points to report URLs: Task 4.
  - `address_risk` and `track_funds` graph output: Task 5.
  - Graph/table discriminator: Task 6.
  - Artifact cleanup: Task 7.
  - Live verification: Task 8.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "handle later" steps.
- Type consistency:
  - Graph writer is `writeGraphReport`.
  - Graph URL metadata is `_meta.chainInsights.graph.url`.
  - Canonical node field is `node_type`.
  - Canonical edge field is `edge_type`.
  - Report route is `/graph-reports/:filename`.
