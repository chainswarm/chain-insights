import { safeFilename } from './paths.js'
import { JsonCanvasSchema, type JsonCanvas } from './schema.js'

function roleColor(roles: string[]): string {
  if (roles.includes('victim')) return '1'
  if (roles.includes('suspect') || roles.includes('scam_candidate')) return '2'
  if (roles.includes('deposit')) return '3'
  if (roles.includes('exchange')) return '5'
  if (roles.includes('service')) return '6'
  return '#808080'
}

function nodeRoles(node: Record<string, unknown>): string[] {
  return Array.isArray(node['roles']) ? node['roles'].map(String) : []
}

function nodeLabel(node: Record<string, unknown>): string {
  return String(node['address'] ?? node['id'] ?? 'unknown')
}

export function graphNodeId(node: Record<string, unknown>, index: number): string {
  return String(node['id'] ?? node['address'] ?? `node-${index + 1}`)
}

export function entityNotePath(entityId: string): string {
  return `Entities/${safeFilename(entityId)}`
}

export function graphToCanvas(graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }): JsonCanvas {
  const nodes = [
    {
      id: 'case',
      type: 'file' as const,
      file: 'Case.md',
      x: 0,
      y: 0,
      width: 360,
      height: 120,
      color: '4',
    },
  ]

  const nodeIdMap = new Map<string, string>()
  graph.nodes.forEach((node, index) => {
    const rawId = graphNodeId(node, index)
    const canvasId = `entity-${index + 1}`
    nodeIdMap.set(rawId, canvasId)
    nodes.push({
      id: canvasId,
      type: 'file' as const,
      file: entityNotePath(rawId),
      x: 420 + (index % 4) * 340,
      y: Math.floor(index / 4) * 220,
      width: 300,
      height: 120,
      color: roleColor(nodeRoles(node)),
    })
  })

  const edges = graph.edges.flatMap((edge, index) => {
    const from = nodeIdMap.get(String(edge['source'] ?? ''))
    const to = nodeIdMap.get(String(edge['target'] ?? ''))
    if (!from || !to) return []
    return [{
      id: `edge-${index + 1}`,
      fromNode: from,
      toNode: to,
      fromSide: 'right' as const,
      toSide: 'left' as const,
      toEnd: 'arrow' as const,
      label: String(edge['edge_type'] ?? 'related_to'),
    }]
  })

  for (const [index, node] of graph.nodes.entries()) {
    edges.push({
      id: `case-link-${index + 1}`,
      fromNode: 'case',
      toNode: `entity-${index + 1}`,
      fromSide: 'right' as const,
      toSide: 'left' as const,
      toEnd: 'arrow' as const,
      label: nodeLabel(node),
    })
  }

  return JsonCanvasSchema.parse({ nodes, edges })
}
