import { describe, expect, it } from 'vitest'
import { recountBillableUnits } from '../src/lib/recount-units'

const node = (id: string) => ({ id: `n:${id}`, labels: ['Address'], properties: { address: '0xabc' } })
const edge = (id: string) => ({ id: `r:${id}`, type: 'FLOWS_TO', start: 'n:1', end: 'n:2', properties: {} })

describe('recountBillableUnits', () => {
  it('mirrors the server walker: rows + nodes + edges, containers walked, no dedup', () => {
    const results = [
      { n: node('1'), r: edge('9') },
      { p: { nodes: [node('1'), node('2')], relationships: [edge('5')] } },
      { collected: [node('3'), node('3')] },
      { count: 7 },
    ]
    expect(recountBillableUnits(results)).toEqual({ rows: 4, nodes: 5, edges: 2, total: 11 })
  })

  it('audit parity: recount equals the server-reported billable_units on a fixture response', () => {
    const facts = {
      query: {
        results: [{ n: node('1') }, { count: 1 }],
        billable_units: 3,
        units: { rows: 2, nodes: 1, edges: 0 },
        truncated: false,
      },
    }
    const recount = recountBillableUnits(facts.query.results as Array<Record<string, unknown>>)
    expect(recount.total).toBe(facts.query.billable_units)
    expect(recount).toMatchObject({ rows: 2, nodes: 1, edges: 0 })
  })
})
