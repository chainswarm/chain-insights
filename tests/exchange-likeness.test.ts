import { describe, expect, it, vi } from 'vitest'
import {
  FANIN_MIN,
  LIFETIME_INBOUND_MIN_USD,
  MAX_CANDIDATES,
  RECIPROCITY_MAX,
  exchangeLikeness,
  exchangeLikenessQueryBuilderContract,
} from '../src/investigation/exchange-likeness.js'

type BatchQuery = { id: string; query: string }
type CallToolRequest = { arguments: { queries: BatchQuery[] } }

interface CandidateFixture {
  degreeIn: number
  totalInUsd: number
  inCount: number
  reciprocalCount: number
}

function client(addresses: string[], candidates: CandidateFixture[], opts: { failReciprocityIndex?: number; failMessage?: string } = {}) {
  return {
    callTool: vi.fn(async (req: CallToolRequest) => {
      const results = req.arguments.queries.map((query) => {
        const match = query.id.match(/^(profile|reciprocity)_(\d+)$/)
        if (!match) return { id: query.id, ok: false, error: 'unknown query id' }
        const kind = match[1]
        const index = Number(match[2])
        const address = addresses[index]
        const candidate = candidates[index]
        if (kind === 'profile') {
          return { id: query.id, ok: true, results: [{ address, degree_in: candidate.degreeIn, total_in_usd: candidate.totalInUsd }] }
        }
        if (opts.failReciprocityIndex === index) {
          return { id: query.id, ok: false, error: opts.failMessage ?? 'query timed out' }
        }
        return { id: query.id, ok: true, results: [{ address, in_count: candidate.inCount, reciprocal_count: candidate.reciprocalCount }] }
      })
      return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
    }),
  }
}

describe('exchangeLikeness thresholds (AC3)', () => {
  it('classifies one positive and three single-threshold negatives', async () => {
    const addresses = ['addr-positive', 'addr-low-fanin', 'addr-high-reciprocity', 'addr-low-lifetime']
    const candidates: CandidateFixture[] = [
      { degreeIn: 1500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 2 }, // reciprocity 0.02, all clear
      { degreeIn: 500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 2 }, // fan-in fails alone
      { degreeIn: 1500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 10 }, // reciprocity 0.10 fails alone
      { degreeIn: 1500, totalInUsd: 1_000_000, inCount: 100, reciprocalCount: 2 }, // lifetime fails alone
    ]
    const remote = client(addresses, candidates)
    const result = await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })

    expect(result.document.status).toBe('complete')
    expect(result.candidates).toHaveLength(4)

    expect(result.candidates[0]).toMatchObject({ address: 'addr-positive', exchange_like: true, failing_threshold: undefined })
    expect(result.candidates[0].degree_in).toBeGreaterThanOrEqual(FANIN_MIN)
    expect(result.candidates[0].reciprocity!).toBeLessThanOrEqual(RECIPROCITY_MAX)
    expect(result.candidates[0].total_in_usd).toBeGreaterThanOrEqual(LIFETIME_INBOUND_MIN_USD)

    expect(result.candidates[1]).toMatchObject({ address: 'addr-low-fanin', exchange_like: false, failing_threshold: 'fan_in' })
    expect(result.candidates[2]).toMatchObject({ address: 'addr-high-reciprocity', exchange_like: false, failing_threshold: 'reciprocity' })
    expect(result.candidates[3]).toMatchObject({ address: 'addr-low-lifetime', exchange_like: false, failing_threshold: 'lifetime_inbound_usd' })
  })

  it('names the failing threshold on each finding record', async () => {
    const addresses = ['addr-low-fanin']
    const candidates: CandidateFixture[] = [{ degreeIn: 1, totalInUsd: 60_000_000, inCount: 10, reciprocalCount: 0 }]
    const remote = client(addresses, candidates)
    const result = await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })
    expect(result.document.findings[0].gate).toBe('failing_threshold:fan_in')
  })
})

