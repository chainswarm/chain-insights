import { describe, expect, it } from 'vitest'
import { addBalanceText, ethText, stripEthProperties } from '../src/mcp/balance-text.js'
import { stripUtcProperties, withTimestampTextResult } from '../src/mcp/timestamp-text.js'

describe('balance text twins', () => {
  it('writes the ETH text of the balance Claude Desktop printed raw on 2026-10-21', () => {
    expect(ethText('10003752747799400')).toBe('0.0100037527477994')
  })

  it('is exact for one ETH, zero, a wei, a whole number and a value above 2^53', () => {
    expect(ethText('1000000000000000000')).toBe('1')
    expect(ethText('0')).toBe('0')
    expect(ethText('1')).toBe('0.000000000000000001')
    expect(ethText('9674936629657651')).toBe('0.009674936629657651')
    expect(ethText('123456789012345678901234567890')).toBe('123456789012.34567890123456789')
  })

  it('adds <column>_eth after every wei balance column and nothing else', () => {
    const row = addBalanceText({
      balance: '10003752747799400',
      nonce: 38,
      is_contract: null,
      delegated_to: null,
      amount_usd_sum: '12.5',
      prior_balance: '0',
      balance_text: 'x',
    })
    expect(row).toEqual({
      balance: '10003752747799400',
      balance_eth: '0.0100037527477994',
      nonce: 38,
      is_contract: null,
      delegated_to: null,
      amount_usd_sum: '12.5',
      prior_balance: '0',
      prior_balance_eth: '0',
      balance_text: 'x',
    })
  })

  it('renders the wei that comes back under a *_eth alias as ETH text in place', () => {
    expect(addBalanceText({ held_eth: '10003752747799400' })).toEqual({ held_eth: '0.0100037527477994' })
    expect(addBalanceText({ held_eth: 'already text' })).toEqual({ held_eth: 'already text' })
  })

  it('leaves a null balance, a number and an already present twin alone', () => {
    expect(addBalanceText({ balance: null })).toEqual({ balance: null })
    expect(addBalanceText({ balance: 12 })).toEqual({ balance: 12 })
    expect(addBalanceText({ balance: '5', balance_eth: 'kept' })).toEqual({ balance: '5', balance_eth: 'kept' })
  })

  it('rides the same result mapper as the UTC twin, in the structured content and the text block', () => {
    const structured = {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      facts: { query: { results: [{ balance: '10003752747799400', nonce: 38 }] } },
    }
    const out = withTimestampTextResult({
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    })
    const row = (out.structuredContent as { facts: { query: { results: Record<string, unknown>[] } } }).facts.query.results[0]
    expect(row.balance_eth).toBe('0.0100037527477994')
    expect(JSON.parse(out.content![0]!.text!)).toEqual(out.structuredContent)
  })
})

describe('a _eth column named in a query', () => {
  it('rewrites the property to its wei column and keeps an alias', () => {
    expect(stripEthProperties('USE chain MATCH (a:Address {address: "0x1"}) RETURN a.balance_eth')).toBe(
      'USE chain MATCH (a:Address {address: "0x1"}) RETURN a.balance'
    )
    expect(stripEthProperties('RETURN a.balance_eth AS held_eth')).toBe('RETURN a.balance AS held_eth')
    expect(stripEthProperties('RETURN a.balance, a.nonce')).toBe('RETURN a.balance, a.nonce')
  })

  it('is applied together with the _utc strip', () => {
    expect(stripUtcProperties('RETURN a.balance_eth, f.last_seen_timestamp_utc')).toBe(
      'RETURN a.balance, f.last_seen_timestamp'
    )
  })
})
