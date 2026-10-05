import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(result.networks[0]?.layers).toEqual({
      topology: { enabled: true },
      facts: { enabled: true },
      risk: { enabled: false },
    })
    expect(result.networks[0]?.coverage).toEqual({
      from_block: 84,
      to_block: 7440268,
      from_timestamp: '2023-03-20T22:25:48Z',
      to_timestamp: '2026-01-31T04:26:00Z',
    })
    expect(result.networks[0]?.tools).toEqual({
      graph_query: 'available',
      graph_query_batch: 'available',
    })
  })

  it('mirrors every GraphRAG network with only its advertised tools', async () => {
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
                graph_query_batch: 'unavailable',
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

    expect(result.networks).toEqual([
      expect.objectContaining({
        network: 'bittensor',
        display_name: 'Bittensor',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
      }),
      expect.objectContaining({
        network: 'robinhood',
        display_name: 'Robinhood',
        layers: {
          topology: { enabled: true },
          facts: { enabled: true },
          risk: { enabled: false },
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'unavailable',
        },
      }),
    ])
    expect(result.networks).toHaveLength(2)
    expect(Object.keys(result.networks[0]?.tools ?? {})).toEqual([
      'graph_query',
      'graph_query_batch',
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
    expect(result.networks[0]?.layers).toEqual({ topology: { enabled: true } })
    expect(result.networks[0]?.tools).toEqual({
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

  it('passes the layers through exactly as the server sent them, coverage rows included', async () => {
    const layers = {
      topology: {
        enabled: true,
        live: { enabled: true, coverage: { from_block: 8512012, to_block: 8513977 } },
        archive: { enabled: true, coverage: { from_block: 8512012, to_block: 8513977 } },
      },
      facts: { enabled: true, relationships: ['TRANSFER', 'SWAP'] },
      risk: { enabled: false },
    }
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
              layers,
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

    expect(result.networks[0]?.layers).toEqual(layers)
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
    expect(output).toContain('graph_query')
    expect(output).toContain('graph_query_batch')
    expect(output).toContain('Dataset')
    expect(output).toContain('graph_query, graph_query_batch')
    expect(output).not.toContain('aml_address_risk')
    expect(output).not.toContain('meta_network_capabilities')
    expect(output).not.toContain('meta_usage_status')
    expect(output).not.toContain('meta_help')
    expect(output).not.toContain('wallet_balance')
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
    expect(output).toContain('graph_query')
    expect(output).not.toContain('aml_address_risk')
    expect(output).not.toContain('undefined')
  })

  it('does not show tools a network did not advertise in CLI output', async () => {
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
    expect(output).toContain('none')
    expect(output).not.toContain('aml_address_risk')
    expect(output).not.toContain('graph_query')
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
  it('passes the coverage floor, every lane and the graph progress through', async () => {
    const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = mirrorGraphNetworkCapabilities({
      networks: [
        {
          network: 'robinhood',
          status: 'live',
          tools: {},
          coverage: { to_block: 33750000, complete_through_block: 11746537 },
          lane_progress: [
            { lane: 'core_dex_follow', height: 11746537 },
            { lane: 'core_smart_account_follow', height: null },
            { lane: '', height: 5 },
            'junk',
          ],
          graph_progress: {
            complete_through_block: 11341125,
            layers: [
              { layer: 'flows', position: 32111999 },
              { layer: 'dex_swaps', position: 11341125 },
              { layer: 'broken' },
            ],
          },
        },
      ],
    })

    const network = result.networks[0]
    expect(network?.coverage?.complete_through_block).toBe(11746537)
    expect(network?.coverage?.chain_tip_block).toBeUndefined()
    expect(network?.lane_progress).toEqual([
      { lane: 'core_dex_follow', height: 11746537 },
      { lane: 'core_smart_account_follow', height: null },
    ])
    expect(network?.graph_progress).toEqual({
      complete_through_block: 11341125,
      layers: [
        { layer: 'flows', position: 32111999 },
        { layer: 'dex_swaps', position: 11341125 },
      ],
    })
  })

  it('leaves the graph progress out when GraphRAG sends none or a malformed one', async () => {
    const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
    const result = mirrorGraphNetworkCapabilities({
      networks: [
        { network: 'robinhood', status: 'live', tools: {} },
        {
          network: 'base',
          status: 'live',
          tools: {},
          graph_progress: { layers: 'x' },
          lane_progress: 7,
        },
      ],
    })

    expect(result.networks[0]?.graph_progress).toBeUndefined()
    expect(result.networks[0]?.lane_progress).toBeUndefined()
    expect(result.networks[1]?.graph_progress).toBeUndefined()
    expect(result.networks[1]?.lane_progress).toBeUndefined()
  })

  // The public reply of 2026-10-05, saved once. The mirror repeats the layer
  // blocks member for member: it adds no field, invents no default and drops no
  // member, and a block the server did not send stays absent.
  describe('the layer blocks of the public reply', () => {
    type Reply = { networks: Array<Record<string, unknown>> }
    const reply = JSON.parse(
      readFileSync(
        join(process.cwd(), 'tests/fixtures/capabilities-robinhood-20261005.json'),
        'utf8'
      )
    ) as Reply
    const sent = reply.networks.find((candidate) => candidate['network'] === 'robinhood')!

    it('keeps layers and chain_admission equal to what the server sent', async () => {
      const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
      const mirrored = mirrorGraphNetworkCapabilities(reply).networks[0]!

      expect(Object.keys(sent['layers'] as object).length).toBeGreaterThan(0)
      expect(mirrored.layers).toEqual(sent['layers'])
      expect(mirrored.chain_admission).toEqual(sent['chain_admission'])
    })

    it('shows both blocks in the document that cia networks prints as JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(reply), { status: 200 })
      )
      const { fetchNetworkCapabilities, findNetworkCapability } =
        await import('../src/mcp/capabilities.js')
      const document = await fetchNetworkCapabilities({
        graphMcpEndpoint: 'https://mcp.example.test/',
        graphMcpMode: 'debug',
      })
      const printed = JSON.parse(
        JSON.stringify(findNetworkCapability(document, 'robinhood'), null, 2)
      ) as Record<string, unknown>

      expect(printed['layers']).toEqual(sent['layers'])
      expect(printed['chain_admission']).toEqual(sent['chain_admission'])
    })

    it('leaves a block the server did not send absent, never empty', async () => {
      const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
      const mirrored = mirrorGraphNetworkCapabilities(reply).networks[0]!

      expect(sent).not.toHaveProperty('topology_admission')
      expect(sent).not.toHaveProperty('facts_admission')
      expect(mirrored).not.toHaveProperty('topology_admission')
      expect(mirrored).not.toHaveProperty('facts_admission')

      const bare = mirrorGraphNetworkCapabilities({
        networks: [{ network: 'robinhood', status: 'live', tools: {} }],
      }).networks[0]!
      expect(bare).not.toHaveProperty('layers')
      expect(bare).not.toHaveProperty('chain_admission')
    })

    it('passes topology_admission and facts_admission through when the server sends them', async () => {
      const topologyAdmission = { rules_version: '1', max_hops_per_path: 5, max_limit: 5000 }
      const factsAdmission = { rules_version: '1', window_days: 1, max_rows: 200, max_hops: 1 }
      const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
      const mirrored = mirrorGraphNetworkCapabilities({
        networks: [
          {
            ...sent,
            topology_admission: topologyAdmission,
            facts_admission: factsAdmission,
          },
        ],
      }).networks[0]!

      expect(mirrored.topology_admission).toEqual(topologyAdmission)
      expect(mirrored.facts_admission).toEqual(factsAdmission)
    })

    it('does not take a block that is not an object', async () => {
      const { mirrorGraphNetworkCapabilities } = await import('../src/mcp/capabilities.js')
      const mirrored = mirrorGraphNetworkCapabilities({
        networks: [
          {
            network: 'robinhood',
            status: 'live',
            tools: {},
            layers: 'x',
            chain_admission: [1],
            topology_admission: null,
            facts_admission: 7,
          },
        ],
      }).networks[0]!

      for (const key of ['layers', 'chain_admission', 'topology_admission', 'facts_admission']) {
        expect(mirrored, key).not.toHaveProperty(key)
      }
    })
  })
})
