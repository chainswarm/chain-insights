import { describe, expect, it, vi } from 'vitest'
import { traceDepositSources } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

function clientWithRows(rowsPerDepth: Record<string, Array<Record<string, unknown>>>) {
  const captured: BatchQuery[] = []
  return {
    captured,
    callTool: vi.fn(async (req: { arguments: { queries: BatchQuery[] } }) => {
      captured.push(...req.arguments.queries)
      const queries = req.arguments.queries.map((q) => ({ id: q.id, ok: true, results: rowsPerDepth[q.id] ?? [] }))
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

describe('aml_trace_deposit_sources filters', () => {
  it('applies min_amount_sum and time window to the reverse query', async () => {
    const remote = clientWithRows({})
    await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      minAmountSum: 25,
      timeRange: { from_ms: 1715500000000 },
      writeArtifacts: false,
    })
    const reverse = remote.captured.find((q) => q.id === 'reverse_deposit_sources_1')
    expect(reverse!.query).toContain('r1.amount_usd_sum >= 25')
    expect(reverse!.query).toContain('r1.first_seen_timestamp >= 1715500000000 OR r1.last_seen_timestamp >= 1715500000000')
  })

  it('warns when a depth saturates the 500-row limit', async () => {
    const row = { source_address: 'net:0xsrc', deposit_address: 'net:0xdep', hop: 1, addresses: ['net:0xsrc', 'net:0xdep'], path_nodes: [], edge_props: [] }
    const remote = clientWithRows({ reverse_deposit_sources_1: Array.from({ length: 500 }, () => ({ ...row })) })
    const result = await traceDepositSources(remote as never, config, {
      depositAddresses: 'net:0xdep',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })
    const warnings = (result.structuredContent as { warnings: string[] }).warnings
    expect(warnings.some((w) => w.includes('reverse_deposit_sources_1') && w.includes('500'))).toBe(true)
  })
})
