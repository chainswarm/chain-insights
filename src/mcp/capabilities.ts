import type { InvestigatorConfig } from '../config/schema.js'
import { applyMcpAuthHeaders, resolveGraphMcpEndpoint } from './client.js'

export interface NetworkTopologyLayer {
  enabled: boolean
  coverage?: {
    from_block?: number
    to_block?: number
    from_timestamp?: string
    to_timestamp?: string
    chain_tip_block?: number
    blocks_behind_tip?: number
  }
}

export interface NetworkLayerCapability {
  enabled: boolean
  live?: NetworkTopologyLayer
  archive?: NetworkTopologyLayer
}

export interface NetworkCapability {
  network: string
  display_name?: string
  status: string
  default?: boolean
  layers: Record<string, NetworkLayerCapability>
  tools: Record<string, string>
  coverage?: {
    from_block?: number
    to_block?: number
    from_timestamp?: string
    to_timestamp?: string
    chain_tip_block?: number
    blocks_behind_tip?: number
  }
  freshness?: {
    last_processed_at?: string
    last_successful_sync_at?: string
    max_data_age_seconds?: number
    last_processing_duration_seconds?: number
  }
}

export interface NetworkCapabilitiesDocument {
  schema: 'chain-insights.network-capabilities.v1'
  networks: NetworkCapability[]
}

const BITTENSOR_SEMANTIC_NETWORKS = new Set(['bittensor', 'bittensor_evm', 'bittensor_semantic'])
const PUBLIC_CHAIN_INSIGHTS_TOOL_STATUS = {
  aml_address_risk: 'available',
  graph_query: 'available',
  graph_query_batch: 'available',
  meta_network_capabilities: 'available',
  meta_usage_status: 'available',
  wallet_balance: 'available',
} as const
const AVAILABLE_TOOLS_PER_LINE = 3

function publicNetworkCapabilities(document: NetworkCapabilitiesDocument): NetworkCapabilitiesDocument {
  const source = document.networks.find((network) => BITTENSOR_SEMANTIC_NETWORKS.has(network.network))
  return {
    schema: 'chain-insights.network-capabilities.v1',
    networks: source
      ? [{
        network: 'bittensor',
        display_name: 'Bittensor',
        status: source.status || 'live',
        default: source.default !== false,
        layers: {
          facts: { enabled: source.layers.facts?.enabled === true },
          risk: { enabled: source.layers.risk?.enabled === true },
          topology: {
            enabled: source.layers.topology?.enabled === true,
            ...(source.layers.topology?.live ? { live: source.layers.topology.live } : {}),
            ...(source.layers.topology?.archive ? { archive: source.layers.topology.archive } : {}),
          },
        },
        ...(source.coverage ? { coverage: source.coverage } : {}),
        ...(source.freshness ? { freshness: source.freshness } : {}),
        tools: PUBLIC_CHAIN_INSIGHTS_TOOL_STATUS,
      }]
      : [],
  }
}

function metadataNetworksUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  url.pathname = '/metadata/networks'
  url.search = ''
  url.hash = ''
  return url
}

export async function fetchNetworkCapabilities(
  config: Pick<InvestigatorConfig, 'graphMcpAuthToken' | 'graphMcpMode' | 'graphMcpEndpoint'>,
): Promise<NetworkCapabilitiesDocument> {
  const endpoint = resolveGraphMcpEndpoint(config)
  const request = metadataNetworksUrl(endpoint)
  const headers = new Headers()
  const token = config.graphMcpAuthToken?.trim()
  if (token) {
    applyMcpAuthHeaders(headers, token)
  }
  let response: Response
  try {
    response = await fetch(request, { headers })
  } catch (err) {
    throw new Error(`network capabilities unavailable at ${request}: ${(err as Error).message}`)
  }
  if (!response.ok) {
    throw new Error(`network capabilities unavailable at ${request}: HTTP ${response.status}`)
  }
  const parsed = await response.json() as NetworkCapabilitiesDocument
  if (parsed.schema !== 'chain-insights.network-capabilities.v1' || !Array.isArray(parsed.networks)) {
    throw new Error('network capabilities response has unsupported schema')
  }
  return publicNetworkCapabilities(parsed)
}

function layerValue(network: NetworkCapability, layer: string): string {
  const capability = network.layers[layer]
  if (!capability?.enabled) return 'no'
  return 'yes'
}

function availableTools(network: NetworkCapability): string[] {
  const effectiveTools = BITTENSOR_SEMANTIC_NETWORKS.has(network.network) && network.layers.topology?.enabled === true
    ? {
      ...(network.tools ?? {}),
      ...PUBLIC_CHAIN_INSIGHTS_TOOL_STATUS,
    }
    : network.tools ?? {}
  const tools = Object.entries(effectiveTools)
    .filter(([, status]) => status === 'available')
    .map(([name]) => name)
  return tools.sort()
}

function availableToolLines(network: NetworkCapability): string[] {
  const tools = availableTools(network)
  if (tools.length === 0) return ['none']
  const lines: string[] = []
  for (let index = 0; index < tools.length; index += AVAILABLE_TOOLS_PER_LINE) {
    lines.push(tools.slice(index, index + AVAILABLE_TOOLS_PER_LINE).join(', '))
  }
  return lines
}

function shortDate(value?: string): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function datasetLabel(network: NetworkCapability): string {
  const coverage = network.coverage
  if (!coverage) return 'unknown'
  const blockRange = coverage.from_block !== undefined && coverage.to_block !== undefined
    ? `${coverage.from_block}..${coverage.to_block}`
    : 'blocks unknown'
  const dateRange = coverage.from_timestamp && coverage.to_timestamp
    ? `${shortDate(coverage.from_timestamp)}..${shortDate(coverage.to_timestamp)}`
    : ''
  if (blockRange === 'blocks unknown' && dateRange === '') return 'unknown'
  if (blockRange === 'blocks unknown') return dateRange
  if (dateRange === '') return blockRange
  return `${blockRange} / ${dateRange}`
}

export function formatNetworkCapabilities(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const headers = ['Network', 'Topology', 'Facts', 'Risk', 'Dataset', 'Available tools']
  const widths = [14, 10, 8, 8, 38, 64]
  const row = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  const networkRows = document.networks.flatMap((network) => {
    const toolLines = availableToolLines(network)
    return toolLines.map((toolLine, index) => row([
      index === 0 ? network.display_name || network.network : '',
      index === 0 ? layerValue(network, 'topology') : '',
      index === 0 ? layerValue(network, 'facts') : '',
      index === 0 ? layerValue(network, 'risk') : '',
      index === 0 ? datasetLabel(network) : '',
      toolLine,
    ]))
  })
  return [
    row(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...networkRows,
  ].join('\n')
}
