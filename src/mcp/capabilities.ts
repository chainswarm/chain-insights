import type { InvestigatorConfig } from '../config/schema.js'
import { applyMcpAuthHeaders, resolveGraphMcpEndpoint } from './client.js'

export interface NetworkRetention {
  mode: 'full_history' | 'rolling_window' | 'expanding_then_rolling' | 'bounded_range' | 'unknown' | string
  window_days?: number
  from_block?: number
  to_block?: number
  from_timestamp?: string
  to_timestamp?: string
  started_at?: string
  rolls_after_at?: string
  current_window_seconds?: number
}

export interface NetworkLayerCapability {
  enabled: boolean
  retention?: NetworkRetention | null
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
  return parsed
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
    : 'dates unknown'
  if (blockRange === 'blocks unknown' && dateRange === 'dates unknown') return 'unknown'
  return `${blockRange} / ${dateRange}`
}

export function formatNetworkCapabilities(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const headers = ['Network', 'Topology', 'Facts', 'Risk', 'Dataset', 'Available tools']
  const widths = [14, 10, 8, 8, 38, 64]
  const row = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  return [
    row(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...document.networks.map((network) => row([
      network.display_name || network.network,
      layerValue(network, 'topology'),
      layerValue(network, 'facts'),
      layerValue(network, 'risk'),
      datasetLabel(network),
      availableToolsLabel(network),
    ])),
  ].join('\n')
}
