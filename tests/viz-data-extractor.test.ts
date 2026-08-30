import { describe, it, expect, beforeEach, vi } from 'vitest'

// VIZ-01: Data extractor for investigation evidence and JSON input

describe('parseEvidenceJson (VIZ-01)', () => {
  let extractors: typeof import('../src/viz/data-extractor.js')

  beforeEach(async () => {
    vi.resetModules()
    extractors = await import('../src/viz/data-extractor.js')
  })

  it('returns empty array when markdown has no JSON code blocks', () => {
    const { parseEvidenceJson } = extractors
    const md = '## Evidence\n\nSome plain text without code blocks.'
    expect(parseEvidenceJson(md)).toEqual([])
  })

  it('extracts items from a ```json array code block', () => {
    const { parseEvidenceJson } = extractors
    const md = [
      '## Evidence',
      '',
      '```json',
      '[{"from":"0xaaa","to":"0xbbb","value":100},{"from":"0xbbb","to":"0xccc","value":50}]',
      '```',
    ].join('\n')
    const items = parseEvidenceJson(md)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ from: '0xaaa', to: '0xbbb', value: 100 })
  })

  it('extracts an unfenced JSON object from evidence body', () => {
    const { parseEvidenceJson } = extractors
    const md = [
      '## Evidence',
      '',
      '{"schema":"chain-insights.compact_evidence.v1","outgoing_flows":[]}',
    ].join('\n')
    expect(parseEvidenceJson(md)).toEqual([
      { schema: 'chain-insights.compact_evidence.v1', outgoing_flows: [] },
    ])
  })

  it('ignores non-JSON code blocks (```typescript)', () => {
    const { parseEvidenceJson } = extractors
    const md = '```typescript\nconst x = 1\n```'
    expect(parseEvidenceJson(md)).toEqual([])
  })
})

describe('extractGraphFromJson (VIZ-01)', () => {
  let extractors: typeof import('../src/viz/data-extractor.js')

  beforeEach(async () => {
    vi.resetModules()
    extractors = await import('../src/viz/data-extractor.js')
  })

  it('parses full GraphData object (nodes + edges + metadata)', () => {
    const { extractGraphFromJson } = extractors
    const input = {
      nodes: [
        { id: '0xaaa', entityType: 'eoa', riskLevel: 'low', totalIn: 0, totalOut: 100, txCount: 1 },
      ],
      edges: [{ source: '0xaaa', target: '0xbbb', value: 100 }],
      metadata: { title: 'Test', generatedAt: '2026-01-01T00:00:00Z' },
    }
    const result = extractGraphFromJson(input)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]!.id).toBe('0xaaa')
    expect(result.edges).toHaveLength(1)
  })

  it('auto-derives nodes from simple [{from, to, value}] array', () => {
    const { extractGraphFromJson } = extractors
    const input = [
      { from: '0xaaa', to: '0xbbb', value: 100, txHash: '0x111' },
      { from: '0xbbb', to: '0xccc', value: 50, txHash: '0x222' },
    ]
    const result = extractGraphFromJson(input)
    // 3 unique addresses
    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toHaveLength(2)
    // All nodes default to unknown entity/risk
    for (const node of result.nodes) {
      expect(node.entityType).toBe('unknown')
      expect(node.riskLevel).toBe('unknown')
    }
    // Computed totals
    const nodeAaa = result.nodes.find((n) => n.id === '0xaaa')
    expect(nodeAaa).toBeDefined()
    expect(nodeAaa!.totalOut).toBe(100)
    expect(nodeAaa!.txCount).toBe(1)
    const nodeBbb = result.nodes.find((n) => n.id === '0xbbb')
    expect(nodeBbb).toBeDefined()
    expect(nodeBbb!.totalIn).toBe(100)
    expect(nodeBbb!.totalOut).toBe(50)
    expect(nodeBbb!.txCount).toBe(2)
  })

  it('maps txHash from simple array to GraphEdge', () => {
    const { extractGraphFromJson } = extractors
    const input = [{ from: '0xaaa', to: '0xbbb', value: 100, txHash: '0xdeadbeef' }]
    const result = extractGraphFromJson(input)
    expect(result.edges[0]!.txHash).toBe('0xdeadbeef')
  })

  it('maps compact evidence outgoing_flows using the amount_usd_sum field', () => {
    const { extractGraphFromJson } = extractors
    const input = [
      {
        schema: 'chain-insights.compact_evidence.v1',
        outgoing_flows: [
          {
            src: '5src',
            dst: '5dst',
            amount_usd_sum: 42,
            tx_count: 1,
            first_tx_id: '294-1',
          },
        ],
      },
    ]
    const result = extractGraphFromJson(input)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({
      source: '5src',
      target: '5dst',
      value: 42,
      txHash: '294-1',
    })
  })

  it('throws "Invalid transaction data" for non-array non-GraphData input', () => {
    const { extractGraphFromJson } = extractors
    expect(() => extractGraphFromJson({})).toThrow('Invalid transaction data')
  })

  it('throws "Invalid transaction data" for null input', () => {
    const { extractGraphFromJson } = extractors
    expect(() => extractGraphFromJson(null)).toThrow('Invalid transaction data')
  })
})
