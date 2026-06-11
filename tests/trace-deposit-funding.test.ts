import { describe, expect, it, vi } from 'vitest'
import { traceVictimFunds } from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

const FORWARD_ROW = {
  addresses: ['net:0xv1', 'net:0xdep', 'net:0xex'],
  node_labels: [[], [], ['Binance, exchange']],
  path_nodes: [
    { address: 'net:0xv1', labels: [], is_exchange: null },
    { address: 'net:0xdep', labels: [], is_exchange: null },
    { address: 'net:0xex', labels: ['Binance, exchange'], is_exchange: true },
  ],
  edge_props: [
    { amount_usd_sum: 50, tx_count: 1 },
    { amount_usd_sum: 49, tx_count: 1 },
  ],
  exchange_address: 'net:0xex',
  exchange_labels: ['Binance, exchange'],
  deposit_address: 'net:0xdep',
  deposit_is_exchange: null,
  hops: 2,
}

const BACKWARD_ROW = {
  deposit_address: 'net:0xdep',
  source_exchange: 'net:0xsrcex',
  source_labels: ['Kraken, exchange'],
  hops: 1,
  addresses: ['net:0xdep', 'net:0xsrcex'],
  node_labels: [[], ['Kraken, exchange']],
  path_nodes: [
    { address: 'net:0xdep', labels: [] },
    { address: 'net:0xsrcex', labels: ['Kraken, exchange'], is_exchange: true },
  ],
}

function client(options: { failTraceback?: boolean } = {}) {
  return {
    callTool: vi.fn(async (req: { arguments: { queries: BatchQuery[] } }) => {
      const queries = req.arguments.queries.map((q) => {
        if (q.id === 'forward_exchange_paths_2') return { id: q.id, ok: true, results: [FORWARD_ROW] }
        if (q.id.startsWith('backward_from_deposit_')) {
          if (options.failTraceback) return { id: q.id, ok: false, error: 'timeout' }
          if (q.id === 'backward_from_deposit_1_1') return { id: q.id, ok: true, results: [BACKWARD_ROW] }
          return { id: q.id, ok: true, results: [] }
        }
        return { id: q.id, ok: true, results: [] }
      })
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries } }) }], isError: false }
    }),
  }
}

describe('deposit traceback in public trace tools', () => {
  it('runs traceback and surfaces deposit_funding', async () => {
    const remote = client()
    const result = await traceVictimFunds(remote as never, { dataDir: '/tmp/ci-test', serverPort: 4321 }, {
      victimAddresses: 'net:0xv1',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const issued = remote.callTool.mock.calls.flatMap((call) => (call[0] as { arguments: { queries: BatchQuery[] } }).arguments.queries.map((q) => q.id))
    expect(issued.some((id) => id.startsWith('backward_from_deposit_'))).toBe(true)
    const content = result.structuredContent as { deposit_funding?: { source_exchange_paths: Array<Record<string, unknown>>; reverse_leads: Array<Record<string, unknown>> } }
    expect(content.deposit_funding).toBeDefined()
    expect(content.deposit_funding!.source_exchange_paths).toHaveLength(1)
    expect(content.deposit_funding!.source_exchange_paths[0]).toMatchObject({
      deposit_address: 'net:0xdep',
      source_exchange: 'net:0xsrcex',
    })
  })

  it('surfaces traceback query failures as warnings without aborting the trace', async () => {
    const remote = client({ failTraceback: true })
    const result = await traceVictimFunds(remote as never, { dataDir: '/tmp/ci-test', serverPort: 4321 }, {
      victimAddresses: 'net:0xv1',
      network: 'bittensor',
      writeArtifacts: false,
    })
    const content = result.structuredContent as {
      summary?: { candidate_deposit_count: number }
      deposit_funding?: { source_exchange_paths: Array<Record<string, unknown>> }
      warnings?: string[]
    }
    expect(content.summary?.candidate_deposit_count).toBe(1)
    expect(content.deposit_funding).toBeDefined()
    expect(content.deposit_funding!.source_exchange_paths).toEqual([])
    expect(content.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/deposit traceback query .* failed: timeout/),
    ]))
  })
})
