import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PaymentRequiredError } from '../src/mcp/client.js'
import {
  ADDRESS_SAMPLE_LIMIT,
  FACTS_TRANSFER_COLUMNS,
  GraphSchemaError,
  SAMPLED_LINK_TYPES,
  addressSampleQuery,
  buildGraphSchema,
  formatGraphSchemaText,
  getGraphSchema,
  handleMetaSchema,
  linkSampleQuery,
  normalizeSchemaNetwork,
  type GraphSchemaClient,
} from '../src/mcp/graph-schema.js'
import {
  PARTIAL_SCHEMA_TTL_MS,
  graphSchemaCachePath,
  loadGraphSchemaCache,
  saveGraphSchemaCache,
} from '../src/mcp/graph-schema-cache.js'
import { propertiesOf } from './support/facts-columns.js'
import { flat, read } from './support/schema-text.js'

// The replies of the default endpoint of 2026-10-06, recorded once through one
// MCP session: one reply for each read of a build, keyed by its query.
type Reply = { structuredContent: Record<string, unknown> }
const recorded = JSON.parse(read('tests/fixtures/graph-schema-replies-20261006.json')) as {
  billed_units: number
  replies: Record<string, Reply>
}

const LABELS = 'USE topology CALL db.labels()'
const LINK_TYPES = 'USE topology CALL db.relationshipTypes()'
const PROPERTY_KEYS = 'USE topology CALL db.propertyKeys()'
const INDEXES = 'USE topology SHOW INDEXES'
const CAPABILITIES = 'network_capabilities'

const T0 = new Date('2026-10-06T18:00:00.000Z')
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000)

function replyFor(key: string): unknown {
  const reply = recorded.replies[key]
  if (!reply) throw new Error(`no recorded reply for ${key}`)
  return {
    content: [{ type: 'text', text: JSON.stringify(reply.structuredContent) }],
    structuredContent: reply.structuredContent,
  }
}

function recordedRows(key: string): Record<string, unknown>[] {
  const facts = recorded.replies[key]?.structuredContent['facts'] as {
    query: { results: Record<string, unknown>[] }
  }
  return facts.query.results
}

/** A client that answers from the recording, or from `override`, and lists every call it gets. */
function fakeClient(override?: (key: string) => unknown) {
  const calls: string[] = []
  const client: GraphSchemaClient = {
    async callTool(request) {
      const key = request.name === 'graph_query' ? String(request.arguments['query']) : request.name
      calls.push(key)
      const custom = override?.(key)
      if (custom instanceof Error) throw custom
      if (custom !== undefined) return custom
      return replyFor(key)
    },
  }
  return { calls, client }
}

