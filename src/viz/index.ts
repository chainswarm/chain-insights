export { GraphData, GraphNode, GraphEdge, EntityType, RiskLevel, truncateGraph } from './graph-model.js'
export type { GraphData as GraphDataType, GraphNode as GraphNodeType, GraphEdge as GraphEdgeType } from './graph-model.js'
export { generateHtml, writeVizHtml, transformToGraphHtml } from './html-generator.js'
export { DataExtractor, extractGraphFromCase, extractGraphFromJson } from './data-extractor.js'

import { readFile } from 'node:fs/promises'
import { truncateGraph } from './graph-model.js'
import { generateHtml, writeVizHtml } from './html-generator.js'

export async function generateVisualization(opts: {
  caseId?: string
  dataFile?: string
}): Promise<{ vizId: string; htmlPath: string }> {
  let rawData: unknown

  if (opts.dataFile) {
    const content = await readFile(opts.dataFile, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.')
    }
    const { extractGraphFromJson } = await import('./data-extractor.js')
    rawData = extractGraphFromJson(parsed)
  } else if (opts.caseId) {
    const { extractGraphFromCase } = await import('./data-extractor.js')
    const extracted = await extractGraphFromCase(opts.caseId)
    if (extracted.nodes.length === 0) {
      throw new Error('No Transaction Data. This case has no evidence with transaction data. Add evidence using `chain-insights evidence add` or provide a JSON file with `chain-insights viz --data <file.json>`.')
    }
    rawData = extracted
  } else {
    throw new Error('Provide either a case ID or --data <file.json>')
  }

  const data = truncateGraph(rawData as Parameters<typeof truncateGraph>[0])

  const vizId = opts.caseId
    ? `${opts.caseId}_${Date.now()}`
    : `adhoc_${Date.now()}`

  const title = data.metadata.caseId
    ? `${data.metadata.caseId} - Money Flow`
    : 'Ad-hoc Visualization'

  const html = generateHtml(data, title)
  const htmlPath = await writeVizHtml(vizId, html, opts.caseId)

  return { vizId, htmlPath }
}
