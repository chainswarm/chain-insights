import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP schema cache (MCP-02)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })

  it('loadSchema() returns null when mcp-schema.json is absent', async () => {
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    const result = await loadSchema()
    expect(result).toBeNull()
  })

  it('loadSchema() returns tools array within 24h TTL', async () => {
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    const tools = [{ name: 'trace_address', description: 'Trace address funds' }]
    await writeFile(schemaPath, JSON.stringify({ tools, cachedAt: Date.now() }), { mode: 0o600 })
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    const result = await loadSchema()
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0]!.name).toBe('trace_address')
  })

  it('loadSchema(endpoint) returns null for cache without matching endpoint', async () => {
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    const tools = [{ name: 'address_risk' }]
    await writeFile(schemaPath, JSON.stringify({ tools, cachedAt: Date.now() }), { mode: 0o600 })
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    const result = await loadSchema('http://localhost:8012/mcp')
    expect(result).toBeNull()
  })

  it('loadSchema(endpoint) returns null when cached endpoint differs', async () => {
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    const tools = [{ name: 'address_risk' }]
    await writeFile(schemaPath, JSON.stringify({
      tools,
      cachedAt: Date.now(),
      endpoint: 'http://localhost:8011/mcp',
    }), { mode: 0o600 })
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    const result = await loadSchema('http://localhost:8012/mcp')
    expect(result).toBeNull()
  })

  it('loadSchema() returns null when cachedAt is 25 hours old (TTL expired)', async () => {
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    const tools = [{ name: 'trace_address' }]
    const staleTime = Date.now() - 25 * 60 * 60 * 1000
    await writeFile(schemaPath, JSON.stringify({ tools, cachedAt: staleTime }), { mode: 0o600 })
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    const result = await loadSchema()
    expect(result).toBeNull()
  })

  it('saveSchema(tools) → loadSchema() round-trip returns same tools', async () => {
    const { saveSchema, loadSchema } = await import('../src/mcp/schema-cache.js')
    const tools = [
      { name: 'trace_address', description: 'Trace address' },
      { name: 'risk_score', description: 'Risk scoring', inputSchema: { type: 'object' } },
    ]
    await saveSchema(tools)
    const result = await loadSchema()
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result![0]!.name).toBe('trace_address')
    expect(result![1]!.name).toBe('risk_score')
    expect(result![1]!.inputSchema).toEqual({ type: 'object' })
  })

  it('saveSchema(tools, endpoint) scopes the cache to that endpoint', async () => {
    const { saveSchema, loadSchema } = await import('../src/mcp/schema-cache.js')
    const tools = [
      { name: 'topology_query' },
      { name: 'topology_query_batch' },
    ]
    await saveSchema(tools, 'http://localhost:8012/mcp')

    expect(await loadSchema('http://localhost:8012/mcp')).toEqual(tools)
    expect(await loadSchema('http://localhost:8011/mcp')).toBeNull()
  })

  it('saveSchema writes file with 0o600 permissions', async () => {
    const { saveSchema } = await import('../src/mcp/schema-cache.js')
    await saveSchema([{ name: 'test_tool' }])
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    const st = await stat(schemaPath)
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })

  it('loadSchema() propagates JSON parse errors (does not swallow them)', async () => {
    const schemaPath = join(fakeHome, '.chain-insights', 'mcp-schema.json')
    await writeFile(schemaPath, 'NOT VALID JSON', { mode: 0o600 })
    const { loadSchema } = await import('../src/mcp/schema-cache.js')
    await expect(loadSchema()).rejects.toThrow()
  })
})

describe('MCP tool table formatter (MCP-02)', () => {
  it('formatToolsTable([]) returns "No tools available."', async () => {
    const { formatToolsTable } = await import('../src/mcp/format.js')
    expect(formatToolsTable([])).toBe('No tools available.')
  })

  it('formatToolsTable renders tool name and description', async () => {
    const { formatToolsTable } = await import('../src/mcp/format.js')
    const result = formatToolsTable([{ name: 'trace-funds', description: 'Trace fund flows' }])
    expect(result).toContain('trace-funds')
    expect(result).toContain('Trace fund flows')
  })

  it('formatToolsTable pads name to 30 chars', async () => {
    const { formatToolsTable } = await import('../src/mcp/format.js')
    const result = formatToolsTable([{ name: 'short', description: 'desc' }])
    // 'short' padded to 30 chars then '  desc'
    expect(result).toContain('short' + ' '.repeat(25) + '  desc')
  })

  it('formatToolsTable truncates description at 60 chars', async () => {
    const { formatToolsTable } = await import('../src/mcp/format.js')
    const longDesc = 'A'.repeat(80)
    const result = formatToolsTable([{ name: 'tool', description: longDesc }])
    expect(result).toContain('A'.repeat(60))
    expect(result).not.toContain('A'.repeat(61))
  })

  it('formatToolsTable handles tool with no description', async () => {
    const { formatToolsTable } = await import('../src/mcp/format.js')
    const result = formatToolsTable([{ name: 'no-desc-tool' }])
    expect(result).toContain('no-desc-tool')
  })
})
