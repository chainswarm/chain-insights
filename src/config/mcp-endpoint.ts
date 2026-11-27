import { isIP } from 'node:net'
import { RELEASE_CHANNEL } from '../version.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export const LOCAL_GRAPH_MCP_ENDPOINT = 'http://127.0.0.1:8012/mcp'
export const PRODUCTION_GRAPH_MCP_ENDPOINT = 'https://mcp.chain-insights.ai/'
export const STAGING_GRAPH_MCP_ENDPOINT = 'https://mcp-staging.chain-insights.ai/'

/**
 * The endpoint a build reads when nothing else is set: the staging endpoint
 * for a package published under the npm tag `next`, the production endpoint
 * for `latest`, for any other tag, and for a build with no channel stamp.
 */
export function defaultGraphMcpEndpointFor(channel: string | undefined): string {
  return channel === 'next' ? STAGING_GRAPH_MCP_ENDPOINT : PRODUCTION_GRAPH_MCP_ENDPOINT
}

export const DEFAULT_GRAPH_MCP_ENDPOINT = defaultGraphMcpEndpointFor(RELEASE_CHANNEL)

/**
 * The line that tells a user which endpoint they read and why, with a note
 * when a value they just asked for is not the one read.
 */
export function graphMcpEndpointLines(
  endpoint: string,
  requested?: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const channel = RELEASE_CHANNEL ?? 'latest'
  const lane =
    endpoint === STAGING_GRAPH_MCP_ENDPOINT
      ? 'staging'
      : endpoint === PRODUCTION_GRAPH_MCP_ENDPOINT
        ? 'production'
        : 'custom'
  const lines = [`Graph endpoint: ${endpoint} (${lane}, npm tag ${channel})`]
  const asked = requested?.trim()
  if (asked && asked !== endpoint) {
    lines.push(
      graphMcpEndpointEnvOverride(env)
        ? `Note: CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT wins over the saved ${asked}.`
        : `Note: a saved ${asked} reads as the default of this build, which is ${endpoint}. Set CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT to read ${asked}.`
    )
  }
  return lines
}

/**
 * A saved `graphMcpEndpoint` that is a real choice of the user, or
 * `undefined`. Older releases wrote the production endpoint into every new
 * config file (the installer and every `cia config set` saved the default),
 * so a saved production endpoint cannot be told apart from that old default.
 * It is read as no choice: the build's default applies, and a `next` build
 * reads staging. To read production from a `next` build, set
 * CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT.
 */
export function savedGraphMcpEndpointChoice(saved: string | undefined): string | undefined {
  const trimmed = saved?.trim()
  if (!trimmed || trimmed === PRODUCTION_GRAPH_MCP_ENDPOINT) return undefined
  return trimmed
}

/**
 * The endpoint the CLI and the proxy read: the environment override first,
 * then a saved choice, then the default of the build's channel.
 */
export function selectGraphMcpEndpoint(input: {
  channel: string | undefined
  env?: NodeJS.ProcessEnv
  saved?: string
}): string {
  return (
    graphMcpEndpointEnvOverride(input.env) ??
    savedGraphMcpEndpointChoice(input.saved) ??
    defaultGraphMcpEndpointFor(input.channel)
  )
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (LOOPBACK_HOSTS.has(normalized)) return true
  if (isIP(normalized) !== 4) return false
  return normalized.split('.')[0] === '127'
}

function isKubernetesServiceHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.svc.cluster.local')
}

export function graphMcpEndpointEnvOverride(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const envEndpoint =
    env.CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT?.trim() || env.GRAPH_MCP_ENDPOINT?.trim()
  return envEndpoint ? validateMcpEndpoint(envEndpoint, 'graphMcpEndpoint') : undefined
}

export function validateMcpEndpoint(value: string, key: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${key} must be a non-empty absolute URL.`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      `${key} must be an absolute URL (example: https://mcp.example.com/mcp or http://127.0.0.1:8012/mcp).`
    )
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${key} must not include URL credentials.`)
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${key} must not include query parameters or URL fragments.`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${key} must use either https:// or http://.`)
  }
  if (
    parsed.protocol === 'http:' &&
    !isLoopbackHost(parsed.hostname) &&
    !isKubernetesServiceHost(parsed.hostname)
  ) {
    throw new Error(
      `${key} must use https:// for remote hosts. http:// is allowed only for localhost, loopback addresses, or Kubernetes *.svc.cluster.local service DNS.`
    )
  }

  return trimmed
}
