import { describe, it, expect } from 'vitest'
import { GraphData, GraphNode, GraphEdge, EntityType, RiskLevel, truncateGraph } from '../src/viz/graph-model.js'

const validNode = {
  id: '0x1234567890abcdef',
  entityType: 'eoa',
  riskLevel: 'low',
  totalIn: 100,
  totalOut: 50,
  txCount: 5,
}

const validEdge = {
  source: '0x1234',
  target: '0xabcd',
  value: 1.5,
}

const validMetadata = {
  generatedAt: '2024-01-01T00:00:00Z',
}

const validGraphData = {
  nodes: [validNode],
  edges: [validEdge],
  metadata: validMetadata,
}

describe('GraphData schema (VIZ-01)', () => {
  it('GraphData.parse(validInput) succeeds with nodes and edges arrays', () => {
    const result = GraphData.parse(validGraphData)
    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
  })

  it('GraphData.parse({}) throws validation error (missing required fields)', () => {
    expect(() => GraphData.parse({})).toThrow()
  })

  it('EntityType.parse("eoa") returns "eoa"', () => {
    expect(EntityType.parse('eoa')).toBe('eoa')
  })

  it('EntityType.parse("invalid") throws', () => {
    expect(() => EntityType.parse('invalid')).toThrow()
  })

  it('EntityType.parse("hub") returns "hub"', () => {
    expect(EntityType.parse('hub')).toBe('hub')
  })

  it('RiskLevel.parse("critical") returns "critical"', () => {
    expect(RiskLevel.parse('critical')).toBe('critical')
  })

  it('GraphNode defaults: entityType="unknown", riskLevel="unknown", totalIn=0, totalOut=0, txCount=0', () => {
    const node = GraphNode.parse({ id: 'test-id' })
    expect(node.entityType).toBe('unknown')
    expect(node.riskLevel).toBe('unknown')
    expect(node.totalIn).toBe(0)
    expect(node.totalOut).toBe(0)
    expect(node.txCount).toBe(0)
  })

  it('GraphEdge requires source, target, value; optional txHash/blockNumber/timestamp', () => {
    const edge = GraphEdge.parse({ source: '0x1', target: '0x2', value: 1.0 })
    expect(edge.source).toBe('0x1')
    expect(edge.target).toBe('0x2')
    expect(edge.value).toBe(1.0)
    expect(edge.txHash).toBeUndefined()
    expect(edge.blockNumber).toBeUndefined()
    expect(edge.timestamp).toBeUndefined()
  })

  it('GraphEdge.parse missing value throws', () => {
    expect(() => GraphEdge.parse({ source: '0x1', target: '0x2' })).toThrow()
  })

  it('GraphEdge.parse with txHash/blockNumber/timestamp succeeds', () => {
    const edge = GraphEdge.parse({
      source: '0x1',
      target: '0x2',
      value: 2.5,
      txHash: '0xabc',
      blockNumber: 123456,
      timestamp: '2024-01-01T00:00:00Z',
    })
    expect(edge.txHash).toBe('0xabc')
    expect(edge.blockNumber).toBe(123456)
    expect(edge.timestamp).toBe('2024-01-01T00:00:00Z')
  })
})

describe('truncateGraph (VIZ-01)', () => {
  function makeNode(id: string, volume: number) {
    return { id, totalIn: volume / 2, totalOut: volume / 2, txCount: 1 }
  }

  it('returns data unchanged when nodes.length <= 100', () => {
    const data = GraphData.parse({
      nodes: Array.from({ length: 50 }, (_, i) => makeNode(`n${i}`, i + 1)),
      edges: [],
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const result = truncateGraph(data)
    expect(result.nodes).toHaveLength(50)
    expect(result.metadata.truncated).toBe(false)
  })

  it('truncates 150 nodes to 100, keeps top by volume', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => makeNode(`n${i}`, i + 1))
    const data = GraphData.parse({
      nodes,
      edges: [],
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const result = truncateGraph(data)
    expect(result.nodes).toHaveLength(100)
    expect(result.metadata.truncated).toBe(true)
    expect(result.metadata.totalNodes).toBe(150)
    expect(result.metadata.hiddenNodes).toBe(50)
  })

  it('keeps top 100 nodes by totalIn+totalOut', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => makeNode(`n${i}`, i + 1))
    const data = GraphData.parse({
      nodes,
      edges: [],
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const result = truncateGraph(data)
    // Top nodes should have highest volume (i=50..149, volume=51..150)
    const minVolumeKept = Math.min(...result.nodes.map(n => n.totalIn + n.totalOut))
    expect(minVolumeKept).toBeGreaterThanOrEqual(51)
  })

  it('filters edges to only include both endpoints in kept nodes', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => makeNode(`n${i}`, i + 1))
    const edges = [
      { source: 'n0', target: 'n1', value: 1 },  // n0 and n1 have low volume (1 and 2), should be dropped
      { source: 'n148', target: 'n149', value: 5 }, // high volume nodes, should be kept
    ]
    const data = GraphData.parse({
      nodes,
      edges,
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const result = truncateGraph(data)
    // n0 and n1 (volume 1 and 2) should be cut; n148/n149 (volume 149/150) should be kept
    const keptIds = new Set(result.nodes.map(n => n.id))
    expect(keptIds.has('n0')).toBe(false)
    expect(keptIds.has('n148')).toBe(true)
    expect(keptIds.has('n149')).toBe(true)
    // edge for n148->n149 should be kept
    const edgeKept = result.edges.some(e => e.source === 'n148' && e.target === 'n149')
    expect(edgeKept).toBe(true)
  })
})
