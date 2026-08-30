import { randomUUID } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

const GraphReportInputSchema = z
  .object({
    schema: z.literal('chain-insights.graph.v1'),
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()),
    flows: z.array(z.unknown()).optional(),
    edge_anchors: z.array(z.unknown()).optional(),
  })
  .passthrough()

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
  const sanitized = slug
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  return sanitized || 'graph'
}

function timestampSegment(date = new Date()): string {
  return date.toISOString().replace(/[-:.]/g, '')
}

function uniqueFilename(slug: string): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  return `${timestampSegment()}-${sanitizeSlug(slug)}-${suffix}.graph.json`
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}

export async function writeGraphReport(
  graphData: unknown,
  options: WriteGraphReportOptions
): Promise<GraphReportRef> {
  const parsed = GraphReportInputSchema.safeParse(graphData)
  if (!parsed.success) {
    const schema = graphPayloadSchema(graphData)
    if (schema !== 'chain-insights.graph.v1') {
      throw new Error(`Unsupported graph payload schema: ${schema}`)
    }

    throw new Error(
      'Invalid graph payload: nodes and edges must be arrays; flows and edge_anchors must be arrays when present'
    )
  }

  const normalized = normalizeGraphPayload({
    ...parsed.data,
    flows: parsed.data.flows ?? [],
    edge_anchors: parsed.data.edge_anchors ?? [],
  })
  const paths = workspaceOutputPaths()
  const filename = uniqueFilename(options.slug)
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