describe('exchangeLikeness reciprocity single-row aggregate (AC3 exact-or-inconclusive)', () => {
  it('emits a single-row aggregate with no LIMIT clause', () => {
    const { query } = exchangeLikenessQueryBuilderContract.reciprocityQuery('reciprocity_0', 'addr')
    expect(query).not.toMatch(/LIMIT/i)
    expect(query).toMatch(/OPTIONAL MATCH/)
    expect(query).toMatch(/collect\(DISTINCT/)
    expect(query).toMatch(/AS in_count/)
    expect(query).toMatch(/AS reciprocal_count/)
  })

  it('yields exchange_like=null on a reciprocity aggregate timeout, never a classification', async () => {
    const addresses = ['addr-timeout']
    const candidates: CandidateFixture[] = [{ degreeIn: 1500, totalInUsd: 60_000_000, inCount: 0, reciprocalCount: 0 }]
    const remote = client(addresses, candidates, { failReciprocityIndex: 0, failMessage: 'query timed out after 10s' })
    const result = await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })
    expect(result.candidates[0].exchange_like).toBeNull()
    expect(result.candidates[0].inconclusive_reason).toBe('query_timeout')
    expect(result.candidates[0].failing_threshold).toBeUndefined()
    expect(result.document.status).toBe('inconclusive')
    expect(result.document.findings[0].inconclusive).toBe(true)
  })

  it('yields exchange_like=null on a reciprocity aggregate admission rejection, never a classification', async () => {
    const addresses = ['addr-rejected']
    const candidates: CandidateFixture[] = [{ degreeIn: 1500, totalInUsd: 60_000_000, inCount: 0, reciprocalCount: 0 }]
    const remote = client(addresses, candidates, { failReciprocityIndex: 0, failMessage: 'admission rejected: quota exceeded' })
    const result = await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })
    expect(result.candidates[0].exchange_like).toBeNull()
    expect(result.candidates[0].inconclusive_reason).toBe('admission_rejected')
    expect(result.document.status).toBe('inconclusive')
  })
})

describe('exchangeLikeness candidate cap and read-only surface', () => {
  it('rejects more than MAX_CANDIDATES addresses', async () => {
    expect(MAX_CANDIDATES).toBe(25)
    const addresses = Array.from({ length: 26 }, (_, index) => `addr-${index}`)
    const remote = client(addresses, addresses.map(() => ({ degreeIn: 1, totalInUsd: 1, inCount: 1, reciprocalCount: 1 })))
    await expect(exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })).rejects.toThrow(/at most 25/)
  })

  const DENYLIST = /\b(MERGE|CREATE|SET|DELETE|REMOVE|DROP)\b/i
  const PROCEDURE_CALL = /\bCALL\s+(?!\{)/i

  it('neither profile nor reciprocity queries ever emit a denylisted write token', () => {
    const profile = exchangeLikenessQueryBuilderContract.profileQuery('profile_0', 'addr-"quote"').query
    const reciprocity = exchangeLikenessQueryBuilderContract.reciprocityQuery('reciprocity_0', 'addr-"quote"').query
    for (const query of [profile, reciprocity]) {
      expect(DENYLIST.test(query)).toBe(false)
      expect(PROCEDURE_CALL.test(query)).toBe(false)
    }
  })

  it('reaches the network exclusively through graph_query_batch', async () => {
    const addresses = ['addr-a']
    const candidates: CandidateFixture[] = [{ degreeIn: 1500, totalInUsd: 60_000_000, inCount: 10, reciprocalCount: 0 }]
    const remote = client(addresses, candidates)
    await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })
    for (const call of remote.callTool.mock.calls) {
      expect((call[0] as { name: string }).name).toBe('graph_query_batch')
    }
  })

  it('reads lifetime fan-in/inbound from federated topology node metrics, not the facts tier', () => {
    // Since the federation typed-AST planner (rbmk#458), a multi-shard
    // node-metric projection returns EXACT lifetime values (additive props
    // summed across disjoint shard windows, degrees re-derived by distinct
    // counterparty set union) — oracle-verified. Exchange-likeness therefore
    // reads degree_in/total_in_usd straight off the topology Address node,
    // dropping its last facts_address_features_view / HAS_FEATURE dependency
    // (rbmk#447 P3/P5). The exact projection shape here is the difftest
    // corpus case plan-node-metric-lifetime, which must stay exact-match.
    const profile = exchangeLikenessQueryBuilderContract.profileQuery('profile_0', 'addr-a').query
    expect(profile).toMatch(/^USE topology\b/)
    expect(profile).not.toContain('HAS_FEATURE')
    expect(profile).toContain('a.degree_in AS degree_in')
    expect(profile).toContain('a.total_in_usd AS total_in_usd')
    // reciprocity stays on the topology tier (FLOWS_TO edges)
    const reciprocity = exchangeLikenessQueryBuilderContract.reciprocityQuery('reciprocity_0', 'addr-a').query
    expect(reciprocity).not.toMatch(/^USE facts\b/)
  })
})

