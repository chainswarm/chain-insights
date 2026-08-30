import { describe, expect, it, vi } from 'vitest'
import {
  createUsageAccumulator,
  usageBlock,
  wrapClientForUsageTracking,
} from '../src/lib/usage-accumulator.js'

function batchResult(facts: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify({ facts }) }], isError: false }
}

describe('usage accumulator math', () => {
  it('totals facts.batch.billable_units and counts one query per batch entry', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () =>
        batchResult({
          batch: { billable_units: 42 },
          queries: [
            { id: 'a', ok: true },
            { id: 'b', ok: true },
          ],
        })
      ),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 42, query_count: 2, truncated_queries: 0 })
  })

  it('falls back to summing per-query billable_units when facts.batch is absent', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () =>
        batchResult({
          queries: [
            { id: 'a', ok: true, billable_units: 3 },
            { id: 'b', ok: true, billable_units: 5 },
            { id: 'c', ok: true },
          ],
        })
      ),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 8, query_count: 3, truncated_queries: 0 })
  })

  it('counts truncated_queries from per-entry truncated flags', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () =>
        batchResult({
          batch: { billable_units: 10 },
          queries: [
            { id: 'a', ok: true, truncated: true },
            { id: 'b', ok: true, truncated: false },
            { id: 'c', ok: true, truncated: true },
          ],
        })
      ),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 10, query_count: 3, truncated_queries: 2 })
  })

  it('accumulates across multiple round trips', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce(
          batchResult({ batch: { billable_units: 5 }, queries: [{ id: 'a' }] })
        )
        .mockResolvedValueOnce(
          batchResult({ batch: { billable_units: 7 }, queries: [{ id: 'b' }, { id: 'c' }] })
        ),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 12, query_count: 3, truncated_queries: 0 })
  })

  it('defensive: absent facts/billing fields contribute 0 units but still count the query', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({}) }],
        isError: false,
      })),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 0, query_count: 1, truncated_queries: 0 })
  })

  it('defensive: malformed (non-JSON) response text never throws', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'not json' }],
        isError: true,
      })),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await expect(
      tracked.callTool({ name: 'graph_query_batch', arguments: {} })
    ).resolves.toBeDefined()

    expect(usageBlock(totals)).toEqual({ billable_units: 0, query_count: 1, truncated_queries: 0 })
  })

  it('defensive: empty/no content never throws', async () => {
    const totals = createUsageAccumulator()
    const client = { callTool: vi.fn(async () => ({})) }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 0, query_count: 1, truncated_queries: 0 })
  })

  it('single graph_query calls use facts.query.billable_units/truncated and count as 1', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () =>
        batchResult({
          query: {
            results: [{ n: 1 }],
            billable_units: 4,
            units: { rows: 1, nodes: 0, edges: 0 },
            truncated: true,
          },
        })
      ),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'graph_query', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 4, query_count: 1, truncated_queries: 1 })
  })

  it('ignores tool calls that are not graph_query/graph_query_batch', async () => {
    const totals = createUsageAccumulator()
    const client = {
      callTool: vi.fn(async () => batchResult({ batch: { billable_units: 999 } })),
    }
    const tracked = wrapClientForUsageTracking(client, totals)
    await tracked.callTool({ name: 'network_capabilities', arguments: {} })

    expect(usageBlock(totals)).toEqual({ billable_units: 0, query_count: 0, truncated_queries: 0 })
  })

  it('passes through the raw result unchanged', async () => {
    const totals = createUsageAccumulator()
    const raw = batchResult({ batch: { billable_units: 1 }, queries: [{ id: 'a' }] })
    const client = { callTool: vi.fn(async () => raw) }
    const tracked = wrapClientForUsageTracking(client, totals)
    const result = await tracked.callTool({ name: 'graph_query_batch', arguments: {} })

    expect(result).toBe(raw)
  })

  it('usageBlock returns a detached snapshot, not the live accumulator', async () => {
    const totals = createUsageAccumulator()
    const snapshot = usageBlock(totals)
    totals.billable_units = 99
    expect(snapshot.billable_units).toBe(0)
  })
})
