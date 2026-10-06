import { describe, it, expect, vi, afterEach } from 'vitest'
import { McpToolError, formatMcpTextContent, printMcpTextContent } from '../src/mcp/print-result.js'

describe('printMcpTextContent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prints text content lines on a successful result', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    printMcpTextContent({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    })
    expect(log).toHaveBeenCalledWith('hello')
    expect(log).toHaveBeenCalledWith('world')
  })

  it('renders graph query JSON as a readable result table by default', () => {
    const result = JSON.stringify({
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      facts: {
        query: {
          count: 2,
          billable_units: 2,
          elapsed_ms: 7,
          truncated: false,
          results: [
            { address: '0xabc', tx_count: 3 },
            { address: '0xdef', tx_count: 4 },
          ],
        },
      },
      subject: { network: 'robinhood' },
    })

    const formatted = formatMcpTextContent(result, 'graph_query')

    expect(formatted).toContain('Tool: graph_query')
    expect(formatted).toContain('Network: robinhood')
    expect(formatted).toContain('Rows: 2')
    expect(formatted).toContain('Billed units: 2')
    expect(formatted).toContain('0xabc')
    expect(formatted).toContain('0xdef')
    expect(formatted).not.toContain('"schema"')
  })

  it('handles sparse graph metadata and tabular values', () => {
    const result = JSON.stringify({
      facts: {
        subject: { network: 'robinhood' },
        query: {
          results: [{ address: null, active: false, metadata: { source: 'test' } }, 'ignored'],
        },
      },
    })

    const formatted = formatMcpTextContent(result)

    expect(formatted).toContain('Tool: MCP result')
    expect(formatted).toContain('Network: robinhood')
    expect(formatted).toContain('Rows: 1')
    expect(formatted).toContain('active')
    expect(formatted).toContain('{"source":"test"}')
  })

  it('renders batch query errors and empty results', () => {
    const result = JSON.stringify({
      facts: {
        queries: [
          null,
          { id: '', results: 'invalid', error: 'partial failure' },
          { count: 0, results: [] },
        ],
      },
    })

    const formatted = formatMcpTextContent(result, 'graph_query_batch')

    expect(formatted).toContain('Tool: graph_query_batch')
    expect(formatted).toContain('Queries: 3')
    expect(formatted).toContain('Error: partial failure')
    expect(formatted).toContain('[query]')
    expect(formatted).toContain('Rows: 0')
    expect(formatted).toContain('Results: none')
  })

  it('preserves plain text and formats non-graph JSON', () => {
    expect(formatMcpTextContent('not json')).toBe('not json')
    expect(formatMcpTextContent('{"ok":true}')).toBe('{\n  "ok": true\n}')
    expect(formatMcpTextContent('true')).toBe('true')
    expect(formatMcpTextContent('null')).toBe('')
  })

  it('pretty-prints JSON when JSON output is requested', () => {
    const result = '{"schema":"chain-insights.result.v1","facts":{"ok":true}}'

    expect(formatMcpTextContent(result, 'graph_query', { json: true })).toBe(
      '{\n  "schema": "chain-insights.result.v1",\n  "facts": {\n    "ok": true\n  }\n}'
    )
  })

  it('throws the joined error text when the result is an error', () => {
    expect(() =>
      printMcpTextContent({
        isError: true,
        content: [{ type: 'text', text: 'query failed: bad syntax' }],
      })
    ).toThrow(/query failed: bad syntax/)
  })

  it('throws a generic message when the error result has no text', () => {
    expect(() => printMcpTextContent({ isError: true, content: [] })).toThrow(/error/i)
  })

  // The graph server answers a refused or killed query as a tool error: the
  // text a plain client reads, and beside it structuredContent.error_detail with
  // the code, the rule, the class, the fix and a working example. The text below
  // is the server's own text for a switched-off chain layer.
  const CHAIN_OFF_TEXT =
    'chain_unavailable: the chain layer is switched off. Check chain_admission.enabled in network_capabilities.'
  const CHAIN_OFF_DETAIL = {
    code: 'chain_unavailable',
    rule: 'layer_off',
    class: 'failed',
    fix: 'Check chain_admission.enabled in network_capabilities.',
    example: 'USE chain MATCH (h:Head) RETURN h.block_height',
  }

  it('throws an McpToolError that keeps the server text and the error_detail of the reply', () => {
    const attempt = (): void =>
      printMcpTextContent({
        isError: true,
        content: [{ type: 'text', text: CHAIN_OFF_TEXT }],
        structuredContent: {
          schema: 'chain-insights.result.v1',
          tool: 'graph_query',
          error_detail: CHAIN_OFF_DETAIL,
        },
      })
    let thrown: unknown
    try {
      attempt()
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(McpToolError)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as McpToolError).message).toBe(CHAIN_OFF_TEXT)
    expect((thrown as McpToolError).errorDetail).toEqual(CHAIN_OFF_DETAIL)
  })

  it('throws an McpToolError with no errorDetail when the reply carries none', () => {
    let thrown: unknown
    try {
      printMcpTextContent({
        isError: true,
        content: [{ type: 'text', text: 'query failed: bad syntax' }],
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(McpToolError)
    expect((thrown as McpToolError).message).toBe('query failed: bad syntax')
    expect((thrown as McpToolError).errorDetail).toBeUndefined()
  })

  it('McpToolError ignores an error_detail that is not an object of text fields', () => {
    for (const structuredContent of [
      { error_detail: 'chain_unavailable' },
      { error_detail: ['x'] },
      { error_detail: { code: 7, class: null } },
      { error_detail: {} },
    ]) {
      let thrown: unknown
      try {
        printMcpTextContent({
          isError: true,
          content: [{ type: 'text', text: 'boom' }],
          structuredContent,
        })
      } catch (err) {
        thrown = err
      }
      expect(
        (thrown as McpToolError).errorDetail,
        JSON.stringify(structuredContent)
      ).toBeUndefined()
    }
  })

  it('a successful result with structuredContent is printed and is no McpToolError', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    printMcpTextContent({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { error_detail: CHAIN_OFF_DETAIL },
    })
    expect(log).toHaveBeenCalledWith('ok')
  })
})
