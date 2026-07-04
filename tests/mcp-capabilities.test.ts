import { describe, expect, it, vi, afterEach } from 'vitest'

describe('MCP network capabilities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches metadata networks from graph MCP root without requiring wallet payment setup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor',
        display_name: 'Bittensor',
        status: 'live',
        default: true,
        layers: {
          topology: { enabled: true },
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
      graphMcpEndpoint: 'https://staging-mcp.chain-insights.ai/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(fetchMock).toHaveBeenCalledWith(new URL('https://staging-mcp.chain-insights.ai/metadata/networks'), {
      headers: expect.any(Headers),
    })
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('X-MCP-Debug-Token')).toBe('debug-token')
    expect(headers.get('X-MCP-Test-Key')).toBe('debug-token')
    expect(headers.get('X-Chain-Insights-Test-Key')).toBe('debug-token')
    expect(headers.get('Authorization')).toBe('Bearer debug-token')
    expect(result.networks[0]?.network).toBe('bittensor')
    expect(result.networks[0]?.coverage).toEqual({
      from_block: 84,
      to_block: 7440268,
      from_timestamp: '2023-03-20T22:25:48Z',
      to_timestamp: '2026-01-31T04:26:00Z',
    })
  })

  it('merges internal Bittensor aliases into the public bittensor semantic network', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor_evm',
        display_name: 'Bittensor EVM',
        status: 'live',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        aggregations: {
          transfers: [{ level: 'daily', enabled: true }],
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }],
    }), { status: 200 }))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'https://staging-mcp.chain-insights.ai/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(result.networks).toEqual([expect.objectContaining({
      network: 'bittensor',
      display_name: 'Bittensor',
      tools: expect.objectContaining({
        aml_address_risk: 'available',
        aml_trace_victim_funds: 'available',
        aml_trace_deposit_sources: 'available',
        aml_trace_suspect_funds: 'available',
        graph_query: 'available',
        graph_query_batch: 'available',
        meta_network_capabilities: 'available',
        meta_usage_status: 'available',
        wallet_balance: 'available',
      }),
    })])
    expect(JSON.stringify(result)).not.toContain('bittensor_evm')
    expect(JSON.stringify(result)).not.toContain('aggregations')
  })

  it('passes through live/archive topology sub-layers (AC4/AC11: dual-layer capability reporting)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor',
        display_name: 'Bittensor',
        status: 'live',
        default: true,
        layers: {
          topology: {
            enabled: true,
            live: { enabled: true, coverage: { from_block: 8512012, to_block: 8513977 } },
            archive: { enabled: true, coverage: { from_block: 8512012, to_block: 8513977 } },
          },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: { graph_query: 'available', graph_query_batch: 'available' },
      }],
    }), { status: 200 }))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    const topology = result.networks[0]?.layers.topology
    // Backward-compat field preserved.
    expect(topology?.enabled).toBe(true)
    // New dual-layer fields.
    expect(topology?.live?.enabled).toBe(true)
    expect(topology?.archive?.enabled).toBe(true)
    expect(topology?.live?.coverage).toEqual({ from_block: 8512012, to_block: 8513977 })
  })

  it('includes the metadata URL when network capability fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    await expect(fetchNetworkCapabilities({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })).rejects.toThrow('network capabilities unavailable at http://localhost:8012/metadata/networks: fetch failed')
  })

  it('formats layer support and available tools for CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor',
        display_name: 'Bittensor',
        status: 'live',
        default: true,
        layers: {
          topology: { enabled: true },
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

    expect(output).toContain('Bittensor')
    expect(output).toContain('yes')
    expect(output).toContain('84..7440268 / 2023-03-20..2026-01-31')
    expect(output).toContain('aml_address_risk')
    expect(output).toContain('aml_trace_victim_funds')
    expect(output).toContain('aml_trace_deposit_sources')
    expect(output).toContain('aml_trace_suspect_funds')
    expect(output).toContain('graph_query')
    expect(output).toContain('graph_query_batch')
    expect(output).toContain('meta_network_capabilities')
    expect(output).toContain('meta_usage_status')
    expect(output).toContain('wallet_balance')
    expect(output).toContain('Dataset')
    expect(output).toContain('aml_address_risk, aml_trace_deposit_sources, aml_trace_suspect_funds')
    expect(output).toContain('aml_trace_victim_funds, graph_query, graph_query_batch')
    expect(output).toContain('meta_network_capabilities, meta_usage_status, wallet_balance')
    expect(output).not.toContain('aml_address_risk, aml_trace_deposit_sources, aml_trace_suspect_funds, aml_trace_victim_funds')
  })

  it('formats no available tools for unsupported networks', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'future_network',
        display_name: 'Future Network',
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

    expect(output).toContain('Future Network')
    expect(output).toContain('none')
  })

  it('formats partial dataset coverage without hiding missing heights', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor',
        display_name: 'Bittensor',
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

    expect(output).toContain('Bittensor')
    expect(output).toContain('2026-05-19..2026-05-20')
    expect(output).not.toContain('blocks unknown')
  })

  it('does not expose StarRocks storage metadata in CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [{
        network: 'bittensor',
        display_name: 'Bittensor',
        status: 'live',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: {},
      }],
    })

    expect(output).not.toContain('Transfers')
    expect(output).not.toContain('raw/day/month/year')
    expect(output).not.toContain('retention')
    expect(output).not.toContain('window_days')
  })
})
