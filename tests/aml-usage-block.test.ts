import { describe, expect, it, vi } from 'vitest'
import { addressRisk, traceDepositSources, traceSuspectFunds, traceVictimFunds } from '../src/investigation/public-tools.js'

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

  it('aml_trace_victim_funds totals usage across seed pre-flight + probe batches', async () => {
    const remote = billedClient(5, (id) => (id === 'seed_address_exists_1' ? { address: '5Victim' } : undefined))
    const result = await traceVictimFunds(remote as never, config, {
      victimAddresses: '5Victim',
      network: 'bittensor',
      writeArtifacts: false,
    })

    const usage = (result.structuredContent as { usage: { billable_units: number; query_count: number; truncated_queries: number } }).usage
    expect(usage).toEqual({
      billable_units: 5 * batchCallCount(remote),
      query_count: expectedQueryCount(remote),
      truncated_queries: 0,
    })
    expect(usage.query_count).toBeGreaterThan(0)
  })

  it('aml_trace_suspect_funds totals usage on the live traversal path (no money-trail hit)', async () => {
    const remote = billedClient(4, (id) => (id === 'seed_address_exists_1' ? { address: '5Suspect' } : undefined))
    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Suspect',
      network: 'bittensor',
      live: true,
      writeArtifacts: false,
    })

    const usage = (result.structuredContent as { usage: { billable_units: number; query_count: number; truncated_queries: number } }).usage
    expect(usage).toEqual({
      billable_units: 4 * batchCallCount(remote),
      query_count: expectedQueryCount(remote),
      truncated_queries: 0,
    })
  })

  it('aml_trace_suspect_funds totals usage on the money-trail fast path', async () => {
    const remote = billedClient(6, (id) => {
      if (id === 'seed_address_exists_1') return { address: '5Suspect' }
      if (id === 'money_trail_seed_probe') return { address: '5End', fact_type: 'x', hop: 1, terminal_role: 'deposit', value: 10 }
      return undefined
    })
    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Suspect',
      network: 'bittensor',
      writeArtifacts: false,
    })

    const content = result.structuredContent as { trace_source?: string; usage: { billable_units: number; query_count: number; truncated_queries: number } }
    expect(content.trace_source).toBe('money_trail')
    expect(content.usage).toEqual({
      billable_units: 6 * batchCallCount(remote),
      query_count: expectedQueryCount(remote),
      truncated_queries: 0,
    })
  })

  it('aml_trace_deposit_sources totals usage across pre-flight + reverse traceback batches', async () => {
    const remote = billedClient(2, (id) => (id === 'seed_address_exists_1' ? { address: '5Deposit' } : undefined))
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: '5Deposit',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })

    const usage = (result.structuredContent as { usage: { billable_units: number; query_count: number; truncated_queries: number } }).usage
    expect(usage).toEqual({
      billable_units: 2 * batchCallCount(remote),
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
