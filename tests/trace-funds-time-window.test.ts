import { describe, expect, it, vi } from 'vitest'
import { runFundFlowProbe } from '../src/investigation/trace-funds.js'

type BatchQuery = { id: string; query: string }

function batchResponse(results: Array<{ id: string; rows?: Array<Record<string, unknown>> }>) {
  return {
    facts: { queries: results.map((entry) => ({ id: entry.id, ok: true, results: entry.rows ?? [] })) },
  }
}

function fakeClient(captured: BatchQuery[][]) {
  return {
    callTool: vi.fn(async (req: { name: string; arguments: { queries: BatchQuery[] } }) => {
      captured.push(req.arguments.queries)
      return {
        content: [{ type: 'text', text: JSON.stringify(batchResponse(req.arguments.queries.map((q) => ({ id: q.id })))) }],
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
