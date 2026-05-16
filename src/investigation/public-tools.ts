import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { InvestigatorConfig } from '../config/schema.js'
import { runFundFlowProbe, type TraceFundsResult } from './trace-funds.js'
import { normalizeGraphPayload } from '../viz/graph-normalizer.js'

type RemoteToolResult = {
  content?: ContentBlock[]
  isError?: boolean
}

interface ParsedBatch {
  facts?: {
    queries?: Array<{
      id?: string
      ok?: boolean
      results?: Array<Record<string, unknown>>
      error?: string
    }>
  }
}

export interface AddressRiskOptions {
  address: string
  network: string
  compareAddress?: string
}

export interface TrackFundsOptions {
  trustedAddresses: string | string[]
  untrustedAddresses?: string | string[]
  network: string
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
}

function escapeCypherString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function textFromToolResult(result: RemoteToolResult): string {
  return (result.content ?? [])
    .filter((item): item is Extract<ContentBlock, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

function parseBatchResult(result: RemoteToolResult): ParsedBatch {
  const text = textFromToolResult(result).trim()
  if (!text) throw new Error('graph_query_batch returned no text content')
  const parsed = JSON.parse(text) as ParsedBatch
  if (!parsed.facts?.queries) throw new Error('graph_query_batch response did not include facts.queries')
  return parsed
}

function resultsFor(batch: ParsedBatch, id: string): Array<Record<string, unknown>> {
  const query = batch.facts?.queries?.find((entry) => entry.id === id)
  if (!query) return []
  if (query.ok === false) throw new Error(query.error || `Query failed: ${id}`)
  return query.results ?? []
}

async function callGraphBatch(
  remoteClient: Client,
  network: string,
  queries: Array<{ id: string; query: string }>,
): Promise<ParsedBatch> {
  const result = await remoteClient.callTool({
    name: 'graph_query_batch',
    arguments: {
      network,
      queries,
      per_query_timeout_seconds: 10,
    },
  }) as RemoteToolResult
  if (result.isError) throw new Error(textFromToolResult(result) || 'graph_query_batch failed')
  return parseBatchResult(result)
}

function parseAddressList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function addressProfileQuery(address: string): { id: string; query: string } {
  return {
    id: 'address_profile',
    query: [
      `MATCH (a:Address {address: "${escapeCypherString(address)}"})`,
      'RETURN a.address AS address, labels(a) AS labels, a.confluence_score AS confluence_score, a.ml_risk_level AS ml_risk_level, a.degree_in AS degree_in, a.degree_out AS degree_out, a.total_volume_usd AS total_volume_usd',
      'LIMIT 1',
    ].join(' '),
  }
}

function exchangeOutflowsQuery(address: string): { id: string; query: string } {
  return {
    id: 'exchange_outflows',
    query: [
      `MATCH p = (a:Address {address: "${escapeCypherString(address)}"})-[:FLOWS_TO *BFS (e, v | true)]->(exchange:Exchange)`,
      'WHERE a <> exchange AND NOT any(n IN nodes(p)[1..-1] WHERE "Exchange" IN labels(n))',
      'WITH p, exchange, [n IN nodes(p) | n.address] AS path, relationships(p) AS rels',
      'WITH p, exchange, path, rels, rels[size(rels)-1] AS terminal',
      'RETURN "outflow" AS direction, exchange.address AS exchange_address, labels(exchange) AS exchange_labels, path[size(path)-2] AS deposit_address, size(path)-1 AS hops, terminal.amount_sum AS amount_sum, terminal.amount_usd_sum AS amount_usd_sum, terminal.tx_count AS tx_count, path',
      'ORDER BY amount_usd_sum DESC, amount_sum DESC',
      'LIMIT 10',
    ].join(' '),
  }
}

function exchangeInflowsQuery(address: string): { id: string; query: string } {
  return {
    id: 'exchange_inflows',
    query: [
      `MATCH p = (exchange:Exchange)-[:FLOWS_TO *BFS (e, v | true)]->(a:Address {address: "${escapeCypherString(address)}"})`,
      'WHERE a <> exchange AND NOT any(n IN nodes(p)[1..-1] WHERE "Exchange" IN labels(n))',
      'WITH p, exchange, [n IN nodes(p) | n.address] AS path, relationships(p) AS rels',
      'WITH p, exchange, path, rels, rels[size(rels)-1] AS terminal',
      'RETURN "inflow" AS direction, exchange.address AS exchange_address, labels(exchange) AS exchange_labels, path[1] AS withdrawal_address, size(path)-1 AS hops, terminal.amount_sum AS amount_sum, terminal.amount_usd_sum AS amount_usd_sum, terminal.tx_count AS tx_count, path',
      'ORDER BY amount_usd_sum DESC, amount_sum DESC',
      'LIMIT 10',
    ].join(' '),
  }
}

function connectionProbeQuery(address: string, compareAddress: string): { id: string; query: string } {
  return {
    id: 'connection_probe',
    query: [
      `MATCH p = (a:Address {address: "${escapeCypherString(address)}"})-[:FLOWS_TO *BFS (e, v | true)]-(b:Address {address: "${escapeCypherString(compareAddress)}"})`,
      'RETURN [n IN nodes(p) | n.address] AS path, size(nodes(p))-1 AS hops',
      'ORDER BY hops ASC',
      'LIMIT 5',
    ].join(' '),
  }
}

function formatExchangeRows(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const direction = String(row['direction'] ?? 'flow')
    const exchange = String(row['exchange_address'] ?? '')
    const amount = row['amount_sum'] ?? row['amount_usd_sum'] ?? ''
    const hops = row['hops'] ?? ''
    return `- ${direction}: ${exchange} (${hops} hop(s), amount ${amount})`
  })
}

