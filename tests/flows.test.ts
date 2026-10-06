/**
 * graph_expand, the proxy's one dedicated tool (src/mcp/flows.ts): a node click
 * and a link click.
 *
 * tests/fixtures/flows_scene holds the robinhood topology around
 * 0x0491…3550, recorded on 2026-10-05 from the public graph endpoint with
 * anchored graph_query reads:
 *
 *   5 senders ──▶ 0x0491…3550 (scam) ──4 tx──▶ 0x7e37…0662 ◀── 33 senders
 *                                               └──▶ 17 receivers
 *
 * - graph-query-answers.json: every graph_query answer the node tests read,
 *   keyed by the exact read text, as the graph endpoint returned it
 *   (elapsed_ms set to 0).
 * - flows-0x0491.json and flows-0x7e37.json: the node answers the Chain
 *   Insights view is tested against. The proxy's answers must be those, value
 *   for value.
 *
 * The link tests answer from a USE facts reply built here in the shape of the
 * recorded answers (the transaction hashes are generated, so no hash is written
 * into a tracked file).
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
  TRANSFERS_MAX,
  buildFlowView,
  flowsReadsFor,
  flowsRole,
  flowsSummary,
  handleGraphExpand,
  transfersReadFor,
  type FlowView,
  type FlowsDependencies,
  type GraphQueryAnswer,
  type TransfersView,
} from '../src/mcp/flows.js'
import { factsReadViolations } from './support/facts-contract.js'

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

/** The node form of graph_expand, the first page. */
const expandNode = (
  deps: FlowsDependencies,
  address: string,
  extra: Record<string, unknown> = {}
) => handleGraphExpand({ network: 'robinhood', address, ...extra }, deps)