function refusal(code: string, text: string) {
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${text}` }],
    structuredContent: {
      facts: { query: { billable_units: 0, elapsed_ms: 0 } },
      error_detail: { code, class: 'refused', fix: 'Send one read statement.' },
    },
  }
}

const readsOfOneBuild = [
  CAPABILITIES,
  LABELS,
  LINK_TYPES,
  PROPERTY_KEYS,
  INDEXES,
  addressSampleQuery(),
  ...SAMPLED_LINK_TYPES.map((type) => linkSampleQuery(type)),
]

describe('the graph schema built from the recorded catalog answers', () => {
  it('reads the capabilities, the four catalog calls and the samples, one after another, and never db.schema.visualization', async () => {
    const { calls, client } = fakeClient()
    await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })

    expect(calls).toEqual(readsOfOneBuild)
    expect(calls).toEqual([
      'network_capabilities',
      'USE topology CALL db.labels()',
      'USE topology CALL db.relationshipTypes()',
      'USE topology CALL db.propertyKeys()',
      'USE topology SHOW INDEXES',
      'USE topology MATCH (a:Address) RETURN keys(a) AS keys LIMIT 20',
      'USE topology MATCH ()-[r:FLOWS_TO]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:OPERATED_BY]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:LINKED]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:SWAPPED]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:BRIDGED]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:ADDED_LIQUIDITY]->() RETURN keys(r) AS keys LIMIT 5',
      'USE topology MATCH ()-[r:REMOVED_LIQUIDITY]->() RETURN keys(r) AS keys LIMIT 5',
    ])
    expect(calls.join('\n')).not.toContain('visualization')
  })

  it('sends only reads inside the probe limit the server publishes', () => {
    const { topology_admission: admission } = JSON.parse(
      read('tests/fixtures/topology-admission-20261006.json')
    ) as { topology_admission: Record<string, number> }
    expect(ADDRESS_SAMPLE_LIMIT).toBeLessThanOrEqual(admission['probe_max_limit'] ?? 0)
    for (const type of SAMPLED_LINK_TYPES) {
      expect(Number(/LIMIT (\d+)$/.exec(linkSampleQuery(type))?.[1])).toBeLessThanOrEqual(
        admission['probe_max_limit'] ?? 0
      )
    }
  })

  it('answers with the schema of the network in the contract shape', async () => {
    const { client } = fakeClient()
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(true)
    expect(Object.keys(document)).toEqual([
      'schema',
      'network',
      'built_at',
      'source',
      'cached',
      'billed_units',
      'layers',
      'notes',
    ])
    expect(document).toMatchObject({
      schema: 'chain-insights.graph-schema.v1',
      network: 'robinhood',
      built_at: '2026-10-06T18:00:00.000Z',
      source: 'live catalog',
      cached: false,
    })
    expect(Object.keys(document.layers)).toEqual(['topology', 'facts', 'chain'])
    expect(Object.keys(document.layers.topology)).toEqual([
      'labels',
      'link_types',
      'property_keys',
      'indexes',
      'samples',
    ])
  })

  it('names the labels, the link types and the property keys the graph listed, sorted', async () => {
    const { client } = fakeClient()
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })
    const { topology } = document.layers

    expect(topology.labels).toEqual(
      recordedRows(LABELS)
        .map((row) => row['label'])
        .sort()
    )
    expect(topology.labels).toEqual(expect.arrayContaining(['Address', 'Chain', 'Pool']))
    expect(topology.link_types).toEqual(
      recordedRows(LINK_TYPES)
        .map((row) => row['relationshipType'])
        .sort()
    )
    expect(topology.link_types).toHaveLength(13)
    expect(topology.link_types).toEqual(expect.arrayContaining(['FLOWS_TO', 'SWAPPED', 'LINKED']))
    expect(topology.property_keys).toHaveLength(recordedRows(PROPERTY_KEYS).length)
    expect(topology.property_keys).toEqual([...topology.property_keys].sort())
    expect(topology.property_keys).toContain('amount_usd_sum')
  })

  it('lists the property indexes of nodes and links and leaves out the lookup indexes', async () => {
    const { client } = fakeClient()
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })
    const { indexes } = document.layers.topology

    expect(indexes).toContainEqual({
      name: 'address_address_unique',
      entity: 'node',
      types: ['Address'],
      properties: ['address'],
      state: 'ONLINE',
    })
    expect(indexes).toContainEqual({
      name: 'flows_to_pair_key_idx',
      entity: 'link',
      types: ['FLOWS_TO'],
      properties: ['pair_key'],
      state: 'ONLINE',
    })
    const lookups = recordedRows(INDEXES).filter((row) => row['type'] === 'LOOKUP')
    expect(lookups.length).toBeGreaterThan(0)
    expect(indexes).toHaveLength(recordedRows(INDEXES).length - lookups.length)
    for (const index of indexes) {
      expect(index.properties.length, index.name).toBeGreaterThan(0)
      expect(['node', 'link']).toContain(index.entity)
    }
  })

  it('samples an address and each main link type the graph lists, and unions the keys', async () => {
    const { client } = fakeClient()
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })
    const { samples } = document.layers.topology

    expect(Object.keys(samples)).toEqual(['Address', ...SAMPLED_LINK_TYPES])
    expect(samples['FLOWS_TO']).toEqual([
      'amount_usd_sum',
      'first_seen_timestamp',
      'last_seen_timestamp',
      'pair_key',
      'synced_through_height',
      'tx_count',
    ])
    expect(samples['LINKED']).toEqual([
      'basis',
      'confidence',
      'declared_owner',
      'last_height',
      'owner_state',
      'source_event',
    ])
    // A contract carries more keys than a plain address: the union holds every
    // key of every row of the sample.
    const rows = recordedRows(addressSampleQuery()).map((row) => row['keys'] as string[])
    expect(samples['Address']!.length).toBeGreaterThanOrEqual(
      Math.max(...rows.map((keys) => keys.length))
    )
    for (const keys of rows) expect(samples['Address']).toEqual(expect.arrayContaining(keys))
    expect(samples['Address']).toEqual(expect.arrayContaining(['address', 'network', 'labels']))
    for (const keys of Object.values(samples)) expect(keys).toEqual([...keys].sort())
  })

  it('takes the facts relationships and the chain lookups from the published capabilities', async () => {
    const { client } = fakeClient()
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })

    expect(document.layers.facts.relationships).toEqual([
      'TRANSFER',
      'BRIDGE_CROSSING',
      'SWAP',
      'LIQUIDITY_ADD',
      'LIQUIDITY_REMOVE',
    ])
    expect(document.layers.facts.transfer_columns).toEqual([...FACTS_TRANSFER_COLUMNS])
    expect(document.layers.chain.lookups).toEqual(['Transaction', 'Block', 'Head'])
  })

  it('sums the billed units of the replies and says the fields come from a sample', async () => {
    const { client } = fakeClient()
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })

    expect(document.billed_units).toBe(recorded.billed_units)
    expect(document.billed_units).toBe(1019)
    expect(document.notes).toContain(
      'Fields come from a sample of the live graph. A rare field may be missing.'
    )
    expect(document.notes.join('\n')).toContain(
      'Link types with no sample: APPROVED, BUNDLED, DEPLOYED_CONTRACT, SIGNED_AUTHORIZATION, SIGNED_FOR, SPONSORED.'
    )
    expect(document.notes.join('\n')).toContain('never filter or sort on them')
  })

  it('samples only the link types the graph lists', async () => {
    const { calls, client } = fakeClient((key) => {
      if (key !== LINK_TYPES) return undefined
      const reply = replyFor(key) as {
        structuredContent: { facts: { query: { results: unknown[] } } }
      }
      const results = reply.structuredContent.facts.query.results.filter(
        (row) => (row as Record<string, unknown>)['relationshipType'] !== 'BRIDGED'
      )
      const structuredContent = {
        ...reply.structuredContent,
        facts: { query: { ...reply.structuredContent.facts.query, results } },
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      }
    })
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })

    expect(calls).not.toContain(linkSampleQuery('BRIDGED'))
    expect(document.layers.topology.samples).not.toHaveProperty('BRIDGED')
    expect(document.layers.topology.samples).toHaveProperty('FLOWS_TO')
  })

  it('reads the rows from the JSON text when a reply carries no structuredContent', async () => {
    const { client } = fakeClient((key) => {
      if (key !== LABELS) return undefined
      const reply = replyFor(key) as { content: unknown[] }
      return { content: reply.content }
    })
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })
    expect(document.layers.topology.labels).toContain('Address')
  })

  it('pauses between reads only when asked to', async () => {
    const waits: number[] = []
    const { client } = fakeClient()
    await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
      pauseMs: 250,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    expect(waits).toHaveLength(readsOfOneBuild.length - 1)
    expect(new Set(waits)).toEqual(new Set([250]))
  })
})

describe('a read that fails leaves a note and its section empty', () => {
  it('a refused catalog call empties property_keys, notes the code and reads on', async () => {
    const { calls, client } = fakeClient((key) =>
      key === PROPERTY_KEYS
        ? refusal('unsupported_topology_dialect', 'CALL is not served')
        : undefined
    )
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(false)
    expect(document.layers.topology.property_keys).toEqual([])
    expect(document.layers.topology.labels.length).toBeGreaterThan(0)
    expect(Object.keys(document.layers.topology.samples)).toHaveLength(
      1 + SAMPLED_LINK_TYPES.length
    )
    expect(document.notes[0]).toBe(
      'property keys could not be read: unsupported_topology_dialect: CALL is not served'
    )
    expect(calls).toEqual(readsOfOneBuild)
    // The refused read billed nothing.
    expect(document.billed_units).toBe(recorded.billed_units - 133)
  })

  it('a failed link sample empties that kind only', async () => {
    const { client } = fakeClient((key) =>
      key === linkSampleQuery('SWAPPED') ? new Error('socket hang up') : undefined
    )
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(false)
    expect(document.layers.topology.samples).not.toHaveProperty('SWAPPED')
    expect(document.layers.topology.samples).toHaveProperty('BRIDGED')
    expect(document.notes).toContain('the SWAPPED sample could not be read: socket hang up')
  })

  it('failed capabilities empty facts and chain, and the topology is still read', async () => {
    const { client } = fakeClient((key) =>
      key === CAPABILITIES ? new Error('not found') : undefined
    )
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(false)
    expect(document.layers.facts).toEqual({ relationships: [], transfer_columns: [] })
    expect(document.layers.chain).toEqual({ lookups: [] })
    expect(document.layers.topology.labels).toContain('Address')
    expect(document.notes[0]).toBe('network capabilities could not be read: not found')
  })

  it('an unknown set of link types skips the link samples and says so', async () => {
    const { calls, client } = fakeClient((key) =>
      key === LINK_TYPES ? refusal('graph_query_failed', 'down') : undefined
    )
    const { document } = await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })

    for (const type of SAMPLED_LINK_TYPES) expect(calls).not.toContain(linkSampleQuery(type))
    expect(document.notes).toContain('The link samples were skipped: the link types are unknown.')
    expect(document.layers.topology.samples).toHaveProperty('Address')
  })

  it('a rate limit stops the reads after it and says when to call again', async () => {
    const limited = Object.assign(
      new Error(
        'Streamable HTTP error: Error POSTing to endpoint: {"error":"too many requests from this address; retry after 23 seconds"}'
      ),
      { code: 429 }
    )
    const { calls, client } = fakeClient((key) => (key === PROPERTY_KEYS ? limited : undefined))
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(false)
    expect(calls).toEqual([CAPABILITIES, LABELS, LINK_TYPES, PROPERTY_KEYS])
    expect(document.notes.join('\n')).toContain(
      'The endpoint is limiting requests, so the reads after it were not sent. Call again after 23 seconds with refresh=true.'
    )
    expect(document.layers.topology.labels.length).toBeGreaterThan(0)
    expect(document.layers.topology.indexes).toEqual([])
  })

  it('a busy answer of the capacity class counts as a rate limit', async () => {
    const busy = {
      isError: true,
      content: [{ type: 'text', text: 'topology_busy: no free slot' }],
      structuredContent: { error_detail: { code: 'topology_busy', class: 'capacity' } },
    }
    const { calls, client } = fakeClient((key) => (key === LABELS ? busy : undefined))
    await buildGraphSchema({ client, network: 'robinhood', now: () => T0 })
    expect(calls).toEqual([CAPABILITIES, LABELS])
  })

  it('a payment request stops the reads after it and says what to fix', async () => {
    const { calls, client } = fakeClient((key) =>
      key === LINK_TYPES ? new PaymentRequiredError('Payment required for graph_query.') : undefined
    )
    const { document, complete } = await buildGraphSchema({
      client,
      network: 'robinhood',
      now: () => T0,
    })

    expect(complete).toBe(false)
    expect(calls).toEqual([CAPABILITIES, LABELS, LINK_TYPES])
    expect(document.notes.slice(0, 2)).toEqual([
      'link types could not be read: Payment required for graph_query.',
      'The endpoint asks for payment, so the reads after it were not sent. Fix the payment setup, then call again with refresh=true.',
    ])
    // The reads before it stand, and the capabilities still fill facts and chain.
    expect(document.layers.topology.labels).toContain('Address')
    expect(document.layers.facts.relationships).toContain('TRANSFER')
  })

  it('a network the capabilities do not list is refused before any graph read', async () => {
    const { calls, client } = fakeClient()
    await expect(buildGraphSchema({ client, network: 'ethereum', now: () => T0 })).rejects.toThrow(
      new GraphSchemaError(
        'network_not_served: "ethereum" is not a network this endpoint serves. Served networks: robinhood.'
      )
    )
    expect(calls).toEqual([CAPABILITIES])
  })
})

describe('the network argument', () => {
  it('is a lower-case identifier', () => {
    expect(normalizeSchemaNetwork(' Robinhood ')).toBe('robinhood')
    expect(normalizeSchemaNetwork('base-sepolia')).toBe('base-sepolia')
  })

  it.each([undefined, null, '', '  ', 42])('refuses %j as missing', (value) => {
    expect(() => normalizeSchemaNetwork(value)).toThrow(/^invalid_network: network is required/)
  })

  it.each(['../etc/passwd', 'robinhood chain', 'a/b', '-x', 'x'.repeat(65)])(
    'refuses %j: it would reach a file name',
    (value) => {
      expect(() => normalizeSchemaNetwork(value)).toThrow(/is not a network identifier/)
    }
  )
})

describe('the schema cache on disk', () => {
  const endpoint = 'https://mcp.example.test/'
  let home: string
  let previousHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ci-graph-schema-'))
    previousHome = process.env['HOME']
    process.env['HOME'] = home
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
    await rm(home, { recursive: true, force: true })
  })

  function session(override?: (key: string) => unknown) {
    const { calls, client } = fakeClient(override)
    let sessions = 0
    return {
      calls,
      get sessions() {
        return sessions
      },
      options: {
        endpoint,
        now: () => T0,
        withClient: async <T>(fn: (client: GraphSchemaClient) => Promise<T>) => {
          sessions += 1
          return fn(client)
        },
      },
    }
  }

  it('lives under the data dir as cache/schema-<network>-<endpoint hash>.json, owner only', async () => {
    const run = session()
    await getGraphSchema({ ...run.options, network: 'robinhood' })

    const file = graphSchemaCachePath('robinhood', endpoint)
    expect(file).toMatch(
      new RegExp(
        `^${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.chain-insights/cache/schema-robinhood-[0-9a-f]{12}\\.json$`
      )
    )
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await readdir(join(home, '.chain-insights', 'cache'))).toEqual([file.split('/').at(-1)])
    // Another endpoint has its own file.
    expect(graphSchemaCachePath('robinhood', 'https://other.example.test/')).not.toBe(file)
  })

  it('misses, then hits: a fresh cache answers cached true with no session and no read', async () => {
    const run = session()
    const first = await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(first.cached).toBe(false)
    expect(run.sessions).toBe(1)
    expect(run.calls).toEqual(readsOfOneBuild)

    const second = await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(second.cached).toBe(true)
    expect(run.sessions).toBe(1)
    expect(run.calls).toHaveLength(readsOfOneBuild.length)
    expect({ ...second, cached: false }).toEqual(first)
  })

  it('refresh rebuilds in one new session and replaces the file', async () => {
    const run = session()
    await getGraphSchema({ ...run.options, network: 'robinhood' })
    const rebuilt = await getGraphSchema({ ...run.options, network: 'robinhood', refresh: true })

    expect(rebuilt.cached).toBe(false)
    expect(run.sessions).toBe(2)
    expect(run.calls).toHaveLength(2 * readsOfOneBuild.length)
    expect((await getGraphSchema({ ...run.options, network: 'robinhood' })).cached).toBe(true)
  })

  it('is valid for 24 hours', async () => {
    const run = session()
    await getGraphSchema({ ...run.options, network: 'robinhood' })

    const hit = await loadGraphSchemaCache(
      'robinhood',
      endpoint,
      new Date(T0.getTime() + 23 * 3_600_000)
    )
    expect(hit?.cached).toBe(true)
    const miss = await loadGraphSchemaCache(
      'robinhood',
      endpoint,
      new Date(T0.getTime() + 25 * 3_600_000)
    )
    expect(miss).toBeNull()

    await getGraphSchema({
      ...run.options,
      now: () => new Date(T0.getTime() + 25 * 3_600_000),
      network: 'robinhood',
    })
    expect(run.sessions).toBe(2)
  })

  it('keeps a schema with a failed read for ten minutes only', async () => {
    const run = session((key) => (key === INDEXES ? new Error('socket hang up') : undefined))
    await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(PARTIAL_SCHEMA_TTL_MS).toBe(10 * 60_000)

    const soon = await getGraphSchema({
      ...run.options,
      now: () => minutes(9),
      network: 'robinhood',
    })
    expect(soon.cached).toBe(true)
    expect(run.sessions).toBe(1)

    const later = await getGraphSchema({
      ...run.options,
      now: () => minutes(11),
      network: 'robinhood',
    })
    expect(later.cached).toBe(false)
    expect(run.sessions).toBe(2)
  })

  it('does not share a cache between endpoints or between networks', async () => {
    const run = session()
    await getGraphSchema({ ...run.options, network: 'robinhood' })
    await getGraphSchema({
      ...run.options,
      endpoint: 'https://other.example.test/',
      network: 'robinhood',
    })
    expect(run.sessions).toBe(2)
  })

  it('treats a damaged file as a miss and replaces it', async () => {
    const file = graphSchemaCachePath('robinhood', endpoint)
    await mkdir(join(home, '.chain-insights', 'cache'), { recursive: true })
    await writeFile(file, '{ not json')

    const run = session()
    const built = await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(built.cached).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8')).document.network).toBe('robinhood')
  })

  it('asks for a client only when it builds', async () => {
    const run = session()
    await saveGraphSchemaCache(
      'robinhood',
      (await buildGraphSchema({ client: fakeClient().client, network: 'robinhood', now: () => T0 }))
        .document,
      endpoint,
      true,
      T0
    )
    await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(run.sessions).toBe(0)
  })

  it('refuses a name that is not an identifier before it touches the disk', async () => {
    const run = session()
    await expect(getGraphSchema({ ...run.options, network: '../../x' })).rejects.toThrow(
      /invalid_network/
    )
    expect(existsSync(join(home, '.chain-insights'))).toBe(false)
    expect(run.sessions).toBe(0)
  })

  it('saves nothing for a network the endpoint does not serve', async () => {
    const run = session()
    await expect(getGraphSchema({ ...run.options, network: 'ethereum' })).rejects.toThrow(
      /network_not_served/
    )
    expect(existsSync(join(home, '.chain-insights', 'cache'))).toBe(false)
  })

  it('shares one build between two callers that ask at once, in one session', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => {
      release = done
    })
    const { calls, client } = fakeClient()
    let sessions = 0
    const options = {
      endpoint,
      now: () => T0,
      network: 'robinhood',
      withClient: async <T>(fn: (client: GraphSchemaClient) => Promise<T>) => {
        sessions += 1
        await gate
        return fn(client)
      },
    }
    const both = Promise.all([
      getGraphSchema(options),
      getGraphSchema({ ...options, refresh: true }),
    ])
    release()
    const [a, b] = await both
    expect(sessions).toBe(1)
    expect(calls).toHaveLength(readsOfOneBuild.length)
    expect(a).toBe(b)
  })

  it('notes a cache that cannot be written and still answers', async () => {
    // A file where the cache directory should be.
    await mkdir(join(home, '.chain-insights'), { recursive: true })
    await writeFile(join(home, '.chain-insights', 'cache'), 'not a directory')
    const run = session()
    const built = await getGraphSchema({ ...run.options, network: 'robinhood' })
    expect(built.layers.topology.labels).toContain('Address')
    expect(built.notes.join('\n')).toContain('The schema could not be saved to the cache:')
  })
})

describe('the meta_schema answer', () => {
  const endpoint = 'https://mcp.example.test/'
  let home: string
  let previousHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ci-meta-schema-'))
    previousHome = process.env['HOME']
    process.env['HOME'] = home
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
    await rm(home, { recursive: true, force: true })
  })

  const deps = (client: GraphSchemaClient) => ({
    endpoint,
    now: () => T0,
    withClient: <T>(fn: (client: GraphSchemaClient) => Promise<T>) => fn(client),
    describeFailure: (err: unknown) => `MCP call failed: ${(err as Error).message}`,
  })

  it('returns the compact text for the model and the document as structuredContent', async () => {
    const result = await handleMetaSchema({ network: 'robinhood' }, deps(fakeClient().client))

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toMatchObject({
      schema: 'chain-insights.graph-schema.v1',
      network: 'robinhood',
      cached: false,
    })
    const text = result.content[0]!.text
    expect(text.split('\n')[0]).toBe('Graph schema, network robinhood')
    expect(text).toContain('USE topology')
    expect(text).toContain('Labels: Address, Bundler, Chain')
    expect(text).toContain('- node Address(address) ONLINE')
    expect(text).toContain('- FLOWS_TO: amount_usd_sum, first_seen_timestamp')
    expect(text).toContain('USE facts\nRelationships: TRANSFER, BRIDGE_CROSSING')
    expect(text).toContain('USE chain\nLookups: Transaction, Block, Head')
    expect(text).toContain('read now for 1019 billed units and cached for 24 hours')
    // Compact: no JSON braces, one line for each list.
    expect(text).not.toContain('{')
    expect(text.length).toBeLessThan(6000)
  })

  it('says it came from the cache on a second call', async () => {
    const client = fakeClient().client
    await handleMetaSchema({ network: 'robinhood' }, deps(client))
    const second = await handleMetaSchema({ network: 'robinhood' }, deps(client))

    expect(second.structuredContent).toMatchObject({ cached: true })
    expect(second.content[0]!.text).toContain(
      'from the cache, kept 24 hours; refresh=true rebuilds it'
    )
  })

  it('refresh=true rebuilds', async () => {
    const run = fakeClient()
    await handleMetaSchema({ network: 'robinhood' }, deps(run.client))
    const again = await handleMetaSchema({ network: 'robinhood', refresh: true }, deps(run.client))

    expect(again.structuredContent).toMatchObject({ cached: false })
    expect(run.calls).toHaveLength(2 * readsOfOneBuild.length)
  })

  it.each([
    [{}, /invalid_network: network is required/],
    [{ network: 'robinhood', refresh: 'yes' }, /invalid_refresh/],
    [{ network: 'ethereum' }, /network_not_served: "ethereum"/],
  ])('refuses %j as an error answer with its own words', async (args, pattern) => {
    const result = await handleMetaSchema(args, deps(fakeClient().client))
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(pattern)
  })

  it('describes a failure that is not its own', async () => {
    const result = await handleMetaSchema(
      { network: 'robinhood' },
      {
        ...deps(fakeClient().client),
        withClient: async () => {
          throw new Error('payment required')
        },
      }
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]!.text).toBe('MCP call failed: payment required')
  })

  it('prints the notes of a partial schema, and the empty section says none read', async () => {
    const client = fakeClient((key) =>
      key === LABELS ? new Error('socket hang up') : undefined
    ).client
    const result = await handleMetaSchema({ network: 'robinhood' }, deps(client))
    const text = result.content[0]!.text

    expect(result.isError).toBe(false)
    expect(text).toContain('Labels: none read')
    expect(text).toContain('Notes:\n- labels could not be read: socket hang up')
  })

  it('formats an empty document without a list of nothing', () => {
    const text = formatGraphSchemaText({
      schema: 'chain-insights.graph-schema.v1',
      network: 'robinhood',
      built_at: T0.toISOString(),
      source: 'live catalog',
      cached: false,
      billed_units: 0,
      layers: {
        topology: { labels: [], link_types: [], property_keys: [], indexes: [], samples: {} },
        facts: { relationships: [], transfer_columns: [] },
        chain: { lookups: [] },
      },
      notes: [],
    })
    expect(text).toContain('Indexes: none read')
    expect(text).toContain('Fields, from a sample: none read')
    expect(text).not.toContain('Notes:')
  })
})

describe('the TRANSFER columns of the schema', () => {
  it('are columns the graph server maps on TRANSFER', () => {
    const mapped = new Set(propertiesOf('TRANSFER'))
    expect(
      FACTS_TRANSFER_COLUMNS.filter((name) => !mapped.has(name)),
      'a column the server does not map on TRANSFER'
    ).toEqual([])
  })

  it('are the columns the cypher skill lists, in its order', () => {
    const skill = flat(read('skills/chain-insights-cypher/SKILL.md'))
    const listed = /`TRANSFER` columns: ([^.]*)\. `kind` is/.exec(skill)?.[1] ?? ''
    const names = listed.match(/[a-z_]+/g)?.filter((word) => word !== 'and') ?? []
    expect([...FACTS_TRANSFER_COLUMNS]).toEqual(names)
  })
})
