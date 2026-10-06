/**
 * meta_schema: the live graph schema of one network, read from the graph
 * endpoint and kept on disk for 24 hours.
 *
 * The graph serves four read-only catalog statements on `USE topology` through
 * the ordinary graph_query tool: `CALL db.labels()`, `CALL db.relationshipTypes()`,
 * `CALL db.propertyKeys()` and `SHOW INDEXES`. They name the labels, the link
 * types, every property key and the indexes. They do not say which keys belong to
 * which kind, so the main kinds are sampled with the two probe forms the server
 * admits (`keys(a)` on addresses, `keys(r)` on a link). The facts relationships
 * and the chain lookups come from the network's published capabilities.
 *
 * One build is one MCP session and runs its reads one after another: the public
 * endpoint allows about 30 requests a minute for each IP address, and opening a
 * session costs three of them. A read that fails leaves its section empty and
 * adds a note. It never fails the tool.
 */

import { findNetworkCapability, mirrorGraphNetworkCapabilities } from './capabilities.js'
import type { NetworkCapability } from './capabilities.js'
import { PaymentRequiredError } from './client.js'
import { refusalText, type GraphQueryAnswer } from './flows.js'
import { loadGraphSchemaCache, saveGraphSchemaCache } from './graph-schema-cache.js'

export const GRAPH_SCHEMA_ID = 'chain-insights.graph-schema.v1' as const
export const GRAPH_SCHEMA_SOURCE = 'live catalog' as const
export const META_SCHEMA_TITLE = 'Graph schema'
export const META_SCHEMA_DESCRIPTION =
  'Return the live graph schema of one network: the labels, the link types, the field names of an address and of each main link, the indexes, the USE facts relationships with the TRANSFER columns, and the USE chain lookups. ' +
  'Call it first when you need field names. It is cached for 24 hours; pass refresh=true to rebuild it.'

/** Fields of an address come from this many sampled nodes, and of a link from this many sampled links. */
export const ADDRESS_SAMPLE_LIMIT = 20
export const LINK_SAMPLE_LIMIT = 5

/** The link types an agent queries. Each is sampled only when the graph lists it. */
export const SAMPLED_LINK_TYPES = [
  'FLOWS_TO',
  'OPERATED_BY',
  'LINKED',
  'SWAPPED',
  'BRIDGED',
  'ADDED_LIQUIDITY',
  'REMOVED_LIQUIDITY',
] as const

// The TRANSFER columns the cypher skill lists, in its order. tests/graph-schema.test.ts
// holds this list to the skill and to the columns the graph server maps on TRANSFER
// (tests/fixtures/facts-columns.json).
export const FACTS_TRANSFER_COLUMNS = [
  'tx_id',
  'block_date',
  'block_height',
  'block_timestamp',
  'event_index',
  'edge_index',
  'kind',
  'asset_contract',
  'asset_symbol',
  'amount',
  'amount_usd',
  'price_usd',
  'price_missing',
  'token_id',
  'token_standard',
  'operator_address',
  'raw_amount',
  'decimals',
] as const

// `CALL db.schema.visualization()` is not read. It bills about 427 units where
// the four statements below bill 13 to 133 each, and it adds only which labels a
// link type joins, which the cypher skill and the served hints already say.
const CATALOG_READS = {
  labels: { label: 'labels', query: 'USE topology CALL db.labels()' },
  linkTypes: { label: 'link types', query: 'USE topology CALL db.relationshipTypes()' },
  propertyKeys: { label: 'property keys', query: 'USE topology CALL db.propertyKeys()' },
  indexes: { label: 'indexes', query: 'USE topology SHOW INDEXES' },
} as const

export function addressSampleQuery(): string {
  return `USE topology MATCH (a:Address) RETURN keys(a) AS keys LIMIT ${ADDRESS_SAMPLE_LIMIT}`
}

export function linkSampleQuery(linkType: string): string {
  return `USE topology MATCH ()-[r:${linkType}]->() RETURN keys(r) AS keys LIMIT ${LINK_SAMPLE_LIMIT}`
}

