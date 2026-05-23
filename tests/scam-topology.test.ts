import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { InvestigatorConfig } from '../src/config/schema.js'

const runFundFlowProbeMock = vi.hoisted(() => vi.fn())
const evidenceAppendMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  filename: '001_scam_topology_20260523T120000.md',
  sha256: 'abc123',
}))

vi.mock('../src/investigation/trace-funds.js', () => ({
  runFundFlowProbe: runFundFlowProbeMock,
}))

vi.mock('../src/cases/index.js', () => ({
  EvidenceStore: {
    append: evidenceAppendMock,
  },
}))

const client = { callTool: vi.fn() } as unknown as Client
const config = {
  dataDir: '/tmp/chain-insights-scam-topology-test',
  serverPort: 4321,
} as InvestigatorConfig

function graphBatchResult(queries: Array<{ id: string; ok: boolean; results: Array<Record<string, unknown>> }>) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        schema: 'chain-insights.result.v1',
        tool: 'graph_query_batch',
        facts: { queries },
      }),
    }],
  }
}

function probeResult(seed: string, path: string[]) {
  const [first, second, third, fourth] = path
  return {
    summaryText: `Trace complete for bittensor:${seed}`,
    compactEvidence: {},
    graphData: {
      schema: 'chain-insights.graph.v1',
      nodes: path.map((address, index) => ({
        id: address,
        address,
        node_type: 'address',
        roles: index === 0 ? ['seed'] : index === path.length - 2 ? ['deposit_candidate'] : index === path.length - 1 ? ['exchange'] : undefined,
      })),
      edges: [
        { source: first, target: second, edge_type: 'flows_to', amount_sum: 10, amount_usd_sum: 10, tx_count: 1 },
        { source: second, target: third, edge_type: 'flows_to', amount_sum: 9, amount_usd_sum: 9, tx_count: 1 },
        { source: third, target: fourth, edge_type: 'flows_to', amount_sum: 8, amount_usd_sum: 8, tx_count: 1, terminal_exchange: true },
      ],
      flows: [
        { hop: 1, src: first, dst: second, amount_sum: 10, amount_usd_sum: 10, tx_count: 1, terminal_exchange: false },
        { hop: 2, src: second, dst: third, amount_sum: 9, amount_usd_sum: 9, tx_count: 1, terminal_exchange: false },
        { hop: 3, src: third, dst: fourth, amount_sum: 8, amount_usd_sum: 8, tx_count: 1, terminal_exchange: true },
      ],
      deposits: [{
        address: third,
        exchangeAddress: fourth,
        amount_sum: 8,
        amount_usd_sum: 8,
        hops: 3,
        path,
      }],
      source_matches: [],
      reverse_leads: [{ address: '5Lead', deposit_address: third, reason: 'high_volume_sender' }],
      edge_anchors: [],
    },
    files: {
      schema: '/tmp/schema.json',
      compactEvidence: '/tmp/compact.json',
      graph: '/tmp/graph.json',
      graphHtml: '/tmp/graph.html',
      table: '/tmp/table.csv',
      tableHtml: '/tmp/table.html',
      report: '/tmp/report.md',
    },
    continuation: {
      nextHopAddresses: [],
      depositAddresses: [third],
      exchangeAddresses: [fourth],
      hint: 'Found deposit candidates',
    },
    addressMap: { S1: seed },
  }
}

