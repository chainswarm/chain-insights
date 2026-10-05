/**
 * money_flows and graph_expand, the proxy's own money-flow tools
 * (src/mcp/flows.ts).
 *
 * tests/fixtures/flows_scene holds the robinhood topology around
 * 0x0491…3550, recorded on 2026-10-05 from the public graph endpoint with
 * anchored graph_query reads:
 *
 *   5 senders ──▶ 0x0491…3550 (scam) ──4 tx──▶ 0x7e37…0662 ◀── 33 senders
 *                                               └──▶ 17 receivers
 *
 * - graph-query-answers.json: every graph_query answer these tests read, keyed
 *   by the exact read text, as the graph endpoint returned it (elapsed_ms set
 *   to 0).
 * - flows-0x0491.json and flows-0x7e37.json: the money_flows answer and the
 *   first graph_expand page the Chain Insights view is tested against. The
 *   proxy's answers must be those, value for value.
 *
 * The graph endpoint is replaced by a double that answers from the recorded
 * file and counts every read, so a refusal before any read is proven by a
 * count of zero.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FLOWS_MAX_CHARS,
  FLOWS_MAX_NODES,
  FLOWS_PER_SIDE,
  FLOWS_SUMMARY_MAX_LINES,
  buildFlowView,
  flowsReadsFor,
  flowsRole,
  flowsSummary,
  handleGraphExpand,
  handleMoneyFlows,
  type FlowView,
  type FlowsDependencies,
  type GraphQueryAnswer,
} from '../src/mcp/flows.js'

const SCENE = join(import.meta.dirname, 'fixtures', 'flows_scene')
const SCAM = '0x04911a118f11c75667e4d0dfb8e640af5a353550'
const RECEIVER = '0x7e3702e9dfaa847f9829a258f1e26fa431160662'
const ABSENT = '0x5e1c7a3d9b0f4e2a6c8d1b3f5a7e9c0d2b4f6a8e'
const HUB = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
const NOW = new Date('2026-10-05T12:00:00Z')

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(SCENE, name), 'utf8')) as T
}

const recordedAnswers = readJson<Record<string, GraphQueryAnswer>>('graph-query-answers.json')

type Read = { network: string; query: string }

/** A graph endpoint double: answers each read from `answer`, records every read. */
function endpoint(answer: (read: Read) => GraphQueryAnswer | Promise<GraphQueryAnswer>) {
  const reads: Read[] = []
  const deps: FlowsDependencies = {
    graphQuery: async (read) => {
      reads.push(read)
      return answer(read)
    },
    describeFailure: (err) => `MCP call failed: ${(err as Error).message}`,
    now: () => NOW,
  }
  return { reads, deps }
}

/** The recorded scene: a read the recording does not hold fails the test. */
function sceneEndpoint() {
  return endpoint((read) => {
    const answer = recordedAnswers[read.query]
    if (!answer) throw new Error(`the recorded scene holds no answer for: ${read.query}`)
    return answer
  })
}

function rowsAnswer(results: Record<string, unknown>[]): GraphQueryAnswer {
  return {
    content: [{ type: 'text', text: 'rows' }],
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      hint: null,
      facts: { query: { results, count: results.length, billable_units: results.length } },
    },
  }
}

function viewOf(result: { structuredContent?: Record<string, unknown>; isError: boolean }) {
  expect(result.isError).toBe(false)
  const view = result.structuredContent as unknown as FlowView
  expect(view.schema).toBe('chain-insights.flows.v1')
  return view
}

function sides(view: FlowView) {
  return {
    senders: view.edges.filter((edge) => edge.to === view.center),
    receivers: view.edges.filter((edge) => edge.from === view.center),
  }
}

function lineCount(text: string): number {
  return text.split('\n').length
}

