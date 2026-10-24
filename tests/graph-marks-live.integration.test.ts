import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateMcpEndpoint } from '../src/config/mcp-endpoint.js'
import { applyMcpAuthHeaders } from '../src/mcp/client.js'
import { callGraphQueryBatch, type ToolCaller } from '../src/mcp/graph-client.js'
import { PACKAGE_VERSION } from '../src/version.js'
import { readRegistry } from './dex-registry.js'
import { readGolden, type GoldenCountRow, type GoldenMarkRow } from './graph-marks-golden.js'

// Live read of the golden mark set (tests/fixtures/graph-marks-golden.json)
// against a Chain Insights Graph lane. One batch per 20 reads, under a
// minute, no retry loop, no wait for a lane: a T4 check per release
// candidate, never in the push gate.
//
// A row asserts that every golden mark is present and every forbidden mark
// absent. It never asserts equality: a new mark on the lane (a future
// :Bridge, a judgement label on lane B) passes, a dropped golden mark fails
// with the row's name and source link in the message. A count asserts at
// least the recorded floor: the chain grows, so equality would fail on
// health.
//
// The example pool of every row of the exchange registry
// (registry/robinhood.json) is read the same way: it is :Pool and its labels
// hold one of the row's adapters. Nothing about an exchange name is read: the
// graph carries none.
//
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT=http://127.0.0.1:8012/mcp \
//   CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN=<the lane's debug bearer> \
//   npx vitest run tests/graph-marks-live.integration.test.ts

const endpoint = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT']?.trim()
const token = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN']?.trim()
const network = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK']?.trim() || 'robinhood'

// The server caps one batch at 20 queries.
const BATCH_SIZE = 20

type BatchEntry = {
  id?: string
  ok?: boolean
  count?: number
  error?: string
  results?: Array<Record<string, unknown>>
}

type MarkRead = {
  address: string
  node_labels: string[]
  token_standard: string | null
  labels: string[] | null
}

export function rowQuery(row: GoldenMarkRow): string {
  return (
    `USE topology MATCH (a:Address {address: "${row.address}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.token_standard AS token_standard, a.labels AS labels LIMIT 1'
  )
}

export function examplePoolMarkQuery(pool: string): string {
  return (
    `USE topology MATCH (a:Address {address: "${pool}"}) ` +
    'RETURN a.address AS address, labels(a) AS node_labels, a.token_standard AS token_standard, a.labels AS labels LIMIT 1'
  )
}

export function countQuery(count: GoldenCountRow): string {
  return `USE topology MATCH (a:${count.mark}) RETURN count(a) AS n LIMIT 1`
}

/** The one-line verdict of a row against what the lane served: null when it holds. */
export function judgeRow(row: GoldenMarkRow, read: MarkRead | undefined): string | null {
  const where = `${row.name} ${row.address} (source ${row.source}, since block ${row.since_block})`
  if (!read) return `${where}: the lane served no node`
  const served = new Set(read.node_labels)
  const missing = row.marks.filter((mark) => !served.has(mark))
  const forbidden = row.never.filter((mark) => served.has(mark))
  const problems: string[] = []
  if (missing.length) problems.push(`missing ${missing.join(', ')}`)
  if (forbidden.length) problems.push(`carries ${forbidden.join(', ')}`)
  const words = new Set(read.labels ?? [])
  const missingWords = (row.words ?? []).filter((word) => !words.has(word))
  if (missingWords.length) problems.push(`missing label word ${missingWords.join(', ')}; served words [${[...words].sort().join(', ')}]`)
  if (row.token_standard && read.token_standard !== row.token_standard) {
    problems.push(`token_standard ${String(read.token_standard)} wanted ${row.token_standard}`)
  }
  if (!problems.length) return null
  return `${where}: ${problems.join('; ')}; served [${[...served].sort().join(', ')}]`
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

describe.skipIf(!endpoint)('the golden mark set against a live Chain Insights Graph', () => {
  const golden = readGolden()
  const pools = readRegistry().rows.filter((row) => row.example_pool && row.trail_type !== 'vault')
  let client: Client
  let caller: ToolCaller
  const answers = new Map<string, BatchEntry>()

  beforeAll(async () => {
    const url = validateMcpEndpoint(endpoint!, 'CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT')
    const authFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      )
      if (token) applyMcpAuthHeaders(headers, token)
      return fetch(input, { ...init, headers })
    }
    client = new Client({ name: 'chain-insights-live-marks', version: PACKAGE_VERSION })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: authFetch }))
    caller = {
      callTool: (input) =>
        client.callTool(input) as Promise<{
          content?: Array<{ type: string; text?: string }>
          structuredContent?: Record<string, unknown>
          isError?: boolean
        }>,
    }
    const queries = [
      ...golden.rows.map((row) => ({ id: `row:${row.address}`, query: rowQuery(row) })),
      ...golden.counts.map((count) => ({ id: `count:${count.mark}`, query: countQuery(count) })),
      ...pools.map((row) => ({ id: `pool:${row.dex}`, query: examplePoolMarkQuery(row.example_pool!) })),
    ]
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

  it('answers every row and every count', () => {
    const failed = [...answers.values()].filter((entry) => !entry.ok)
    expect(
      failed.map((entry) => `${entry.id}: ${entry.error ?? ''}`),
      'every read of the batch is served'
    ).toEqual([])
    expect(answers.size).toBe(golden.rows.length + golden.counts.length + pools.length)
  })

  it('serves every golden mark on every row, and no forbidden one', () => {
    const verdicts: string[] = []
    for (const row of golden.rows) {
      const [read] = (answers.get(`row:${row.address}`)?.results ?? []) as MarkRead[]
      const verdict = judgeRow(row, read)
      if (verdict) verdicts.push(verdict)
    }
    expect(verdicts, 'rows whose marks the lane does not serve').toEqual([])
  })

  it('serves at least the recorded floor of every mark', () => {
    const under: string[] = []
    for (const count of golden.counts) {
      const [read] = answers.get(`count:${count.mark}`)?.results ?? []
      const served = Number(read?.['n'])
      if (!(served >= count.floor)) {
        under.push(`${count.mark}: served ${served}, floor ${count.floor} read on lane ${count.lane} at ${count.read_at}`)
      }
    }
    expect(under, 'marks under their floor').toEqual([])
  })

  it('serves every registry example pool as :Pool with one of its adapter marks', () => {
    const verdicts: string[] = []
    for (const row of pools) {
      const [read] = (answers.get(`pool:${row.dex}`)?.results ?? []) as MarkRead[]
      const where = `${row.dex} example pool ${row.example_pool} (source ${row.source})`
      if (!read) {
        verdicts.push(`${where}: the lane served no node`)
        continue
      }
      const marks = read.labels ?? []
      if (!read.node_labels.includes('Pool')) verdicts.push(`${where}: not :Pool, served [${read.node_labels.join(', ')}]`)
      if (!row.adapters.some((adapter) => marks.includes(adapter))) {
        verdicts.push(`${where}: lacks the mark ${row.adapters.join(' or ')}, served [${marks.join(', ')}]`)
      }
    }
    expect(verdicts, 'example pools the lane does not mark').toEqual([])
  })
})
