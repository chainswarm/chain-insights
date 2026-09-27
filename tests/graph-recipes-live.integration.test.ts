import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateMcpEndpoint } from '../src/config/mcp-endpoint.js'
import { pairAnchorQuery } from '../src/investigation/public-tools.js'
import { fetchNetworkCapabilities, type NetworkCapability } from '../src/mcp/capabilities.js'
import { applyMcpAuthHeaders } from '../src/mcp/client.js'
import { callGraphQueryBatch, type ToolCaller } from '../src/mcp/graph-client.js'
import { PACKAGE_VERSION } from '../src/version.js'

// Live recipe run: every documented recipe in tests/fixtures/documented-recipes.json
// and every entry of the query corpus (tests/fixtures/graph-query-corpus.json,
// the queries the product builders emit) is sent to a running Chain Insights
// Graph endpoint, exactly as the batch wrapper sends it. The unit tests pin
// the query text; this one proves the backend still admits, refuses and
// answers each shape after a backend change.
//
// Opt in with CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT (the /mcp URL). The debug
// or test-access token goes in CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN and the
// network in CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK (default robinhood). Without
// the endpoint the suite is skipped, so `npm test` never needs a backend.
//
// Recipes carry two flags the runner reads:
//   admits: false  — the backend must refuse the query with the remedy text;
//   expect_rows    — the recipe is anchored on fixture data the backend
//                    serves, so it must return at least one row.

const endpoint = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT']?.trim()
const token = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN']?.trim()
const network = process.env['CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK']?.trim() || 'robinhood'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Recipe = {
  id: string
  query: string
  layer: 'facts' | 'topology'
  admits?: boolean
  expect_rows?: boolean
  features: string[]
}

type BatchEntry = {
  id?: string
  ok?: boolean
  count?: number
  error?: string
  results?: Array<Record<string, unknown>>
}

const recipes = (
  JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/documented-recipes.json'), 'utf8')) as {
    recipes: Recipe[]
  }
).recipes

type CorpusEntry = { builder: string; scope: string; query: string }

const corpus = (
  JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/graph-query-corpus.json'), 'utf8')) as {
    entries: CorpusEntry[]
  }
).entries
const corpusId = (index: number): string => `corpus_${String(index).padStart(2, '0')}`

// The backend's default recency window for an address read with no day bound
// (FACTS_RECENCY_WINDOW_DAYS). The product pair anchor carries no day bound.
const RECENCY_WINDOW_DAYS = 90
const DAY_MS = 86_400_000

// The server caps one batch at 20 queries.
const BATCH_SIZE = 20
const PARTITION_REMEDY = /partition-bounding predicate/

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

// The aliases of a recipe's RETURN list. Every fixture-anchored recipe aliases
// every projection, so the alias set is the exact output column contract.
function returnAliases(query: string): string[] {
  const returnAt = query.lastIndexOf(' RETURN ')
  const tail = query.slice(returnAt + ' RETURN '.length)
  return [...tail.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]!)
}

function entriesById(facts: Record<string, unknown>): Map<string, BatchEntry> {
  const queries = facts['queries']
  expect(Array.isArray(queries), 'facts.queries is the batch result list').toBe(true)
  const map = new Map<string, BatchEntry>()
  for (const entry of queries as BatchEntry[]) {
    if (entry.id) map.set(entry.id, entry)
  }
  return map
}

