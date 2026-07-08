import { describe, expect, it, vi } from 'vitest'
import { addressRisk } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }
type QueryResponder = (id: string) => { id: string; ok: boolean; results?: Array<Record<string, unknown>>; error?: string } | undefined

// Builds a client that resolves "5Known" to a real :Address (address-grain:
// the address_profile query result itself is the existence check), answers
// every other lookup query (feature/risk_score/label_risk/connection_probe)
// with an empty-but-ok result, and delegates exchange_outflows_N/
// exchange_inflows_N responses to the given responder so each test can
// control exactly which hop-depth queries fail or return rows.
function clientWithExchangeSearch(respond: QueryResponder) {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = (req.arguments.queries ?? []).map((q) => {
        if (q.id === 'address_profile') {
          return { id: q.id, ok: true, results: [{ address: '5Known', network: 'bittensor' }] }
        }
        if (q.id.startsWith('exchange_outflows_') || q.id.startsWith('exchange_inflows_')) {
          return respond(q.id) ?? { id: q.id, ok: true, results: [] }
        }
        return { id: q.id, ok: true, results: [] }
      })
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

describe('aml_address_risk exchange-search partial-failure reporting', () => {
  it('complete clean: no hits, no failures -> reports a genuine clean result', async () => {
    const remote = clientWithExchangeSearch(() => undefined)
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    expect(result.summaryText).toContain('- No exchange inflow/outflow paths found in bounded search.')
    expect(result.summaryText).not.toContain('incomplete')
    const facts = (result.structuredContent as { facts: { exchange_behavior: { search_status: string; failed_query_ids?: string[] } } }).facts
    expect(facts.exchange_behavior.search_status).toBe('complete')
    expect(facts.exchange_behavior.failed_query_ids).toBeUndefined()
  })

  it('partial clean: no hits, but a hop-depth query failed -> must NOT read as a clean finding', async () => {
    const remote = clientWithExchangeSearch((id) =>
      id === 'exchange_outflows_2' ? { id, ok: false, error: 'query-memory limit exceeded' } : undefined,
    )
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    expect(result.summaryText).toContain('Exchange search incomplete: 1 hop-depth query failed')
    expect(result.summaryText).not.toContain('No exchange inflow/outflow paths found in bounded search.')
    const facts = (result.structuredContent as {
      facts: { exchange_behavior: { search_status: string; failed_query_ids?: string[] } }
    }).facts
    expect(facts.exchange_behavior.search_status).toBe('incomplete')
    expect(facts.exchange_behavior.failed_query_ids).toEqual(['exchange_outflows_2'])
  })

  it('partial with hits: some rows found, but another hop-depth query failed -> hits shown with an incompleteness caveat', async () => {
    const remote = clientWithExchangeSearch((id) => {
      if (id === 'exchange_outflows_1') {
        return {
          id,
          ok: true,
          results: [{
            direction: 'outflow',
            exchange_address: 'bittensor:5exchange',
            exchange_display_labels: 'Binance',
            hops: 1,
            amount_usd_sum: 42,
          }],
        }
      }
      if (id === 'exchange_inflows_3') return { id, ok: false, error: 'context deadline exceeded' }
      return undefined
    })
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    expect(result.summaryText).toContain('outflow')
    expect(result.summaryText).toContain('(incomplete: 1 other hop-depth query failed -- there may be more exchange exposure than shown here)')
    const facts = (result.structuredContent as {
      facts: { exchange_behavior: { search_status: string; failed_query_ids?: string[]; outflows: unknown[] } }
    }).facts
    expect(facts.exchange_behavior.search_status).toBe('incomplete')
    expect(facts.exchange_behavior.failed_query_ids).toEqual(['exchange_inflows_3'])
    expect(facts.exchange_behavior.outflows).toHaveLength(1)
  })

  it('an unrelated query failure (e.g. address_feature) does not mark the exchange search incomplete', async () => {
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = (req.arguments.queries ?? []).map((q) => {
          if (q.id === 'address_profile') return { id: q.id, ok: true, results: [{ address: '5Known', network: 'bittensor' }] }
          if (q.id === 'address_feature') return { id: q.id, ok: false, error: 'unrelated failure' }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
      }),
    }
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    expect(result.summaryText).toContain('- No exchange inflow/outflow paths found in bounded search.')
    const facts = (result.structuredContent as { facts: { exchange_behavior: { search_status: string } } }).facts
    expect(facts.exchange_behavior.search_status).toBe('complete')
  })
})
