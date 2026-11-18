/**
 * graph_expand's node click and aml_deployer_screen's funder read, on both
 * graph shapes of a lane.
 *
 * - The graph of before (a lane whose money family lists no ROUTED_TO, a shape
 *   read that fails, or no shape at all): every read is the one of 0.82.0,
 *   byte for byte. tests/fixtures/expand-funder-reads-0.82.0.json was written
 *   from main before the change; the recorded flows scene answers as recorded.
 * - A lane with the levels: a node side reads FLOWED_TO and ROUTED_TO together,
 *   newest first, and a route is one edge with link_kind ROUTED_TO; the funder
 *   is the earliest money from another address on FLOWED_TO or ROUTED_TO, and
 *   a self route is never the funder.
 *
 * No graph is reached: the endpoints are doubles that record every read.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  deployerScreenQueries,
  handleAmlDeployerScreen,
  type AmlDeployerScreenResult,
} from '../src/mcp/deployer-screen.js'
import {
  flowsReadsFor,
  handleGraphExpand,
  type FlowView,
  type FlowsDependencies,
  type GraphQueryAnswer,
} from '../src/mcp/flows.js'
import type { SwapLinkShape } from '../src/mcp/layer-routing.js'
import type { GraphAnswer } from '../src/mcp/token-lookup.js'

type Row = Record<string, unknown>
const FIXTURES = join(import.meta.dirname, 'fixtures')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const pinned = readJson<{
  flows: Array<{ address: string; in_offset: number; out_offset: number; reads: unknown[] }>
  deployer: Array<{ address: string; queries: Array<{ id: string; query: string }> }>
}>(join(FIXTURES, 'expand-funder-reads-0.82.0.json'))
const sceneAnswers = readJson<Record<string, GraphQueryAnswer>>(
  join(FIXTURES, 'flows_scene', 'graph-query-answers.json')
)
const NOW = new Date('2026-10-05T12:00:00Z')

const A = '0x04911a118f11c75667e4d0dfb8e640af5a353550'
const PAYER = '0x1111111111111111111111111111111111111111'
const RECEIVER = '0x2222222222222222222222222222222222222222'
const BOTH = '0x3333333333333333333333333333333333333333'
const FRIEND = '0x4444444444444444444444444444444444444444'

const NODE =
  'b.address AS address, b.labels AS labels, b.is_exchange AS is_exchange, b.is_sanctioned AS is_sanctioned, ' +
  'b.is_scam AS is_scam, b.is_victim AS is_victim, b:Pool AS pool, b.total_in_usd AS total_in_usd, ' +
  'b.total_out_usd AS total_out_usd, b.degree_in AS degree_in, b.degree_out AS degree_out'
const LEVELS_SIDE =
  `${NODE}, f.amount_usd_sum AS usd, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen, ` +
  'f.last_seen_timestamp AS last_seen, type(f) AS link_kind, f.bought_usd_sum AS bought_usd, f.swap_count AS swap_count ' +
  'ORDER BY f.last_seen_timestamp DESC, b.address, link_kind'

function rowsAnswer(results: Row[]): GraphQueryAnswer {
  return {
    content: [{ type: 'text', text: 'rows' }],
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      hint: null,
      facts: { query: { results, count: results.length } },
    },
  }
}

function flowsEndpoint(
  answer: (query: string) => GraphQueryAnswer,
  linkShape?: FlowsDependencies['linkShape']
) {
  const reads: string[] = []
  const deps: FlowsDependencies = {
    graphQuery: async ({ query }) => {
      reads.push(query)
      return answer(query)
    },
    describeFailure: (err) => `MCP call failed: ${(err as Error).message}`,
    now: () => NOW,
    ...(linkShape ? { linkShape } : {}),
  }
  return { reads, deps }
}

const party = (address: string, link: Row): Row => ({
  address,
  labels: [],
  total_in_usd: 0,
  total_out_usd: 0,
  degree_in: 1,
  degree_out: 1,
  ...link,
})

describe('on the graph of before, both reads are the ones of 0.82.0, byte for byte', () => {
  it('graph_expand node reads, with no shape and with route', () => {
    for (const c of pinned.flows) {
      expect(flowsReadsFor(c.address, c.in_offset, c.out_offset)).toEqual(c.reads)
      expect(flowsReadsFor(c.address, c.in_offset, c.out_offset, 'route')).toEqual(c.reads)
    }
  })

  it('aml_deployer_screen batch, with no shape and with route', () => {
    for (const c of pinned.deployer) {
      expect(deployerScreenQueries(c.address)).toEqual(c.queries)
      expect(deployerScreenQueries(c.address, 'route')).toEqual(c.queries)
    }
  })

  const shapes: Array<[string, FlowsDependencies['linkShape']]> = [
    ['no shape', undefined],
    ['a route lane', () => 'route' as SwapLinkShape],
    [
      'a shape read that throws',
      () => {
        throw new Error('network_capabilities failed')
      },
    ],
  ]
  for (const [name, linkShape] of shapes) {
    it(`a node click on ${name} answers the recorded scene as recorded`, async () => {
      const { reads, deps } = flowsEndpoint((query) => {
        const answer = sceneAnswers[query]
        if (!answer) throw new Error(`the recorded scene holds no answer for: ${query}`)
        return answer
      }, linkShape)
      const result = await handleGraphExpand({ network: 'robinhood', address: A }, deps)
      expect(result.structuredContent).toEqual(
        readJson(join(FIXTURES, 'flows_scene', 'flows-0x0491.json'))
      )
      expect(reads.every((query) => !query.includes('ROUTED_TO'))).toBe(true)
    })
  }

  it('the deployer screen on a route lane sends the pinned batch and adds no funded_via', async () => {
    const calls: Array<Array<{ id: string; query: string }>> = []
    const result = await handleAmlDeployerScreen(
      { network: 'robinhood', address: A },
      {
        graphQueryBatch: async (args) => {
          calls.push(args.queries)
          return batchAnswer([], [{ launcher: A, funder: PAYER, funded_at: 1, funding_usd: 5 }])
        },
        describeFailure: () => 'failed',
        linkShape: () => 'route',
      }
    )
    expect(calls).toEqual([pinned.deployer.find((c) => c.address === A)!.queries])
    const screen = result.structuredContent as unknown as AmlDeployerScreenResult
    expect(screen.first_funder?.address).toBe(PAYER)
    expect(Object.keys(screen.first_funder!)).not.toContain('funded_via')
  })
})

describe('graph_expand on a lane with the levels', () => {
  it('reads FLOWED_TO and ROUTED_TO together on each side, the self link once, anchored and paged as before', () => {
    const reads = flowsReadsFor(A, 0, 0, 'levels')
    expect(reads.map((read) => [read.id, read.skip, read.limit])).toEqual([
      ['node', 0, 1],
      ['out', 0, 200],
      ['out', 200, 51],
      ['in', 0, 200],
      ['in', 200, 51],
    ])
    expect(reads[0]!.query).toBe(pinned.flows[0]!.reads[0]!.query)
    expect(reads[1]!.query).toBe(
      `USE topology MATCH (a:Address {address: '${A}'})-[f:FLOWED_TO|ROUTED_TO]->(b:Address) RETURN ${LEVELS_SIDE} LIMIT 200`
    )
    expect(reads[4]!.query).toBe(
      `USE topology MATCH (b:Address)-[f:FLOWED_TO|ROUTED_TO]->(a:Address {address: '${A}'}) WHERE b.address <> '${A}' RETURN ${LEVELS_SIDE} SKIP 200 LIMIT 51`
    )
  })

  it('draws a route as one ROUTED_TO edge, joins a pair that holds both, keeps the self link and names it in the text', async () => {
    const center = {
      address: A,
      labels: [],
      degree_in: 1,
      degree_out: 2,
      total_in_usd: 10,
      total_out_usd: 30,
    }
    const out: Row[] = [
      party(RECEIVER, {
        usd: 100,
        tx_count: 2,
        first_seen: 1_000,
        last_seen: 9_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 98,
        swap_count: 2,
      }),
      party(A, {
        usd: 40,
        tx_count: 3,
        first_seen: 500,
        last_seen: 8_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 39,
        swap_count: 3,
      }),
      party(BOTH, {
        usd: 5,
        tx_count: 1,
        first_seen: 2_000,
        last_seen: 7_000,
        link_kind: 'FLOWED_TO',
      }),
      party(BOTH, {
        usd: 20,
        tx_count: 1,
        first_seen: 3_000,
        last_seen: 6_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 19,
        swap_count: 1,
      }),
    ]
    const inbound: Row[] = [
      party(PAYER, {
        usd: 70,
        tx_count: 1,
        first_seen: 100,
        last_seen: 5_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 69,
        swap_count: 1,
      }),
      party(FRIEND, {
        usd: 10,
        tx_count: 4,
        first_seen: 50,
        last_seen: 4_000,
        link_kind: 'FLOWED_TO',
      }),
    ]
    const { reads, deps } = flowsEndpoint(
      (query) =>
        query.includes('LIMIT 1') && !query.includes('[f:')
          ? rowsAnswer([center])
          : query.includes(`(a:Address {address: '${A}'})-[f:`)
            ? rowsAnswer(out)
            : rowsAnswer(inbound),
      async () => 'levels'
    )
    const result = await handleGraphExpand({ network: 'robinhood', address: A }, deps)
    expect(result.isError).toBe(false)
    // Each side came back short, so its second chunk is never read.
    expect(reads).toHaveLength(3)
    const view = result.structuredContent as unknown as FlowView
    expect(view.link_kinds).toEqual(['FLOWED_TO', 'ROUTED_TO'])
    expect(view.edges).toEqual([
      {
        from: PAYER,
        to: A,
        usd: 70,
        tx_count: 1,
        first_seen_ms: 100,
        last_seen_ms: 5_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 69,
        swap_count: 1,
      },
      {
        from: FRIEND,
        to: A,
        usd: 10,
        tx_count: 4,
        first_seen_ms: 50,
        last_seen_ms: 4_000,
        link_kind: 'FLOWED_TO',
      },
      {
        from: A,
        to: RECEIVER,
        usd: 100,
        tx_count: 2,
        first_seen_ms: 1_000,
        last_seen_ms: 9_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 98,
        swap_count: 2,
      },
      {
        from: A,
        to: A,
        usd: 40,
        tx_count: 3,
        first_seen_ms: 500,
        last_seen_ms: 8_000,
        link_kind: 'ROUTED_TO',
        bought_usd: 39,
        swap_count: 3,
      },
      {
        from: A,
        to: BOTH,
        usd: 25,
        tx_count: 2,
        first_seen_ms: 2_000,
        last_seen_ms: 7_000,
        link_kind: 'FLOWED_TO, ROUTED_TO',
        bought_usd: 19,
        swap_count: 1,
      },
    ])
    expect(view.nodes.map((node) => node.address)).toEqual([A, PAYER, FRIEND, RECEIVER, BOTH])
    expect(view.cursor).toEqual({ in_offset: 2, out_offset: 4 })
    // Nothing more came back on either side: no more to load.
    expect(view.remaining).toEqual({ senders: 0, receivers: 0 })
    const text = result.content[0]!.text
    expect(text).toContain('Swapped for itself: swap route, $40.00 paid and $39.00 got in 3 swaps')
    expect(text).toContain(`${PAYER} other, swap route, $70.00 paid and $69.00 got in 1 swaps`)
    expect(text).toContain(`${BOTH} other, funds and a swap route, $25.00 in 2 tx`)
    expect(text).toContain('funds and swap routes together, newest first.')
  })

  it('a full side says more remain, at least one, though the degrees count funds only', async () => {
    const center = { address: A, labels: [], degree_in: 0, degree_out: 0 }
    const many = (n: number, skip: number) =>
      Array.from({ length: n }, (_, i) =>
        party(`0x${(skip + i + 1).toString(16).padStart(40, '0')}`, {
          usd: 1,
          tx_count: 1,
          first_seen: 1,
          last_seen: 1,
          link_kind: 'ROUTED_TO',
          bought_usd: 1,
          swap_count: 1,
        })
      )
    const { deps } = flowsEndpoint(
      (query) => {
        if (!query.includes('[f:')) return rowsAnswer([center])
        if (!query.includes(`-[f:FLOWED_TO|ROUTED_TO]->(b:Address)`)) return rowsAnswer([])
        return rowsAnswer(query.includes('SKIP 200') ? many(51, 200) : many(200, 0))
      },
      () => 'levels'
    )
    const view = (await handleGraphExpand({ network: 'robinhood', address: A }, deps))
      .structuredContent as unknown as FlowView
    expect(view.edges).toHaveLength(250)
    expect(view.truncated).toBe(true)
    expect(view.remaining).toEqual({ senders: 0, receivers: 1 })
  })
})

function batchAnswer(token: Row[], wallet: Row[]): GraphAnswer {
  const member = (id: string, results: Row[]) => ({ id, ok: true, results, count: results.length })
  return {
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts: { queries: [member('token', token), member('wallet', wallet)] },
      hint: null,
    },
    isError: false,
  }
}

describe('aml_deployer_screen on a lane with the levels', () => {
  it('the funder read walks FLOWED_TO|ROUTED_TO from another address and returns what the launcher got', () => {
    const [token, wallet] = deployerScreenQueries(A, 'levels')
    const before = pinned.deployer.find((c) => c.address === A)!.queries
    const levelled = (query: string) =>
      query
        .replace(
          'OPTIONAL MATCH (f:Address)-[e:FLOWED_TO]->(l)',
          'OPTIONAL MATCH (f:Address)-[e:FLOWED_TO|ROUTED_TO]->(l) WHERE f.address <> l.address'
        )
        .replace(
          'e.amount_usd_sum AS funding_usd',
          'coalesce(e.bought_usd_sum, e.amount_usd_sum) AS funding_usd, type(e) AS funding_link'
        )
    // Nothing else in either read changes.
    expect(token!.query).toBe(levelled(before[0]!.query))
    expect(wallet!.query).toBe(levelled(before[1]!.query))
    expect(wallet!.query).toBe(
      `USE topology MATCH (l:Address {address:'${A}'}) ` +
        'OPTIONAL MATCH (f:Address)-[e:FLOWED_TO|ROUTED_TO]->(l) WHERE f.address <> l.address ' +
        'WITH l, f, e ORDER BY e.first_seen_timestamp LIMIT 1 ' +
        "OPTIONAL MATCH (ch:Chain)-[b:BRIDGED]->(l) WHERE b.kind IN ['TOKEN_DEPOSIT','NATIVE_DEPOSIT'] " +
        'WITH l, f, e, ch, b ORDER BY b.first_height LIMIT 1 ' +
        before[1]!.query
          .slice(before[1]!.query.indexOf('RETURN '))
          .replace(
            'e.amount_usd_sum AS funding_usd',
            'coalesce(e.bought_usd_sum, e.amount_usd_sum) AS funding_usd, type(e) AS funding_link'
          )
    )
  })

  it('a launcher funded by the proceeds of a swap names the payer, funded_via swap, and the hint says so', async () => {
    const calls: Array<Array<{ id: string; query: string }>> = []
    const result = await handleAmlDeployerScreen(
      { network: 'robinhood', address: A },
      {
        graphQueryBatch: async (args) => {
          calls.push(args.queries)
          return batchAnswer(
            [],
            [
              {
                launcher: A,
                funder: PAYER,
                funder_roles: ['Address', 'Account'],
                funded_at: 1_700_000_000_000,
                funding_tx_count: 1,
                funding_usd: 69,
                funding_link: 'ROUTED_TO',
              },
            ]
          )
        },
        describeFailure: () => 'failed',
        linkShape: async () => 'levels',
      }
    )
    expect(calls[0]!.every((q) => q.query.includes('[e:FLOWED_TO|ROUTED_TO]'))).toBe(true)
    const screen = result.structuredContent as unknown as AmlDeployerScreenResult
    expect(screen.first_funder).toMatchObject({
      address: PAYER,
      kind: 'wallet',
      funding_usd: 69,
      funded_via: 'swap',
    })
    expect(screen.hint).toContain('paid the launcher through a swap')
  })
})
