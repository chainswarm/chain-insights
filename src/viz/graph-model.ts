import * as z from 'zod'

export const EntityType = z.enum(['eoa', 'contract', 'exchange', 'mixer', 'unknown'])
export type EntityType = z.infer<typeof EntityType>

export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical', 'unscored', 'unknown'])
export type RiskLevel = z.infer<typeof RiskLevel>

export const GraphNode = z.object({
  id:         z.string().min(1),
  label:      z.string().optional(),
  entityType: EntityType.default('unknown'),
  riskLevel:  RiskLevel.default('unknown'),
  totalIn:    z.number().default(0),
  totalOut:   z.number().default(0),
  txCount:    z.number().int().default(0),
  firstSeen:  z.string().optional(),
  lastSeen:   z.string().optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  source:      z.string().min(1),
  target:      z.string().min(1),
  value:       z.number(),
  txHash:      z.string().optional(),
  blockNumber: z.number().int().optional(),
  timestamp:   z.string().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphData = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  metadata: z.object({
    title:       z.string().default('Money Flow'),
    generatedAt: z.string(),
    truncated:   z.boolean().default(false),
    totalNodes:  z.number().int().optional(),
    hiddenNodes: z.number().int().optional(),
  }),
})
export type GraphData = z.infer<typeof GraphData>

const MAX_NODES = 100

export function truncateGraph(data: GraphData): GraphData {
  if (data.nodes.length <= MAX_NODES) return data
  const sorted = [...data.nodes].sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
  const kept = sorted.slice(0, MAX_NODES)
  const keptIds = new Set(kept.map(n => n.id))
  const filteredEdges = data.edges.filter(e => keptIds.has(e.source) && keptIds.has(e.target))
  return {
    nodes: kept,
    edges: filteredEdges,
    metadata: {
      ...data.metadata,
      truncated: true,
      totalNodes: data.nodes.length,
      hiddenNodes: data.nodes.length - MAX_NODES,
    },
  }
}
