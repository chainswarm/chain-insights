import { describe, it, expect, vi } from 'vitest'
import { callGraphQueryBatch, callUsageStatus, type ToolCaller } from '../src/mcp/graph-client.js'

function resultEnvelope(facts: Record<string, unknown> = { rows: [] }) {
  return {
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts,
      hint: null,
    },
  }
}

describe('MCP graph batch client', () => {
  it('calls meta_usage_status as free metadata without network arguments', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => ({
        structuredContent: {
          schema: 'chain-insights.result.v1',
          tool: 'meta_usage_status',
          facts: {
            usage: {
              access_mode: 'public_free',
              daily_seconds_used: 4,
              remaining_seconds: 6,
            },
          },
          hint: null,
        },
      })),
    }

    const result = await callUsageStatus({ client })

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'meta_usage_status',
      arguments: {},
    })
    expect(result.tool).toBe('meta_usage_status')
    expect(result.facts).toEqual({
      usage: {
        access_mode: 'public_free',
        daily_seconds_used: 4,
        remaining_seconds: 6,
      },
    })
  })

  it('calls graph_query_batch with network and query list', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope({ count: 2 })),
    }
    const queries = [
      { id: 'count', query: 'MATCH (n) RETURN count(n) AS count' },
      { id: 'relationships', query: 'MATCH (a)-[r]->(b) RETURN type(r) AS type' },
    ]

    const result = await callGraphQueryBatch({ client, network: ' ethereum ', queries })

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: {
        network: 'ethereum',
        queries,
      },
    })
    expect(result).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts: { count: 2 },
      hint: null,
    })
  })

  it('rejects missing network before calling MCP', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope()),
    }

    await expect(callGraphQueryBatch({
      client,
      network: '  ',
      queries: [{ query: 'MATCH (n) RETURN n LIMIT 1' }],
    })).rejects.toThrow('network is required')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('rejects empty queries before calling MCP', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope()),
    }

    await expect(callGraphQueryBatch({
      client,
      network: 'base',
      queries: [],
    })).rejects.toThrow('at least one query is required')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('passes per-query timeout seconds when provided', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope()),
    }
    const queries = [{ query: 'MATCH (n) RETURN n LIMIT 1' }]

    await callGraphQueryBatch({
      client,
      network: 'base',
      queries,
      perQueryTimeoutSeconds: 12,
    })

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'graph_query_batch',
      arguments: {
        network: 'base',
        queries,
        per_query_timeout_seconds: 12,
      },
    })
  })

  it('rejects invalid structuredContent envelopes', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => ({
        structuredContent: {
          schema: 'chain-insights.result.v1',
          tool: 'graph_query_batch',
          facts: [],
          hint: null,
        },
      })),
    }

    await expect(callGraphQueryBatch({
      client,
      network: 'ethereum',
      queries: [{ query: 'MATCH (n) RETURN n LIMIT 1' }],
    })).rejects.toThrow('invalid facts')
  })
})
