// `cia mcp call graph_query ...` against a stale local `graphMcpEndpoint`
// printed only "fetch failed", indistinguishable from a bad query. This pins
// the mapping from a transport failure to an actionable, endpoint-named message,
// and — critically — that a real backend error (a bounds rejection, a 402) is
// left untouched.
import { describe, expect, it } from 'vitest'
import { describeGraphMcpTransportError } from '../src/mcp/transport-error.js'

const ENDPOINT = 'http://127.0.0.1:8012/mcp'

function fetchFailed(cause?: unknown): TypeError {
  return new TypeError('fetch failed', cause === undefined ? undefined : { cause })
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('describeGraphMcpTransportError', () => {
  it('names the endpoint and the cause for connection refused', () => {
    const err = fetchFailed(withCode('connect ECONNREFUSED 127.0.0.1:8012', 'ECONNREFUSED'))
    const message = describeGraphMcpTransportError(err, ENDPOINT)
    expect(message).toContain(ENDPOINT)
    expect(message).toContain('connection refused')
    expect(message).toContain('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT')
  })

  it('maps host-not-found (ENOTFOUND)', () => {
    const err = fetchFailed(withCode('getaddrinfo ENOTFOUND mcp.example', 'ENOTFOUND'))
    expect(describeGraphMcpTransportError(err, ENDPOINT)).toContain('host not found')
  })

  it('maps connection timeout via the undici code', () => {
    const err = fetchFailed(withCode('Connect Timeout Error', 'UND_ERR_CONNECT_TIMEOUT'))
    expect(describeGraphMcpTransportError(err, ENDPOINT)).toContain('connection timed out')
  })

  it('falls back to a generic unreachable message when fetch failed carries no code', () => {
    const message = describeGraphMcpTransportError(fetchFailed(), ENDPOINT)
    expect(message).toContain(ENDPOINT)
    expect(message).toContain('unreachable')
  })

  it('detects the code from the message text when there is no code field', () => {
    const err = new Error('request to http://127.0.0.1:8012 failed, reason: connect ECONNREFUSED')
    expect(describeGraphMcpTransportError(err, ENDPOINT)).toContain('connection refused')
  })

  it('leaves a real backend bounds rejection untouched', () => {
    const err = new Error('traversal depth 9 exceeds the maximum of 5')
    expect(describeGraphMcpTransportError(err, ENDPOINT)).toBeNull()
  })

  it('leaves a payment-required / tool error untouched', () => {
    expect(describeGraphMcpTransportError(new Error('HTTP 402 Payment Required'), ENDPOINT)).toBeNull()
    expect(describeGraphMcpTransportError(new Error('Unknown tool "graph_qeury"'), ENDPOINT)).toBeNull()
  })

  it('is null for non-error inputs', () => {
    expect(describeGraphMcpTransportError(null, ENDPOINT)).toBeNull()
    expect(describeGraphMcpTransportError('nope', ENDPOINT)).toBeNull()
  })
})