function buildRiskGraph(address: string, rows: Array<Record<string, unknown>>, network: string): Record<string, unknown> {
  const nodes = new Map<string, Record<string, unknown>>()
  nodes.set(address, { address, role: 'subject', labels: ['Address'], address_type: 'wallet' })
  const edges: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const path = Array.isArray(row['path']) ? row['path'].map(String) : []
    for (const entry of path) {
      if (!nodes.has(entry)) nodes.set(entry, { address: entry, role: null, labels: [], address_type: 'wallet' })
    }
    const exchange = typeof row['exchange_address'] === 'string' ? row['exchange_address'] : ''
    if (exchange) nodes.set(exchange, { address: exchange, role: 'exchange', labels: row['exchange_labels'] ?? ['Exchange'], address_type: 'exchange' })
    for (let index = 0; index < path.length - 1; index += 1) {
      edges.push({
        from_address: path[index],
        to_address: path[index + 1],
        usd_amount: row['amount_usd_sum'] ?? row['amount_sum'] ?? 0,
        amount_sum: row['amount_sum'] ?? 0,
        tx_count: row['tx_count'] ?? 0,
        type: 'FLOWS_TO',
        direction: row['direction'],
      })
    }
  }
  return normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: [...nodes.values()],
    edges,
    flows: [],
    edge_anchors: [],
    metadata: { address, network, generated_at: new Date().toISOString() },
  })
}