describe.skipIf(!endpoint)('documented recipes against a live Chain Insights Graph', () => {
  let client: Client
  let caller: ToolCaller
  let advertised: NetworkCapability | undefined
  const answers = new Map<string, BatchEntry>()
  const corpusAnswers = new Map<string, BatchEntry>()

  async function runBatch(queries: Array<{ id: string; query: string }>) {
    const result = await callGraphQueryBatch({ client: caller, network, queries })
    expect(result.tool).toBe('graph_query_batch')
    return entriesById(result.facts)
  }

  beforeAll(async () => {
    const url = validateMcpEndpoint(endpoint!, 'CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT')
    const authFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      )
      if (token) applyMcpAuthHeaders(headers, token)
      return fetch(input, { ...init, headers })
    }
    client = new Client({ name: 'chain-insights-live-recipes', version: PACKAGE_VERSION })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: authFetch }))
    caller = {
      callTool: (input) =>
        client.callTool(input, undefined, { timeout: 120_000, maxTotalTimeout: 120_000 }),
    }
    for (const batch of chunk(recipes, BATCH_SIZE)) {
      const batchAnswers = await runBatch(
        batch.map((recipe) => ({ id: recipe.id, query: recipe.query }))
      )
      for (const [id, entry] of batchAnswers) answers.set(id, entry)
    }
    const corpusQueries = corpus.map((entry, index) => ({
      id: corpusId(index),
      query: entry.query,
    }))
    for (const batch of chunk(corpusQueries, BATCH_SIZE)) {
      for (const [id, entry] of await runBatch(batch)) corpusAnswers.set(id, entry)
    }
    const capabilities = await fetchNetworkCapabilities({
      graphMcpEndpoint: endpoint!,
      graphMcpMode: token ? 'debug' : 'paid',
      graphMcpAuthToken: token,
    })
    advertised = capabilities.networks.find((entry) => entry.network === network)
  }, 300_000)

  afterAll(async () => {
    await client?.close()
  })

  it('advertises the network live, with graph_query_batch available and a block coverage', () => {
    // The product client mirrors the backend's network list: name, status,
    // tools and coverage. Layers are not part of what it repeats.
    expect(advertised, `network ${network} advertised at ${endpoint}`).toBeDefined()
    expect(advertised!.status).toBe('live')
    expect(advertised!.tools['graph_query']).toBe('available')
    expect(advertised!.tools['graph_query_batch']).toBe('available')
    const coverage = advertised!.coverage
    expect(coverage, 'coverage block range').toBeDefined()
    expect(coverage!.from_block).toBeLessThanOrEqual(coverage!.to_block!)
  })

  it('answers every recipe in the batch', () => {
    for (const recipe of recipes) {
      expect(answers.has(recipe.id), `no batch entry for ${recipe.id}`).toBe(true)
    }
  })

  it('runs every admitted recipe without an error', () => {
    for (const recipe of recipes.filter((entry) => entry.admits !== false)) {
      const entry = answers.get(recipe.id)!
      expect(entry.ok, `${recipe.id} (${recipe.layer}) failed: ${entry.error ?? ''}`).toBe(true)
      expect(Array.isArray(entry.results), `${recipe.id} returned no result list`).toBe(true)
    }
  })

  it('refuses every recipe documented as refused, naming the remedy', () => {
    const refused = recipes.filter((entry) => entry.admits === false)
    expect(refused.length).toBeGreaterThan(0)
    for (const recipe of refused) {
      const entry = answers.get(recipe.id)!
      expect(entry.ok, `${recipe.id} must be refused`).toBe(false)
      expect(entry.error ?? '', `${recipe.id} remedy`).toMatch(PARTITION_REMEDY)
    }
  })

  it('returns rows for every fixture-anchored recipe, under its RETURN aliases only', () => {
    const anchored = recipes.filter((entry) => entry.expect_rows)
    expect(anchored.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['recipe_facts_transfer_06', 'recipe_facts_transfer_07'])
    )
    for (const recipe of anchored) {
      const entry = answers.get(recipe.id)!
      expect(entry.ok, `${recipe.id} failed: ${entry.error ?? ''}`).toBe(true)
      const rows = entry.results ?? []
      expect(rows.length, `${recipe.id} returned no rows`).toBeGreaterThan(0)
      expect(entry.count).toBe(rows.length)
      const aliases = [...returnAliases(recipe.query)].sort()
      for (const row of rows) {
        expect(Object.keys(row).sort(), `${recipe.id} output columns`).toEqual(aliases)
      }
    }
  })

  it('renders every address column as a lower-case 0x address on an EVM network', () => {
    if (network !== 'robinhood') return
    for (const recipe of recipes.filter((entry) => entry.expect_rows)) {
      for (const row of answers.get(recipe.id)!.results ?? []) {
        for (const column of ['from_address', 'to_address']) {
          if (column in row) {
            expect(row[column], `${recipe.id}.${column}`).toMatch(/^0x[0-9a-f]{40}$/)
          }
        }
        if ('tx_id' in row) {
          expect(row['tx_id'], `${recipe.id}.tx_id`).toMatch(/^0x[0-9a-f]{64}$/)
        }
      }
    }
  })

  it('admits every corpus query the product builders and the documented recipes emit', () => {
    // The corpus is the admission contract: it leaves out the recipes marked
    // admits: false, so every entry must run.
    expect(corpusAnswers.size).toBe(corpus.length)
    corpus.forEach((entry, index) => {
      const answer = corpusAnswers.get(corpusId(index))
      expect(answer, `no batch entry for corpus ${index} (${entry.builder})`).toBeDefined()
      expect(
        answer!.ok,
        `corpus ${index} (${entry.builder}, ${entry.scope}) failed: ${answer!.error ?? ''}`
      ).toBe(true)
      expect(Array.isArray(answer!.results), `corpus ${index} returned no result list`).toBe(true)
    })
  })

  it('anchors a pair through the product pair anchor, first and latest transfer', async () => {
    // The pair of the tx_id recipe's first row, asked the way the product asks
    // for a pair's transaction anchor: no day bound, so the recency window
    // applies. Rows are required only while the served coverage ends inside it.
    const [first] = answers.get('recipe_facts_transfer_06')?.results ?? []
    expect(first, 'the tx_id recipe returned a row to anchor on').toBeDefined()
    const from = String(first!['from_address'])
    const to = String(first!['to_address'])
    const anchors = await runBatch([
      { id: 'anchor_asc', query: pairAnchorQuery(from, to, 'ASC') },
      { id: 'anchor_desc', query: pairAnchorQuery(from, to, 'DESC') },
    ])
    const coverageEnd = Date.parse(advertised?.coverage?.to_timestamp ?? '')
    const insideWindow = Date.now() - coverageEnd < RECENCY_WINDOW_DAYS * DAY_MS
    const stamps: number[] = []
    for (const id of ['anchor_asc', 'anchor_desc']) {
      const entry = anchors.get(id)
      expect(entry?.ok, `${id} failed: ${entry?.error ?? ''}`).toBe(true)
      const rows = entry!.results ?? []
      if (insideWindow) expect(rows.length, `${id} returned no anchor`).toBe(1)
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['block_timestamp', 'tx_id'])
        if (network === 'robinhood') expect(row['tx_id']).toMatch(/^0x[0-9a-f]{64}$/)
        stamps.push(Number(row['block_timestamp']))
      }
    }
    if (stamps.length === 2) expect(stamps[0]).toBeLessThanOrEqual(stamps[1]!)
  })
})
