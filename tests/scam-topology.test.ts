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

function emptyGraphBatchResult(queryCount: number) {
  return graphBatchResult(Array.from({ length: queryCount }, (_, index) => ({
    id: `empty_${index + 1}`,
    ok: true,
    results: [],
  })))
}

function topologyRow(src: string, dst: string, extra: Record<string, unknown> = {}) {
  return {
    src,
    dst,
    amount_sum: 10,
    amount_usd_sum: 10,
    tx_count: 1,
    src_labels: [],
    dst_labels: [],
    src_is_exchange: false,
    dst_is_exchange: false,
    ...extra,
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
    runFundFlowProbeMock.mockImplementation((_client, _config, opts: { seedAddress: string }) => (
      probeResult(opts.seedAddress, [opts.seedAddress, '5LegacyHop', '5LegacyDeposit', '5LegacyExchange'])
    ))
  })

  it('requires at least one victim or scammer seed', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, { network: 'bittensor' }))
      .rejects.toThrow('victim_addresses or scammer_addresses is required')
  })

  it('does not turn victim seed addresses into risky label candidates', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5Hop')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Hop', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_3', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true })] },
      ]))
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
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Scammer', '5Hop')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Hop', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_3', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true })] },
      ]))
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
    ]))
    expect(evidenceAppendMock).toHaveBeenCalledWith('case-1', expect.objectContaining({
      source: 'scam_topology',
    }))
  })

  it('traverses victim topology outward and never queries victim inbound funding sources', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5Hop')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Hop', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_3', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true })] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 3,
      perAddressLimit: 4,
    })

    const calls = vi.mocked(client.callTool).mock.calls
    const allQueries = calls.flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
    expect(allQueries.map((query) => query.id)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/seed_in|funding|fan_in/i),
    ]))
    expect(allQueries.map((query) => query.query).join('\n')).not.toContain(']->(dst:Address {address: "5Victim"})')
    expect(allQueries[0]?.query).toMatch(/^USE live_topology MATCH \(src:Address\)-\[r:FLOWS_TO\]->\(dst:Address\)/)
    expect(allQueries[0]?.query).toContain('src.address = "5Victim"')
    expect(allQueries[1]?.query).toContain('src.address = "5Hop"')
    expect(allQueries[1]?.query).not.toContain('5Victim')

    expect(result.structuredContent.facts.infrastructure_flows).toEqual([])
    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Victim', dst: '5Hop', relation: 'seed_outflow' }),
      expect.objectContaining({ src: '5Hop', dst: '5Deposit', relation: 'traversal_edge' }),
      expect.objectContaining({ src: '5Deposit', dst: '5Exchange', relation: 'terminal_exchange' }),
    ]))
    expect(result.graphData.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '5Victim', target: '5Hop', relation: 'seed_outflow' }),
      expect.objectContaining({ source: '5Deposit', target: '5Exchange', relation: 'terminal_exchange' }),
    ]))
  })

  it('uses archive topology for history scope', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'history_hop_1', ok: true, results: [topologyRow('5Victim', '5HistoryHop')] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      scope: 'history',
      maxHops: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries as Array<{ query: string }>
    expect(queries[0]?.query).toMatch(/^USE archive_topology MATCH/)
    expect(queries[0]?.query).not.toContain('.roles')
    expect(vi.mocked(client.callTool).mock.calls[0]?.[2]).toMatchObject({
      timeout: 900000,
      maxTotalTimeout: 900000,
    })
  })

  it('runs archive frontier queries one at a time to avoid long MemGQL sessions', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(emptyGraphBatchResult(1))
      .mockResolvedValueOnce(emptyGraphBatchResult(1))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: ['5VictimA', '5VictimB'],
      scope: 'history',
      maxHops: 1,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries).toHaveLength(1)
    expect(vi.mocked(client.callTool).mock.calls[1]?.[0]?.arguments?.queries).toHaveLength(1)
  })

  it('filters incident traversal by sinceTimestampMs when provided', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5IncidentHop')] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      scope: 'incident',
      sinceTimestampMs: 1715532228001,
      maxHops: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries as Array<{ query: string }>
    expect(queries[0]?.query).toContain('USE live_topology')
    expect(queries[0]?.query).toContain('r.last_seen_timestamp >= 1715532228001')
  })

  it('compares history and incident traversal membership', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'history_hop_1', ok: true, results: [
          topologyRow('5Victim', '5Shared'),
          topologyRow('5Victim', '5OldOnly'),
        ] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [
          topologyRow('5Victim', '5Shared'),
          topologyRow('5Victim', '5NewOnly'),
        ] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      scope: 'compare',
      sinceTimestampMs: 1715532228001,
      maxHops: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ query: string }> ?? [])
      .map((query) => query.query)
      .join('\n')
    expect(queries).toContain('USE archive_topology')
    expect(queries).toContain('USE live_topology')
    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Victim', dst: '5Shared', scope_membership: 'overlap' }),
      expect.objectContaining({ src: '5Victim', dst: '5OldOnly', scope_membership: 'history_only' }),
      expect.objectContaining({ src: '5Victim', dst: '5NewOnly', scope_membership: 'incident_only' }),
    ]))
  })

  it('treats generic non-exchange labels as context boundaries, not hard-coded infrastructure roles', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5LabeledNode', { dst_labels: ['validator', 'subnet 7'] })] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 3,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(1)
    expect(result.structuredContent.facts.case_roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5LabeledNode', role: 'context_boundary' }),
    ]))
    expect(result.structuredContent.facts.investigation_hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5LabeledNode', labels: ['validator', 'subnet 7'], hint_type: 'generic_labeled_context' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).not.toContainEqual(expect.objectContaining({
      address: '5LabeledNode',
      address_subtype: expect.stringMatching(/miner|validator|subnet/),
    }))
  })

  it('stops at exchange endpoints and records safety context instead of scam labels', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Scammer', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true })] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      scammerAddresses: '5Scammer',
      maxHops: 3,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(3)
    const queries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string }> ?? [])
    expect(queries.map((query) => query.id)).toContain('incident_deposit_cluster_1')
    expect(result.structuredContent.facts.case_roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Exchange', role: 'exchange_endpoint' }),
      expect.objectContaining({ address: '5Deposit', role: 'exchange_deposit_candidate' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Scammer', address_subtype: 'scam_seed', promotion_status: 'promote_confirmed' }),
      expect.objectContaining({ address: '5Deposit', address_subtype: 'exchange_deposit_candidate', promotion_status: 'review_required' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).not.toContainEqual(expect.objectContaining({ address: '5Exchange' }))
    expect(result.structuredContent.facts.safety_decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Exchange', decision: 'do_not_label_exchange_endpoint' }),
    ]))
  })

  it('expands exchange-deposit inflow clusters into reviewable laundering candidates', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5Hop')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Hop', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_3', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_deposit_cluster_1', ok: true, results: [
          topologyRow('5SiblingMixer', '5Deposit', { amount_sum: 42 }),
          topologyRow('5GenericLabeledMixer', '5Deposit', { amount_sum: 21, src_labels: ['miner subnet 9'] }),
        ] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 3,
      sinceTimestampMs: 1715532228001,
    })

    const queries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
    expect(queries.map((query) => query.id)).toContain('incident_deposit_cluster_1')
    expect(queries.find((query) => query.id === 'incident_deposit_cluster_1')?.query)
      .toContain('MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address: "5Deposit"})')

    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '5SiblingMixer',
        dst: '5Deposit',
        relation: 'deposit_cluster_inflow',
      }),
      expect.objectContaining({
        src: '5GenericLabeledMixer',
        dst: '5Deposit',
        relation: 'deposit_cluster_inflow',
        src_labels: ['miner subnet 9'],
      }),
    ]))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5SiblingMixer',
        address_subtype: 'laundering_intermediate',
        promotion_status: 'review_required',
      }),
      expect.objectContaining({
        address: '5GenericLabeledMixer',
        address_subtype: 'laundering_intermediate',
        promotion_status: 'review_required',
      }),
    ]))
  })

  it('treats string zero exchange flags as false and continues traversal', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5StringZero', { dst_is_exchange: '0' })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5StringZero', '5NextHop')] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 2,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(2)
    expect(result.structuredContent.facts.case_roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5StringZero', role: 'laundering_intermediate' }),
    ]))
    expect(result.structuredContent.facts.case_roles).not.toContainEqual(expect.objectContaining({
      address: '5StringZero',
      role: 'exchange_endpoint',
    }))
    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5StringZero', dst: '5NextHop', relation: 'traversal_edge' }),
    ]))
  })

  it('enforces per-address limits with one bounded query per frontier source', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1_source_1', ok: true, results: [topologyRow('5SeedA', '5AOut')] },
      { id: 'incident_hop_1_source_2', ok: true, results: [topologyRow('5SeedB', '5BOut')] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      scammerAddresses: ['5SeedA', '5SeedB'],
      maxHops: 1,
      perAddressLimit: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries as Array<{ id: string; query: string }>
    expect(queries).toHaveLength(2)
    expect(queries[0]?.query).toContain('src.address = "5SeedA"')
    expect(queries[0]?.query).toContain('LIMIT 1')
    expect(queries[1]?.query).toContain('src.address = "5SeedB"')
    expect(queries[1]?.query).toContain('LIMIT 1')
  })

  it('chunks frontier queries to stay within graph_query_batch limits', async () => {
    const seedAddresses = ['5SeedA', '5SeedB', '5SeedC']
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult(seedAddresses.map((seedAddress, seedIndex) => ({
        id: `incident_hop_1_source_${seedIndex + 1}`,
        ok: true,
        results: Array.from({ length: 7 }, (_, resultIndex) => (
          topologyRow(seedAddress, `5Frontier${seedIndex}${resultIndex}`)
        )),
      }))))
      .mockResolvedValueOnce(emptyGraphBatchResult(20))
      .mockResolvedValueOnce(emptyGraphBatchResult(1))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      scammerAddresses: seedAddresses,
      maxHops: 2,
      perAddressLimit: 10,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(client.callTool).mock.calls[1]?.[0]?.arguments?.queries).toHaveLength(20)
    expect(vi.mocked(client.callTool).mock.calls[2]?.[0]?.arguments?.queries).toHaveLength(1)
  })

  it('preserves seed attribution when multiple seeds share a downstream frontier', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1_source_1', ok: true, results: [topologyRow('5Victim', '5Shared')] },
        { id: 'incident_hop_1_source_2', ok: true, results: [topologyRow('5Scammer', '5Shared')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Shared', '5Exit')] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      scammerAddresses: '5Scammer',
      maxHops: 2,
    })

    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Shared', dst: '5Exit', seed_address: '5Victim', seed_role: 'victim' }),
      expect.objectContaining({ src: '5Shared', dst: '5Exit', seed_address: '5Scammer', seed_role: 'scammer' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Exit',
        evidence: expect.arrayContaining([
          expect.objectContaining({ seed_address: '5Victim', seed_role: 'victim' }),
          expect.objectContaining({ seed_address: '5Scammer', seed_role: 'scammer' }),
        ]),
      }),
    ]))
  })

  it('does not preserve legacy seed funding input infrastructure roles', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: '5Victim',
      maxHops: 3,
      perAddressLimit: 4,
    })

    const allQueries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string }> ?? [])
    expect(allQueries.map((query) => query.id)).not.toEqual(expect.arrayContaining(['seed_in_1', 'anchor_fan_in_1']))
    expect(result.structuredContent.facts.infrastructure_flows).toEqual([])
    expect(result.graphData.edges).not.toContainEqual(expect.objectContaining({ relation: 'seed_funding_input' }))
    expect(result.graphData.nodes).not.toContainEqual(expect.objectContaining({
      address: '5FundingA',
      roles: expect.arrayContaining(['funding_source']),
    }))
  })
})
