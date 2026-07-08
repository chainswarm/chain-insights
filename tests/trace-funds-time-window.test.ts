import { describe, expect, it, vi } from 'vitest'
import { runFundFlowProbe } from '../src/investigation/trace-funds.js'
import { traceSuspectFunds, traceVictimFunds } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

function batchResponse(results: Array<{ id: string; rows?: Array<Record<string, unknown>> }>) {
  return {
    facts: { queries: results.map((entry) => ({ id: entry.id, ok: true, results: entry.rows ?? [] })) },
  }
}

function fakeClient(captured: BatchQuery[][]) {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
      // AC12's archive-retry hint probes network_capabilities (no queries arg)
      // when a trace finds nothing; respond with archive disabled so no hint
      // computation is exercised by these window-wiring tests.
      if (req.name === 'network_capabilities') {
        return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
      }
      const queries = req.arguments.queries ?? []
      captured.push(queries)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(batchResponse(queries.map((q) => (
            // Confirm any seed existence probe so callers of
            // traceVictimFunds/traceSuspectFunds (which pre-flight seeds
            // against :Address before tracing) proceed to the forward query.
            q.id.startsWith('seed_address_exists_')
              ? { id: q.id, rows: [{ address: q.query.match(/address:\s*"([^"]+)"/)?.[1] ?? '' }] }
              : { id: q.id }
          )))),
        }],
        isError: false,
      }
    }),
  }
}

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

describe('forward trace activity window', () => {
  it('renders first_seen/last_seen predicates on every hop edge when a window is set', async () => {
    const captured: BatchQuery[][] = []
    await runFundFlowProbe(fakeClient(captured) as never, config, {
      seedAddress: 'net:0xseed',
      network: 'bittensor',
      maxHops: 2,
      writeArtifacts: false,
      activityWindow: { fromMs: 1715500000000, toMs: 1716000000000 },
    })
    const forward = captured.flat().filter((q) => q.id.startsWith('forward_exchange_paths_'))
    expect(forward).toHaveLength(2)
    for (const query of forward) {
      expect(query.query).toContain('r1.first_seen_timestamp >= 1715500000000 OR r1.last_seen_timestamp >= 1715500000000')
      expect(query.query).toContain('r1.first_seen_timestamp <= 1716000000000')
    }
    expect(forward[1]!.query).toContain('r2.first_seen_timestamp >= 1715500000000 OR r2.last_seen_timestamp >= 1715500000000')
    expect(forward[1]!.query).toContain('r2.first_seen_timestamp <= 1716000000000')
  })

  it('renders only the from predicate when toMs is omitted', async () => {
    const captured: BatchQuery[][] = []
    await runFundFlowProbe(fakeClient(captured) as never, config, {
      seedAddress: 'net:0xseed',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
      activityWindow: { fromMs: 1715500000000 },
    })
    const forward = captured.flat().find((q) => q.id === 'forward_exchange_paths_1')
    expect(forward!.query).toContain('(r1.first_seen_timestamp >= 1715500000000 OR r1.last_seen_timestamp >= 1715500000000)')
    expect(forward!.query).not.toContain('<=')
  })

  it('omits window predicates when no window is given', async () => {
    const captured: BatchQuery[][] = []
    await runFundFlowProbe(fakeClient(captured) as never, config, {
      seedAddress: 'net:0xseed',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const forward = captured.flat().filter((q) => q.id.startsWith('forward_exchange_paths_'))
    expect(forward[0]!.query).not.toContain('first_seen_timestamp >=')
  })

  it('projects first_seen/last_seen in flow edge maps', async () => {
    const captured: BatchQuery[][] = []
    await runFundFlowProbe(fakeClient(captured) as never, config, {
      seedAddress: 'net:0xseed',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const forward = captured.flat().find((q) => q.id === 'forward_exchange_paths_1')
    expect(forward!.query).toContain('first_seen_timestamp: r1.first_seen_timestamp')
    expect(forward!.query).toContain('last_seen_timestamp: r1.last_seen_timestamp')
  })
})

describe('public trace tools window wiring', () => {
  it('derives the window from incident_timestamp_ms and reports time_filter', async () => {
    const captured: BatchQuery[][] = []
    const result = await traceVictimFunds(fakeClient(captured) as never, config, {
      victimAddresses: 'net:0xv1',
      network: 'bittensor',
      incidentTimestampMs: 1715500000000,
      writeArtifacts: false,
    })
    const forward = captured.flat().filter((q) => q.id.startsWith('forward_exchange_paths_'))
    expect(forward.length).toBeGreaterThan(0)
    expect(forward[0]!.query).toContain('first_seen_timestamp >= 1715500000000')
    const input = (result.structuredContent as { input: Record<string, unknown> }).input
    expect(input['time_filter']).toEqual({ from_ms: 1715500000000 })
  })

  it('reports time_filter none when no window inputs are given', async () => {
    const captured: BatchQuery[][] = []
    const result = await traceVictimFunds(fakeClient(captured) as never, config, {
      victimAddresses: 'net:0xv1',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const input = (result.structuredContent as { input: Record<string, unknown> }).input
    expect(input['time_filter']).toBe('none')
  })

  it('wires the window through traceSuspectFunds symmetrically', async () => {
    const captured: BatchQuery[][] = []
    const result = await traceSuspectFunds(fakeClient(captured) as never, config, {
      suspectAddresses: 'net:0xs1',
      network: 'bittensor',
      incidentTimestampMs: 1715500000000,
      writeArtifacts: false,
    })
    const forward = captured.flat().filter((q) => q.id.startsWith('forward_exchange_paths_'))
    expect(forward[0]!.query).toContain('first_seen_timestamp >= 1715500000000')
    const input = (result.structuredContent as { input: Record<string, unknown> }).input
    expect(input['time_filter']).toEqual({ from_ms: 1715500000000 })
  })
})
