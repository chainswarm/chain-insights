import { describe, expect, it } from 'vitest'
import { McpToolError } from '../src/mcp/print-result.js'
import {
  PUBLIC_MCP_TOOL_ALLOWED_ARGS,
  PUBLIC_MCP_TOOL_REQUIRED_ARGS,
  assertPublicMcpToolName,
  formatMcpCallError,
  isHiddenRemoteToolName,
  visibleRemoteTools,
} from '../src/mcp/tool-visibility.js'

describe('aml_address_risk is a local tool of the proxy, and address_risk stays hidden', () => {
  it('is no hidden name; the retired remote address_risk still is', () => {
    expect(isHiddenRemoteToolName('aml_address_risk')).toBe(false)
    expect(isHiddenRemoteToolName('address_risk')).toBe(true)
    expect(
      visibleRemoteTools([
        { name: 'address_risk' },
        { name: 'graph_query' },
        { name: 'graph_query_batch' },
      ]).map((tool) => tool.name)
    ).toEqual(['graph_query', 'graph_query_batch'])
    expect(() => assertPublicMcpToolName('aml_address_risk')).not.toThrow()
    expect(() => assertPublicMcpToolName('address_risk')).toThrow(
      "MCP tool 'address_risk' is not exposed by Chain Insights."
    )
  })

  it('has a public argument contract: network, address and surroundings', () => {
    expect(PUBLIC_MCP_TOOL_REQUIRED_ARGS).not.toHaveProperty('aml_address_risk')
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['aml_address_risk']).toEqual([
      'network',
      'address',
      'surroundings',
    ])
  })
})

describe('MCP CLI error guidance', () => {
  it.each(['MCP error -32602: unknown tool "unknown"', 'Tool unknown not found'])(
    'turns an unknown remote tool error into a catalog-directed message: %s',
    (message) => {
      expect(formatMcpCallError('unknown', new Error(message))).toBe(
        'Unknown MCP tool "unknown". Run `cia mcp tools --refresh` to list available tools.'
      )
    }
  )

  it('preserves non-tool errors', () => {
    expect(formatMcpCallError('graph_query', new Error('Graph endpoint unavailable'))).toBe(
      'Graph endpoint unavailable'
    )
  })

  it('keeps the catalog-directed message for an error reply that names an unknown tool and has no envelope', () => {
    expect(formatMcpCallError('unknown', new McpToolError('Tool unknown not found'))).toBe(
      'Unknown MCP tool "unknown". Run `cia mcp tools --refresh` to list available tools.'
    )
  })

  it('prints a tool error with an envelope as the server text and one code line', () => {
    const err = new McpToolError(
      'facts_busy: no free slot for this read in 2s. Retry after a short wait.',
      {
        code: 'facts_busy',
        class: 'capacity',
        fix: 'Retry after a short wait.',
      }
    )
    expect(formatMcpCallError('graph_query', err)).toBe(
      'facts_busy: no free slot for this read in 2s. Retry after a short wait.\n  code facts_busy · class capacity · Retry after a short wait.'
    )
  })
})

describe('meta_dex_lookup admits the address form through the CLI', () => {
  it('lists address beside name, so `cia mcp call meta_dex_lookup address=0x…` is not refused before the proxy runs', () => {
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['meta_dex_lookup']).toEqual(['network', 'name', 'address', 'pools'])
  })
})
