export { GraphData, GraphNode, GraphEdge, EntityType, RiskLevel, truncateGraph } from './graph-model.js'
export type { GraphData as GraphDataType, GraphNode as GraphNodeType, GraphEdge as GraphEdgeType } from './graph-model.js'
export { generateHtml, writeVizHtml } from './html-generator.js'
export { buildCssVariables, buildLayoutCss, ENTITY_COLORS, RISK_COLORS } from './theme.js'
export { buildVizLogic } from './templates/viz-logic.js'

import { readFile } from 'node:fs/promises'
import { GraphData, truncateGraph } from './graph-model.js'
import { generateHtml, writeVizHtml } from './html-generator.js'

export async function generateVisualization(opts: {
  caseId?: string
  dataFile?: string
}): Promise<{ vizId: string; htmlPath: string }> {
  let rawData: unknown

  if (opts.dataFile) {
    const content = await readFile(opts.dataFile, 'utf-8')
    try {
      rawData = JSON.parse(content)
    } catch {
      throw new Error('Invalid transaction data. The input file must contain a JSON array of transaction objects with `from`, `to`, and `value` fields.')
    }
  } else if (opts.caseId) {
    // Case-based extraction -- implemented in Plan 02
    throw new Error('Case not found. Run `chain-insights case list` to see available cases.')
  } else {
    throw new Error('Provide either a case ID or --data <file.json>')
  }

  // Validate and parse
  const parsed = GraphData.parse(rawData)
  const data = truncateGraph(parsed)

  // Generate viz ID
  const vizId = opts.caseId
    ? `${opts.caseId}_${Date.now()}`
    : `adhoc_${Date.now()}`

  // Title
  const title = data.metadata.caseId
    ? `${data.metadata.caseId} - Money Flow`
    : 'Ad-hoc Visualization'

  // Generate HTML and write to disk
  // Pass caseId so writeVizHtml stores in per-case dir (CONTEXT.md) or central dir (standalone)
  const html = generateHtml(data, title)
  const htmlPath = await writeVizHtml(vizId, html, opts.caseId)

  return { vizId, htmlPath }
}