describe('money_flows', () => {
  it('answers the 0x0491…3550 scene: the scam centre, 5 senders and 1 receiver, as recorded', async () => {
    const { reads, deps } = sceneEndpoint()
    const result = await handleMoneyFlows({ address: SCAM, network: 'robinhood' }, deps)

    const view = viewOf(result)
    expect(view).toEqual(readJson('flows-0x0491.json'))
    const { senders, receivers } = sides(view)
    expect([view.nodes[0].role, senders.length, receivers.length, view.truncated]).toEqual([
      'scam',
      5,
      1,
      false,
    ])

    // Three anchored graph_query reads on robinhood, the node first.
    expect(reads.map((read) => read.network)).toEqual(['robinhood', 'robinhood', 'robinhood'])
    expect(reads.map((read) => read.query)).toEqual(
      flowsReadsFor(SCAM, 0, 0).map((read) => read.query)
    )
    for (const read of reads) {
      expect(read.query).toContain(`{address: '${SCAM}'}`)
      expect(read.query.startsWith('USE topology MATCH')).toBe(true)
    }

    // The text names the centre, its role, its totals and every counterparty.
    const text = result.content[0].text
    expect(lineCount(text)).toBeLessThanOrEqual(FLOWS_SUMMARY_MAX_LINES)
    expect(text).toContain(`${SCAM} on robinhood: scam (Scam)`)
    expect(text).toContain('$20.97 in, $20.97 out')
    expect(text).toContain(
      '0x21d2c31a59be56d7bd35cc228f707ac2e19c5f2d other, $10.49 in 2 tx, last seen 2026-06-18'
    )
    expect(text).toContain(
      '0x7e3702e9dfaa847f9829a258f1e26fa431160662 other, $20.97 in 4 tx, last seen 2026-07-10 (86 days ago)'
    )
    for (const node of view.nodes) expect(text).toContain(node.address)
  })

  it('lower-cases an address before it reads', async () => {
    const { reads, deps } = sceneEndpoint()
    const result = await handleMoneyFlows(
      { address: `0x${SCAM.slice(2).toUpperCase()}`, network: 'Robinhood' },
      deps
    )
    expect(viewOf(result).center).toBe(SCAM)
    expect(reads).toHaveLength(3)
  })

  it('answers an address the graph does not hold as an error, after one read', async () => {
    const { reads, deps } = sceneEndpoint()
    const result = await handleMoneyFlows({ address: ABSENT, network: 'robinhood' }, deps)
    expect(result).toEqual({
      content: [{ type: 'text', text: `${ABSENT} is not in the robinhood topology graph` }],
      isError: true,
    })
    expect(reads).toHaveLength(1)
  })

  it.each([
    [
      'a short address',
      { address: '0x1234', network: 'robinhood' },
      'a full 0x address of 40 hexadecimal characters is needed',
    ],
    [
      'a non-hex character',
      { address: `${SCAM.slice(0, -1)}g`, network: 'robinhood' },
      'a full 0x address of 40 hexadecimal characters is needed',
    ],
    [
      'no 0x',
      { address: `${SCAM.slice(2)}0`, network: 'robinhood' },
      'a full 0x address of 40 hexadecimal characters is needed',
    ],
    [
      'a read written into the address',
      { address: `${SCAM}'}) RETURN 1 //`, network: 'robinhood' },
      'a full 0x address of 40 hexadecimal characters is needed',
    ],
    [
      'no address',
      { network: 'robinhood' },
      'a full 0x address of 40 hexadecimal characters is needed',
    ],
    [
      'another network',
      { address: SCAM, network: 'ethereum' },
      'invalid_network: money flows read the robinhood topology graph only; got "ethereum"',
    ],
    ['no network', { address: SCAM }, 'invalid_network: network is required'],
    ['no arguments at all', undefined, 'invalid_network: network is required'],
  ])('refuses %s before any read', async (_name, args, want) => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleMoneyFlows(args, deps)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(result.content[0].text).toContain(want)
    expect(reads).toHaveLength(0)
  })

  it('cuts a hub with 10,001 senders to one page: at most 60 addresses, under 40,000 characters, truncated', async () => {
    // Sender i was last seen at 1780000000000 + i seconds, so the newest is
    // sender 10001. The in read asks for 13 rows and gets the 13 newest.
    const sender = (i: number) => ({
      address: `0xa0${String(i).padStart(38, '0')}`,
      labels: [],
      total_in_usd: 0,
      total_out_usd: 100,
      degree_in: 0,
      degree_out: 1,
      pool: false,
      usd: 100,
      tx_count: 1,
      first_seen: 1_780_000_000_000 + i * 1000,
      last_seen: 1_780_000_000_000 + i * 1000,
    })
    const { reads, deps } = endpoint((read) => {
      if (read.query.includes('LIMIT 1') && !read.query.includes('FLOWS_TO')) {
        return rowsAnswer([
          {
            address: HUB,
            labels: ['Exchange'],
            is_exchange: true,
            pool: false,
            total_in_usd: 1_000_000,
            total_out_usd: 999_000,
            degree_in: 10_001,
            degree_out: 1,
          },
        ])
      }
      if (read.query.startsWith(`USE topology MATCH (a:Address {address: '${HUB}'})`)) {
        return rowsAnswer([
          {
            address: '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
            labels: [],
            pool: false,
            total_in_usd: 999_000,
            total_out_usd: 0,
            degree_in: 1,
            degree_out: 0,
            usd: 999_000,
            tx_count: 7,
            first_seen: 1_780_000_000_000,
            last_seen: 1_790_000_000_000,
          },
        ])
      }
      const limit = Number(/LIMIT (\d+)$/.exec(read.query)?.[1])
      return rowsAnswer(Array.from({ length: limit }, (_, index) => sender(10_001 - index)))
    })

    const result = await handleMoneyFlows({ address: HUB, network: 'robinhood' }, deps)
    const view = viewOf(result)
    const { senders, receivers } = sides(view)
    expect(view.nodes.length).toBeLessThanOrEqual(FLOWS_MAX_NODES)
    expect(JSON.stringify(view).length).toBeLessThan(FLOWS_MAX_CHARS)
    expect(view.truncated).toBe(true)
    expect([senders.length, receivers.length]).toEqual([FLOWS_PER_SIDE, 1])
    expect(view.cursor).toEqual({ in_offset: 12, out_offset: 1 })
    expect(view.nodes[0].role).toBe('exchange')
    expect(senders[0].from).toBe(sender(10_001).address)
    expect(reads).toHaveLength(3)
    expect(lineCount(result.content[0].text)).toBeLessThanOrEqual(FLOWS_SUMMARY_MAX_LINES)
    expect(result.content[0].text).toContain('More flows exist than shown')
  })
})