describe('scamTopology', () => {
  beforeEach(() => {
    runFundFlowProbeMock.mockReset()
    evidenceAppendMock.mockClear()
    vi.mocked(client.callTool).mockReset()
    vi.mocked(client.callTool).mockResolvedValue(graphBatchResult([]))
  })

  it('requires at least one victim or scammer seed', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, { network: 'bittensor' }))
      .rejects.toThrow('victim_addresses or scammer_addresses is required')
  })

  it('does not turn victim seed addresses into risky label candidates', async () => {
    runFundFlowProbeMock.mockResolvedValueOnce(probeResult('5Victim', ['5Victim', '5Hop', '5Deposit', '5Exchange']))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
    })

    expect(result.structuredContent.facts.case_roles).toContainEqual(expect.objectContaining({
      address: '5Victim',
      role: 'victim',
    }))
    expect(result.structuredContent.facts.label_candidates)
      .not.toContainEqual(expect.objectContaining({ address: '5Victim', address_type: 'SCAM' }))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Hop', address_subtype: 'laundering_intermediate', promotion_status: 'review_required' }),
      expect.objectContaining({ address: '5Deposit', address_subtype: 'exchange_deposit_candidate', promotion_status: 'review_required' }),
    ]))
  })

  it('emits scammer seed, laundering intermediate, and deposit candidates with evidence', async () => {
    runFundFlowProbeMock.mockResolvedValueOnce(probeResult('5Scammer', ['5Scammer', '5Hop', '5Deposit', '5Exchange']))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      scammerAddresses: ['5Scammer'],
      caseId: 'case-1',
    })

    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Scammer',
        address_type: 'SCAM',
        address_subtype: 'scam_seed',
        confidence_score: 1,
        promotion_status: 'promote_confirmed',
      }),
      expect.objectContaining({
        address: '5Hop',
        address_type: 'SCAM',
        address_subtype: 'laundering_intermediate',
        promotion_status: 'review_required',
      }),
      expect.objectContaining({
        address: '5Deposit',
        address_type: 'SCAM',
        address_subtype: 'exchange_deposit_candidate',
        promotion_status: 'review_required',
      }),
    ]))
    expect(result.structuredContent.facts.safety_decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Exchange', decision: 'do_not_label_exchange_endpoint' }),
      expect.objectContaining({ address: '5Lead', decision: 'context_only_reverse_lead' }),
    ]))
    expect(evidenceAppendMock).toHaveBeenCalledWith('case-1', expect.objectContaining({
      source: 'scam_topology',
    }))
  })

  it('expands victim traces with live topology funding, sweep, and fan context', async () => {
    runFundFlowProbeMock.mockResolvedValueOnce(probeResult('5Victim', ['5Victim', '5Mixer', '5Deposit', '5Exchange']))
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      {
        id: 'seed_in_1',
        ok: true,
        results: [{
          relation: 'seed_funding_input',
          src: '5FundingA',
          dst: '5Victim',
          amount_sum: 1506.99,
          tx_count: 7,
          src_labels: ['miner subnet 15'],
          dst_labels: [],
        }],
      },
      {
        id: 'seed_out_1',
        ok: true,
        results: [{
          relation: 'seed_sweep',
          src: '5Victim',
          dst: '5Mixer',
          amount_sum: 1506.99,
          tx_count: 1,
          src_labels: [],
          dst_labels: [],
        }],
      },
      {
        id: 'anchor_fan_in_1',
        ok: true,
        results: [{
          relation: 'anchor_fan_in',
          src: '5FanIn',
          dst: '5Mixer',
          amount_sum: 44,
          tx_count: 2,
          src_labels: [],
          dst_labels: [],
        }],
      },
      {
        id: 'anchor_fan_out_1',
        ok: true,
        results: [{
          relation: 'anchor_fan_out',
          src: '5Mixer',
          dst: '5FanOut',
          amount_sum: 11,
          tx_count: 1,
          src_labels: [],
          dst_labels: ['Kucoin', 'exchange'],
        }],
      },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 3,
      perAddressLimit: 4,
    })

    const call = vi.mocked(client.callTool).mock.calls[0]?.[0]
    expect(call).toMatchObject({
      name: 'graph_query_batch',
      arguments: expect.objectContaining({
        network: 'bittensor',
        per_query_timeout_seconds: 600,
      }),
    })
    const queries = call?.arguments?.queries as Array<{ id: string; query: string }>
    expect(queries.map((query) => query.id)).toEqual(['seed_in_1', 'seed_out_1', 'anchor_fan_in_1', 'anchor_fan_out_1'])
    expect(queries[0]?.query).toContain('USE live_topology MATCH')
    expect(queries[2]?.query).toContain('5Mixer')

    expect(result.summaryText).toContain('Infrastructure context: 4 live topology edge(s)')
    expect(result.structuredContent.facts.infrastructure_flows).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'seed_funding_input', src: '5FundingA', dst: '5Victim' }),
      expect.objectContaining({ relation: 'seed_sweep', src: '5Victim', dst: '5Mixer' }),
      expect.objectContaining({ relation: 'anchor_fan_in', src: '5FanIn', dst: '5Mixer' }),
      expect.objectContaining({ relation: 'anchor_fan_out', src: '5Mixer', dst: '5FanOut' }),
    ]))
    expect(result.graphData.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '5FundingA', target: '5Victim', relation: 'seed_funding_input' }),
      expect.objectContaining({ source: '5Mixer', target: '5FanOut', relation: 'anchor_fan_out' }),
    ]))
    expect(result.graphData.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5FundingA', roles: expect.arrayContaining(['funding_source']) }),
      expect.objectContaining({ address: '5FanOut', roles: expect.arrayContaining(['fan_out_context']) }),
    ]))
  })
})
