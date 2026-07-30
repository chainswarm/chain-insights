import { describe, expect, it, vi } from 'vitest'
import {
  moneyTrailCorridorQuery,
  moneyTrailSeedProbeQuery,
  traceResultFromMoneyTrail,
  traceSuspectFunds,
} from '../src/investigation/public-tools.js'

type BatchQuery = { id: string; query: string }

const config = { dataDir: '/tmp/ci-test', serverPort: 4321 }

describe('money-trail trace query builders', () => {
  it('moneyTrailSeedProbeQuery emits pinned query text with an escaped address literal', () => {
    expect(moneyTrailSeedProbeQuery('addr"1')).toMatchSnapshot()
  })

  it('moneyTrailCorridorQuery emits pinned query text with an escaped seed literal', () => {
    expect(moneyTrailCorridorQuery('seed"1')).toMatchSnapshot()
  })
})

describe('traceResultFromMoneyTrail assembly', () => {
  it('stamps trace_source/money_trail_generation and the precomputed-trail sentence', () => {
    const corridorRows = [
      { address: '5Mid', edge_class: 'transport', value: '100', min_hop: 1, seed_count: 1, primary_seed: '5Seed', generation: 4, network: 'bittensor' },
    ]
    const endRows = [
      { address: '5End', fact_type: 'cash_out', direction: 'out', terminal_role: 'exchange', hop: 2, value: '90', generation: 4 },
    ]
    const result = traceResultFromMoneyTrail('bittensor', '5Seed', corridorRows, endRows)
    const content = result.structuredContent as { trace_source: string; money_trail_generation: number }
    expect(content.trace_source).toBe('money_trail')
    expect(content.money_trail_generation).toBe(4)
    expect(result.summaryText).toContain('precomputed money trail, investigation round 4')
  })

  it('never contains the word "attribution" anywhere in the assembled result', () => {
    const result = traceResultFromMoneyTrail(
      'bittensor',
      '5Seed',
      [{ address: '5Mid', edge_class: 'transport', value: '100', min_hop: 1, generation: 1 }],
      [{ address: '5End', fact_type: 'cash_out', terminal_role: 'exchange', hop: 2, value: '90', generation: 1 }],
    )
    expect(result.summaryText.toLowerCase()).not.toContain('attribution')
    expect(JSON.stringify(result.structuredContent).toLowerCase()).not.toContain('attribution')
  })
})

describe('traceSuspectFunds money-trail fast path', () => {
  it('non-empty probe -> fast path taken, result carries trace_source money_trail (S1)', async () => {
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = req.arguments.queries ?? []
        const results = queries.map((q) => {
          if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: '5Seed' }] }
          if (q.id === 'money_trail_seed_probe') {
            return { id: q.id, ok: true, results: [{ address: '5End', fact_type: 'cash_out', direction: 'out', terminal_role: 'exchange', hop: 2, value: '90', generation: 5 }] }
          }
          if (q.id === 'money_trail_corridor') {
            return { id: q.id, ok: true, results: [{ address: '5Mid', edge_class: 'transport', value: '100', min_hop: 1, generation: 5 }] }
          }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }

    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Seed',
      network: 'bittensor',
      writeArtifacts: false,
    })

    const content = result.structuredContent as { trace_source?: string; money_trail_generation?: number }
    expect(content.trace_source).toBe('money_trail')
    expect(content.money_trail_generation).toBe(5)
    expect(result.summaryText).toContain('precomputed money trail, investigation round 5')

    const issuedIds = remote.callTool.mock.calls.flatMap((call) => ((call[0] as { arguments: { queries?: BatchQuery[] } }).arguments.queries ?? []).map((q) => q.id))
    // Fast path replaces the per-seed traversal: no forward-trace probe query fired.
    expect(issuedIds.some((id) => id.startsWith('forward_trace'))).toBe(false)
  })

  it('empty probe -> fast-path branch not taken, falls through to the existing live path', async () => {
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = req.arguments.queries ?? []
        const results = queries.map((q) => {
          if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: '5Seed' }] }
          if (q.id === 'money_trail_seed_probe') return { id: q.id, ok: true, results: [] }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }

    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Seed',
      network: 'bittensor',
      writeArtifacts: false,
    })

    const content = result.structuredContent as { trace_source?: string }
    expect(content.trace_source).toBeUndefined()

    const issuedIds = remote.callTool.mock.calls.flatMap((call) => ((call[0] as { arguments: { queries?: BatchQuery[] } }).arguments.queries ?? []).map((q) => q.id))
    expect(issuedIds).toContain('money_trail_seed_probe')
    // Corridor query must never fire when the probe came back empty.
    expect(issuedIds).not.toContain('money_trail_corridor')
  })

  it('live:true skips the probe entirely', async () => {
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = req.arguments.queries ?? []
        const results = queries.map((q) => {
          if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: '5Seed' }] }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }

    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Seed',
      network: 'bittensor',
      live: true,
      writeArtifacts: false,
    })

    const content = result.structuredContent as { trace_source?: string }
    expect(content.trace_source).toBeUndefined()

    const issuedIds = remote.callTool.mock.calls.flatMap((call) => ((call[0] as { arguments: { queries?: BatchQuery[] } }).arguments.queries ?? []).map((q) => q.id))
    expect(issuedIds).not.toContain('money_trail_seed_probe')
  })

  it('probe query failure degrades to the live path instead of throwing', async () => {
    const remote = {
      callTool: vi.fn(async (req: { name: string; arguments: { queries?: BatchQuery[] } }) => {
        if (req.name === 'network_capabilities') {
          return { content: [{ type: 'text', text: JSON.stringify({ networks: [] }) }], isError: false }
        }
        const queries = req.arguments.queries ?? []
        if (queries.some((q) => q.id === 'money_trail_seed_probe')) {
          throw new Error('transport error: connection reset')
        }
        const results = queries.map((q) => {
          if (q.id.startsWith('seed_address_exists_')) return { id: q.id, ok: true, results: [{ address: '5Seed' }] }
          return { id: q.id, ok: true, results: [] }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }

    const result = await traceSuspectFunds(remote as never, config, {
      suspectAddresses: '5Seed',
      network: 'bittensor',
      writeArtifacts: false,
    })

    const content = result.structuredContent as { trace_source?: string }
    expect(content.trace_source).toBeUndefined()
    expect(result.summaryText).toContain('Trace suspect funds complete')
  })
})
