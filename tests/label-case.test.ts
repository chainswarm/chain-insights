import { describe, expect, it } from 'vitest'
import { fixLabelCase } from '../src/mcp/label-case.js'
import { withoutUtcProperties } from '../src/mcp/timestamp-text.js'

const ROUTER = '0xb672a5d825f82dea8574711d1da696fcc48d2ae0'

describe('a label or link type in the wrong case', () => {
  it.each([
    [`USE topology MATCH (a:address {address:'${ROUTER}'})-[f:flowed_to]->(b:address) RETURN b.address LIMIT 5`,
      `USE topology MATCH (a:Address {address:'${ROUTER}'})-[f:FLOWED_TO]->(b:Address) RETURN b.address LIMIT 5`],
    ['MATCH (:address)-[:Transfer|swap]->( x : token :contract) RETURN x LIMIT 1',
      'MATCH (:Address)-[:TRANSFER|SWAP]->( x : Token :Contract) RETURN x LIMIT 1'],
    ['USE chain MATCH (h:head) RETURN h.behind_money', 'USE chain MATCH (h:Head) RETURN h.behind_money'],
  ])('is spelled the graph way: %s', (query, expected) => {
    expect(fixLabelCase(query)).toBe(expected)
  })

  it.each([
    'USE topology MATCH (a:Address {address: address}) RETURN a.labels LIMIT 1',
    `MATCH (a:Address {address: "(b:address)"}) RETURN a LIMIT 1`,
    'MATCH (a:Mystery) RETURN a LIMIT 1',
    'RETURN CASE WHEN x THEN 1 ELSE 0 END AS token LIMIT 1',
    "RETURN a.name || swap AS s LIMIT 1",
  ])('leaves the rest as written: %s', (query) => {
    expect(fixLabelCase(query)).toBe(query)
  })

  it('reaches every query of a batch through the proxy rewrite', () => {
    const args = withoutUtcProperties('graph_query_batch', {
      network: 'robinhood',
      queries: [{ id: 'node', query: `USE topology MATCH (a:address {address:'${ROUTER}'}) RETURN a.labels LIMIT 1` }],
    })
    expect((args.queries as { query: string }[])[0].query).toContain('(a:Address {')
  })
})
