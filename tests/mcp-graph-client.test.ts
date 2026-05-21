import { describe, it, expect, vi } from 'vitest'
import { callTopologyQueryBatch, type ToolCaller } from '../src/mcp/graph-client.js'

function resultEnvelope(facts: Record<string, unknown> = { rows: [] }) {
  return {
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'topology_query_batch',
      facts,
      hint: null,
    },
  }
}

describe('MCP graph batch client', () => {
  it('calls topology_query_batch with network and query list', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope({ count: 2 })),
    }
    const queries = [
      { id: 'count', query: 'MATCH (n) RETURN count(n) AS count' },
      { id: 'relationships', query: 'MATCH (a)-[r]->(b) RETURN type(r) AS type' },
    ]

    const result = await callTopologyQueryBatch({ client, network: ' ethereum ', queries })

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'topology_query_batch',
      arguments: {
        network: 'ethereum',
        queries,
      },
    })
    expect(result).toEqual({
      schema: 'chain-insights.result.v1',
      tool: 'topology_query_batch',
      facts: { count: 2 },
      hint: null,
    })
  })

  it('rejects missing network before calling MCP', async () => {
    const client: ToolCaller = {
      callTool: vi.fn(async () => resultEnvelope()),
    }

    await expect(callTopologyQueryBatch({
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

    await expect(callTopologyQueryBatch({
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

    await callTopologyQueryBatch({
      client,
      network: 'base',
      queries,
      perQueryTimeoutSeconds: 12,
    })

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'topology_query_batch',
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
          tool: 'topology_query_batch',
          facts: [],
          hint: null,
        },
      })),
    }

    await expect(callTopologyQueryBatch({
      client,
      network: 'ethereum',
      queries: [{ query: 'MATCH (n) RETURN n LIMIT 1' }],
    })).rejects.toThrow('invalid facts')
  })
})
