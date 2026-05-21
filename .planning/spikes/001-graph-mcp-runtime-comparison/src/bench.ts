import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Driver } from 'neo4j-driver'

import { validateReadOnlyCypher } from './cypher.js'
import { createDriver, memgraphConfigFor, runReadQuery } from './memgraph.js'

type Target = {
  name: string
  kind: 'mcp' | 'direct'
  url?: string
  headers?: Record<string, string>
}

type Sample = {
  queryName: string
  target: string
  ms: number
  ok: boolean
  count?: number
  error?: string
}

type Runner = {
  call(cypher: string): Promise<number>
  close(): Promise<void>
}

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 20)
const NETWORK = process.env.BENCH_NETWORK ?? 'bittensor'

const PYTHON_MCP_URL = process.env.PYTHON_MCP_URL ?? 'http://127.0.0.1:8011/mcp'
const HONO_MCP_URL = process.env.HONO_MCP_URL ?? 'http://127.0.0.1:8911/mcp'
const GO_MCP_URL = process.env.GO_MCP_URL ?? 'http://127.0.0.1:8921/mcp'
const DEBUG_TOKEN = process.env.MCP_DEBUG_BYPASS_TOKEN ?? process.env.GRAPHRAG_DEBUG_TOKEN ?? 'chain-insights-dev-debug'

const targets: Target[] = [
  { name: 'python-fastmcp', kind: 'mcp', url: PYTHON_MCP_URL, headers: { 'X-MCP-Debug-Token': DEBUG_TOKEN } },
  { name: 'ts-hono-mcp', kind: 'mcp', url: HONO_MCP_URL },
  { name: 'go-mcp', kind: 'mcp', url: GO_MCP_URL },
  { name: 'direct-memgraph', kind: 'direct' },
]

async function main() {
  const sampleAddress = await getSampleAddress()
  const queries = [
    {
      name: 'address_sample_10',
      cypher: 'MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 10',
    },
    {
      name: 'node_count',
      cypher: 'MATCH (n) RETURN count(n) AS count LIMIT 1',
    },
    {
      name: 'one_hop_expand_50',
      cypher: `MATCH (a {address: "${sampleAddress}"})-[r]-(b) RETURN a, r, b LIMIT 50`,
    },
  ]

  const samples: Sample[] = []

  for (const target of targets) {
    const runner = await createRunner(target)
    try {
      for (const query of queries) {
        await runOnce(target, runner, query.name, query.cypher)
        for (let i = 0; i < ITERATIONS; i += 1) {
          samples.push(await runOnce(target, runner, query.name, query.cypher))
        }
      }
    } finally {
      await runner.close()
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    network: NETWORK,
    iterations: ITERATIONS,
    sampleAddress,
    summaries: summarize(samples),
    samples,
  }

  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const resultsDir = path.join(root, 'results')
  await mkdir(resultsDir, { recursive: true })
  await writeFile(path.join(resultsDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.summaries, null, 2))
  console.log(`wrote ${path.join(resultsDir, 'latest.json')}`)
}

async function runOnce(
  target: Target,
  runner: Runner,
  queryName: string,
  cypher: string,
): Promise<Sample> {
  const started = performance.now()
  try {
    const count = await runner.call(cypher)
    return {
      queryName,
      target: target.name,
      ms: performance.now() - started,
      ok: true,
      count,
    }
  } catch (error) {
    return {
      queryName,
      target: target.name,
      ms: performance.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function createRunner(target: Target): Promise<Runner> {
  if (target.kind === 'direct') return createDirectRunner()
  return createMcpRunner(target)
}

async function createMcpRunner(target: Target): Promise<Runner> {
  const client = new Client({ name: `bench-${target.name}`, version: '0.0.0' })
  const fetchWithHeaders: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    for (const [key, value] of Object.entries(target.headers ?? {})) headers.set(key, value)
    return fetch(input, { ...init, headers })
  }
  const transport = new StreamableHTTPClientTransport(new URL(target.url ?? ''), {
    fetch: fetchWithHeaders,
  })
  await client.connect(transport)
  return {
    async call(cypher: string): Promise<number> {
    const result = await client.callTool({
      name: 'graph_query',
      arguments: { network: NETWORK, query: cypher },
    })
    const structuredContent = result.structuredContent as
      | { facts?: { query?: { count?: number } } }
      | undefined
    const facts = structuredContent?.facts
    return facts?.query?.count ?? 0
    },
    close: () => client.close(),
  }
}

function createDirectRunner(): Runner {
  const driver: Driver = createDriver(memgraphConfigFor(NETWORK))
  return {
    async call(cypher: string): Promise<number> {
      const rows = await runReadQuery(driver, validateReadOnlyCypher(cypher))
      return rows.length
    },
    close: () => driver.close(),
  }
}

async function getSampleAddress(): Promise<string> {
  const driver = createDriver(memgraphConfigFor(NETWORK))
  try {
    const rows = await runReadQuery(
      driver,
      'MATCH (n) WHERE n.address IS NOT NULL RETURN n.address AS address LIMIT 1',
    )
    const address = rows[0]?.address
    if (typeof address !== 'string') throw new Error('No sample address found in Memgraph')
    return address
  } finally {
    await driver.close()
  }
}

function summarize(samples: Sample[]) {
  const groups = new Map<string, Sample[]>()
  for (const sample of samples) {
    const key = `${sample.target}:${sample.queryName}`
    const current = groups.get(key) ?? []
    current.push(sample)
    groups.set(key, current)
  }

  return [...groups.entries()].map(([key, group]) => {
    const [target, queryName] = key.split(':')
    const ok = group.filter((sample) => sample.ok)
    const failed = group.length - ok.length
    const times = ok.map((sample) => sample.ms).sort((a, b) => a - b)
    return {
      target,
      queryName,
      ok: ok.length,
      failed,
      count: ok[0]?.count ?? null,
      p50_ms: percentile(times, 0.5),
      p95_ms: percentile(times, 0.95),
      min_ms: times[0] ?? null,
      max_ms: times.at(-1) ?? null,
    }
  })
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))
  return Math.round(values[index] * 100) / 100
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
