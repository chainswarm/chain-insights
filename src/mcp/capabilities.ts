import type { InvestigatorConfig } from '../config/schema.js'
import { applyMcpAuthHeaders, resolveGraphMcpEndpoint } from './client.js'

export interface NetworkLayerCapability {
  enabled: boolean
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
          topology: { enabled: source.layers.topology?.enabled === true },
        },
        tools: {
          graph_query: 'available',
          graph_query_batch: 'available',
        },
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
  config: Pick<InvestigatorConfig, 'mcpAuthToken' | 'graphMcpAuthToken' | 'graphMcpMode' | 'graphMcpEndpoint' | 'mcpEndpoint'>,
): Promise<NetworkCapabilitiesDocument> {
  const endpoint = resolveGraphMcpEndpoint(config)
  const request = metadataNetworksUrl(endpoint)
  const headers = new Headers()
  const token = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim()
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

function availableToolsLabel(network: NetworkCapability): string {
  const tools = Object.entries(network.tools ?? {})
    .filter(([, status]) => status === 'available')
    .map(([name]) => name)
  return tools.length > 0 ? tools.join(', ') : 'none'
}

export function formatNetworkCapabilities(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const headers = ['Network', 'Topology', 'Facts', 'Risk', 'Available tools']
  const widths = [14, 10, 8, 8, 64]
  const row = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  return [
    row(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...document.networks.map((network) => row([
      network.display_name || network.network,
      layerValue(network, 'topology'),
      layerValue(network, 'facts'),
      layerValue(network, 'risk'),
      availableToolsLabel(network),
    ])),
  ].join('\n')
}