export interface GraphSchemaIndex {
  name: string
  entity: 'node' | 'link'
  /** The labels of a node index, the link types of a link index. */
  types: string[]
  properties: string[]
  state: string
}

export interface GraphSchemaDocument {
  schema: typeof GRAPH_SCHEMA_ID
  network: string
  built_at: string
  source: typeof GRAPH_SCHEMA_SOURCE
  cached: boolean
  /** Units the reads of the build billed, summed from the replies. A cached document keeps the units of its build. */
  billed_units: number
  layers: {
    topology: {
      labels: string[]
      link_types: string[]
      property_keys: string[]
      indexes: GraphSchemaIndex[]
      samples: Record<string, string[]>
    }
    facts: { relationships: string[]; transfer_columns: string[] }
    chain: { lookups: string[] }
  }
  notes: string[]
}

/** A refusal with its own words for the caller: a bad argument, an unserved network, an endpoint that is down. */
export class GraphSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphSchemaError'
  }
}

export interface GraphSchemaClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
}

type Row = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : []
}

const NETWORK_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * The network as a lower-case identifier. It becomes part of a file name and of
 * every query, so only an identifier passes.
 */
export function normalizeSchemaNetwork(raw: unknown): string {
  const network = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!network) {
    throw new GraphSchemaError(
      'invalid_network: network is required. Pass the identifier of a served network, for example robinhood.'
    )
  }
  if (!NETWORK_PATTERN.test(network)) {
    throw new GraphSchemaError(
      `invalid_network: "${String(raw).trim()}" is not a network identifier. Pass the identifier of a served network, for example robinhood.`
    )
  }
  return network
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function queryBlock(structured: unknown): Row | null {
  const facts = isRecord(structured) ? structured.facts : undefined
  const query = isRecord(facts) ? facts.query : undefined
  return isRecord(query) ? query : null
}

/** The `facts.query` block of one graph_query reply, from structuredContent or from the JSON text. */
function answerQuery(answer: GraphQueryAnswer): Row | null {
  const fromStructured = queryBlock(answer.structuredContent)
  if (fromStructured) return fromStructured
  for (const block of answer.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      const parsed = queryBlock(JSON.parse(block.text))
      if (parsed) return parsed
    } catch {
      /* not JSON: try the next block */
    }
  }
  return null
}

// A failure after which every later read would fail the same way: the endpoint
// limits requests, or it asks for payment. The build stops sending reads.
type Halt = 'rate_limit' | 'payment'

function haltOfError(err: unknown): Halt | undefined {
  if (err instanceof PaymentRequiredError) return 'payment'
  const code = isRecord(err) ? err.code : undefined
  const message = err instanceof Error ? err.message : String(err)
  if (code === 429 || /\b429\b|too many requests|rate.?limit/i.test(message)) return 'rate_limit'
  if (/\b402\b|payment required/i.test(message)) return 'payment'
  return undefined
}

function haltOfAnswer(answer: GraphQueryAnswer): Halt | undefined {
  const detail = isRecord(answer.structuredContent)
    ? answer.structuredContent.error_detail
    : undefined
  return isRecord(detail) && detail.class === 'capacity' ? 'rate_limit' : undefined
}

