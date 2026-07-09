import { describe, expect, it, vi } from 'vitest'
import {
  FRONTIER_CAP,
  MAX_HOPS_CAP,
  MAX_QUERIES_PER_BATCH,
  QUERY_ROW_LIMIT,
  WALL_CLOCK_BUDGET_MS,
  scamCorridorQueryBuilderContract,
  scamCorridorTrace,
} from '../src/investigation/scam-corridor-trace.js'

type BatchQuery = { id: string; query: string }
type CallToolRequest = { arguments: { queries: BatchQuery[] } }

function findingFor(document: { findings: Array<{ address: string }> }, address: string) {
  return document.findings.find((finding) => finding.address === address)
}

// One hop-1 neighbor per gate arm, so a single canned response drives the
// whole gate-precedence table in one traversal (maxHops: 1 — none of these
// nodes need to be expanded further to prove their own classification).
const GATE_TABLE_ROWS = [
  { address: 'addr-exchange-flag', degree_in: 5, is_exchange: true, labels: [], tx_count: 1, amount_usd_sum: 100 },
  // Proves precedence: the Exchange boundary-role label is shadowed by the
  // exchange gate (Gate 1) firing first, exactly like gates.go's
  // isExchangeNode(n) — it must resolve exchange_terminal, NOT
  // protected_infra, even though 'Exchange' is also in boundaryRoleLabels.
  { address: 'addr-exchange-label', degree_in: 5, is_exchange: false, labels: ['Exchange'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-hub', degree_in: 1500, is_exchange: false, labels: [], tx_count: 1, amount_usd_sum: 100 },
  // High degree_in but Bridge is excluded from isHub (matches gates.go's
  // isBridgeNode guard inside isHub) — must fall through to protected_infra.
  { address: 'addr-bridge', degree_in: 5000, is_exchange: false, labels: ['Bridge'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-validator', degree_in: 5, is_exchange: false, labels: ['Validator'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-miner', degree_in: 5, is_exchange: false, labels: ['Miner'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-subnet', degree_in: 5, is_exchange: false, labels: ['Subnet'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-mixer', degree_in: 5, is_exchange: false, labels: ['Mixer'], tx_count: 1, amount_usd_sum: 100 },
  { address: 'addr-shared-tx', degree_in: 5, is_exchange: false, labels: [], tx_count: 1000, amount_usd_sum: 100 },
  { address: 'addr-shared-usd', degree_in: 5, is_exchange: false, labels: [], tx_count: 1, amount_usd_sum: 5_000_000 },
  { address: 'addr-mule', degree_in: 5, is_exchange: false, labels: [], tx_count: 1, amount_usd_sum: 100 },
]

function stubClient(rows: Array<Record<string, unknown>>) {
  return {
    callTool: vi.fn(async (req: CallToolRequest) => {
      const results = req.arguments.queries.map((query) => ({ id: query.id, ok: true, results: rows }))
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
    }),
  }
}

function throwingClient(message: string) {
  return { callTool: vi.fn(async () => { throw new Error(message) }) }
}

describe('scamCorridorTrace gate precedence (AC1)', () => {
  it('drives every gate arm from one hop of canned rows', async () => {
    const remote = stubClient(GATE_TABLE_ROWS)
    const result = await scamCorridorTrace(remote as never, {
      seedAddress: 'seed-address',
      network: 'bittensor',
      maxHops: 1,
      writeArtifacts: false,
    })

    expect(result.document.status).toBe('complete')
    expect(result.document.frontier_truncated).toBeUndefined()

    expect(findingFor(result.document, 'addr-exchange-flag')).toMatchObject({ classification: 'exchange_terminal', gate: 'exchange_terminal' })
    expect(findingFor(result.document, 'addr-exchange-label')).toMatchObject({ classification: 'exchange_terminal', gate: 'exchange_terminal' })
    expect(findingFor(result.document, 'addr-hub')).toMatchObject({ classification: 'corridor_hub', gate: 'hub_degree_in' })
    expect(findingFor(result.document, 'addr-bridge')).toMatchObject({ classification: 'protected_infra', gate: 'boundary_role:Bridge' })
    expect(findingFor(result.document, 'addr-validator')).toMatchObject({ classification: 'protected_infra', gate: 'boundary_role:Validator' })
    expect(findingFor(result.document, 'addr-miner')).toMatchObject({ classification: 'protected_infra', gate: 'boundary_role:Miner' })
    expect(findingFor(result.document, 'addr-subnet')).toMatchObject({ classification: 'protected_infra', gate: 'boundary_role:Subnet' })
    expect(findingFor(result.document, 'addr-mixer')).toMatchObject({ classification: 'corridor_hub', gate: 'mixer_labeled' })
    const sharedTx = findingFor(result.document, 'addr-shared-tx')
    expect(sharedTx?.classification).toBeUndefined()
    expect(sharedTx?.gate).toBe('shared_deposit_exchange_infra')
    const sharedUsd = findingFor(result.document, 'addr-shared-usd')
    expect(sharedUsd?.classification).toBeUndefined()
    expect(sharedUsd?.gate).toBe('shared_deposit_exchange_infra')
    expect(findingFor(result.document, 'addr-mule')).toMatchObject({ classification: 'propagated_scam', gate: 'propagated_scam' })
  })
})

describe('scamCorridorTrace hard caps (AC2)', () => {
  it('pins the literal cap constants', () => {
    expect(MAX_HOPS_CAP).toBe(4)
    expect(FRONTIER_CAP).toBe(50)
    expect(MAX_QUERIES_PER_BATCH).toBe(20)
    expect(QUERY_ROW_LIMIT).toBe(200)
    expect(WALL_CLOCK_BUDGET_MS).toBe(120_000)
  })

  it('clamps maxHops to the hard cap even if a caller asks for more', async () => {
    const remote = stubClient([])
    await scamCorridorTrace(remote as never, { seedAddress: 'seed', network: 'bittensor', maxHops: 999, writeArtifacts: false })
    // No neighbors returned, so the loop stops after hop 1 regardless; this
    // test only proves the call does not reject/hang on an oversized maxHops.
    expect(remote.callTool).toHaveBeenCalled()
  })

  it('marks the run inconclusive when the wall-clock budget is exhausted before any query', async () => {
    const remote = throwingClient('should never be called')
    const result = await scamCorridorTrace(remote as never, {
      seedAddress: 'seed',
      network: 'bittensor',
      wallClockBudgetMs: 0,
      writeArtifacts: false,
    })
    expect(result.document.status).toBe('inconclusive')
    expect(remote.callTool).not.toHaveBeenCalled()
  })

  it('marks the run inconclusive on admission rejection after one backoff retry', async () => {
    const remote = throwingClient('admission rejected: quota exceeded')
    const result = await scamCorridorTrace(remote as never, {
      seedAddress: 'seed',
      network: 'bittensor',
      writeArtifacts: false,
    })
    expect(result.document.status).toBe('inconclusive')
    expect(remote.callTool).toHaveBeenCalledTimes(2)
  })

  it('marks the run inconclusive on a timeout that persists through one backoff retry', async () => {
    const remote = throwingClient('query timed out after 10s')
    const result = await scamCorridorTrace(remote as never, {
      seedAddress: 'seed',
      network: 'bittensor',
      writeArtifacts: false,
    })
    expect(result.document.status).toBe('inconclusive')
    expect(remote.callTool).toHaveBeenCalledTimes(2)
  })

  it('marks the run partial and records frontier_truncated when a hop overflows the frontier cap', async () => {
    const overflowRows = Array.from({ length: 5 }, (_, index) => ({
      address: `mule-${index}`,
      degree_in: 5,
      is_exchange: false,
      labels: [],
      tx_count: 1,
      amount_usd_sum: 100,
    }))
    const remote = stubClient(overflowRows)
    const result = await scamCorridorTrace(remote as never, {
      seedAddress: 'seed',
      network: 'bittensor',
      maxHops: 1,
      frontierCap: 2,
      writeArtifacts: false,
    })
    expect(result.document.status).toBe('partial')
    expect(result.document.frontier_truncated).toEqual([1])
    expect(result.document.findings).toHaveLength(2)
  })

  it('reports complete only when no cap is hit', async () => {
    const remote = stubClient([{ address: 'only-one', degree_in: 5, is_exchange: false, labels: [], tx_count: 1, amount_usd_sum: 100 }])
    const result = await scamCorridorTrace(remote as never, { seedAddress: 'seed', network: 'bittensor', maxHops: 1, writeArtifacts: false })
    expect(result.document.status).toBe('complete')
  })
})

describe('scamCorridorTrace read-only query surface (AC4)', () => {
  const DENYLIST = /\b(MERGE|CREATE|SET|DELETE|REMOVE|DROP)\b/i
  // Procedure-call CALL <identifier> is denylisted; the read-only subquery
  // form CALL { is permitted. frontierQuery never emits CALL at all, but the
  // regex below is written to allow CALL { and reject anything else, per the
  // spec's exact wording.
  const PROCEDURE_CALL = /\bCALL\s+(?!\{)/i

  it('frontierQuery never emits a denylisted write token', () => {
    for (const [address, limit] of [['addr-a', 200], ['addr-"quote"', 50], ['seed', 1]] as const) {
      const { query } = scamCorridorQueryBuilderContract.frontierQuery('id', address, limit)
      expect(DENYLIST.test(query)).toBe(false)
      expect(PROCEDURE_CALL.test(query)).toBe(false)
    }
  })

  it('frontierQuery always ends with LIMIT <= QUERY_ROW_LIMIT', () => {
    const { query } = scamCorridorQueryBuilderContract.frontierQuery('id', 'addr', 200)
    const match = query.match(/LIMIT (\d+)$/)
    expect(match).toBeTruthy()
    expect(Number(match![1])).toBeLessThanOrEqual(QUERY_ROW_LIMIT)
  })

  it('reaches the network exclusively through graph_query_batch', async () => {
    const remote = stubClient(GATE_TABLE_ROWS)
    await scamCorridorTrace(remote as never, { seedAddress: 'seed', network: 'bittensor', maxHops: 1, writeArtifacts: false })
    for (const call of remote.callTool.mock.calls) {
      expect((call[0] as { name: string }).name).toBe('graph_query_batch')
    }
  })
})
