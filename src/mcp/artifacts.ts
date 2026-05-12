import { randomUUID } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'
import type { InvestigatorConfig } from '../config/schema.js'

const GraphArtifactInputSchema = z.object({
  schema: z.literal('chain-insights.graph.v1'),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  flows: z.array(z.unknown()),
  edge_anchors: z.array(z.unknown()),
})

export type GraphArtifactInput = z.infer<typeof GraphArtifactInputSchema>

export type GraphArtifactRef = {
  schema: string
  id: string
  url: string
  path: string
}

function graphPayloadSchema(graphData: unknown): string {
  return typeof graphData === 'object' && graphData !== null && 'schema' in graphData
    ? String(graphData.schema)
    : 'unknown'
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}

export async function writeGraphArtifact(
  graphData: unknown,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
): Promise<GraphArtifactRef> {
  const parsed = GraphArtifactInputSchema.safeParse(graphData)
  if (!parsed.success) {
    const schema = graphPayloadSchema(graphData)
    if (schema !== 'chain-insights.graph.v1') {
      throw new Error(`Unsupported graph payload schema: ${schema}`)
    }

    throw new Error('Invalid graph payload: nodes, edges, flows, and edge_anchors must be arrays')
  }

  const id = randomUUID()
  const artifactDir = path.join(config.dataDir, 'artifacts', id)
  const filePath = path.join(artifactDir, 'graph.json')
  await ensurePrivateDirectory(config.dataDir)
  await ensurePrivateDirectory(path.join(config.dataDir, 'artifacts'))
  await ensurePrivateDirectory(artifactDir)
  await writeFile(filePath, JSON.stringify(parsed.data, null, 2) + '\n', { mode: 0o600 })

  return {
    schema: parsed.data.schema,
    id,
    path: filePath,
    url: `http://127.0.0.1:${config.serverPort}/artifacts/${id}/graph.json`,
  }
}
