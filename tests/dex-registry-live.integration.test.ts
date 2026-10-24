import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateMcpEndpoint } from '../src/config/mcp-endpoint.js'
import { applyMcpAuthHeaders } from '../src/mcp/client.js'
import { contractQuery } from '../src/mcp/dex-tool.js'
import { callGraphQueryBatch, type ToolCaller } from '../src/mcp/graph-client.js'
import { PACKAGE_VERSION } from '../src/version.js'
import { readRegistry, type DexRow } from './dex-registry.js'

// Live read of the served exchange registry (registry/robinhood.json) against a
// Chain Insights Graph lane, per release candidate: a wrong address would reach
// every proxy within the hour, so the release is not published while a row is
// red. Batches of 20, under a minute, no wait for a lane: a T4 check, never in
// the push gate. Run it on lane B and on lane A.
//
// Per row:
//   - every factory, manager and router is a contract on the lane;
//   - every factory of a row with a pool floor deployed pools, and the row's
//     factories deployed at least the floor;
//   - the example pool is :Pool, carries one of the row's adapter marks, and
//     was deployed by one of its factories.
// Nothing about an exchange name is read: the graph carries none.
//
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT=http://127.0.0.1:8012/mcp \
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN=<the lane's debug bearer> \
//   CIA_LIVE_LANE=b \
//   npx vitest run tests/dex-registry-live.integration.test.ts

const endpoint = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT']?.trim()
const token = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN']?.trim()
const network = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK']?.trim() || 'robinhood'
const lane = process.env['CIA_LIVE_LANE']?.trim() || endpoint || 'the lane'
const BATCH_SIZE = 20

type BatchEntry = {
  id?: string
  ok?: boolean
  error?: string
  results?: Array<Record<string, unknown>>
}

export function examplePoolQuery(row: DexRow): string {
  return (
    `USE topology MATCH (f:Address)-[:DEPLOYED_CONTRACT]->(p:Address {address: "${row.example_pool}"}) ` +
    'RETURN f.address AS from_address, labels(p) AS node_labels, p.labels AS marks LIMIT 5'
  )
}

export function factoryCountQuery(factory: string): string {
  return `USE topology MATCH (f:Address {address: "${factory}"})-[:DEPLOYED_CONTRACT]->(p:Pool) RETURN count(p) AS n LIMIT 1`
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size))
  return out
}

describe.skipIf(!endpoint)('the exchange registry against a live Chain Insights Graph', () => {
  const registry = readRegistry()
  let client: Client
  let caller: ToolCaller
  const answers = new Map<string, BatchEntry>()
  const contracts = registry.rows.flatMap((row) =>
    Object.entries(row.roles).map(([address, role]) => ({ row, address, role }))
  )

  beforeAll(async () => {
    const url = validateMcpEndpoint(endpoint!, 'CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT')
    const authFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      )
      if (token) applyMcpAuthHeaders(headers, token)
      return fetch(input, { ...init, headers })
    }
    client = new Client({ name: 'chain-insights-live-dex-registry', version: PACKAGE_VERSION })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: authFetch }))
    caller = {
      callTool: (input) =>
        client.callTool(input) as Promise<{
          content?: Array<{ type: string; text?: string }>
          structuredContent?: Record<string, unknown>
          isError?: boolean
        }>,
    }
    const queries: Array<{ id: string; query: string }> = contracts.map(({ row, address }) => ({
      id: `contract:${row.dex}:${address}`,
      query: contractQuery(address),
    }))
    for (const row of registry.rows) {
      if (row.trail_type !== 'vault' && row.example_pool) {
        queries.push({ id: `pool:${row.dex}`, query: examplePoolQuery(row) })
      }
      if (row.trail_type !== 'vault' && row.pool_floor !== null) {
        for (const factory of row.factories) {
          queries.push({ id: `count:${row.dex}:${factory}`, query: factoryCountQuery(factory) })
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
  }, 120_000)

  afterAll(async () => {
    await client?.close()
  })

  it('answers every read of the registry', () => {
    const failed = [...answers.values()].filter((entry) => !entry.ok)
    expect(
      failed.map((entry) => `${entry.id}: ${entry.error ?? ''}`),
      'every read is served'
    ).toEqual([])
  })

  it('shows every factory, manager and router as a contract', () => {
    const unconfirmed: string[] = []
    for (const { row, address, role } of contracts) {
      const [read] = answers.get(`contract:${row.dex}:${address}`)?.results ?? []
      const labels = (read?.['node_labels'] as string[] | undefined) ?? []
      if (!read || !(read['is_contract'] === true || labels.includes('Contract'))) {
        unconfirmed.push(
          `${row.dex} ${role} ${address} on ${lane}: ${read ? 'not a contract' : 'not on the lane'} (source ${row.source})`
        )
      }
    }
    expect(unconfirmed, 'registry contracts the lane does not confirm').toEqual([])
    console.info(
      `registry version ${registry.registry_version}, ${registry.rows.length} exchanges, ${contracts.length} contracts confirmed on ${lane}`
    )
  })

  it('serves every example pool as :Pool with its adapter mark, deployed by a factory of its row', () => {
    const verdicts: string[] = []
    for (const row of registry.rows) {
      if (row.trail_type === 'vault' || !row.example_pool) continue
      const where = `${row.dex} (${row.display}, source ${row.source}) on ${lane}`
      const reads = answers.get(`pool:${row.dex}`)?.results ?? []
      if (reads.length === 0) {
        verdicts.push(`${where}: the example pool ${row.example_pool} has no creation on the lane`)
        continue
      }
      const problems: string[] = []
      const nodeLabels = (reads[0]!['node_labels'] as string[] | undefined) ?? []
      const marks = (reads[0]!['marks'] as string[] | undefined) ?? []
      if (!nodeLabels.includes('Pool')) problems.push('the example pool is not :Pool')
      if (!row.adapters.some((adapter) => marks.includes(adapter))) {
        problems.push(
          `the example pool lacks the mark ${row.adapters.join(' or ')}, served [${marks.join(', ')}]`
        )
      }
      const deployers = reads.map((read) => String(read['from_address']))
      if (!deployers.some((deployer) => row.factories.includes(deployer))) {
        problems.push(`deployed by ${deployers.join(', ')}, not a factory of the row`)
      }
      if (problems.length) verdicts.push(`${where}: ${problems.join('; ')}`)
    }
    expect(verdicts, 'registry rows the lane does not confirm').toEqual([])
  })

  it('serves at least the pool floor of every exchange, and pools from every factory', () => {
    const under: string[] = []
    for (const row of registry.rows) {
      if (row.trail_type === 'vault' || row.pool_floor === null) continue
      let total = 0
      for (const factory of row.factories) {
        const [read] = answers.get(`count:${row.dex}:${factory}`)?.results ?? []
        const n = Number(read?.['n'])
        if (!(n > 0)) under.push(`${row.dex}: factory ${factory} deployed no pool on ${lane}`)
        total += Number.isFinite(n) ? n : 0
      }
      if (!(total >= row.pool_floor))
        under.push(`${row.dex}: ${total} pools on ${lane}, floor ${row.pool_floor}`)
    }
    expect(under, 'exchanges under their pool floor').toEqual([])
  })
})
