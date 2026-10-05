// `cia mcp call graph_query ...` against a stale local `graphMcpEndpoint`
// printed only "fetch failed", indistinguishable from a bad query. This pins
// the mapping from a transport failure to an actionable, endpoint-named message,
// and — critically — that a real backend error (a bounds rejection, a 402) is
// left untouched.
import { describe, expect, it } from 'vitest'
import { McpToolError } from '../src/mcp/print-result.js'
import {
  describeGraphMcpTransportError,
  toGraphMcpEndpointError,
} from '../src/mcp/transport-error.js'

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
    expect(
      describeGraphMcpTransportError(new Error('HTTP 402 Payment Required'), ENDPOINT)
    ).toBeNull()
    expect(
      describeGraphMcpTransportError(new Error('Unknown tool "graph_qeury"'), ENDPOINT)
    ).toBeNull()
  })

  it('detects a transport failure from the message alone (socket hang up)', () => {
    const err = new Error('socket hang up')
    expect(describeGraphMcpTransportError(err, ENDPOINT)).toContain('unreachable')
  })

  it('is null for non-error inputs', () => {
    expect(describeGraphMcpTransportError(null, ENDPOINT)).toBeNull()
    expect(describeGraphMcpTransportError('nope', ENDPOINT)).toBeNull()
  })
})

describe('toGraphMcpEndpointError', () => {
  it('wraps a transport failure in an endpoint-named Error, keeping the cause', () => {
    const original = fetchFailed(withCode('connect ECONNREFUSED 127.0.0.1:8012', 'ECONNREFUSED'))
    const wrapped = toGraphMcpEndpointError(original, ENDPOINT)
    expect(wrapped).toBeInstanceOf(Error)
    expect((wrapped as Error).message).toContain(ENDPOINT)
    expect((wrapped as Error).cause).toBe(original)
  })

  it('returns a real backend error unchanged (same reference)', () => {
    const backend = new Error('traversal depth 9 exceeds the maximum of 5')
    expect(toGraphMcpEndpointError(backend, ENDPOINT)).toBe(backend)
  })
})

// A tool reply is the server answering. Its text is the server's own, and the
// word "network" is a word of the server's vocabulary: `chain_unavailable` names
// network_capabilities, and `invalid_network` names the network argument. Neither
// is a failure of the connection. Only a failure of the connection is.
describe('a tool error is never an endpoint error', () => {
  const TEXTS = {
    layerOff:
      'chain_unavailable: the chain layer is switched off. Check chain_admission.enabled in network_capabilities.',
    invalidNetwork: 'invalid_network: network "mainnet" is not a known GraphRAG network',
    factsBusy:
      'facts_busy: the warehouse turned this read away: its queue was full or the wait in it ended. Retry after a short wait.',
  }

  it.each([
    ['the text of a switched-off chain layer', new McpToolError(TEXTS.layerOff), false],
    ['an invalid_network refusal', new McpToolError(TEXTS.invalidNetwork), false],
    ['a facts_busy refusal', new McpToolError(TEXTS.factsBusy), false],
    [
      'a fetch failure with ECONNREFUSED',
      fetchFailed(withCode('connect ECONNREFUSED 127.0.0.1:8012', 'ECONNREFUSED')),
      true,
    ],
  ])('%s', (_name, err, isEndpointError) => {
    const wrapped = toGraphMcpEndpointError(err, ENDPOINT)
    if (isEndpointError) {
      expect(wrapped).not.toBe(err)
      expect((wrapped as Error).message).toContain(
        'Could not reach the Chain Insights Graph endpoint'
      )
      expect((wrapped as Error).message).toContain(ENDPOINT)
    } else {
      expect(wrapped).toBe(err)
      expect(describeGraphMcpTransportError(err, ENDPOINT)).toBeNull()
    }
  })

  it('the bare word network no longer marks a plain Error as a transport failure', () => {
    for (const text of Object.values(TEXTS)) {
      expect(describeGraphMcpTransportError(new Error(text), ENDPOINT), text).toBeNull()
    }
  })

  it('an McpToolError whose text names a transport code is still the server answering', () => {
    const err = new McpToolError('chain_node_error: dial tcp: connect ECONNREFUSED 10.0.0.1:8545')
    expect(toGraphMcpEndpointError(err, ENDPOINT)).toBe(err)
  })
})
