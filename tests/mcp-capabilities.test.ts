import { describe, expect, it, vi, afterEach } from 'vitest'

describe('MCP network capabilities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches metadata networks from graph MCP root without requiring wallet payment setup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology: { enabled: true, retention: { mode: 'rolling_window', window_days: 365 } },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        coverage: {
          from_block: 84,
          to_block: 7440268,
          from_timestamp: '2023-03-20T22:25:48Z',
          to_timestamp: '2026-01-31T04:26:00Z',
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }],
    }), { status: 200 }))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      mcpEndpoint: 'https://legacy.example.test/mcp',
      graphMcpEndpoint: 'https://staging-mcp.chain-insights.ai/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
      mcpAuthToken: '',
    })

    expect(fetchMock).toHaveBeenCalledWith(new URL('https://staging-mcp.chain-insights.ai/metadata/networks'), {
      headers: expect.any(Headers),
    })
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('X-MCP-Debug-Token')).toBe('debug-token')
    expect(result.networks[0]?.network).toBe('tron')
  })

  it('includes the metadata URL when network capability fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    await expect(fetchNetworkCapabilities({
      mcpEndpoint: 'https://legacy.example.test/mcp',
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
      mcpAuthToken: '',
    })).rejects.toThrow('network capabilities unavailable at http://localhost:8012/metadata/networks: fetch failed')
  })

  it('formats layer support and available tools for CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology: { enabled: true, retention: { mode: 'rolling_window', window_days: 365 } },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        coverage: {
          from_block: 84,
          to_block: 7440268,
          from_timestamp: '2023-03-20T22:25:48Z',
          to_timestamp: '2026-01-31T04:26:00Z',
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }],
    })

    expect(output).toContain('TRON')
    expect(output).toContain('yes')
    expect(output).toContain('84..7440268 / 2023-03-20..2026-01-31')
    expect(output).toContain('graph_query, graph_query_batch')
  })

  it('formats no available tools for unsupported networks', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'base',
        display_name: 'Base',
        status: 'unavailable',
        layers: {
          topology: { enabled: false },
          facts: { enabled: false },
          risk: { enabled: false },
        },
        tools: {
          graph_query: 'unavailable',
          graph_query_batch: 'unavailable',
        },
      }],
    })

    expect(output).toContain('Base')
    expect(output).toContain('none')
  })

  it('formats partial dataset coverage without hiding missing heights', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        coverage: {
          from_timestamp: '2026-05-19T00:00:00Z',
          to_timestamp: '2026-05-20T00:00:00Z',
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }],
    })

    expect(output).toContain('blocks unknown / 2026-05-19..2026-05-20')
  })

  it('does not expose StarRocks storage materializations in CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology: { enabled: true, retention: { mode: 'unknown' } },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: {},
      }],
    })

    expect(output).not.toContain('Transfers')
    expect(output).not.toContain('raw/day/month/year')
  })
})