describe('graph_expand', () => {
  it('pages through every link of 0x7e37…0662 with the cursor each answer gives, as the view does', async () => {
    const { reads, deps } = sceneEndpoint()
    const first = viewOf(
      await handleGraphExpand(
        { network: 'robinhood', address: RECEIVER, in_offset: 0, out_offset: 0 },
        deps
      )
    )
    expect(first).toEqual(readJson('flows-0x7e37.json'))
    expect(first.edges.some((edge) => edge.from === SCAM && edge.to === RECEIVER)).toBe(true)

    const pages: FlowView[] = [first]
    for (let view = first; view.truncated;) {
      view = viewOf(
        await handleGraphExpand({ network: 'robinhood', address: RECEIVER, ...view.cursor }, deps)
      )
      pages.push(view)
      if (pages.length > 5) throw new Error('more than five pages for 50 links')
    }
    expect(pages).toHaveLength(3)
    expect(pages.at(-1)?.cursor).toEqual({ in_offset: 33, out_offset: 17 })
    const links = new Map<string, number>()
    for (const page of pages) {
      for (const edge of page.edges) {
        const key = `${edge.from}>${edge.to}`
        links.set(key, (links.get(key) ?? 0) + 1)
      }
    }
    expect(links.size).toBe(50)
    expect([...links.values()].every((count) => count === 1)).toBe(true)
    expect(reads).toHaveLength(9)
  })

  it.each([[{ in_offset: 10_001, out_offset: 0 }], [{ in_offset: 0, out_offset: 10_001 }]])(
    'refuses an offset over 10,000 before any read: %o',
    async (offsets) => {
      const { reads, deps } = endpoint(() => {
        throw new Error('no read may run')
      })
      const result = await handleGraphExpand(
        { network: 'robinhood', address: RECEIVER, ...offsets },
        deps
      )
      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'invalid_offset: in_offset and out_offset must each be at most 10000',
          },
        ],
        isError: true,
      })
      expect(reads).toHaveLength(0)
    }
  )

  it.each([[{ in_offset: -1 }], [{ out_offset: 1.5 }], [{ in_offset: '12' }]])(
    'refuses an offset that is not a whole number of 0 or more before any read: %o',
    async (offsets) => {
      const { reads, deps } = endpoint(() => {
        throw new Error('no read may run')
      })
      const result = await handleGraphExpand(
        { network: 'robinhood', address: RECEIVER, ...offsets },
        deps
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('invalid_offset')
      expect(reads).toHaveLength(0)
    }
  )

  it('refuses a malformed address before any read', async () => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleGraphExpand({ network: 'robinhood', address: '0x1234' }, deps)
    expect(result.content[0].text).toContain(
      'a full 0x address of 40 hexadecimal characters is needed'
    )
    expect(reads).toHaveLength(0)
  })

  it('reads a page at offset 10,000 itself: an empty side, not a refusal', async () => {
    const { deps } = sceneEndpoint()
    const view = viewOf(
      await handleGraphExpand(
        { network: 'robinhood', address: RECEIVER, in_offset: 10_000, out_offset: 10_000 },
        deps
      )
    )
    expect(view.edges).toEqual([])
    expect(view.cursor).toEqual({ in_offset: 10_000, out_offset: 10_000 })
  })
})

