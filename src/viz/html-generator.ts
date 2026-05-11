import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import type { GraphData } from './graph-model.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templatePath = path.resolve(__dirname, 'templates', 'graph.html')
const template = readFileSync(templatePath, 'utf-8')

interface GraphHtmlNode {
  address: string
  address_type: string
  labels: string[]
  flow_in_usd: number
  flow_out_usd: number
  role: string | null
  risk_level: string | null
  pattern_flags: string[]
}

interface GraphHtmlEdge {
  from_address: string
  to_address: string
  usd_amount: number
  tx_count: number
  type: string
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
  unknown: null,
}

export function transformToGraphHtml(data: GraphData): GraphHtmlData {
  const nodes: GraphHtmlNode[] = data.nodes.map((n) => ({
    address: n.id,
    address_type: n.entityType === 'exchange' ? 'exchange' : 'wallet',
    labels: n.label ? [n.label] : [],
    flow_in_usd: n.totalIn,
    flow_out_usd: n.totalOut,
    role: ENTITY_TO_ROLE[n.entityType] ?? null,
    risk_level: n.riskLevel === 'unknown' ? null : n.riskLevel,
    pattern_flags: [],
  }))

  const edges: GraphHtmlEdge[] = data.edges.map((e) => ({
    from_address: e.source,
    to_address: e.target,
    usd_amount: e.value,
    tx_count: 1,
    type: 'FLOWS_TO',
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
  const dataJson = JSON.stringify(graphHtmlData).replaceAll('</script>', '<\\/script>')
  const inlineScript = `<script>var INLINE_DATA = ${dataJson};</script>`

  return template.replace('</body>', `${inlineScript}\n</body>`)
}

function sanitizePathSegment(segment: string): string {
  if (/[/\\]|^\.\.?$/.test(segment)) throw new Error(`Invalid path segment: ${segment}`)
  return segment
}

export async function writeVizHtml(vizId: string, html: string, caseId?: string): Promise<string> {
  let vizDir: string
  if (caseId) {
    vizDir = path.join(os.homedir(), '.chain-insights', 'cases', sanitizePathSegment(caseId), 'viz')
  } else {
    vizDir = path.join(os.homedir(), '.chain-insights', 'viz')
  }
  await mkdir(vizDir, { recursive: true })
  const filePath = path.join(vizDir, `${vizId}.html`)
  await writeFile(filePath, html, { mode: 0o600 })
  return filePath
}