export interface BuildOptions {
  client: GraphSchemaClient
  /** A normalized network identifier. */
  network: string
  now?: () => Date
  /** A wait between two reads, in milliseconds. One build needs none: it stays under the rate limit. */
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface BuildResult {
  document: GraphSchemaDocument
  /** False when a read failed: the document has a section missing. */
  complete: boolean
}

function describeIndex(row: Row): GraphSchemaIndex | null {
  const name = typeof row.name === 'string' ? row.name : ''
  const entity =
    row.entityType === 'NODE' ? 'node' : row.entityType === 'RELATIONSHIP' ? 'link' : null
  const properties = stringList(row.properties)
  // A lookup index names no label and no property: it tells an agent nothing.
  if (!name || !entity || properties.length === 0) return null
  return {
    name,
    entity,
    types: stringList(row.labelsOrTypes),
    properties,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
  }
}

export async function buildGraphSchema(options: BuildOptions): Promise<BuildResult> {
  const { client } = options
  const now = options.now ?? (() => new Date())
  const pauseMs = options.pauseMs ?? 0
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  const problems: string[] = []
  const remarks: string[] = []
  let billed = 0
  let calls = 0
  let halted = false

  async function pace(): Promise<void> {
    if (calls > 0 && pauseMs > 0) await sleep(pauseMs)
    calls += 1
  }

  function fail(label: string, reason: string, halt?: Halt): null {
    problems.push(`${label} could not be read: ${reason}`)
    if (halt && !halted) {
      halted = true
      if (halt === 'payment') {
        problems.push(
          'The endpoint asks for payment, so the reads after it were not sent. Fix the payment setup, then call again with refresh=true.'
        )
      } else {
        // The endpoint says how long to wait: "retry after 23 seconds".
        const wait = /retry after (\d+) seconds?/i.exec(reason)?.[1]
        problems.push(
          `The endpoint is limiting requests, so the reads after it were not sent. Call again after ${wait ? `${wait} seconds` : 'a minute'} with refresh=true.`
        )
      }
    }
    return null
  }

  async function graphRead(network: string, label: string, query: string): Promise<Row[] | null> {
    if (halted) return null
    await pace()
    let answer: GraphQueryAnswer
    try {
      answer = (await client.callTool({
        name: 'graph_query',
        arguments: { network, query },
      })) as GraphQueryAnswer
    } catch (err) {
      return fail(label, err instanceof Error ? err.message : String(err), haltOfError(err))
    }
    const block = answerQuery(answer ?? {})
    if (block && typeof block.billable_units === 'number') billed += block.billable_units
    if (answer?.isError === true) {
      return fail(label, refusalText(answer), haltOfAnswer(answer))
    }
    if (!block || !Array.isArray(block.results)) {
      return fail(label, 'the reply holds no rows')
    }
    return block.results.filter(isRecord)
  }

  // ── The network: capabilities first, so an unserved name costs no graph read.
  let network = options.network
  let capability: NetworkCapability | undefined
  await pace()
  try {
    const answer = (await client.callTool({
      name: 'network_capabilities',
      arguments: {},
    })) as GraphQueryAnswer
    if (answer?.isError === true) {
      fail('network capabilities', refusalText(answer), haltOfAnswer(answer))
    } else {
      const facts = isRecord(answer?.structuredContent) ? answer.structuredContent.facts : undefined
      const capabilities = isRecord(facts) ? facts.capabilities : undefined
      const networks =
        isRecord(capabilities) && Array.isArray(capabilities.networks)
          ? capabilities.networks
          : null
      if (!networks) {
        fail('network capabilities', 'the reply lists no networks')
      } else {
        const document = mirrorGraphNetworkCapabilities({ networks })
        capability = findNetworkCapability(document, options.network)
        if (!capability) {
          const served = document.networks.map((entry) => entry.network).join(', ')
          throw new GraphSchemaError(
            `network_not_served: "${options.network}" is not a network this endpoint serves. Served networks: ${served || 'none'}.`
          )
        }
        network = capability.network
      }
    }
  } catch (err) {
    if (err instanceof GraphSchemaError) throw err
    fail('network capabilities', err instanceof Error ? err.message : String(err), haltOfError(err))
  }

  // ── Topology: the catalog, then a sample of the main kinds.
  const topology: GraphSchemaDocument['layers']['topology'] = {
    labels: [],
    link_types: [],
    property_keys: [],
    indexes: [],
    samples: {},
  }
  const topologyOff = capability?.layers?.topology?.enabled === false
  if (topologyOff) {
    remarks.push('The topology layer is off on this network.')
  } else {
    const labels = await graphRead(network, CATALOG_READS.labels.label, CATALOG_READS.labels.query)
    if (labels) topology.labels = sortedUnique(labels.flatMap((row) => stringList([row.label])))

    const linkTypes = await graphRead(
      network,
      CATALOG_READS.linkTypes.label,
      CATALOG_READS.linkTypes.query
    )
    if (linkTypes) {
      topology.link_types = sortedUnique(
        linkTypes.flatMap((row) => stringList([row.relationshipType]))
      )
    }

    const keys = await graphRead(
      network,
      CATALOG_READS.propertyKeys.label,
      CATALOG_READS.propertyKeys.query
    )
    if (keys) {
      topology.property_keys = sortedUnique(keys.flatMap((row) => stringList([row.propertyKey])))
    }

    const indexes = await graphRead(
      network,
      CATALOG_READS.indexes.label,
      CATALOG_READS.indexes.query
    )
    if (indexes) {
      topology.indexes = indexes
        .map(describeIndex)
        .filter((index): index is GraphSchemaIndex => index !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    // An address is sampled unless the label list was read and has no Address.
    const labelsRead = labels !== null
    if (!labelsRead || topology.labels.includes('Address')) {
      const rows = await graphRead(network, 'the Address sample', addressSampleQuery())
      if (rows) topology.samples['Address'] = unionOfKeys(rows)
    }

    const sampled = SAMPLED_LINK_TYPES.filter((type) => topology.link_types.includes(type))
    if (linkTypes === null && !halted) {
      problems.push('The link samples were skipped: the link types are unknown.')
    }
    for (const type of sampled) {
      const rows = await graphRead(network, `the ${type} sample`, linkSampleQuery(type))
      if (rows) topology.samples[type] = unionOfKeys(rows)
    }

    const unsampled = topology.link_types.filter(
      (type) => !(SAMPLED_LINK_TYPES as readonly string[]).includes(type)
    )
    if (unsampled.length > 0) {
      remarks.push(
        `Link types with no sample: ${unsampled.join(', ')}. Read the keys of one with USE topology MATCH ()-[r:<TYPE>]->() RETURN keys(r) AS keys LIMIT ${LINK_SAMPLE_LIMIT}.`
      )
    }
  }

  // ── Facts and chain: what the network publishes.
  const facts: GraphSchemaDocument['layers']['facts'] = { relationships: [], transfer_columns: [] }
  const chain: GraphSchemaDocument['layers']['chain'] = { lookups: [] }
  if (capability) {
    if (capability.layers?.facts?.enabled === false) {
      remarks.push('The facts layer is off on this network.')
    } else {
      facts.relationships = stringList(capability.layers?.facts?.relationships)
      if (facts.relationships.includes('TRANSFER')) {
        facts.transfer_columns = [...FACTS_TRANSFER_COLUMNS]
      }
    }
    const admission = capability.chain_admission
    if (admission?.enabled === false) {
      remarks.push(`The chain layer is off (status ${admission.status ?? 'unknown'}).`)
    } else {
      chain.lookups = stringList(admission?.lookups)
    }
  }

  const words = [...topology.property_keys, ...Object.values(topology.samples).flat()]
  if (words.includes('synced_through_height') || words.includes('pair_key')) {
    remarks.push(
      'synced_through_height and pair_key are sync bookkeeping: never filter or sort on them.'
    )
  }
  remarks.push('Fields come from a sample of the live graph. A rare field may be missing.')

  return {
    complete: problems.length === 0,
    document: {
      schema: GRAPH_SCHEMA_ID,
      network,
      built_at: now().toISOString(),
      source: GRAPH_SCHEMA_SOURCE,
      cached: false,
      billed_units: billed,
      layers: { topology, facts, chain },
      notes: [...problems, ...remarks],
    },
  }
}

function unionOfKeys(rows: Row[]): string[] {
  return sortedUnique(rows.flatMap((row) => stringList(row.keys)))
}

// ─── Reading from the cache, or building ──────────────────────────────────────

export interface GetGraphSchemaOptions {
  /** As the caller wrote it: normalized here. */
  network: unknown
  refresh?: boolean
  endpoint: string
  /**
   * Runs `fn` with one connected client. It is called once for a build and not at
   * all when the cache answers, so a cache hit opens no session.
   */
  withClient: <T>(fn: (client: GraphSchemaClient) => Promise<T>) => Promise<T>
  now?: () => Date
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
}

// Builds in flight, by endpoint and network: two callers that ask for one
// schema at once share one build and pay for it once.
const building = new Map<string, Promise<GraphSchemaDocument>>()

export async function getGraphSchema(options: GetGraphSchemaOptions): Promise<GraphSchemaDocument> {
  const network = normalizeSchemaNetwork(options.network)
  const now = options.now ?? (() => new Date())
  if (options.refresh !== true) {
    const cached = await loadGraphSchemaCache(network, options.endpoint, now())
    if (cached) return cached
  }
  const key = `${options.endpoint}\n${network}`
  const running = building.get(key)
  if (running) return running
  const build = (async () => {
    const { document, complete } = await options.withClient((client) =>
      buildGraphSchema({
        client,
        network,
        now,
        ...(options.pauseMs === undefined ? {} : { pauseMs: options.pauseMs }),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      })
    )
    try {
      await saveGraphSchemaCache(network, document, options.endpoint, complete, now())
    } catch (err) {
      document.notes.push(
        `The schema could not be saved to the cache: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    return document
  })()
  building.set(key, build)
  try {
    return await build
  } finally {
    building.delete(key)
  }
}

// ─── Text ─────────────────────────────────────────────────────────────────────

function listLine(title: string, values: string[], empty = 'none read'): string {
  return `${title}: ${values.length > 0 ? values.join(', ') : empty}`
}

/** The schema as the model and the terminal read it. */
export function formatGraphSchemaText(document: GraphSchemaDocument): string {
  const { topology, facts, chain } = document.layers
  const origin = document.cached
    ? 'from the cache, kept 24 hours; refresh=true rebuilds it'
    : `read now for ${document.billed_units} billed units and cached for 24 hours`
  const lines = [
    `Graph schema, network ${document.network}`,
    `Source: ${document.source}, built ${document.built_at} (${origin})`,
    '',
    'USE topology',
    listLine('Labels', topology.labels),
    listLine('Link types', topology.link_types),
    listLine(`Property keys (${topology.property_keys.length})`, topology.property_keys),
  ]
  lines.push(topology.indexes.length > 0 ? 'Indexes:' : 'Indexes: none read')
  for (const index of topology.indexes) {
    lines.push(
      `- ${index.entity} ${index.types.join('|')}(${index.properties.join(', ')}) ${index.state}`
    )
  }
  const sampled = Object.entries(topology.samples)
  lines.push(sampled.length > 0 ? 'Fields, from a sample:' : 'Fields, from a sample: none read')
  for (const [kind, fields] of sampled) lines.push(`- ${kind}: ${fields.join(', ')}`)
  lines.push(
    '',
    'USE facts',
    listLine('Relationships', facts.relationships),
    listLine('TRANSFER columns', facts.transfer_columns),
    '',
    'USE chain',
    listLine('Lookups', chain.lookups)
  )
  if (document.notes.length > 0) {
    lines.push('', 'Notes:', ...document.notes.map((note) => `- ${note}`))
  }
  return lines.join('\n')
}

// ─── The MCP tool ─────────────────────────────────────────────────────────────

export interface GraphSchemaDependencies {
  endpoint: string
  withClient: GetGraphSchemaOptions['withClient']
  /** The text of a failure that is not a GraphSchemaError: payment required, transport. */
  describeFailure: (err: unknown) => string
  now?: () => Date
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type MetaSchemaResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError: boolean
}

function errorResult(text: string): MetaSchemaResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** meta_schema, {network, refresh?}. Every argument is checked before the first read. */
export async function handleMetaSchema(
  args: unknown,
  deps: GraphSchemaDependencies
): Promise<MetaSchemaResult> {
  const record = isRecord(args) ? args : {}
  const refresh = record.refresh
  if (refresh !== undefined && refresh !== null && typeof refresh !== 'boolean') {
    return errorResult('invalid_refresh: refresh must be true or false')
  }
  try {
    const document = await getGraphSchema({
      network: record.network,
      refresh: refresh === true,
      endpoint: deps.endpoint,
      withClient: deps.withClient,
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.pauseMs === undefined ? {} : { pauseMs: deps.pauseMs }),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    })
    return {
      content: [{ type: 'text', text: formatGraphSchemaText(document) }],
      structuredContent: document as unknown as Record<string, unknown>,
      isError: false,
    }
  } catch (err) {
    return errorResult(err instanceof GraphSchemaError ? err.message : deps.describeFailure(err))
  }
}