describe('an unreachable graph endpoint', () => {
  it('still refuses bad arguments first, then names the endpoint with no read', async () => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    deps.unavailable = () => 'Chain Insights Graph is not connected'
    const malformed = await handleMoneyFlows({ address: '0x1234', network: 'robinhood' }, deps)
    expect(malformed.content[0].text).toContain('invalid_address')
    const down = await handleMoneyFlows({ address: SCAM, network: 'robinhood' }, deps)
    expect(down).toEqual({
      content: [{ type: 'text', text: 'Chain Insights Graph is not connected' }],
      isError: true,
    })
    expect(reads).toHaveLength(0)
  })
})

describe('a refused read', () => {
  const typedRefusal = (code: string, text: string): GraphQueryAnswer => ({
    content: [{ type: 'text', text }],
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query',
      hint: null,
      facts: { query: { elapsed_ms: 1000, billable_units: 0 } },
      error_detail: { code, rule: 'r', class: 'capacity', fix: 'f', example: 'e' },
    },
    isError: true,
  })

  it.each([
    [
      'a typed query_timeout',
      typedRefusal('query_timeout', 'query_timeout: the topology query ran out of time'),
      'query_timeout: the topology query ran out of time',
    ],
    [
      'a typed topology_busy whose text names no code',
      typedRefusal('topology_busy', 'no topology slot freed in time'),
      'topology_busy: no topology slot freed in time',
    ],
    [
      'a plain refusal that names its code',
      {
        content: [{ type: 'text', text: 'invalid_scope: query must begin with USE' }],
        isError: true,
      },
      'invalid_scope: query must begin with USE',
    ],
    [
      'a plain refusal with no code',
      { content: [{ type: 'text', text: 'Write operations are not permitted' }], isError: true },
      'graph_query_failed: Write operations are not permitted',
    ],
    [
      'an answer with no rows',
      { content: [{ type: 'text', text: 'odd' }], structuredContent: { schema: 'other' } },
      'graph_query_failed: the graph endpoint answered without chain-insights.result.v1 rows',
    ],
  ])(
    'on the expand side ends the call with an error naming the code: %s',
    async (_name, refused, want) => {
      // The node read answers; the first page read is refused.
      const { reads, deps } = endpoint((read) =>
        read.query.includes('FLOWS_TO') ? refused : recordedAnswers[read.query]
      )
      const result = await handleGraphExpand({ network: 'robinhood', address: RECEIVER }, deps)
      expect(result).toEqual({ content: [{ type: 'text', text: want }], isError: true })
      expect(reads).toHaveLength(2)
    }
  )

  it('that throws (payment required, transport) answers with the proxy failure text', async () => {
    const { deps } = endpoint(() => {
      throw new Error('402 Payment Required')
    })
    const result = await handleMoneyFlows({ address: SCAM, network: 'robinhood' }, deps)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'MCP call failed: 402 Payment Required' }],
      isError: true,
    })
  })
})

