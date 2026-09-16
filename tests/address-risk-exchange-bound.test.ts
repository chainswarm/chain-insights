import { describe, expect, it, vi } from 'vitest'
import { addressRisk, queryBuilderContract } from '../src/investigation/public-tools.js'

// Exchange search hub bound, attribution probe, and statuses
// (AP1000 change topology-60s-budget-and-exchange-hub-bound, spec
// aml-address-risk-exchange-search, design D4 to D8).
//
// Why the bound exists: the search walks every relationship of every address
// two hops out before it checks for an exchange. On production one middle
// address was a hub with 1,353,649 senders, and the 3-hop inflow search walked
// 19,164,381 relationships until its time budget ended.

type BatchQuery = { id: string; query: string }

interface BatchCall {
  ids: string[]
  args: Record<string, unknown>
}

function clientWithAttribution(
  exchanges: number | 'error',
  profile: { degree_in?: number; degree_out?: number } = {}
) {
  const calls: BatchCall[] = []
  const client = {
    callTool: vi.fn(async (req: { name: string; arguments: Record<string, unknown> }) => {
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = (req.arguments['queries'] as BatchQuery[]) ?? []
      calls.push({ ids: queries.map((query) => query.id), args: req.arguments })
      const results = queries.map((query) => {
        if (query.id === 'exchange_attribution') {
          return exchanges === 'error'
            ? { id: query.id, ok: false, error: 'query_timeout: the topology query did not finish' }
            : { id: query.id, ok: true, results: [{ exchanges }] }
        }
        if (query.id === 'address_profile') {
          return { id: query.id, ok: true, results: [{ address: '0xsubject', network: 'robinhood' }] }
        }
        if (query.id === 'address_feature') {
          return {
            id: query.id,
            ok: true,
            results: [{ degree_in: profile.degree_in ?? 12, degree_out: profile.degree_out ?? 1 }],
          }
        }
        return { id: query.id, ok: true, results: [] }
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }],
        isError: false,
      }
    }),
  }
  return { client, calls }
}

function exchangeBehaviorOf(result: { structuredContent: unknown }) {
  return (
    result.structuredContent as {
      facts: {
        exchange_behavior: {
          search_status: string
          hub_bound?: number
          failed_query_ids?: string[]
          skipped_query_ids?: string[]
          skip_reason?: string
          unavailable_reason?: string
        }
        risk: { signals?: { exchange_exposure?: string } }
        partial_query_errors?: Array<{ id: string }>
      }
    }
  ).facts
}

const allIds = (calls: BatchCall[]) => calls.flatMap((call) => call.ids)

describe('exchange search hub bound', () => {
  it('bounds every middle address and the subject at depth 2 and 3', () => {
    const [inflow1, inflow2, inflow3] = queryBuilderContract.exchangeInflowQueries('0xsubject')
    const [outflow1, outflow2, outflow3] = queryBuilderContract.exchangeOutflowQueries('0xsubject')

    // Depth 1 has no middle address and reads only the subject's own edges.
    expect(inflow1?.query).not.toContain('degree_in')
    expect(outflow1?.query).not.toContain('degree_out')

    expect(inflow2?.query).toContain('coalesce(n1.degree_in, 0) <= 10000')
    expect(inflow2?.query).toContain('coalesce(a.degree_in, 0) <= 10000')
    expect(inflow3?.query).toContain('coalesce(n1.degree_in, 0) <= 10000')
    expect(inflow3?.query).toContain('coalesce(n2.degree_in, 0) <= 10000')
    expect(inflow3?.query).toContain('coalesce(a.degree_in, 0) <= 10000')

    expect(outflow2?.query).toContain('coalesce(n1.degree_out, 0) <= 10000')
    expect(outflow2?.query).toContain('coalesce(a.degree_out, 0) <= 10000')
    expect(outflow3?.query).toContain('coalesce(n1.degree_out, 0) <= 10000')
    expect(outflow3?.query).toContain('coalesce(n2.degree_out, 0) <= 10000')
    expect(outflow3?.query).toContain('coalesce(a.degree_out, 0) <= 10000')

    // The exchange at the end of the path is never bounded.
    expect(inflow3?.query).not.toContain('exchange.degree_in')
    expect(outflow3?.query).not.toContain('exchange.degree_out')
  })
})

