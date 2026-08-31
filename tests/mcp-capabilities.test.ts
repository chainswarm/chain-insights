import { describe, expect, it, vi, afterEach } from 'vitest'

describe('MCP network capabilities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches metadata networks from graph MCP root without requiring wallet payment setup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: 'chain-insights.network-capabilities.v1',
          networks: [
            {
              network: 'robinhood',
              display_name: 'Robinhood',
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
            },
          ],
        }),
        { status: 200 }
      )
    )

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'https://mcp.example.test/',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(fetchMock).toHaveBeenCalledWith(new URL('https://mcp.example.test/metadata/networks'), {
      headers: expect.any(Headers),
    })
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('X-MCP-Debug-Token')).toBe('debug-token')
    expect(headers.get('X-MCP-Test-Key')).toBe('debug-token')
    expect(headers.get('X-Chain-Insights-Test-Key')).toBe('debug-token')
    expect(headers.get('Authorization')).toBe('Bearer debug-token')
    expect(result.networks[0]?.network).toBe('robinhood')
    expect(result.networks[0]?.layers).toEqual({})
    expect(result.networks[0]?.coverage).toEqual({
      from_block: 84,
      to_block: 7440268,
      from_timestamp: '2023-03-20T22:25:48Z',
      to_timestamp: '2026-01-31T04:26:00Z',
    })
  })

  it('mirrors every GraphRAG network and overlays the seven public CIA tools', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: 'chain-insights.network-capabilities.v1',
          networks: [
            {
              network: 'bittensor',
              display_name: 'Bittensor',
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
            },
            {
              network: 'robinhood',
              display_name: 'Robinhood',
              status: 'live',
              layers: {
                topology: { enabled: true },
                facts: { enabled: true },
                risk: { enabled: false },
              },
              tools: {
                graph_query: 'available',
                graph_query_batch: 'available',
              },
            },
          ],
        }),
        { status: 200 }
      )
    )

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'https://mcp.example.test/',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    const publicTools = {
      aml_address_risk: 'available',
      graph_query: 'available',
      graph_query_batch: 'available',
      meta_network_capabilities: 'available',
      meta_usage_status: 'available',
      meta_help: 'available',
      wallet_balance: 'available',
    }
    expect(result.networks).toEqual([
      expect.objectContaining({
        network: 'bittensor',
        display_name: 'Bittensor',
        layers: {},
        tools: publicTools,
      }),
      expect.objectContaining({
        network: 'robinhood',
        display_name: 'Robinhood',
        layers: {},
        tools: publicTools,
      }),
    ])
    expect(result.networks).toHaveLength(2)
    expect(Object.keys(result.networks[0]?.tools ?? {})).toEqual([
      'aml_address_risk',
      'graph_query',
      'graph_query_batch',
      'meta_network_capabilities',
      'meta_usage_status',
      'meta_help',
      'wallet_balance',
    ])
    expect(JSON.stringify(result)).not.toContain('aggregations')
  })

  it('lists only bittensor when GraphRAG advertises only bittensor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: 'chain-insights.network-capabilities.v1',
          networks: [
            {
              network: 'bittensor',
              display_name: 'Bittensor',
              status: 'live',
              layers: { topology: { enabled: true } },
              tools: { graph_query: 'available' },
            },
          ],
        }),
        { status: 200 }
      )
    )

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(result.networks).toHaveLength(1)
    expect(result.networks[0]?.network).toBe('bittensor')
    expect(result.networks[0]?.layers).toEqual({})
    expect(result.networks[0]?.tools).toMatchObject({
      aml_address_risk: 'available',
      graph_query: 'available',
    })
  })

  it('returns an empty list when GraphRAG advertises no networks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: 'chain-insights.network-capabilities.v1',
          networks: [],
        }),
        { status: 200 }
      )
    )

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(result.networks).toEqual([])
  })

  it('drops per-layer topology/facts/risk passthrough (one graph, no layer rows)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: 'chain-insights.network-capabilities.v1',
          networks: [
            {
              network: 'robinhood',
              display_name: 'Robinhood',
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
            },
          ],
        }),
        { status: 200 }
      )
    )

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = await fetchNetworkCapabilities({
      graphMcpEndpoint: 'http://localhost:8012/mcp',
      graphMcpMode: 'debug',
      graphMcpAuthToken: 'debug-token',
    })

    expect(result.networks[0]?.layers).toEqual({})
    expect(JSON.stringify(result)).not.toContain('8512012')
    expect(JSON.stringify(result)).not.toContain('topology')
  })

  it('includes the metadata URL when network capability fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))

    const { fetchNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    await expect(
      fetchNetworkCapabilities({
        graphMcpEndpoint: 'http://localhost:8012/mcp',
        graphMcpMode: 'debug',
        graphMcpAuthToken: 'debug-token',
      })
    ).rejects.toThrow(
      'network capabilities unavailable at http://localhost:8012/metadata/networks: fetch failed'
    )
  })

  it('formats layer support and available tools for CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [
        {
          network: 'robinhood',
          display_name: 'Robinhood',
          status: 'live',
          default: true,
          layers: {},
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
        },
      ],
    })

    expect(output).toContain('Robinhood')
    expect(output).toContain('84..7440268 / 2023-03-20..2026-01-31')
    expect(output).toContain('aml_address_risk')
    expect(output).toContain('graph_query')
    expect(output).toContain('graph_query_batch')
    expect(output).toContain('meta_network_capabilities')
    expect(output).toContain('meta_usage_status')
    expect(output).toContain('meta_help')
    expect(output).toContain('wallet_balance')
    expect(output).toContain('Dataset')
    expect(output).toContain('aml_address_risk, graph_query, graph_query_batch')
    expect(output).toContain('meta_help, meta_network_capabilities, meta_usage_status')
    expect(output).toContain('wallet_balance')
    expect(output).not.toContain('aml_trace')
    expect(output.split('\n')[0]).toBe(
      'Network'.padEnd(14) + '  ' + 'Dataset'.padEnd(38) + '  ' + 'Chain Insights tools'.padEnd(64)
    )
    expect(output).not.toContain('Topology')
    expect(output).not.toContain('Facts')
    expect(output).not.toContain('Risk')
  })

  it('selects a network by identifier without changing the advertised document', async () => {
    const { findNetworkCapability } = await import('../src/mcp/capabilities.js')

    const document = {
      schema: 'chain-insights.network-capabilities.v1' as const,
      networks: [
        {
          network: 'robinhood',
          display_name: 'Robinhood',
          status: 'live',
          layers: {},
          tools: {},
        },
      ],
    }

    expect(findNetworkCapability(document, ' Robinhood ')).toBe(document.networks[0])
    expect(findNetworkCapability(document, 'missing')).toBeUndefined()
  })

  it('formats a compact user network overview without duplicating the tool matrix', async () => {
    const { formatNetworkOverview } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkOverview({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [
        {
          network: 'robinhood',
          display_name: 'Robinhood Chain',
          status: 'live',
          layers: {},
          coverage: {
            from_block: 84,
            to_block: 7440268,
            from_timestamp: '2023-03-20T22:25:48Z',
            to_timestamp: '2026-01-31T04:26:00Z',
          },
          tools: {},
        },
      ],
    })

    expect(output).toContain('Robinhood Chain')
    expect(output).toContain('live')
    expect(output).toContain('84..7440268 / 2023-03-20..2026-01-31')
    expect(output).not.toContain('Chain Insights tools')
    expect(output).not.toContain('graph_query')
  })

  it('formats one network as a readable detail table', async () => {
    const { formatNetworkCapability } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapability({
      network: 'robinhood',
      display_name: 'Robinhood',
      status: 'live',
      default: true,
      layers: {},
      coverage: {
        from_block: 84,
        to_block: 7440268,
        from_timestamp: '2023-03-20T22:25:48Z',
        to_timestamp: '2026-01-31T04:26:00Z',
      },
      tools: {
        graph_query: 'available',
      },
    })

    expect(output).toContain('Network')
    expect(output).toContain('Robinhood')
    expect(output).toContain('Identifier')
    expect(output).toContain('robinhood')
    expect(output).toContain('Status')
    expect(output).toContain('live (default)')
    expect(output).toContain('Dataset')
    expect(output).toContain('84..7440268 / 2023-03-20..2026-01-31')
    expect(output).toContain('Available tools')
    expect(output).toContain('aml_address_risk')
    expect(output).not.toContain('undefined')
  })

  it('overlays CIA tools on every advertised network in CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [
        {
          network: 'future_network',
          display_name: 'Future Network',
          status: 'unavailable',
          layers: {},
          tools: {
            graph_query: 'unavailable',
            graph_query_batch: 'unavailable',
          },
        },
      ],
    })

    expect(output).toContain('Future Network')
    expect(output).toContain('aml_address_risk')
    expect(output).toContain('graph_query')
    expect(output).not.toContain('none')
  })

  it('formats partial dataset coverage without hiding missing heights', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [
        {
          network: 'robinhood',
          display_name: 'Robinhood',
          status: 'live',
          layers: {},
          coverage: {
            from_timestamp: '2026-05-19T00:00:00Z',
            to_timestamp: '2026-05-20T00:00:00Z',
          },
          tools: {
            graph_query: 'available',
            graph_query_batch: 'available',
          },
        },
      ],
    })

    expect(output).toContain('Robinhood')
    expect(output).toContain('2026-05-19..2026-05-20')
    expect(output).not.toContain('blocks unknown')
  })

  it('does not expose StarRocks storage metadata in CLI output', async () => {
    const { formatNetworkCapabilities } = await import('../src/mcp/capabilities.js')

    const output = formatNetworkCapabilities({
      schema: 'chain-insights.network-capabilities.v1',
      networks: [
        {
          network: 'robinhood',
          display_name: 'Robinhood',
          status: 'live',
          layers: {},
          tools: {},
        },
      ],
    })

    expect(output).not.toContain('Transfers')
    expect(output).not.toContain('raw/day/month/year')
    expect(output).not.toContain('retention')
    expect(output).not.toContain('window_days')
  })
})
