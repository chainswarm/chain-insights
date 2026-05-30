import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { normalizeGraphPayload, type NormalizedGraphPayload } from '../viz/graph-normalizer.js'
import { extractGraphFromCase } from '../viz/data-extractor.js'
import { workspaceOutputPaths } from '../workspace/output-root.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nodeId(node: Record<string, unknown>): string {
  return String(node['id'] ?? node['address'] ?? '')
}

function edgeKey(edge: Record<string, unknown>): string {
  return `${String(edge['source'] ?? '')}->${String(edge['target'] ?? '')}:${String(edge['edge_type'] ?? 'related_to')}`
}

function mergeGraphs(graphs: NormalizedGraphPayload[]): NormalizedGraphPayload {
  const nodes = new Map<string, Record<string, unknown>>()
  const edges = new Map<string, Record<string, unknown>>()
  for (const graph of graphs) {
    for (const rawNode of graph.nodes) {
      const id = nodeId(rawNode)
      if (id) nodes.set(id, { ...(nodes.get(id) ?? {}), ...rawNode, id })
    }
    for (const rawEdge of graph.edges) {
      if (typeof rawEdge['source'] !== 'string' || typeof rawEdge['target'] !== 'string') continue
      edges.set(edgeKey(rawEdge), { ...(edges.get(edgeKey(rawEdge)) ?? {}), ...rawEdge })
    }
  }
  return {
    schema: 'chain-insights.graph.v1',
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    flows: graphs.flatMap(graph => graph.flows),
    edge_anchors: graphs.flatMap(graph => graph.edge_anchors),
    metadata: {
      source: 'case-export',
      graph_count: graphs.length,
      generated_at: new Date().toISOString(),
    },
  }
}

export async function loadCaseExportGraph(caseId: string): Promise<NormalizedGraphPayload> {
  const paths = workspaceOutputPaths()
  const files = await readdir(paths.reportGraphsRoot).catch(() => [])
  const graphs: NormalizedGraphPayload[] = []
  for (const file of files.filter(name => name.endsWith('.graph.json')).sort()) {
    const parsed = JSON.parse(await readFile(path.join(paths.reportGraphsRoot, file), 'utf8')) as unknown
    if (isRecord(parsed) && parsed['schema'] === 'chain-insights.graph.v1') {
      graphs.push(normalizeGraphPayload(parsed))
    }
  }
  if (graphs.length > 0) return mergeGraphs(graphs)

  const fallback = await extractGraphFromCase(caseId)
  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: fallback.nodes,
    edges: fallback.edges,
    flows: [],
    edge_anchors: [],
    metadata: fallback.metadata,
  })
}