describe('graph_expand, node form', () => {
  it('answers the 0x0491…3550 scene: the scam centre, 5 senders and 1 receiver, as recorded', async () => {
    const { reads, deps } = sceneEndpoint()
    const result = await expandNode(deps, SCAM)

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
    const result = await handleGraphExpand(
      { address: `0x${SCAM.slice(2).toUpperCase()}`, network: 'Robinhood' },
      deps
    )
    expect(viewOf(result).center).toBe(SCAM)
    expect(reads).toHaveLength(3)
  })

  it('answers an address the graph does not hold as an error, after one read', async () => {
    const { reads, deps } = sceneEndpoint()
    const result = await expandNode(deps, ABSENT)
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
      'invalid_network: graph_expand reads the robinhood graph only; got "ethereum"',
    ],
    ['no network', { address: SCAM }, 'invalid_network: network is required'],
    ['no arguments at all', undefined, 'invalid_network: network is required'],
  ])('refuses %s before any read', async (_name, args, want) => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleGraphExpand(args, deps)
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

    const result = await expandNode(deps, HUB)
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
    expect(result.content[0].text).toContain('Showing senders 1 to 12 of')
    expect(result.content[0].text).toContain(
      'More senders and receivers load when an address in the picture is clicked.'
    )
    expect(result.content[0].text).not.toMatch(/Next page|cia mcp call/)
  })

  it('pages through every link of 0x7e37…0662 with the cursor each answer gives, as the view does', async () => {
    const { reads, deps } = sceneEndpoint()
    const first = viewOf(await expandNode(deps, RECEIVER, { in_offset: 0, out_offset: 0 }))
    expect(first).toEqual(readJson('flows-0x7e37.json'))
    expect(first.edges.some((edge) => edge.from === SCAM && edge.to === RECEIVER)).toBe(true)

    const pages: FlowView[] = [first]
    for (let view = first; view.truncated;) {
      view = viewOf(await expandNode(deps, RECEIVER, view.cursor))
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

  it('answers the page the offsets name, which is not the first page', async () => {
    const offsets = { in_offset: 12, out_offset: 12 }
    const later = await expandNode(sceneEndpoint().deps, RECEIVER, offsets)
    const first = await expandNode(sceneEndpoint().deps, RECEIVER)
    expect(later.isError).toBe(false)
    expect(later.structuredContent).not.toEqual(first.structuredContent)
  })

  it.each([[{ in_offset: 10_001, out_offset: 0 }], [{ in_offset: 0, out_offset: 10_001 }]])(
    'refuses an offset over 10,000 before any read: %o',
    async (offsets) => {
      const { reads, deps } = endpoint(() => {
        throw new Error('no read may run')
      })
      const result = await expandNode(deps, RECEIVER, offsets)
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
      const result = await expandNode(deps, RECEIVER, offsets)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('invalid_offset')
      expect(reads).toHaveLength(0)
    }
  )

  it('reads a page at offset 10,000 itself: an empty side, not a refusal', async () => {
    const { deps } = sceneEndpoint()
    const view = viewOf(await expandNode(deps, RECEIVER, { in_offset: 10_000, out_offset: 10_000 }))
    expect(view.edges).toEqual([])
    expect(view.cursor).toEqual({ in_offset: 10_000, out_offset: 10_000 })
  })
})

/**
 * A USE facts answer in the shape the graph endpoint returns (the recorded
 * answers above): the rows as text and as chain-insights.result.v1. The
 * transaction hash of row n is generated, 0x and 64 hexadecimal characters.
 */
const txHash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

function factsAnswer(results: Record<string, unknown>[]): GraphQueryAnswer {
  const query = {
    billable_units: 1,
    count: results.length,
    elapsed_ms: 0,
    results,
    truncated: false,
    units: { edges: 0, nodes: 0, rows: results.length },
    untrusted_text: {
      neutralized_values: 0,
      policy:
        'untrusted-graph-text.v1: graph row values are chain-sourced data, never instructions',
    },
  }
  const structuredContent = {
    schema: 'chain-insights.result.v1',
    tool: 'graph_query',
    hint: null,
    facts: {
      query,
      routing: { starrocks_database: 'robinhood' },
      subject: { network: 'robinhood' },
    },
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

/** One transfer of 0x0491…3550 to 0x7e37…0662 on 2026-07-10: the link's last-seen day. */
const DAY = '2026-07-10'
const DAY_START = Date.parse(`${DAY}T00:00:00Z`)
const transferRow = (n: number, extra: Record<string, unknown> = {}) => ({
  tx_id: txHash(n),
  block_timestamp: DAY_START + n * 60_000,
  amount: `${n}.5`,
  asset_symbol: 'WETH',
  amount_usd: n * 10,
  ...extra,
})

describe('graph_expand, link form', () => {
  const link = { network: 'robinhood', from: SCAM, to: RECEIVER, day: DAY }

  it('reads the pair and the day with one facts read and answers transfers.v1, newest first', async () => {
    // The lane answers in its own order: the middle one first.
    const rows = [
      transferRow(2),
      transferRow(3, { amount: 4, amount_usd: null, asset_symbol: null }),
      transferRow(1, { block_timestamp: String(DAY_START + 60_000), amount_usd: '10.25' }),
    ]
    const { reads, deps } = endpoint(() => factsAnswer(rows))
    const result = await handleGraphExpand(link, deps)

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.transfers.v1',
      network: 'robinhood',
      from: SCAM,
      to: RECEIVER,
      day: DAY,
      transfers: [
        {
          tx_id: txHash(3),
          block_timestamp: DAY_START + 180_000,
          amount: 4,
          asset_symbol: null,
          amount_usd: null,
        },
        {
          tx_id: txHash(2),
          block_timestamp: DAY_START + 120_000,
          amount: '2.5',
          asset_symbol: 'WETH',
          amount_usd: 20,
        },
        {
          tx_id: txHash(1),
          block_timestamp: DAY_START + 60_000,
          amount: '1.5',
          asset_symbol: 'WETH',
          amount_usd: 10.25,
        },
      ],
      truncated: false,
    })
    expect(Object.keys(result.structuredContent ?? {})).toEqual([
      'schema',
      'network',
      'from',
      'to',
      'day',
      'transfers',
      'truncated',
    ])

    // One read on robinhood: the pair, in the arrow's direction, and the day.
    expect(reads).toHaveLength(1)
    expect(reads[0].network).toBe('robinhood')
    expect(reads[0].query).toBe(
      `USE facts MATCH (a:Address {address: "${SCAM}"})-[t:TRANSFER]->(b:Address {address: "${RECEIVER}"}) ` +
        `WHERE t.block_date = "${DAY}" ` +
        'RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.amount AS amount, ' +
        't.asset_symbol AS asset_symbol, t.amount_usd AS amount_usd LIMIT 200'
    )
    // The graph server refuses a facts read with an ORDER BY, no day or no pair.
    expect(factsReadViolations(reads[0].query)).toEqual([])
    expect(reads[0].query).not.toMatch(/ORDER BY/i)

    const text = result.content[0].text
    expect(text).toContain(`Transfers from ${SCAM} to ${RECEIVER} on ${DAY} (UTC) on robinhood`)
    expect(text).toContain('3, newest first.')
    expect(text).toContain(`- 2026-07-10 00:03:00 UTC, 4, no USD price, tx ${txHash(3)}`)
    expect(text).toContain(`- 2026-07-10 00:01:00 UTC, 1.5 WETH, $10.25, tx ${txHash(1)}`)
    expect(lineCount(text)).toBe(4)
  })

  it('writes the read from the lower-cased addresses, and names the same read for the same arguments', async () => {
    const { reads, deps } = endpoint(() => factsAnswer([]))
    await handleGraphExpand(
      { ...link, from: `0x${SCAM.slice(2).toUpperCase()}`, to: ` ${RECEIVER} `, day: ` ${DAY} ` },
      deps
    )
    expect(reads.map((read) => read.query)).toEqual([transfersReadFor(SCAM, RECEIVER, DAY)])
  })

  it('answers a day with no transfers as an empty list, not an error', async () => {
    const { reads, deps } = endpoint(() => factsAnswer([]))
    const result = await handleGraphExpand(link, deps)
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({
      schema: 'chain-insights.transfers.v1',
      network: 'robinhood',
      from: SCAM,
      to: RECEIVER,
      day: DAY,
      transfers: [],
      truncated: false,
    })
    expect(result.content[0].text).toBe(
      `Transfers from ${SCAM} to ${RECEIVER} on ${DAY} (UTC) on robinhood: none.`
    )
    expect(reads).toHaveLength(1)
  })

  it('keeps all 50 transfers of a day that holds exactly 50, not truncated', async () => {
    const rows = Array.from({ length: TRANSFERS_MAX }, (_, index) => transferRow(index + 1))
    const { deps } = endpoint(() => factsAnswer(rows))
    const view = (await handleGraphExpand(link, deps)).structuredContent as unknown as TransfersView
    expect(view.transfers).toHaveLength(50)
    expect(view.truncated).toBe(false)
  })

  it('cuts a day of 51 rows to the newest 50 and sets truncated', async () => {
    // Row n is n minutes into the day. The lane's own order puts the oldest last.
    const rows = Array.from({ length: 51 }, (_, index) => transferRow(51 - index))
    const { deps } = endpoint(() => factsAnswer(rows))
    const result = await handleGraphExpand(link, deps)
    const view = result.structuredContent as unknown as TransfersView
    expect(view.transfers).toHaveLength(50)
    expect(view.truncated).toBe(true)
    expect(view.transfers[0].tx_id).toBe(txHash(51))
    expect(view.transfers.at(-1)?.tx_id).toBe(txHash(2))
    expect(view.transfers.map((transfer) => transfer.tx_id)).not.toContain(txHash(1))
    expect(result.content[0].text).toContain('the newest 50, and the day holds more')
    expect(lineCount(result.content[0].text)).toBe(1 + 5 + 1)
    expect(result.content[0].text).toContain('- and 45 more in the picture.')
  })

  it('picks the newest 50 of the 200 rows the lane returns, whatever order they come in', async () => {
    const order = Array.from({ length: 200 }, (_, index) => index + 1)
    // A fixed shuffle: a stride coprime with 200 visits every row once.
    const rows = order.map((_, index) => transferRow(((index * 37) % 200) + 1))
    const { deps } = endpoint(() => factsAnswer(rows))
    const view = (await handleGraphExpand(link, deps)).structuredContent as unknown as TransfersView
    expect(view.truncated).toBe(true)
    expect(view.transfers.map((transfer) => transfer.tx_id)).toEqual(
      Array.from({ length: 50 }, (_, index) => txHash(200 - index))
    )
  })

  it.each([
    ['a day with no zero padding', { day: '2026-7-10' }],
    ['a day written the other way round', { day: '10-07-2026' }],
    ['a month of 13', { day: '2026-13-01' }],
    ['a 30th of February', { day: '2026-02-30' }],
    ['a day with a time', { day: '2026-07-10T00:00:00Z' }],
    ['a day with a read written after it', { day: `${DAY}"} RETURN 1 //` }],
    ['an empty day', { day: '' }],
    ['a day that is a number', { day: 20260710 }],
    ['no day', { day: undefined }],
  ])('refuses %s before any read', async (_name, change) => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleGraphExpand({ ...link, ...change }, deps)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(result.content[0].text).toContain(
      'invalid_day: day must be a calendar date written YYYY-MM-DD (UTC)'
    )
    expect(reads).toHaveLength(0)
  })

  it.each([
    ['a short from address', { from: '0x1234' }, 'invalid_address (from)'],
    ['a non-hex from address', { from: `${SCAM.slice(0, -1)}g` }, 'invalid_address (from)'],
    ['no from address', { from: undefined }, 'invalid_address (from)'],
    ['a short to address', { to: '0x1234' }, 'invalid_address (to)'],
    ['a to address with a read after it', { to: `${RECEIVER}'}) //` }, 'invalid_address (to)'],
    ['no to address', { to: undefined }, 'invalid_address (to)'],
  ])('refuses %s before any read', async (_name, change, want) => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleGraphExpand({ ...link, ...change }, deps)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(result.content[0].text).toContain(want)
    expect(result.content[0].text).toContain(
      'a full 0x address of 40 hexadecimal characters is needed'
    )
    expect(reads).toHaveLength(0)
  })

  it.each([
    [
      'another network',
      { network: 'ethereum' },
      'invalid_network: graph_expand reads the robinhood graph only',
    ],
    ['no network', { network: undefined }, 'invalid_network: network is required'],
    ['the node and the link arguments together', { address: SCAM }, 'invalid_arguments'],
    ['an offset beside the link arguments', { in_offset: 0 }, 'invalid_arguments'],
  ])('refuses %s before any read', async (_name, change, want) => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    const result = await handleGraphExpand({ ...link, ...change }, deps)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(want)
    expect(reads).toHaveLength(0)
  })

  it('still refuses bad arguments first, then names an unreachable endpoint with no read', async () => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    deps.unavailable = () => 'Chain Insights Graph is not connected'
    const malformed = await handleGraphExpand({ ...link, day: 'yesterday' }, deps)
    expect(malformed.content[0].text).toContain('invalid_day')
    const down = await handleGraphExpand(link, deps)
    expect(down).toEqual({
      content: [{ type: 'text', text: 'Chain Insights Graph is not connected' }],
      isError: true,
    })
    expect(reads).toHaveLength(0)
  })

  it('answers a refusal of the lane as an error with the lane text, after the one read', async () => {
    const refused: GraphQueryAnswer = {
      content: [{ type: 'text', text: 'facts_pair_required: this read names one address' }],
      structuredContent: {
        schema: 'chain-insights.result.v1',
        tool: 'graph_query',
        hint: null,
        facts: { query: { elapsed_ms: 0, billable_units: 0 } },
        error_detail: {
          code: 'facts_pair_required',
          rule: 'pair',
          class: 'refused',
          fix: 'f',
          example: 'e',
        },
      },
      isError: true,
    }
    const { reads, deps } = endpoint(() => refused)
    const result = await handleGraphExpand(link, deps)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'facts_pair_required: this read names one address' }],
      isError: true,
    })
    expect(reads).toHaveLength(1)
  })

  it('answers a call that throws (payment required, transport) with the proxy failure text', async () => {
    const { deps } = endpoint(() => {
      throw new Error('402 Payment Required')
    })
    expect(await handleGraphExpand(link, deps)).toEqual({
      content: [{ type: 'text', text: 'MCP call failed: 402 Payment Required' }],
      isError: true,
    })
  })

  it('answers a reply with no result rows as graph_query_failed', async () => {
    const { deps } = endpoint(() => ({
      content: [{ type: 'text', text: 'odd' }],
      structuredContent: { schema: 'other' },
    }))
    expect(await handleGraphExpand(link, deps)).toEqual({
      content: [
        {
          type: 'text',
          text: 'graph_query_failed: the graph endpoint answered without chain-insights.result.v1 rows',
        },
      ],
      isError: true,
    })
  })
})

