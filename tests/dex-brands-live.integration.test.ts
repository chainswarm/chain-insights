import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateMcpEndpoint } from '../src/config/mcp-endpoint.js'
import { applyMcpAuthHeaders } from '../src/mcp/client.js'
import { callGraphQueryBatch, type ToolCaller } from '../src/mcp/graph-client.js'
import { PACKAGE_VERSION } from '../src/version.js'
import { readBrands, type BrandRow } from './dex-brands.js'

// Live read of the exchange brand memo (tests/fixtures/dex-brands.json, the
// pinned DEX brand registry) against a Chain Insights Graph lane: the memo is
// never trusted over the graph (AP1000 change dex-protocol-skills, ruled
// 2026-10-23). Batches of 20, under a minute, no wait for a lane: a T4 check
// per release candidate, never in the push gate.
//
// Per brand row: the example pool is :Pool, carries the row's adapter mark
// and was deployed by a memo factory; the pools the factories deployed are
// at least the recorded floor. Once the lane serves `brand` on any :Pool, the
// example pool's brand equals the row's and the served brand list holds every
// memo brand. A vault row (one manager, no creation) is judged on its manager.
//
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT=http://127.0.0.1:8012/mcp \
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN=<the lane's debug bearer> \
//   npx vitest run tests/dex-brands-live.integration.test.ts

const endpoint = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT']?.trim()
const token = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN']?.trim()
const network = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK']?.trim() || 'robinhood'
const BATCH_SIZE = 20

type BatchEntry = {
  id?: string
  ok?: boolean
  error?: string
  results?: Array<Record<string, unknown>>
}

export function examplePoolQuery(row: BrandRow): string {
  return (
    `USE topology MATCH (f:Address)-[:DEPLOYED_CONTRACT]->(p:Address {address: "${row.example_pool}"}) ` +
    'RETURN f.address AS from_address, labels(p) AS node_labels, p.labels AS marks, p.brand AS brand LIMIT 5'
  )
}

