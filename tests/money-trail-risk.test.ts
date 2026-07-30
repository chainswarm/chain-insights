import { describe, expect, it, vi } from 'vitest'
import { addressRisk, buildMoneyTrailBlock, moneyTrailEndsQuery, moneyTrailIncidentQuery, moneyTrailSummarySentence } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

describe('money-trail query builders', () => {
  it('moneyTrailIncidentQuery emits pinned query text with an escaped address literal', () => {
    expect(moneyTrailIncidentQuery('addr"1')).toMatchSnapshot()
  })

  it('moneyTrailEndsQuery emits pinned query text with an escaped seed literal', () => {
    expect(moneyTrailEndsQuery('seed"1')).toMatchSnapshot()
  })
})

describe('buildMoneyTrailBlock', () => {
  it('returns undefined when there are no incident rows (S2: address not on a trail)', () => {
    expect(buildMoneyTrailBlock([], [])).toBeUndefined()
  })

  it('picks transport over peripheral when both classes are present', () => {
    const block = buildMoneyTrailBlock(
      [
        { edge_class: 'peripheral', min_hop: 5, primary_seed: 'seedA', generation: 1 },
        { edge_class: 'transport', min_hop: 2, primary_seed: 'seedB', generation: 2 },
      ],
      [],
    )
    expect(block?.class).toBe('transport')
  })

  it('picks the lowest min_hop among rows of the winning class', () => {
    const block = buildMoneyTrailBlock(
      [
        { edge_class: 'transport', min_hop: 4, primary_seed: 'seedA', generation: 1 },
        { edge_class: 'transport', min_hop: 1, primary_seed: 'seedB', generation: 3 },
      ],
      [],
    )
    expect(block?.min_hop).toBe(1)
    expect(block?.primary_seed).toBe('seedB')
    expect(block?.generation).toBe(3)
  })

  it('chooses the highest-value trail end as nearest_trail_end', () => {
    const block = buildMoneyTrailBlock(
      [{ edge_class: 'transport', min_hop: 1, primary_seed: 'seedA', generation: 1 }],
      [
        { address: 'end-low', fact_type: 'mixer', value: '10' },
        { address: 'end-high', fact_type: 'cash_out', value: '500' },
      ],
    )
    expect(block?.nearest_trail_end).toEqual({ address: 'end-high', fact_type: 'cash_out', value: '500' })
  })

  it('holding class also reports "sits on a money trail"', () => {
    const block = buildMoneyTrailBlock(
      [{ edge_class: 'holding', min_hop: 3, primary_seed: 'seedA', generation: 1 }],
      [],
    )
    expect(block?.class).toBe('holding')
  })
})

describe('moneyTrailSummarySentence', () => {
  it('reads "sits on a money trail" for transport class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'transport', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('sits on a money trail')
  })

  it('reads "sits on a money trail" for holding class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'holding', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('sits on a money trail')
  })

  it('reads "touched money-trail funds" for peripheral class', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'peripheral', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!)).toContain('touched money-trail funds')
  })

  it('never contains the word "attribution"', () => {
    const block = buildMoneyTrailBlock([{ edge_class: 'peripheral', min_hop: 1, primary_seed: 'seedA', generation: 1 }], [])
    expect(moneyTrailSummarySentence(block!).toLowerCase()).not.toContain('attribution')
  })
})

describe('aml_address_risk money_trail_ends round trip degrades on failure', () => {
  // Simulates a transport/parse-level error on the SECOND callGraphBatch
  // call (the money_trail_ends fan-out), which throws rather than
  // returning an ok:false query row -- distinct from the ok:false path
  // optionalResultsFor already absorbs. The tool must still return a
  // result, with the money_trail block built from the incident rows alone
  // (no nearest_trail_end) and the failure recorded.
  it('ends-call throws -> tool result still returned, block present without nearest_trail_end, failure recorded', async () => {
    let callCount = 0
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        callCount += 1
        const queries = req.arguments.queries ?? []
        if (queries.some((q) => q.id === 'money_trail_ends')) {
          throw new Error('transport error: connection reset')
        }
        const results = queries.map((q) => {
          if (q.id === 'address_profile') return { id: q.id, ok: true, results: [{ address: '5Known', network: 'bittensor' }] }
          if (q.id === 'money_trail_incident') {
            return {
              id: q.id,
              ok: true,
              results: [{ edge_class: 'transport', min_hop: 2, primary_seed: '5Seed', generation: 1 }],
            }
          }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }

    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    expect(callCount).toBeGreaterThanOrEqual(2)
    const facts = (result.structuredContent as {
      facts: {
        money_trail?: { on_trail: true; class: string; nearest_trail_end?: unknown }
        partial_query_errors?: Array<{ id: string; error: string }>
      }
    }).facts
    expect(facts.money_trail).toBeDefined()
    expect(facts.money_trail?.on_trail).toBe(true)
    expect(facts.money_trail?.class).toBe('transport')
    expect(facts.money_trail?.nearest_trail_end).toBeUndefined()
    expect(facts.partial_query_errors).toContainEqual(
      expect.objectContaining({ id: 'money_trail_ends', error: expect.stringContaining('connection reset') }),
    )
    expect(result.summaryText).toContain('sits on a money trail')
  })
})
