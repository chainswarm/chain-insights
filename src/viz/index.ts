export { GraphData, GraphNode, GraphEdge, EntityType, RiskLevel, truncateGraph } from './graph-model.js'
export type { GraphData as GraphDataType, GraphNode as GraphNodeType, GraphEdge as GraphEdgeType } from './graph-model.js'
export { generateHtml, writeVizHtml, transformToGraphHtml } from './html-generator.js'
export { DataExtractor, extractGraphFromJson } from './data-extractor.js'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { truncateGraph } from './graph-model.js'
import { extractGraphFromJson } from './data-extractor.js'
import { generateHtml, writeVizHtml } from './html-generator.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

function sanitizeSourceId(sourceId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sourceId) || sourceId.includes('..')) {
    throw new Error(`Invalid visualization source ID: ${sourceId}`)
  }
  return sourceId
}

export async function generateVisualization(opts: {
  sourceId?: string
  dataFile?: string
}): Promise<{ vizId: string; htmlPath: string }> {
  let rawData: unknown
  let vizId: string
  let title: string

  if (opts.dataFile) {
    const content = await readFile(opts.dataFile, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.')
    }
    rawData = extractGraphFromJson(parsed)
    vizId = `adhoc_${Date.now()}`
    title = 'Ad-hoc Visualization'
  } else if (opts.sourceId) {
    const sourceId = sanitizeSourceId(opts.sourceId)
    const paths = workspaceOutputPaths()
    const graphPath = path.join(paths.reportGraphsRoot, `${sourceId}.graph.json`)
    const content = await readFile(graphPath, 'utf-8')
    rawData = JSON.parse(content) as unknown
    vizId = sourceId
    title = `${sourceId} - Workspace Graph`
  } else {
    throw new Error('Provide either a visualization source ID or --data <file.json>')
  }

  const data = truncateGraph(rawData as Parameters<typeof truncateGraph>[0])
  const html = generateHtml(data, title)
  const htmlPath = await writeVizHtml(vizId, html)

  return { vizId, htmlPath }
}