describe('exchange attribution probe', () => {
  it('skips the searches and reports unavailable when the network has no exchange labels', async () => {
    const { client, calls } = clientWithAttribution(0)

    const result = await addressRisk(client as never, { address: '0xsubject', network: 'robinhood' })

    expect(allIds(calls)).toContain('exchange_attribution')
    expect(allIds(calls).filter((id) => id.startsWith('exchange_inflows_'))).toHaveLength(0)
    expect(allIds(calls).filter((id) => id.startsWith('exchange_outflows_'))).toHaveLength(0)

    const facts = exchangeBehaviorOf(result)
    expect(facts.exchange_behavior.search_status).toBe('unavailable')
    expect(facts.exchange_behavior.unavailable_reason).toBe('no_exchange_attribution')
    expect(facts.risk.signals?.exchange_exposure).toBe('unavailable')
    expect(result.summaryText).not.toContain('No exchange inflow/outflow paths found in bounded search')
    expect(result.summaryText).toContain('unknown')
  })

  it('runs the searches when the network has exchange labels', async () => {
    const { client, calls } = clientWithAttribution(7)

    const result = await addressRisk(client as never, { address: '0xsubject', network: 'robinhood' })

    expect(allIds(calls).filter((id) => id.startsWith('exchange_inflows_'))).toHaveLength(3)
    expect(allIds(calls).filter((id) => id.startsWith('exchange_outflows_'))).toHaveLength(3)
    const facts = exchangeBehaviorOf(result)
    expect(facts.exchange_behavior.search_status).toBe('complete')
    expect(facts.exchange_behavior.hub_bound).toBe(10000)
    expect(facts.exchange_behavior.unavailable_reason).toBeUndefined()
  })

  it('runs the searches and records the failure when the probe itself fails', async () => {
    const { client, calls } = clientWithAttribution('error')

    const result = await addressRisk(client as never, { address: '0xsubject', network: 'robinhood' })

    expect(allIds(calls).filter((id) => id.startsWith('exchange_inflows_'))).toHaveLength(3)
    const facts = exchangeBehaviorOf(result)
    expect(facts.exchange_behavior.search_status).toBe('complete')
    expect(facts.partial_query_errors?.some((failure) => failure.id === 'exchange_attribution')).toBe(
      true
    )
  })
})

describe('hub subject', () => {
  it('skips the 2-hop and 3-hop searches of a direction whose degree is above the bound', async () => {
    const { client, calls } = clientWithAttribution(7, { degree_in: 1_353_649, degree_out: 868_116 })

    const result = await addressRisk(client as never, { address: '0xhub', network: 'robinhood' })

    const facts = exchangeBehaviorOf(result)
    expect(facts.exchange_behavior.skipped_query_ids).toEqual([
      'exchange_inflows_2',
      'exchange_inflows_3',
      'exchange_outflows_2',
      'exchange_outflows_3',
    ])
    expect(facts.exchange_behavior.skip_reason).toBe('subject_above_hub_bound')
    expect(facts.exchange_behavior.search_status).toBe('incomplete')
    expect(allIds(calls)).toContain('exchange_inflows_1')
    expect(allIds(calls)).toContain('exchange_outflows_1')
    expect(result.summaryText).not.toContain('retry or narrow the search')
  })

  it('keeps every depth for an ordinary subject', async () => {
    const { client } = clientWithAttribution(7, { degree_in: 12, degree_out: 1 })

    const result = await addressRisk(client as never, { address: '0xsubject', network: 'robinhood' })

    const facts = exchangeBehaviorOf(result)
    expect(facts.exchange_behavior.skipped_query_ids).toBeUndefined()
    expect(facts.exchange_behavior.search_status).toBe('complete')
  })
})

describe('server query time limit', () => {
  it('sends no per_query_timeout_seconds, so the server applies its own ceiling', async () => {
    const { client, calls } = clientWithAttribution(7)

    await addressRisk(client as never, { address: '0xsubject', network: 'robinhood' })

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.args).not.toHaveProperty('per_query_timeout_seconds')
    }
  })
})