export function managerQuery(row: BrandRow): string {
  return (
    `USE topology MATCH (a:Address {address: "${row.factories[0]}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.brand AS brand LIMIT 1'
  )
}

export function factoryCountQuery(factory: string): string {
  return `USE topology MATCH (f:Address {address: "${factory}"})-[:DEPLOYED_CONTRACT]->(p:Pool) RETURN count(p) AS n LIMIT 1`
}

export const brandListQuery =
  'USE topology MATCH (p:Pool) WHERE p.brand IS NOT NULL RETURN DISTINCT p.brand AS brand LIMIT 100'

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

describe.skipIf(!endpoint)('the exchange brand memo against a live Chain Insights Graph', () => {
  const memo = readBrands()
  let client: Client
  let caller: ToolCaller
  const answers = new Map<string, BatchEntry>()
  const served = new Set<string>()

  beforeAll(async () => {
    const url = validateMcpEndpoint(endpoint!, 'CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT')
    const authFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (token) applyMcpAuthHeaders(headers, token)
      return fetch(input, { ...init, headers })
    }
    client = new Client({ name: 'chain-insights-live-dex-brands', version: PACKAGE_VERSION })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: authFetch }))
    caller = {
      callTool: (input) =>
        client.callTool(input) as Promise<{
          content?: Array<{ type: string; text?: string }>
          structuredContent?: Record<string, unknown>
          isError?: boolean
        }>,
    }
    const queries: Array<{ id: string; query: string }> = [{ id: 'brands', query: brandListQuery }]
    for (const row of memo.rows) {
      if (row.trail_type === 'vault') queries.push({ id: `manager:${row.brand}`, query: managerQuery(row) })
      else if (row.example_pool) queries.push({ id: `pool:${row.brand}`, query: examplePoolQuery(row) })
      if (row.trail_type !== 'vault' && row.pool_floor !== null) {
        for (const factory of row.factories) {
          queries.push({ id: `count:${row.brand}:${factory}`, query: factoryCountQuery(factory) })
        }
      }
    }
    for (const batch of chunk(queries, BATCH_SIZE)) {
      const result = await callGraphQueryBatch({ client: caller, network, queries: batch })
      expect(result.tool).toBe('graph_query_batch')
      const entries = result.facts['queries']
      expect(Array.isArray(entries), 'facts.queries is the batch result list').toBe(true)
      for (const entry of entries as BatchEntry[]) if (entry.id) answers.set(entry.id, entry)
    }
    for (const read of answers.get('brands')?.results ?? []) {
      if (typeof read['brand'] === 'string') served.add(read['brand'])
    }
  }, 120_000)

  afterAll(async () => {
    await client?.close()
  })

  it('answers every read of the memo', () => {
    const failed = [...answers.values()].filter((entry) => !entry.ok)
    expect(failed.map((entry) => `${entry.id}: ${entry.error ?? ''}`), 'every read is served').toEqual([])
  })

  it('serves every example pool as :Pool with its adapter mark, deployed by a memo factory', () => {
    const verdicts: string[] = []
    for (const row of memo.rows) {
      const where = `${row.brand} (${row.display}, source ${row.source})`
      if (row.trail_type === 'vault') {
        const [read] = answers.get(`manager:${row.brand}`)?.results ?? []
        if (!read) verdicts.push(`${where}: the manager ${row.factories[0]} is not on the lane`)
        continue
      }
      if (!row.example_pool) continue
      const reads = answers.get(`pool:${row.brand}`)?.results ?? []
      const [first] = reads
      if (!first) {
        verdicts.push(`${where}: the example pool ${row.example_pool} has no creation on the lane`)
        continue
      }
      const problems: string[] = []
      const nodeLabels = (first['node_labels'] as string[] | undefined) ?? []
      const marks = (first['marks'] as string[] | undefined) ?? []
      const adapters = row.adapters ?? [row.adapter]
      if (!nodeLabels.includes('Pool')) problems.push('the example pool is not :Pool')
      if (!adapters.some((adapter) => marks.includes(adapter))) {
        problems.push(`the example pool lacks the mark ${adapters.join(' or ')}, served [${marks.join(', ')}]`)
      }
      const deployers = reads.map((read) => String(read['from_address']))
      if (!deployers.some((deployer) => row.factories.includes(deployer))) {
        problems.push(`deployed by ${deployers.join(', ')}, not a memo factory`)
      }
      if (problems.length) verdicts.push(`${where}: ${problems.join('; ')}`)
    }
    expect(verdicts, 'memo rows the lane does not confirm').toEqual([])
  })

  it('serves at least the recorded pool floor of every brand', () => {
    const under: string[] = []
    for (const row of memo.rows) {
      if (row.trail_type === 'vault' || row.pool_floor === null) continue
      let total = 0
      for (const factory of row.factories) {
        const [read] = answers.get(`count:${row.brand}:${factory}`)?.results ?? []
        const n = Number(read?.['n'])
        if (!(n > 0)) under.push(`${row.brand}: factory ${factory} deployed no pool on the lane`)
        total += Number.isFinite(n) ? n : 0
      }
      if (!(total >= row.pool_floor)) under.push(`${row.brand}: ${total} pools, floor ${row.pool_floor}`)
    }
    expect(under, 'brands under their pool floor').toEqual([])
  })

  it('agrees with the brand the lane serves, once the lane serves one', () => {
    if (served.size === 0) return // the brand roll has not landed on this lane: the memo path alone is judged
    const verdicts: string[] = []
    for (const row of memo.rows) {
      if (!served.has(row.brand)) verdicts.push(`the lane's brand list lacks ${row.brand}`)
      const id = row.trail_type === 'vault' ? `manager:${row.brand}` : `pool:${row.brand}`
      const [read] = answers.get(id)?.results ?? []
      if (read && read['brand'] !== row.brand) {
        verdicts.push(`${row.brand}: the lane serves brand ${String(read['brand'])} on ${row.trail_type === 'vault' ? 'the manager' : 'the example pool'}`)
      }
    }
    expect(verdicts, 'the memo differs from the graph').toEqual([])
  })
})
