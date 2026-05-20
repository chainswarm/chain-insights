import type { InvestigatorConfig } from '../config/schema.js'
import { resolveGraphMcpEndpoint } from './client.js'

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

export interface NetworkAggregationMaterialization {
  level: 'raw' | 'daily' | 'monthly' | 'yearly' | string
  source?: string
  grain?: string
  derived_from?: string
  enabled: boolean
  retention?: NetworkRetention | null
  coverage?: {
    from_block?: number
    to_block?: number
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

export interface NetworkCapability {
  network: string
  display_name?: string
  status: string
  default?: boolean
  layers: Record<string, NetworkLayerCapability>
  tools: Record<string, string>
  aggregations?: Record<string, NetworkAggregationMaterialization[]>
  coverage?: {
    from_block?: number
    to_block?: number
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
    headers.set('X-MCP-Debug-Token', token)
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(request, { headers })
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

function retentionLabel(network: NetworkCapability): string {
  const topology = network.layers['topology_labels']
  const retention = topology?.retention
  if (!retention) return 'unknown'
  if (retention.mode === 'rolling_window' && retention.window_days) {
    if (retention.window_days % 365 === 0) return `${retention.window_days / 365}y rolling`
    return `${retention.window_days}d rolling`
  }
  if (retention.mode === 'expanding_then_rolling' && retention.window_days) {
    if (retention.window_days % 365 === 0) return `growing to ${retention.window_days / 365}y`
    return `growing to ${retention.window_days}d`
  }
  if (retention.mode === 'full_history') return 'full history'
  if (retention.mode === 'bounded_range') return 'bounded'
  return retention.mode || 'unknown'
}

function freshnessLabel(network: NetworkCapability): string {
  const blocksBehind = network.coverage?.blocks_behind_tip
  if (typeof blocksBehind === 'number') return `${blocksBehind} blocks behind`
  const maxAge = network.freshness?.max_data_age_seconds
  if (typeof maxAge === 'number') return `${Math.round(maxAge / 60)} min old`
  return 'unknown'
}

function aggregationLabel(network: NetworkCapability): string {
  const materializations = network.aggregations?.['transfers']?.filter((materialization) => materialization.enabled) ?? []
  if (materializations.length === 0) return 'unknown'
  const labels = materializations.map((materialization) => {
    if (materialization.level === 'daily') return 'day'
    if (materialization.level === 'monthly') return 'month'
    if (materialization.level === 'yearly') return 'year'
    return materialization.level
  })
  return labels.join('/')
}

export function formatNetworkCapabilities(document: NetworkCapabilitiesDocument): string {
  if (document.networks.length === 0) return 'No supported networks advertised.'
  const headers = ['Network', 'Topology', 'Risk', 'Retention', 'Transfers', 'Freshness']
  const widths = [14, 10, 10, 14, 19, 18]
  const row = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  return [
    row(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...document.networks.map((network) => row([
      network.display_name || network.network,
      layerValue(network, 'topology_labels'),
      layerValue(network, 'risk_intelligence'),
      retentionLabel(network),
      aggregationLabel(network),
      freshnessLabel(network),
    ])),
  ].join('\n')
}
