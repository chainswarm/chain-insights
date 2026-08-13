import { describe, expect, it, vi } from 'vitest'
import { addressRisk } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }
type CallToolRequest = { name: string; arguments: { queries?: BatchQuery[] } }

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

// Every graph_query_batch call is billed `unitsPerCall` and echoes back one
// ok:true empty-result entry per requested query id, except `resolve(id)`
// overrides let a test seed specific rows (e.g. so a seed address resolves).
function billedClient(unitsPerCall: number, resolve: (id: string) => Record<string, unknown> | undefined = () => undefined) {
  return {
    callTool: vi.fn(async (req: CallToolRequest) => {
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = (req.arguments.queries ?? []).map((q) => ({
        id: q.id,
        ok: true,
        results: resolve(q.id) ? [resolve(q.id)] : [],
      }))
      return {
        content: [{ type: 'text', text: JSON.stringify({ facts: { batch: { billable_units: unitsPerCall }, queries } }) }],
        isError: false,
      }
    }),
  }
}

// Sums queries.length across every graph_query_batch call the mock actually
// received, so the expectation tracks the tool's real internal query count
// instead of hard-coding it.
function expectedQueryCount(remote: { callTool: ReturnType<typeof vi.fn> }): number {
  return remote.callTool.mock.calls
    .filter(([req]: [CallToolRequest]) => req.name === 'graph_query_batch')
    .reduce((sum: number, [req]: [CallToolRequest]) => sum + (req.arguments.queries?.length ?? 0), 0)
}

function batchCallCount(remote: { callTool: ReturnType<typeof vi.fn> }): number {
  return remote.callTool.mock.calls.filter(([req]: [CallToolRequest]) => req.name === 'graph_query_batch').length
}

describe('aml_* workflow responses carry a usage block', () => {
  it('aml_address_risk totals billable_units/query_count across its internal graph_query_batch calls', async () => {
    const remote = billedClient(11, (id) => (id === 'address_profile' ? { address: '5Known', network: 'bittensor' } : undefined))
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })

    const facts = (result.structuredContent as { facts: { usage: { billable_units: number; query_count: number; truncated_queries: number } } }).facts
    expect(facts.usage).toEqual({
      billable_units: 11 * batchCallCount(remote),
      query_count: expectedQueryCount(remote),
      truncated_queries: 0,
    })
    expect(facts.usage.query_count).toBeGreaterThan(0)
  })

  it('aml_address_risk still reports a usage block on the unresolved-address early return', async () => {
    const remote = billedClient(3)
    const result = await addressRisk(remote as never, { address: '5Unknown', network: 'bittensor' })

    const facts = (result.structuredContent as { facts: { usage: { billable_units: number; query_count: number; truncated_queries: number } } }).facts
    expect(facts.usage).toEqual({
      billable_units: 3 * batchCallCount(remote),
      query_count: expectedQueryCount(remote),
      truncated_queries: 0,
    })
  })





  it('defensive: a backend that never emits billing fields yields zero units but never blocks the workflow', async () => {
    const remote = {
      callTool: vi.fn(async (req: CallToolRequest) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = (req.arguments.queries ?? []).map((q) => ({
          id: q.id,
          ok: true,
          results: q.id === 'address_profile' ? [{ address: '5Known', network: 'bittensor' }] : [],
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
      }),
    }
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })
    const facts = (result.structuredContent as { facts: { usage: { billable_units: number; query_count: number; truncated_queries: number } } }).facts

    expect(facts.usage.billable_units).toBe(0)
    expect(facts.usage.query_count).toBeGreaterThan(0)
    expect(facts.usage.truncated_queries).toBe(0)
  })

  it('counts truncated_queries when internal queries report truncated: true', async () => {
    const remote = {
      callTool: vi.fn(async (req: CallToolRequest) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = (req.arguments.queries ?? []).map((q) => ({
          id: q.id,
          ok: true,
          truncated: q.id === 'exchange_outflows_1',
          results: q.id === 'address_profile' ? [{ address: '5Known', network: 'bittensor' }] : [],
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { batch: { billable_units: 9 }, queries } }) }], isError: false }
      }),
    }
    const result = await addressRisk(remote as never, { address: '5Known', network: 'bittensor' })
    const facts = (result.structuredContent as { facts: { usage: { billable_units: number; query_count: number; truncated_queries: number } } }).facts

    expect(facts.usage.truncated_queries).toBe(1)
  })
})
