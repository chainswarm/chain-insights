import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { GraphData } from './graph-model.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templatePath = path.resolve(__dirname, 'templates', 'graph.html')
const template = readFileSync(templatePath, 'utf-8')

interface GraphHtmlNode {
  address: string
  node_kind: string
  labels: string[]
  flow_in_usd: number
  flow_out_usd: number
  role: string | null
  risk_level: string | null
  pattern_flags: string[]
}

interface GraphHtmlEdge {
  source: string
  target: string
  usd_amount: number
  tx_count: number
  edge_type: string
}

interface GraphHtmlData {
  nodes: GraphHtmlNode[]
  edges: GraphHtmlEdge[]
  metadata?: { seed_address?: string; title?: string }
}

const ENTITY_TO_ROLE: Record<string, string | null> = {
  eoa: 'search',
  contract: 'intermediary',
  exchange: 'exchange',
  mixer: 'intermediary',
  hub: 'intermediary',
  unknown: null,
}

export function transformToGraphHtml(data: GraphData): GraphHtmlData {
  const nodes: GraphHtmlNode[] = data.nodes.map((n) => ({
    address: n.id,
    node_kind: n.entityType === 'exchange' ? 'exchange' : 'wallet',
    labels: n.label ? [n.label] : [],
    flow_in_usd: n.totalIn,
    flow_out_usd: n.totalOut,
    role: ENTITY_TO_ROLE[n.entityType] ?? null,
    risk_level: n.riskLevel === 'unknown' ? null : n.riskLevel,
    pattern_flags: [],
  }))

  const edges: GraphHtmlEdge[] = data.edges.map((e) => ({
    source: e.source,
    target: e.target,
    usd_amount: e.value,
    tx_count: 1,
    edge_type: 'flows_to',
  }))

  return {
    nodes,
    edges,
    metadata: {
      title: data.metadata.title,
    },
  }
}

export function generateHtml(data: GraphData, _title: string): string {
  const graphHtmlData = transformToGraphHtml(data)
  return generateInlineGraphHtml(graphHtmlData)
}

export function generateInlineGraphHtml(data: unknown): string {
  const dataJson = JSON.stringify(data).replaceAll('</script>', '<\\/script>')
  const inlineScript = `<script>var INLINE_DATA = ${dataJson};</script>`

  return template.replace('</body>', `${inlineScript}\n</body>`)
}

function sanitizePathSegment(segment: string): string {
  if (/[/\\]|^\.\.?$/.test(segment)) throw new Error(`Invalid path segment: ${segment}`)
  return segment
}

export async function writeVizHtml(vizId: string, html: string): Promise<string> {
  const paths = workspaceOutputPaths()
  const vizDir = path.join(paths.publishedRoot, 'viz')
  sanitizePathSegment(vizId)
  await mkdir(vizDir, { recursive: true })
  const filePath = path.join(vizDir, `${vizId}.html`)
  await writeFile(filePath, html, { mode: 0o600 })
  return filePath
}