describe('flows.v1 page budget and summary', () => {
  const party = (prefix: string, index: number, labelBytes: number) => ({
    address: `0x${prefix}${String(index).padStart(36, '0')}`,
    labels: ['L'.repeat(labelBytes)],
    usd: index,
    tx_count: 1,
    first_seen: 1_780_000_000_000 + index,
    last_seen: 1_790_000_000_000 - index,
  })
  const rows = (prefix: string, count: number, labelBytes: number) =>
    Array.from({ length: count }, (_, index) => party(prefix, index, labelBytes))
  const center = { address: `0x${'b'.repeat(40)}`, labels: [], is_exchange: true }

  it('reads thirteen a side and shows twelve, with the cursor past the twelve', () => {
    const view = buildFlowView('robinhood', {
      center,
      senders: rows('aaaa', 13, 8),
      receivers: rows('cccc', 2, 8),
      inOffset: 24,
      outOffset: 0,
    })
    expect([view.nodes.length, view.edges.length, view.truncated]).toEqual([15, 14, true])
    expect(view.cursor).toEqual({ in_offset: 36, out_offset: 2 })
    expect(view.nodes[0]).toMatchObject({ address: view.center, role: 'exchange' })
  })

  it('cuts the oldest links first to stay under 40,000 characters', () => {
    const view = buildFlowView('robinhood', {
      center,
      senders: rows('aaaa', 12, 2000),
      receivers: rows('cccc', 12, 2000),
      inOffset: 0,
      outOffset: 0,
    })
    expect(JSON.stringify(view).length).toBeLessThan(FLOWS_MAX_CHARS)
    expect(view.nodes.length).toBeLessThanOrEqual(FLOWS_MAX_NODES)
    expect(view.truncated).toBe(true)
    const { senders, receivers } = sides(view)
    expect(view.cursor).toEqual({ in_offset: senders.length, out_offset: receivers.length })
    expect(view.edges[0].last_seen_ms).toBe(1_790_000_000_000)
  })

  it.each([
    [{ is_exchange: true, is_scam: true }, 'exchange'],
    [{ is_sanctioned: true, is_scam: true }, 'sanctioned'],
    [{ is_scam: true, is_victim: true }, 'scam'],
    [{ is_victim: true, pool: true }, 'victim'],
    [{ pool: true }, 'pool'],
    [{ is_exchange: null, pool: false, labels: ['Victim'] }, 'other'],
  ])('names the role of %o as %s', (row, want) => {
    expect(flowsRole(row)).toBe(want)
  })

  it('names every counterparty of a full page in at most 20 lines', () => {
    const centre = `0x${'b'.repeat(40)}`
    const view: FlowView = {
      schema: 'chain-insights.flows.v1',
      network: 'robinhood',
      center: centre,
      truncated: true,
      cursor: { in_offset: 12, out_offset: 12 },
      nodes: [
        {
          address: centre,
          role: 'scam',
          labels: ['Scam'],
          total_in_usd: 20.96875433,
          total_out_usd: 74077.38096350993,
          degree_in: 5000,
          degree_out: 13,
        },
      ],
      edges: [],
    }
    for (let index = 0; index < 24; index++) {
      const address = `0x${String(index).padStart(40, '0')}`
      view.nodes.push({
        address,
        role: 'other',
        labels: [],
        total_in_usd: 0,
        total_out_usd: 0,
        degree_in: 0,
        degree_out: 0,
      })
      const incoming = index < 12
      view.edges.push({
        from: incoming ? address : centre,
        to: incoming ? centre : address,
        usd: 1234.5,
        tx_count: index + 1,
        first_seen_ms: 0,
        last_seen_ms: NOW.getTime() - 72 * 3_600_000,
      })
    }
    const text = flowsSummary(view, NOW)
    expect(lineCount(text)).toBeLessThanOrEqual(FLOWS_SUMMARY_MAX_LINES)
    for (const want of [
      'scam (Scam)',
      '$20.97 in',
      '$74,077.38 out',
      '5000 senders',
      'More flows exist',
    ]) {
      expect(text).toContain(want)
    }
    for (let index = 0; index < 24; index++) {
      expect(text).toContain(
        `0x${String(index).padStart(40, '0')} other, $1,234.50 in ${index + 1} tx, last seen 2026-10-02 (3 days ago)`
      )
    }
  })
})
