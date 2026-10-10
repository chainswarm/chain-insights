import { describe, expect, it } from 'vitest'
import { ANSWER_HINT, withAnswerHint, withAnswerHintResult } from '../src/mcp/answer-hint.js'

describe('the answer hint on every graph reply', () => {
  it('fills an empty hint and keeps one the server set', () => {
    const empty = { schema: 'chain-insights.result.v1', tool: 'graph_query', hint: null, facts: { query: { results: [] } } }
    expect((withAnswerHint(empty) as { hint: string }).hint).toBe(ANSWER_HINT)
    const set = { ...empty, hint: 'server says so' }
    expect(withAnswerHint(set)).toBe(set)
    const notGraph = { facts: undefined }
    expect(withAnswerHint(notGraph)).toBe(notGraph)
  })

  it('keeps the JSON text block equal to the structured content', () => {
    const structuredContent = { schema: 'chain-insights.result.v1', tool: 'graph_query_batch', hint: null, facts: { queries: [] } }
    const result = { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false }
    const out = withAnswerHintResult(result)
    expect(JSON.parse(out.content[0].text as string)).toEqual(out.structuredContent)
    expect((out.structuredContent as { hint: string }).hint).toBe(ANSWER_HINT)
    const prose = { content: [{ type: 'text', text: 'rows below' }], structuredContent, isError: false }
    expect(withAnswerHintResult(prose).content).toEqual(prose.content)
  })

  it('names the two rules and nothing else', () => {
    expect(ANSWER_HINT).toMatch(/every address in full/)
    expect(ANSWER_HINT).toMatch(/tokens worth about N USD/)
    expect(ANSWER_HINT).toMatch(/asks for shorter ones/)
    expect(ANSWER_HINT).toMatch(/never draw/)
    expect(ANSWER_HINT.length).toBeLessThan(400)
  })
})
