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

  it('requires one victim address and an incident timestamp', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, { network: 'bittensor' }))
      .rejects.toThrow('victim_address is required')
    await expect(scamTopology(client, config, { network: 'bittensor', victimAddress: '5Victim' }))
      .rejects.toThrow('incident_timestamp_ms is required')
  })

  it('defaults to 16 hops and does not turn victim seed addresses into scam labels', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
    })

    expect(result.structuredContent.facts.victim_address).toBe('5Victim')
    expect(result.structuredContent.facts.incident_timestamp_ms).toBe(1715532228001)
    expect(result.structuredContent.facts.runs[0]).toEqual(expect.objectContaining({
      graph_scope: 'incident',
      topology_graph: 'live_topology',
      max_hops: 16,
    }))
    expect(result.structuredContent.facts.scam_labels).toEqual([])
    expect(result.structuredContent.facts.label_candidates)
      .not.toContainEqual(expect.objectContaining({ address: '5Victim', address_type: 'SCAM' }))
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
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
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
    expect(result.structuredContent.facts.scam_labels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Hop',
        scam: true,
        confidence: 0.72,
        source: 'scam_topology',
        source_victim_address: '5Victim',
        source_incident_timestamp_ms: 1715532228001,
      }),
      expect.objectContaining({
        address: '5Deposit',
        scam: true,
        confidence: 0.68,
        source_victim_address: '5Victim',
      }),
    ]))
  })

  it('rejects scammer seed inputs because scam topology starts from a victim incident', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      scammerAddresses: ['5Scammer'],
      incidentTimestampMs: 1715532228001,
    })).rejects.toThrow('scammer_addresses is no longer accepted')
  })

  it('applies activity timestamps on every wave and follows only active downstream infrastructure', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5LegacyHop', { first_seen_timestamp: 1715532229000, last_seen_timestamp: 1715532229000 })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5LegacyHop', '5ActiveMixer', { first_seen_timestamp: 1715532230000, last_seen_timestamp: 1715532230000 })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_3', ok: true, results: [topologyRow('5ActiveMixer', '5Deposit', { first_seen_timestamp: 1715532231000, last_seen_timestamp: 1715532231000 })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_4', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['exchange'], dst_is_exchange: true, first_seen_timestamp: 1715532232000, last_seen_timestamp: 1715532232000 })] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_deposit_cluster_1', ok: true, results: [topologyRow('5LegacyCluster', '5Deposit', { last_seen_timestamp: 1499999999999 })] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 4,
    })

    const queries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
    expect(queries.find((query) => query.id === 'incident_hop_1')?.query)
      .toContain('r.last_seen_timestamp >= 1715532228001')
    expect(queries.find((query) => query.id === 'incident_hop_2')?.query)
      .toContain('r.last_seen_timestamp >= 1715532229000')
    expect(queries.find((query) => query.id === 'incident_hop_3')?.query)
      .toContain('r.last_seen_timestamp >= 1715532230000')
    expect(queries.find((query) => query.id === 'incident_deposit_cluster_1')?.query)
      .not.toContain('r.last_seen_timestamp >= 1715532228001')
    expect(result.structuredContent.facts.scam_labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5LegacyHop', scam: true }),
      expect.objectContaining({ address: '5ActiveMixer', scam: true }),
      expect.objectContaining({ address: '5LegacyCluster', scam: true }),
    ]))
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
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 3,
    })

    const calls = vi.mocked(client.callTool).mock.calls
    const allQueries = calls.flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
    expect(allQueries.map((query) => query.id)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/seed_in|funding|fan_in/i),
    ]))
    expect(allQueries.map((query) => query.query).join('\n')).not.toContain(']->(dst:Address {address: "5Victim"})')
    expect(allQueries[0]?.query).toMatch(/^USE live_topology MATCH \(src:Address \{address: "5Victim"\}\)-\[r:FLOWS_TO\]->\(dst:Address\)/)
    expect(allQueries[1]?.query).toContain('MATCH (src:Address {address: "5Hop"})-[r:FLOWS_TO]->(dst:Address)')
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

  it('keeps repeated targets as non-expanding convergence edges', async () => {
    vi.mocked(client.callTool).mockImplementation(async (request) => {
      const queries = request.arguments?.queries as Array<{ id: string; query: string }>
      return graphBatchResult(queries.map((query) => {
        const source = query.query.match(/address: "([^"]+)"/)?.[1]
        const resultsBySource: Record<string, Array<Record<string, unknown>>> = {
          '5Victim': [
            topologyRow('5Victim', '5A', { first_seen_timestamp: 100, last_seen_timestamp: 100 }),
            topologyRow('5Victim', '5B', { first_seen_timestamp: 101, last_seen_timestamp: 101 }),
          ],
          '5A': [topologyRow('5A', '5C', { first_seen_timestamp: 110, last_seen_timestamp: 110 })],
          '5B': [topologyRow('5B', '5C', { first_seen_timestamp: 111, last_seen_timestamp: 111 })],
          '5C': [topologyRow('5C', '5D', { first_seen_timestamp: 120, last_seen_timestamp: 120 })],
        }
        return {
          id: query.id,
          ok: true,
          results: source ? resultsBySource[source] ?? [] : [],
        }
      }))
    })
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 100,
      maxHops: 3,
    })

    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '5A',
        dst: '5C',
        relation: 'traversal_edge',
        wave_index: 2,
        expands_frontier: true,
      }),
      expect.objectContaining({
        src: '5B',
        dst: '5C',
        relation: 'convergence_edge',
        wave_index: 2,
        expands_frontier: false,
      }),
      expect.objectContaining({
        src: '5C',
        dst: '5D',
        relation: 'traversal_edge',
        wave_index: 3,
        expands_frontier: true,
      }),
    ]))
    const cExpansionQueries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ query: string }> ?? [])
      .filter((query) => query.query.includes('address: "5C"'))
    expect(cExpansionQueries.length).toBeGreaterThan(0)
    expect(cExpansionQueries.length).toBeLessThanOrEqual(2)
  })

  it('runs only the primary node-relative activity policy by default', async () => {
    vi.mocked(client.callTool).mockImplementation(async (request) => {
      const queries = request.arguments?.queries as Array<{ id: string; query: string }>
      return graphBatchResult(queries.map((query) => {
        const source = query.query.match(/address: "([^"]+)"/)?.[1]
        return {
          id: query.id,
          ok: true,
          results: source === '5Victim'
            ? [topologyRow('5Victim', '5A', { first_seen_timestamp: 150, last_seen_timestamp: 150 })]
            : [],
        }
      }))
    })
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 100,
      maxHops: 2,
    })

    const sourceAQueries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
      .filter((query) => query.query.includes('address: "5A"'))
    expect(sourceAQueries.map((query) => query.query)).toEqual([
      expect.stringContaining('r.first_seen_timestamp >= 150 OR r.last_seen_timestamp >= 150'),
    ])
    expect(result.structuredContent.facts.runs).toEqual([
      expect.objectContaining({ activity_policy: 'node_relative', primary: true }),
    ])
    expect(result.structuredContent.facts.activity_policy_mode).toBe('node_relative_only')
  })

  it('runs only the global incident activity policy when requested', async () => {
    vi.mocked(client.callTool).mockImplementation(async (request) => {
      const queries = request.arguments?.queries as Array<{ id: string; query: string }>
      return graphBatchResult(queries.map((query) => {
        const source = query.query.match(/address: "([^"]+)"/)?.[1]
        return {
          id: query.id,
          ok: true,
          results: source === '5Victim'
            ? [topologyRow('5Victim', '5A', { first_seen_timestamp: 150, last_seen_timestamp: 150 })]
            : [],
        }
      }))
    })
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 100,
      maxHops: 2,
      activityPolicyMode: 'global_incident_only',
    })

    const sourceAQueries = vi.mocked(client.callTool).mock.calls
      .flatMap((call) => call[0]?.arguments?.queries as Array<{ id: string; query: string }> ?? [])
      .filter((query) => query.query.includes('address: "5A"'))
    expect(sourceAQueries.map((query) => query.query)).toEqual([
      expect.stringContaining('r.first_seen_timestamp >= 100 OR r.last_seen_timestamp >= 100'),
    ])
    expect(result.structuredContent.facts.runs).toEqual([
      expect.objectContaining({ activity_policy: 'global_incident', primary: true }),
    ])
    expect(result.structuredContent.facts.primary_activity_policy).toBe('global_incident')
    expect(result.structuredContent.facts.activity_policy_mode).toBe('global_incident_only')
  })

  it('returns a track_funds-compatible graph payload and keeps cluster enrichment out of primary flows', async () => {
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
          topologyRow('5ClusterPeer', '5Deposit', {
            amount_sum: 42,
            amount_usd_sum: 420,
            tx_count: 2,
            src_labels: ['miner subnet 63'],
            first_seen_timestamp: 1700000000000,
            last_seen_timestamp: 1710000000000,
          }),
        ] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 3,
    })

    expect(result.graphData).toMatchObject({
      schema: 'chain-insights.graph.v1',
      nodes: expect.any(Array),
      edges: expect.any(Array),
      flows: expect.any(Array),
      deposits: expect.any(Array),
      source_matches: expect.any(Array),
      reverse_leads: expect.any(Array),
      edge_anchors: [],
    })
    expect(result.graphData).not.toHaveProperty('topology_edges')
    expect(result.graphData).not.toHaveProperty('scam_topology')
    expect(result.graphData.flows).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Victim', dst: '5Hop', terminal_exchange: false }),
      expect.objectContaining({ src: '5Hop', dst: '5Deposit', terminal_exchange: false }),
      expect.objectContaining({ src: '5Deposit', dst: '5Exchange', terminal_exchange: true }),
    ]))
    expect(result.graphData.flows).not.toContainEqual(expect.objectContaining({
      src: '5ClusterPeer',
      dst: '5Deposit',
    }))
    expect(result.graphData.deposits).toEqual([
      expect.objectContaining({
        address: '5Deposit',
        exchangeAddress: '5Exchange',
        hops: 3,
        path: ['5Victim', '5Hop', '5Deposit', '5Exchange'],
      }),
    ])
    expect(result.graphData.reverse_leads).toEqual([
      expect.objectContaining({
        address: '5ClusterPeer',
        deposit_address: '5Deposit',
        amount_usd: 420,
        labels: ['miner subnet 63'],
        reason: 'deposit_cluster_inflow',
      }),
    ])
    expect(result.graphData.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '5ClusterPeer', target: '5Deposit', direction: 'reverse_1hop_lead' }),
    ]))
  })

  it('rejects removed history and compare scope controls', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      scope: 'history',
    })).rejects.toThrow('scope is no longer accepted')
    await expect(scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      scope: 'compare',
    })).rejects.toThrow('scope is no longer accepted')
  })

  it('rejects multiple victim addresses because one incident anchors one topology', async () => {
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await expect(scamTopology(client, config, {
      network: 'bittensor',
      victimAddresses: ['5VictimA', '5VictimB'],
      incidentTimestampMs: 1715532228001,
    })).rejects.toThrow('victim_address must contain exactly one address')
  })

  it('filters the initial victim outflow by incidentTimestampMs', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5IncidentHop')] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries as Array<{ query: string }>
    expect(queries[0]?.query).toContain('USE live_topology')
    expect(queries[0]?.query).toContain('r.last_seen_timestamp >= 1715532228001')
  })

  it('treats generic non-exchange labels as context boundaries, not hard-coded infrastructure roles', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5LabeledNode', { dst_labels: ['validator', 'subnet 7'] })] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
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
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5Deposit')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: true, results: [topologyRow('5Deposit', '5Exchange', { dst_labels: ['Binance', 'exchange', 'miner subnet 5', 'subnet 5 owner'], dst_is_exchange: true })] },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
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
    expect(result.structuredContent.facts.terminal_points).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Exchange',
        terminal_type: 'exchange_endpoint',
        exchange_address: '5Exchange',
        exchange_names: ['Binance'],
        deposit_address: '5Deposit',
        source_address: '5Deposit',
      }),
    ]))
    expect(result.structuredContent.facts.label_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Deposit',
        address_subtype: 'exchange_deposit_candidate',
        promotion_status: 'review_required',
        evidence: expect.arrayContaining([
          expect.objectContaining({
            deposit_address: '5Deposit',
            exchange_address: '5Exchange',
            exchange_names: ['Binance'],
          }),
        ]),
      }),
    ]))
    expect(result.graphData.deposits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: '5Deposit',
        exchangeAddress: '5Exchange',
        exchangeNames: ['Binance'],
      }),
    ]))
    expect(result.structuredContent.facts.scam_labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5Deposit', scam: true, source_victim_address: '5Victim' }),
    ]))
    expect(result.structuredContent.facts.label_candidates).not.toContainEqual(expect.objectContaining({ address: '5Exchange' }))
    expect(result.structuredContent.facts.scam_labels).not.toContainEqual(expect.objectContaining({ address: '5Exchange' }))
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
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 3,
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
    ]))
    expect(result.structuredContent.facts.label_candidates).not.toContainEqual(expect.objectContaining({
      address: '5GenericLabeledMixer',
    }))
    expect(result.structuredContent.facts.scam_labels).not.toContainEqual(expect.objectContaining({
      address: '5GenericLabeledMixer',
    }))
    expect(result.structuredContent.facts.investigation_hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '5GenericLabeledMixer', hint_type: 'generic_labeled_cluster_member' }),
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
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
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

  it('uses an internal bounded frontier limit', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([
      { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5AOut')] },
    ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 1,
    })

    const queries = vi.mocked(client.callTool).mock.calls[0]?.[0]?.arguments?.queries as Array<{ id: string; query: string }>
    expect(queries).toHaveLength(1)
    expect(queries[0]?.query).toContain('MATCH (src:Address {address: "5Victim"})-[r:FLOWS_TO]->(dst:Address)')
    expect(queries[0]?.query).toContain('LIMIT 10')
  })

  it('chunks frontier queries to stay within graph_query_batch limits', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([{
        id: 'incident_hop_1',
        ok: true,
        results: Array.from({ length: 21 }, (_, resultIndex) => (
          topologyRow('5Victim', `5Frontier${resultIndex}`)
        )),
      }]))
      .mockResolvedValueOnce(emptyGraphBatchResult(20))
      .mockResolvedValueOnce(emptyGraphBatchResult(1))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 2,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(client.callTool).mock.calls[1]?.[0]?.arguments?.queries).toHaveLength(20)
    expect(vi.mocked(client.callTool).mock.calls[2]?.[0]?.arguments?.queries).toHaveLength(1)
  })

  it('caps frontier breadth per hop so default 16-hop runs stay bounded', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([{
        id: 'incident_hop_1',
        ok: true,
        results: Array.from({ length: 80 }, (_, resultIndex) => (
          topologyRow('5Victim', `5Frontier${resultIndex}`)
        )),
      }]))
      .mockResolvedValueOnce(emptyGraphBatchResult(20))
      .mockResolvedValueOnce(emptyGraphBatchResult(20))
      .mockResolvedValueOnce(emptyGraphBatchResult(10))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 2,
    })

    expect(vi.mocked(client.callTool)).toHaveBeenCalledTimes(4)
    expect(vi.mocked(client.callTool).mock.calls[1]?.[0]?.arguments?.queries).toHaveLength(20)
    expect(vi.mocked(client.callTool).mock.calls[2]?.[0]?.arguments?.queries).toHaveLength(20)
    expect(vi.mocked(client.callTool).mock.calls[3]?.[0]?.arguments?.queries).toHaveLength(10)
  })

  it('skips failed downstream frontier queries without failing the whole scam topology', async () => {
    vi.mocked(client.callTool)
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_1', ok: true, results: [topologyRow('5Victim', '5SlowFrontier')] },
      ]))
      .mockResolvedValueOnce(graphBatchResult([
        { id: 'incident_hop_2', ok: false, results: [], error: 'query timeout' },
      ]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 2,
    })

    expect(result.structuredContent.facts.topology_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '5Victim', dst: '5SlowFrontier' }),
    ]))
    expect(result.structuredContent.facts.runs[0]).toEqual(expect.objectContaining({
      skipped_query_errors: [expect.objectContaining({
        id: 'incident_hop_2',
        hop: 2,
        error: 'query timeout',
      })],
    }))
  })

  it('does not preserve legacy seed funding input infrastructure roles', async () => {
    vi.mocked(client.callTool).mockResolvedValueOnce(graphBatchResult([]))
    const { scamTopology } = await import('../src/investigation/scam-topology.js')

    const result = await scamTopology(client, config, {
      network: 'bittensor',
      victimAddress: '5Victim',
      incidentTimestampMs: 1715532228001,
      maxHops: 3,
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
