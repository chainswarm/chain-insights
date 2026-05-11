import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serializeFrontmatter } from '../src/cases/frontmatter.js'

// VIZ-01: Data extractor for case evidence and JSON input

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
      edges: [
        { source: '0xaaa', target: '0xbbb', value: 100 },
      ],
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
    const nodeAaa = result.nodes.find(n => n.id === '0xaaa')
    expect(nodeAaa).toBeDefined()
    expect(nodeAaa!.totalOut).toBe(100)
    expect(nodeAaa!.txCount).toBe(1)
    const nodeBbb = result.nodes.find(n => n.id === '0xbbb')
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

  it('throws "Invalid transaction data" for non-array non-GraphData input', () => {
    const { extractGraphFromJson } = extractors
    expect(() => extractGraphFromJson({})).toThrow('Invalid transaction data')
  })

  it('throws "Invalid transaction data" for null input', () => {
    const { extractGraphFromJson } = extractors
    expect(() => extractGraphFromJson(null)).toThrow('Invalid transaction data')
  })
})

describe('extractGraphFromCase (VIZ-01)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    fakeHome = join(tmpdir(), `ci-viz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
    vi.resetModules()
  })

  async function createEvidenceFile(caseId: string, filename: string, content: string) {
    const evidenceDir = join(fakeHome, '.chain-insights', 'cases', caseId, 'evidence')
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, filename), content)
  }

  async function createDossierFile(caseId: string, address: string, entityType: string) {
    const dossierDir = join(fakeHome, '.chain-insights', 'cases', caseId, 'dossiers')
    await mkdir(dossierDir, { recursive: true })
    const safeAddr = address.replace(/[^a-zA-Z0-9]/g, '').slice(0, 66)
    const fm: Record<string, string> = {
      address,
      type: entityType,
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      riskTags: '',
    }
    const body = `# Entity: ${address}\n\n## Findings\n\n`
    await writeFile(join(dossierDir, `${safeAddr}.md`), serializeFrontmatter(fm, body))
  }

  it('returns empty graph when evidence directory does not exist', async () => {
    vi.resetModules()
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase('nonexistent-case')
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('returns empty graph when evidence files have no JSON code blocks', async () => {
    const caseId = 'test-case-001'
    await createEvidenceFile(caseId, '001_manual_20260511.md', [
      '---',
      `id: ${caseId}_ev001`,
      `caseId: ${caseId}`,
      'source: manual',
      '---',
      '## Evidence: manual',
      '',
      'Some plain text with no transaction data.',
    ].join('\n'))
    vi.resetModules()
    process.env['HOME'] = fakeHome
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase(caseId)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('reads evidence files and parses JSON code blocks into graph data', async () => {
    const caseId = 'test-case-002'
    const transactions = [
      { from: '0xaaa', to: '0xbbb', value: 100, txHash: '0x111' },
      { from: '0xbbb', to: '0xccc', value: 50, txHash: '0x222' },
    ]
    const evidenceContent = [
      '---',
      `id: ${caseId}_ev001`,
      `caseId: ${caseId}`,
      'source: mcp-query',
      '---',
      '## Evidence: mcp-query',
      '',
      '```json',
      JSON.stringify(transactions),
      '```',
    ].join('\n')
    await createEvidenceFile(caseId, '001_mcp-query_20260511.md', evidenceContent)
    vi.resetModules()
    process.env['HOME'] = fakeHome
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase(caseId)
    expect(result.nodes.length).toBeGreaterThan(0)
    expect(result.edges).toHaveLength(2)
    const nodeIds = result.nodes.map(n => n.id)
    expect(nodeIds).toContain('0xaaa')
    expect(nodeIds).toContain('0xbbb')
    expect(nodeIds).toContain('0xccc')
  })

  it('enriches nodes with entity types from dossier summaries', async () => {
    const caseId = 'test-case-003'
    const transactions = [
      { from: '0xaaa', to: '0xbbb', value: 100, txHash: '0x111' },
    ]
    const evidenceContent = [
      '---',
      `id: ${caseId}_ev001`,
      `caseId: ${caseId}`,
      'source: mcp-query',
      '---',
      '## Evidence: mcp-query',
      '',
      '```json',
      JSON.stringify(transactions),
      '```',
    ].join('\n')
    await createEvidenceFile(caseId, '001_mcp-query_20260511.md', evidenceContent)
    await createDossierFile(caseId, '0xaaa', 'eoa')
    vi.resetModules()
    process.env['HOME'] = fakeHome
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase(caseId)
    const nodeAaa = result.nodes.find(n => n.id === '0xaaa')
    expect(nodeAaa).toBeDefined()
    expect(nodeAaa!.entityType).toBe('eoa')
    // Other nodes without dossiers stay 'unknown'
    const nodeBbb = result.nodes.find(n => n.id === '0xbbb')
    expect(nodeBbb!.entityType).toBe('unknown')
  })

  it('merges multiple evidence files: deduplicates nodes by id', async () => {
    const caseId = 'test-case-004'
    const tx1 = [{ from: '0xaaa', to: '0xbbb', value: 100, txHash: '0x111' }]
    const tx2 = [{ from: '0xbbb', to: '0xccc', value: 50, txHash: '0x222' }]

    const makeEvidence = (seq: string, txs: object[]) => [
      '---',
      `id: ${caseId}_ev${seq}`,
      `caseId: ${caseId}`,
      'source: mcp-query',
      '---',
      '## Evidence',
      '',
      '```json',
      JSON.stringify(txs),
      '```',
    ].join('\n')

    await createEvidenceFile(caseId, `001_mcp_20260511.md`, makeEvidence('001', tx1))
    await createEvidenceFile(caseId, `002_mcp_20260511.md`, makeEvidence('002', tx2))
    vi.resetModules()
    process.env['HOME'] = fakeHome
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase(caseId)
    // Should have 3 unique nodes, not 4 (0xbbb deduped)
    const nodeIds = result.nodes.map(n => n.id)
    const uniqueIds = [...new Set(nodeIds)]
    expect(uniqueIds).toHaveLength(nodeIds.length) // no duplicates
    expect(nodeIds).toContain('0xaaa')
    expect(nodeIds).toContain('0xbbb')
    expect(nodeIds).toContain('0xccc')
    expect(result.edges).toHaveLength(2)
  })

  it('sets metadata caseId on result', async () => {
    const caseId = 'test-case-005'
    const transactions = [{ from: '0xaaa', to: '0xbbb', value: 1 }]
    const evidenceContent = [
      '---',
      `id: ${caseId}_ev001`,
      `caseId: ${caseId}`,
      'source: mcp-query',
      '---',
      '```json',
      JSON.stringify(transactions),
      '```',
    ].join('\n')
    await createEvidenceFile(caseId, '001_mcp_20260511.md', evidenceContent)
    vi.resetModules()
    process.env['HOME'] = fakeHome
    const { extractGraphFromCase } = await import('../src/viz/data-extractor.js')
    const result = await extractGraphFromCase(caseId)
    expect(result.metadata.caseId).toBe(caseId)
  })
})