export async function addressRisk(remoteClient: Client, options: AddressRiskOptions): Promise<{
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}> {
  const address = options.address.trim()
  const network = options.network.trim()
  const compareAddress = options.compareAddress?.trim() ?? ''
  if (!address) throw new Error('address is required')
  if (!network) throw new Error('network is required')

  const queries = [
    addressProfileQuery(address),
    exchangeOutflowsQuery(address),
    exchangeInflowsQuery(address),
    ...(compareAddress ? [connectionProbeQuery(address, compareAddress)] : [{ id: 'connection_probe', query: 'RETURN [] AS path LIMIT 0' }]),
  ]
  const batch = await callGraphBatch(remoteClient, network, queries)
  const profile = resultsFor(batch, 'address_profile')[0] ?? { address }
  const outflows = resultsFor(batch, 'exchange_outflows')
  const inflows = resultsFor(batch, 'exchange_inflows')
  const connections = compareAddress ? resultsFor(batch, 'connection_probe') : []
  const exchangeRows = [...outflows, ...inflows]
  const graphData = buildRiskGraph(address, exchangeRows, network)

  const lines = [
    `Address risk for ${network}:${address}`,
    '',
    `Risk: ${profile['ml_risk_level'] ?? 'unknown'}${profile['confluence_score'] !== undefined ? ` (${profile['confluence_score']})` : ''}`,
    `Graph degree: in ${profile['degree_in'] ?? 'unknown'}, out ${profile['degree_out'] ?? 'unknown'}.`,
    '',
    'Exchange behavior',
    exchangeRows.length > 0 ? formatExchangeRows(exchangeRows).join('\n') : '- No exchange inflow/outflow paths found in bounded search.',
  ]
  if (compareAddress) {
    lines.push('', `Connection compare target: ${compareAddress}`, connections.length > 0 ? `Connection paths found: ${connections.length}` : 'Connection paths found: 0')
  }

  return {
    summaryText: lines.join('\n'),
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'address_risk',
      facts: {
        subject: { network, addresses: compareAddress ? [address, compareAddress] : [address] },
        risk: {
          level: profile['ml_risk_level'] ?? null,
          score: profile['confluence_score'] ?? null,
        },
        exchange_behavior: {
          outflows,
          inflows,
        },
        connection: compareAddress ? { compare_address: compareAddress, paths: connections } : undefined,
      },
    },
    graphData,
  }
}

export async function trackFunds(
  remoteClient: Client,
  config: Pick<InvestigatorConfig, 'dataDir' | 'serverPort'>,
  options: TrackFundsOptions,
): Promise<{
  summaryText: string
  structuredContent: Record<string, unknown>
  graphData: Record<string, unknown>
}> {
  const network = options.network.trim()
  const trusted = parseAddressList(options.trustedAddresses)
  const untrusted = parseAddressList(options.untrustedAddresses)
  if (!network) throw new Error('network is required')
  if (trusted.length < 1) throw new Error('trusted_addresses must contain at least 1 address')
  if (trusted.length > 5) throw new Error('trusted_addresses cannot exceed 5 addresses')
  if (untrusted.length > 5) throw new Error('untrusted_addresses cannot exceed 5 addresses')
  const overlap = trusted.filter((address) => untrusted.includes(address))
  if (overlap.length > 0) throw new Error(`Address(es) appear in both trusted and untrusted lists: ${overlap.join(', ')}`)

  const runs: Array<{ role: 'trusted' | 'untrusted'; address: string; result: TraceFundsResult }> = []
  for (const address of trusted) {
    runs.push({
      role: 'trusted',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
      }),
    })
  }
  for (const address of untrusted) {
    runs.push({
      role: 'untrusted',
      address,
      result: await runFundFlowProbe(remoteClient, config, {
        seedAddress: address,
        network,
        caseId: options.caseId,
        maxHops: options.maxHops,
        perAddressLimit: options.perAddressLimit,
        minAmountSum: options.minAmountSum,
      }),
    })
  }

  const graphData = normalizeGraphPayload({
    schema: 'chain-insights.graph.v1',
    nodes: runs.flatMap((run) => Array.isArray(run.result.graphData.nodes) ? run.result.graphData.nodes : []),
    edges: runs.flatMap((run) => Array.isArray(run.result.graphData.edges) ? run.result.graphData.edges : []),
    flows: runs.flatMap((run) => Array.isArray(run.result.graphData.flows) ? run.result.graphData.flows : []),
    edge_anchors: [],
    metadata: { network, trusted_addresses: trusted, untrusted_addresses: untrusted, generated_at: new Date().toISOString() },
  })

  return {
    summaryText: [
      `Track funds complete for ${network}`,
      '',
      `Trusted addresses: ${trusted.join(', ')}`,
      `Untrusted addresses: ${untrusted.join(', ') || 'none'}`,
      '',
      ...runs.map((run) => `## ${run.role}: ${run.address}\n${run.result.summaryText}`),
    ].join('\n'),
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'track_funds',
      facts: {
        network,
        trusted_addresses: trusted,
        untrusted_addresses: untrusted,
        runs: runs.map((run) => ({
          role: run.role,
          address: run.address,
          files: run.result.files,
          continuation: run.result.continuation,
          address_map: run.result.addressMap,
        })),
      },
    },
    graphData,
  }
}
