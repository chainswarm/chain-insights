import { describe, it, expect, vi, afterEach } from 'vitest'
import { printMcpTextContent } from '../src/mcp/print-result.js'

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
