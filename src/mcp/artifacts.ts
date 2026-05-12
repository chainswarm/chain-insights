import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InvestigatorConfig } from '../config/schema.js'

export type GraphArtifactInput = {
  schema: string
  nodes: unknown[]
  edges: unknown[]
  flows: unknown[]
  edge_anchors: unknown[]
}

export type GraphArtifactRef = {
  schema: string
  id: string
  url: string
  path: string
}

export async function writeGraphArtifact(
  graphData: GraphArtifactInput,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
): Promise<GraphArtifactRef> {
  if (graphData.schema !== 'chain-insights.graph.v1') {
    throw new Error(`Unsupported graph payload schema: ${graphData.schema}`)
  }

  const id = randomUUID()
  const artifactDir = path.join(config.dataDir, 'artifacts', id)
  const filePath = path.join(artifactDir, 'graph.json')
  await mkdir(artifactDir, { recursive: true })
  await writeFile(filePath, JSON.stringify(graphData, null, 2) + '\n', { mode: 0o600 })

  return {
    schema: graphData.schema,
    id,
    path: filePath,
    url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`,
  }
}
