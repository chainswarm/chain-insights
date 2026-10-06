import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildGraphSchema } from '../src/mcp/graph-schema.js'
import { saveGraphSchemaCache } from '../src/mcp/graph-schema-cache.js'

// `cia network <name> --schema` prints the graph schema of a network: the same
// text meta_schema gives a model, or its JSON with --json, from the 24 hour cache
// or from one rebuilt session with --refresh. The built CLI runs against a
// temporary HOME and an endpoint nothing listens on: a cache hit never reaches
// it, and a rebuild must fail naming it.

const cliBin = join(process.cwd(), 'bin', 'cli.js')
const ENDPOINT = 'http://127.0.0.1:9/mcp'

const recorded = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/graph-schema-replies-20261006.json'), 'utf8')
) as { replies: Record<string, { structuredContent: Record<string, unknown> }> }

let seededHome: string
let emptyHome: string

function run(args: string[], home: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT: ENDPOINT,
  }
  delete env['CIA_ACTION_LOG']
  return spawnSync(process.execPath, [cliBin, ...args], { encoding: 'utf8', env, timeout: 30_000 })
}

beforeAll(async () => {
  seededHome = mkdtempSync(join(tmpdir(), 'ci-cli-schema-seeded-'))
  emptyHome = mkdtempSync(join(tmpdir(), 'ci-cli-schema-empty-'))
  const previousHome = process.env['HOME']
  process.env['HOME'] = seededHome
  try {
    const { document } = await buildGraphSchema({
      client: {
        async callTool(request) {
          const key =
            request.name === 'graph_query' ? String(request.arguments['query']) : request.name
          const reply = recorded.replies[key]
          if (!reply) throw new Error(`no recorded reply for ${key}`)
          return {
            content: [{ type: 'text', text: JSON.stringify(reply.structuredContent) }],
            structuredContent: reply.structuredContent,
          }
        },
      },
      network: 'robinhood',
    })
    await saveGraphSchemaCache('robinhood', document, ENDPOINT, true, new Date())
  } finally {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
  }
})

afterAll(() => {
  rmSync(seededHome, { recursive: true, force: true })
  rmSync(emptyHome, { recursive: true, force: true })
})

describe('cia network <name> --schema', () => {
  it('prints the schema readably from the cache, with no request to the endpoint', () => {
    const result = run(['network', 'robinhood', '--schema'], seededHome)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const lines = result.stdout.split('\n')
    expect(lines[0]).toBe('Graph schema, network robinhood')
    expect(lines[1]).toContain('Source: live catalog, built ')
    expect(lines[1]).toContain('from the cache, kept 24 hours; refresh=true rebuilds it')
    expect(result.stdout).toContain('USE topology\nLabels: Address, Bundler, Chain')
    expect(result.stdout).toContain('- node Address(address) ONLINE')
    expect(result.stdout).toContain('- FLOWS_TO: amount_usd_sum, first_seen_timestamp')
    expect(result.stdout).toContain('USE facts\nRelationships: TRANSFER, BRIDGE_CROSSING')
    expect(result.stdout).toContain('USE chain\nLookups: Transaction, Block, Head')
    expect(result.stdout).toContain('Notes:\n- Link types with no sample: APPROVED')
  })

  it('prints the structured form with --json', () => {
    const result = run(['network', 'robinhood', '--schema', '--json'], seededHome)

    expect(result.status).toBe(0)
    const schema = JSON.parse(result.stdout) as {
      schema: string
      network: string
      cached: boolean
      source: string
      layers: { topology: { samples: Record<string, string[]> }; chain: { lookups: string[] } }
    }
    expect(schema).toMatchObject({
      schema: 'chain-insights.graph-schema.v1',
      network: 'robinhood',
      source: 'live catalog',
      cached: true,
    })
    expect(schema.layers.topology.samples['FLOWS_TO']).toContain('tx_count')
    expect(schema.layers.chain.lookups).toEqual(['Transaction', 'Block', 'Head'])
  })

  it('answers cia mcp call meta_schema with the same text', () => {
    const viaCall = run(['mcp', 'call', 'meta_schema', 'network=robinhood'], seededHome)
    const viaNetwork = run(['network', 'robinhood', '--schema'], seededHome)

    expect(viaCall.status).toBe(0)
    expect(viaCall.stdout).toBe(viaNetwork.stdout)
  })

  it('rebuilds with --refresh: it opens a session and names the endpoint when it cannot', () => {
    const result = run(['network', 'robinhood', '--schema', '--refresh'], seededHome)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`Could not reach the Chain Insights Graph endpoint ${ENDPOINT}`)
  })

  it('builds when there is no cache, and fails naming the endpoint', () => {
    const result = run(['network', 'robinhood', '--schema'], emptyHome)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Could not reach the Chain Insights Graph endpoint ${ENDPOINT}`)
    expect(existsSync(join(emptyHome, '.chain-insights', 'cache'))).toBe(false)
  })

  it('needs --schema for --refresh', () => {
    const result = run(['network', 'robinhood', '--refresh'], seededHome)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--refresh needs --schema')
  })

  it('refuses a name that is not a network identifier before any request', () => {
    const result = run(['network', '../etc/passwd', '--schema'], seededHome)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid_network')
    expect(result.stderr).not.toContain('Could not reach')
  })

  it('lists both options in the help', () => {
    const result = run(['network', '--help'], seededHome)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--schema')
    expect(result.stdout).toContain('--refresh')
    expect(result.stdout).toContain('cached for 24 hours')
  })
})
