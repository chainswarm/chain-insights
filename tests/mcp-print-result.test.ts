import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatMcpTextContent, printMcpTextContent } from '../src/mcp/print-result.js'

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
})
