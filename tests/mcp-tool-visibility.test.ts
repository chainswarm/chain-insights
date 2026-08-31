import { describe, expect, it } from 'vitest'
import { formatMcpCallError } from '../src/mcp/tool-visibility.js'

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
})
