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
          topology_labels: { enabled: true, retention: { mode: 'rolling_window', window_days: 365 } },
          risk_intelligence: { enabled: false },
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
          track_funds: 'available',
          address_risk: 'unavailable',
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

  it('formats retention and layer support for CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology_labels: { enabled: true, retention: { mode: 'rolling_window', window_days: 365 } },
          risk_intelligence: { enabled: false },
        },
        tools: {},
        coverage: { blocks_behind_tip: 12 },
      }],
    })

    expect(output).toContain('TRON')
    expect(output).toContain('1y rolling')
    expect(output).toContain('12 blocks behind')
  })

  it('formats expanding-then-rolling retention for new network rollouts', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology_labels: {
            enabled: true,
            retention: {
              mode: 'expanding_then_rolling',
              window_days: 730,
              started_at: '2026-05-20T00:00:00Z',
              rolls_after_at: '2028-05-19T00:00:00Z',
            },
          },
          risk_intelligence: { enabled: false },
        },
        tools: {},
      }],
    })

    expect(output).toContain('growing to 2y')
  })

  it('formats transfer aggregation materializations for CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'tron',
        display_name: 'TRON',
        status: 'live',
        layers: {
          topology_labels: { enabled: true, retention: { mode: 'unknown' } },
          risk_intelligence: { enabled: false },
        },
        tools: {},
        aggregations: {
          transfers: [
            { level: 'raw', source: 'core_transfers', grain: 'event', enabled: true },
            { level: 'daily', source: 'core_money_flows_daily', grain: 'day', enabled: true, derived_from: 'raw' },
            { level: 'monthly', source: 'core_money_flows_monthly', grain: 'month', enabled: true, derived_from: 'daily' },
            { level: 'yearly', source: 'core_money_flows_yearly', grain: 'year', enabled: true, derived_from: 'monthly' },
          ],
        },
      }],
    })

    expect(output).toContain('raw/day/month/year')
  })
})
