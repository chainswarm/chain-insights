import { describe, expect, it } from 'vitest'
import {
  GRAPH_TOOL_REQUEST_TIMEOUT_MS,
  graphToolRequestOptions,
} from '../src/mcp/request-timeout.js'

// The graph server stops a batch at 100 s. The SDK default request timeout is
// 60 s, so a client that sets no options gives up on a batch the server is
// still answering.
const SERVER_BATCH_BUDGET_MS = 100_000

describe('graphToolRequestOptions', () => {
  it.each(['graph_query', 'graph_query_batch'])(
    '%s waits longer than the server batch budget',
    (tool) => {
      const options = graphToolRequestOptions(tool)

      expect(options?.timeout).toBe(GRAPH_TOOL_REQUEST_TIMEOUT_MS)
      expect(options?.maxTotalTimeout).toBe(GRAPH_TOOL_REQUEST_TIMEOUT_MS)
      expect(GRAPH_TOOL_REQUEST_TIMEOUT_MS).toBeGreaterThan(SERVER_BATCH_BUDGET_MS)
    }
  )

  it.each(['aml_address_risk', 'meta_usage_status', 'wallet_balance', 'wallet-risk', ''])(
    'leaves %j at the SDK default',
    (tool) => {
      expect(graphToolRequestOptions(tool)).toBeUndefined()
    }
  )

  it('is 5 minutes, the wait aml_address_risk already used', () => {
    expect(GRAPH_TOOL_REQUEST_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })
})
