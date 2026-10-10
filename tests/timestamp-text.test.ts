import { describe, expect, it } from 'vitest'
import { addTimestampText, utcText, withTimestampText, withTimestampTextResult } from '../src/mcp/timestamp-text.js'

describe('timestamp text twins', () => {
  it('writes the UTC text of a block the loop saw mis-read four times', () => {
    expect(utcText(1785974143000)).toBe('2026-08-05 23:55:43 UTC')
  })

  it('adds <column>_utc after every epoch-millisecond timestamp column and nothing else', () => {
    const row = addTimestampText({
      from_address: '0xd4a91e5023406903aff83225186e1d1ed18ca587',
      block_timestamp: 1785974143000,
      last_seen_timestamp: 1789785360000,
      first_seen: 1783219200000,
      tx_count: 412,
      amount_usd_sum: '2349759.40',
      block_height: 28897956,
      block_date: '2026-08-05',
    })
    expect(Object.keys(row)).toEqual([
      'from_address',
      'block_timestamp',
      'block_timestamp_utc',
      'last_seen_timestamp',
      'last_seen_timestamp_utc',
      'first_seen',
      'first_seen_utc',
      'tx_count',
      'amount_usd_sum',
      'block_height',
      'block_date',
    ])
    expect(row.block_timestamp_utc).toBe('2026-08-05 23:55:43 UTC')
    expect(row.last_seen_timestamp_utc).toBe('2026-09-19 02:36:00 UTC')
  })

  it('leaves a null timestamp, a block height and an already present twin alone', () => {
    const row = addTimestampText({ block_timestamp: null, block_height: 28897956, last_seen_timestamp: 1, x_timestamp: 5, first_seen: 1783219200000, first_seen_utc: 'kept' })
    expect(row).toEqual({ block_timestamp: null, block_height: 28897956, last_seen_timestamp: 1, x_timestamp: 5, first_seen: 1783219200000, first_seen_utc: 'kept' })
  })

  it('maps graph_query rows and every graph_query_batch entry, and keeps the text block equal to the structured content', () => {
    const structured = {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts: {
        queries: [
          { id: 'a', results: [{ block_timestamp: 1785974143000 }] },
          { id: 'b', results: [], error: 'x' },
        ],
      },
    }
    const out = withTimestampTextResult({
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
      isError: false,
    })
    const facts = (out.structuredContent as { facts: { queries: Array<{ results: Array<Record<string, unknown>> }> } }).facts
    expect(facts.queries[0].results[0].block_timestamp_utc).toBe('2026-08-05 23:55:43 UTC')
    expect(facts.queries[1]).toEqual({ id: 'b', results: [], error: 'x' })
    expect(JSON.parse(out.content![0].text!)).toEqual(out.structuredContent)

    const single = withTimestampText({ facts: { query: { results: [{ last_seen_timestamp: 1789785360000 }] } } }) as {
      facts: { query: { results: Array<Record<string, unknown>> } }
    }
    expect(single.facts.query.results[0].last_seen_timestamp_utc).toBe('2026-09-19 02:36:00 UTC')
  })

  it('leaves a text block that is not the structured JSON as it was, and a result with no rows untouched', () => {
    const structured = { facts: { query: { results: [{ block_timestamp: 1785974143000 }] } } }
    const out = withTimestampTextResult({ content: [{ type: 'text', text: 'Rows: 1' }], structuredContent: structured })
    expect(out.content).toEqual([{ type: 'text', text: 'Rows: 1' }])
    const same = { content: [{ type: 'text', text: '{}' }], structuredContent: { facts: {} } }
    expect(withTimestampTextResult(same)).toBe(same)
  })
})
