// A failed request to the Chain Insights Graph endpoint surfaces from Node's
// fetch as a bare `TypeError: fetch failed`, which says nothing about WHICH
// endpoint was unreachable or WHY. `cia mcp call graph_query ...` against a
// stale `graphMcpEndpoint` — for example a `debug` config pointing at a stopped
// local `127.0.0.1:8012` server — therefore printed only "fetch failed", and a
// user could not tell a dead endpoint from a bad query.
//
// describeGraphMcpTransportError maps a transport-level failure to an actionable
// message that names the endpoint and the cause. A non-transport error (a 402,
// a tool error, a validation error, an unknown-tool error) returns null and is
// left untouched, so real backend messages still reach the caller verbatim.

interface CauseLike {
  code?: unknown
  message?: unknown
  cause?: unknown
}

/** The error and its `cause` chain, bounded against a self-referential chain. */
function causeChain(err: unknown, depth = 0): CauseLike[] {
  if (depth > 8 || err === null || typeof err !== 'object') return []
  const node = err as CauseLike
  return [node, ...causeChain(node.cause, depth + 1)]
}

// Node/undici transport error codes → plain-language cause.
const TRANSPORT_CODES: Record<string, string> = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  ENOTFOUND: 'host not found',
  EAI_AGAIN: 'host not found (DNS lookup failed)',
  ETIMEDOUT: 'connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
  UND_ERR_SOCKET: 'socket closed',
  EPROTO: 'TLS/protocol error',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate not trusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate not trusted',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate host mismatch',
}

/** Returns a plain-language cause when err is a transport failure, else null. */
function transportDetail(err: unknown): string | null {
  const chain = causeChain(err)
  if (chain.length === 0) return null
  let looksTransport = false
  for (const node of chain) {
    const code = typeof node.code === 'string' ? node.code : undefined
    if (code && TRANSPORT_CODES[code]) return TRANSPORT_CODES[code]
    const message = typeof node.message === 'string' ? node.message : ''
    for (const [knownCode, text] of Object.entries(TRANSPORT_CODES)) {
      if (message.includes(knownCode)) return text
    }
    if (/fetch failed|socket hang up|other side closed|network|and could not connect/i.test(message)) {
      looksTransport = true
    }
  }
  return looksTransport ? 'the endpoint is unreachable' : null
}

export function describeGraphMcpTransportError(err: unknown, endpoint: string): string | null {
  const detail = transportDetail(err)
  if (!detail) return null
  return [
    `Could not reach the Chain Insights Graph endpoint ${endpoint} (${detail}).`,
    'Check that the endpoint is correct and running — it is `graphMcpEndpoint` in',
    '~/.chain-insights/config.json — or override it for one run with the',
    'CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT environment variable.',
  ].join(' ')
}

/**
 * Returns an endpoint-named Error when err is a transport failure, preserving
 * the original as `cause`; returns err unchanged otherwise. Callers throw the
 * result, so a real backend error surfaces verbatim while a dead endpoint is
 * self-explaining.
 */
export function toGraphMcpEndpointError(err: unknown, endpoint: string): unknown {
  const message = describeGraphMcpTransportError(err, endpoint)
  return message === null ? err : new Error(message, { cause: err })
}
