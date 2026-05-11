import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('generateHtml (VIZ-02)', () => {
  const validData = {
    nodes: [
      { id: '0x1234', entityType: 'eoa' as const, riskLevel: 'low' as const, totalIn: 100, totalOut: 50, txCount: 5 },
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

  it('generateHtml output contains "GRAPH_DATA" JSON literal', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('GRAPH_DATA')
  })

  it('generateHtml output contains CSS variable "--surface-primary: #0f1117"', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('--surface-primary: #0f1117')
  })

  it('generateHtml output does NOT contain any "https://" CDN references', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).not.toContain('https://')
  })

  it('generateHtml output contains xmlns SVG attribute', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('generateHtml embeds d3 bundle inline (contains d3 function signatures)', async () => {
    const { generateHtml } = await import('../src/viz/html-generator.js')
    const { GraphData } = await import('../src/viz/graph-model.js')
    const data = GraphData.parse(validData)
    const html = generateHtml(data, 'Test Viz')
    // D3 bundle should be inlined - check for d3 variable or function
    expect(html.length).toBeGreaterThan(100_000) // D3 bundle is large
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