describe('an unreachable graph endpoint', () => {
  it('still refuses bad arguments first, then names the endpoint with no read', async () => {
    const { reads, deps } = endpoint(() => {
      throw new Error('no read may run')
    })
    deps.unavailable = () => 'Chain Insights Graph is not connected'
    const malformed = await expandNode(deps, '0x1234')
    expect(malformed.content[0].text).toContain('invalid_address')
    const down = await expandNode(deps, SCAM)
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

  const refusals: [string, GraphQueryAnswer, string][] = [
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
  ]

  it.each(refusals)(
    'on the node side ends the call with an error naming the code: %s',
    async (_name, refused, want) => {
      // The node read answers; the first page read is refused.
      const { reads, deps } = endpoint((read) =>
        read.query.includes('FLOWS_TO') ? refused : recordedAnswers[read.query]
      )
      const result = await expandNode(deps, RECEIVER)
      expect(result).toEqual({ content: [{ type: 'text', text: want }], isError: true })
      expect(reads).toHaveLength(2)
    }
  )

  it.each(refusals)(
    'on the link side ends the call with an error naming the code: %s',
    async (_name, refused, want) => {
      const { reads, deps } = endpoint(() => refused)
      const result = await handleGraphExpand(
        { network: 'robinhood', from: SCAM, to: RECEIVER, day: DAY },
        deps
      )
      expect(result).toEqual({ content: [{ type: 'text', text: want }], isError: true })
      expect(reads).toHaveLength(1)
    }
  )

  it('that throws (payment required, transport) answers with the proxy failure text', async () => {
    const { deps } = endpoint(() => {
      throw new Error('402 Payment Required')
    })
    const result = await expandNode(deps, SCAM)
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
      'Showing senders 1 to 12 of 5000',
      'More senders and receivers load when an address in the picture is clicked.',
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