// Wiring for rbmk chain-insights#217: the MCP graph read path must route
// shard-tagged (`__shard`) fan-out responses through mergeShardRows before
// they reach any investigation tool.
describe('exchangeLikeness — shard-merge wiring (#217)', () => {
  function shardedClient(addresses: string[], candidates: CandidateFixture[]) {
    return {
      callTool: vi.fn(async (req: CallToolRequest) => {
        const results = req.arguments.queries.map((query) => {
          const match = query.id.match(/^(profile|reciprocity)_(\d+)$/)
          if (!match) return { id: query.id, ok: false, error: 'unknown query id' }
          const kind = match[1]
          const index = Number(match[2])
          const address = addresses[index]
          const candidate = candidates[index]
          // Simulate graphrag-mcp thin fan-out: two shards, both returning
          // the SAME exact lifetime-metric row for this address/edge-set (the
          // federation typed-AST planner makes these values exact — see the
          // 'reads lifetime fan-in ...' test above), each tagged `__shard`.
          if (kind === 'profile') {
            return {
              id: query.id,
              ok: true,
              results: [
                { __shard: 'shard-a', address, degree_in: candidate.degreeIn, total_in_usd: candidate.totalInUsd },
                { __shard: 'shard-b', address, degree_in: candidate.degreeIn, total_in_usd: candidate.totalInUsd },
              ],
            }
          }
          return {
            id: query.id,
            ok: true,
            results: [
              { __shard: 'shard-a', address, in_count: candidate.inCount, reciprocal_count: candidate.reciprocalCount },
              { __shard: 'shard-b', address, in_count: candidate.inCount, reciprocal_count: candidate.reciprocalCount },
            ],
          }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ facts: { queries: results } }) }], isError: false }
      }),
    }
  }

  it('merges shard-tagged fan-out rows to the same result a single-shard response would produce, and never leaks __shard', async () => {
    const addresses = ['addr-positive']
    const candidates: CandidateFixture[] = [{ degreeIn: 1500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 2 }]

    const unsharded = await exchangeLikeness(client(addresses, candidates) as never, { addresses, network: 'bittensor', writeArtifacts: false })
    const sharded = await exchangeLikeness(shardedClient(addresses, candidates) as never, { addresses, network: 'bittensor', writeArtifacts: false })

    expect(sharded.candidates).toEqual(unsharded.candidates)
    expect(sharded.candidates[0]).toMatchObject({ address: 'addr-positive', exchange_like: true })
    expect(JSON.stringify(sharded.document)).not.toContain('__shard')
  })

  it('is a true no-op for a non-shard-tagged (single-shard / already-merged) response', async () => {
    const addresses = ['addr-positive', 'addr-low-fanin']
    const candidates: CandidateFixture[] = [
      { degreeIn: 1500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 2 },
      { degreeIn: 500, totalInUsd: 60_000_000, inCount: 100, reciprocalCount: 2 },
    ]
    const remote = client(addresses, candidates)
    const result = await exchangeLikeness(remote as never, { addresses, network: 'bittensor', writeArtifacts: false })
    expect(result.candidates[0]).toMatchObject({ address: 'addr-positive', exchange_like: true })
    expect(result.candidates[1]).toMatchObject({ address: 'addr-low-fanin', exchange_like: false, failing_threshold: 'fan_in' })
  })
})
