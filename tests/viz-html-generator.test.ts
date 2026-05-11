import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('generateHtml (VIZ-02) — graph.html template', () => {
  const validData = {
    nodes: [
      { id: '0x1234', label: 'Source Wallet', entityType: 'eoa' as const, riskLevel: 'low' as const, totalIn: 100, totalOut: 50, txCount: 5 },
    ],
    edges: [{ source: '0x1234', target: '0xabcd', value: 10 }],
    metadata: { generatedAt: '2024-01-01T00:00:00Z', title: 'Test' },
  }

  it('generateHtml produces string starting with "<!DOCTYPE html>"', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toMatch(/^<!DOCTYPE html>/)
  })

  it('generateHtml output contains at least 3 <script> tags', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    const scriptMatches = html.match(/<script/g)
    expect(scriptMatches).not.toBeNull()
    expect(scriptMatches!.length).toBeGreaterThanOrEqual(3)
  })

  it('generateHtml output contains INLINE_DATA with transformed graph data', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('INLINE_DATA')
    expect(html).toContain('"address":"0x1234"')
    expect(html).toContain('"from_address":"0x1234"')
  })

  it('generateHtml output uses Chain Insights brand CSS variables', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('--background-color')
    expect(html).toContain('--gold-1000')
  })

  it('generateHtml output does NOT contain external CDN script/link src references', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//i)
    expect(html).not.toMatch(/<link[^>]+href=["']https?:\/\//i)
  })

  it('generateHtml embeds D3 bundle inline (self-contained)', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html.length).toBeGreaterThan(100_000)
    expect(html).toContain('d3.forceSimulation')
  })

  it('generateHtml output contains canvas element (canvas-based renderer)', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('<canvas id="c"')
  })
})

describe('transformToGraphHtml (data schema mapping)', () => {
  it('maps GraphData nodes to graph.html address-based format', async () => {
    const { transformToGraphHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse({
      nodes: [
        { id: '0x1234', label: 'Binance', entityType: 'exchange', riskLevel: 'medium', totalIn: 500, totalOut: 480, txCount: 15 },
        { id: '0xabcd', entityType: 'mixer', riskLevel: 'critical', totalIn: 100, totalOut: 90, txCount: 3 },
      ],
      edges: [{ source: '0x1234', target: '0xabcd', value: 200 }],
      metadata: { generatedAt: '2024-01-01T00:00:00Z', title: 'Test Flow' },
    })
    const result = transformToGraphHtml(data)
    expect(result.nodes[0].address).toBe('0x1234')
    expect(result.nodes[0].labels).toEqual(['Binance'])
    expect(result.nodes[0].role).toBe('exchange')
    expect(result.nodes[0].risk_level).toBe('medium')
    expect(result.nodes[0].flow_in_usd).toBe(500)
    expect(result.nodes[1].role).toBe('intermediary')
    expect(result.nodes[1].risk_level).toBe('critical')
    expect(result.edges[0].from_address).toBe('0x1234')
    expect(result.edges[0].to_address).toBe('0xabcd')
    expect(result.edges[0].usd_amount).toBe(200)
    expect(result.edges[0].type).toBe('FLOWS_TO')
  })

  it('maps unknown riskLevel to null', async () => {
    const { transformToGraphHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse({
      nodes: [{ id: '0x1234', entityType: 'unknown', riskLevel: 'unknown', totalIn: 0, totalOut: 0, txCount: 0 }],
      edges: [],
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const result = transformToGraphHtml(data)
    expect(result.nodes[0].risk_level).toBeNull()
    expect(result.nodes[0].role).toBeNull()
  })
})

describe('writeVizHtml and generateVisualization (VIZ-02)', () => {
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

  it('writeVizHtml without caseId writes to ~/.chain-insights/viz/ (standalone path)', async () => {
    const { writeVizHtml } = await import('../src/viz/html-generator.js')
    const filePath = await writeVizHtml('test_id', '<html>test</html>')
    expect(filePath).toContain(join('.chain-insights', 'viz', 'test_id.html'))
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('<html>test</html>')
  })

  it('writeVizHtml without caseId writes to correct directory path', async () => {
    const { writeVizHtml } = await import('../src/viz/html-generator.js')
    const filePath = await writeVizHtml('standalone_123', '<html>standalone</html>')
    expect(filePath).toContain(join(fakeHome, '.chain-insights', 'viz'))
    expect(filePath).not.toContain('cases')
  })

  it('writeVizHtml with caseId writes to ~/.chain-insights/cases/<caseId>/viz/ (per-case path per CONTEXT.md)', async () => {
    const { writeVizHtml } = await import('../src/viz/html-generator.js')
    const filePath = await writeVizHtml('CASE-001_12345', '<html>case test</html>', 'CASE-001')
    expect(filePath).toContain(join('cases', 'CASE-001', 'viz', 'CASE-001_12345.html'))
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('<html>case test</html>')
  })

  it('writeVizHtml with caseId returned path contains /cases/<caseId>/viz/', async () => {
    const { writeVizHtml } = await import('../src/viz/html-generator.js')
    const filePath = await writeVizHtml('test_viz', '<html></html>', 'CASE-001')
    expect(filePath).toContain(join('cases', 'CASE-001', 'viz'))
  })

  it('writeVizHtml creates parent directories recursively', async () => {
    const { writeVizHtml } = await import('../src/viz/html-generator.js')
    const filePath = await writeVizHtml('new_viz', '<html>new</html>')
    const st = await stat(filePath)
    expect(st.isFile()).toBe(true)
  })

  it('generateVisualization with dataFile writes .html to ~/.chain-insights/viz/ and returns vizId starting with "adhoc_"', async () => {
    const testData = JSON.stringify({
      nodes: [{ id: '0x1234', entityType: 'eoa', riskLevel: 'low', totalIn: 100, totalOut: 50, txCount: 5 }],
      edges: [{ source: '0x1234', target: '0xabcd', value: 10 }],
      metadata: { generatedAt: '2024-01-01T00:00:00Z' },
    })
    const dataFile = join(fakeHome, 'test-data.json')
    await writeFile(dataFile, testData)

    const { generateVisualization } = await import('../src/viz/index.js')
    const result = await generateVisualization({ dataFile })

    expect(result.vizId).toMatch(/^adhoc_/)
    expect(result.htmlPath).toContain(join('.chain-insights', 'viz'))
    const content = await readFile(result.htmlPath, 'utf-8')
    expect(content).toMatch(/^<!DOCTYPE html>/)
  })
})
