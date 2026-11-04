import { describe, expect, it } from 'vitest'

import { ANSWER_HINT } from '../src/mcp/answer-hint.js'
import { metaTokenLookupArgs } from '../src/mcp/call-args.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import {
  ADDRESS_INPUT_HINT,
  META_TOKEN_LOOKUP_TOOL,
  assetQuery,
  creatorQuery,
  handleMetaTokenLookup,
  type GraphAnswer,
  type MetaTokenLookupResult,
  type TokenToolDependencies,
} from '../src/mcp/token-lookup.js'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS } from '../src/mcp/tool-visibility.js'

// meta_token_lookup against a fake graph transport at the proxy boundary: the
// graph_query and graph_query_batch calls the tool sends are recorded, and the
// replies are the envelopes the graph endpoint sends. No graph is reached.
//
// The first TCITY row and its creator are the golden row of the change's spec
// (lane B, 2026-11-04). The two later contracts are stand-ins for the clones.

const TCITY = '0x9cb6a9859faa69c7374166b1383c7b4ddea71111'
const TCITY_CREATOR = '0x2c35cc18d4cdd3e9d052c2e537949321ba56b5f9'
const TCITY_FACTORY = '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea'
const CLONE_A = '0x00000000000000000000000000000000000c1001'
const CLONE_B = '0x00000000000000000000000000000000000c1002'
const CLONE_CREATOR = '0x00000000000000000000000000000000000dead1'

const TCITY_SYMBOL_READ =
  'USE facts MATCH (t:Asset {symbol: "TCITY"}) RETURN t.asset_contract AS contract, t.asset_symbol AS symbol, t.name AS name, t.token_standard AS token_standard, t.decimals AS decimals, t.verified AS verified, t.verification_source AS verification_source, t.first_seen_timestamp AS first_seen_timestamp LIMIT 26'

// The description as design.md lists it to hosts, character for character.
const DESIGN_DESCRIPTION =
  'Call this first when a question names a token by its ticker or name and gives no contract (TCITY, USDG, SPCX). It returns every contract on the network that carries that symbol, verified first, then oldest first. Tickers collide: never treat the first row as the token. When several match, name them and ask, or pick by the evidence the user gave. Zero candidates means no contract carries the symbol: say so, and do not search the web.'

type Row = Record<string, unknown>

function assetRow(contract: string, firstSeen: number, verified = false): Row {
  return {
    contract,
    symbol: 'TCITY',
    name: 'Tcity',
    token_standard: 'ERC20',
    decimals: 18,
    verified,
    verification_source: verified ? 'rhj_assets' : null,
    first_seen_timestamp: firstSeen,
  }
}

const TCITY_ROWS: Row[] = [
  assetRow(TCITY, 1_791_590_400_000, true),
  assetRow(CLONE_A, 1_792_195_200_000),
  assetRow(CLONE_B, 1_792_281_600_000),
]

function queryAnswer(rows: Row[]): GraphAnswer {
  const structuredContent = {
    schema: 'chain-insights.result.v1',
    tool: 'graph_query',
    facts: { query: { results: rows, count: rows.length } },
    hint: null,
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  }
}

function refusal(text: string, detail?: { code: string; class: string }): GraphAnswer {
  return {
    content: [{ type: 'text', text }],
    ...(detail
      ? {
          structuredContent: {
            schema: 'chain-insights.result.v1',
            tool: 'graph_query',
            hint: null,
            error_detail: { ...detail, rule: 'anchor', fix: '', example: '' },
          },
        }
      : {}),
    isError: true,
  }
}

type Creators = Record<string, { factory: string; creator: string } | 'failed' | 'none'>

/** A batch reply: one member per query, answered from the creators map. */
function batchAnswer(
  queries: Array<{ id: string; query: string }>,
  creators: Creators
): GraphAnswer {
  const members = queries.map(({ id }) => {
    const contract = id.replace(/^creator:/, '')
    const known = creators[contract] ?? 'none'
    if (known === 'failed')
      return { id, ok: false, error: 'query_timeout: the read ran past its time', results: [] }
    return {
      id,
      ok: true,
      results: known === 'none' ? [] : [known],
      count: known === 'none' ? 0 : 1,
    }
  })
  return {
    structuredContent: {
      schema: 'chain-insights.result.v1',
      tool: 'graph_query_batch',
      facts: { queries: members },
      hint: null,
    },
    isError: false,
  }
}

interface FakeGraph {
  /** The reply of each graph_query, in order; the last one repeats. */
  queries?: Array<GraphAnswer | Error>
  creators?: Creators
  batch?: GraphAnswer | Error
  unavailable?: string
}

function harness(fake: FakeGraph = {}) {
  const queryCalls: Array<{ network: string; query: string }> = []
  const batchCalls: Array<{ network: string; queries: Array<{ id: string; query: string }> }> = []
  const replies = fake.queries ?? [queryAnswer(TCITY_ROWS)]
  const deps: TokenToolDependencies = {
    graphQuery: async (args) => {
      queryCalls.push(args)
      const reply = replies[Math.min(queryCalls.length - 1, replies.length - 1)]!
      if (reply instanceof Error) throw reply
      return reply
    },
    graphQueryBatch: async (args) => {
      batchCalls.push(args)
      if (fake.batch instanceof Error) throw fake.batch
      return fake.batch ?? batchAnswer(args.queries, fake.creators ?? {})
    },
    unavailable: () => fake.unavailable,
    describeFailure: (err) => `MCP call failed: ${(err as Error).message}`,
  }
  const lookup = async (args: Record<string, unknown>) => {
    const result = await handleMetaTokenLookup(args, deps)
    return { result, structured: result.structuredContent as unknown as MetaTokenLookupResult }
  }
  return { queryCalls, batchCalls, lookup }
}

/** One lookup on a fresh fake graph: the recorded calls and the result together. */
async function run(fake: FakeGraph, args: Record<string, unknown>) {
  const h = harness(fake)
  return { ...h, ...(await h.lookup(args)) }
}

const TCITY_CREATORS: Creators = {
  [TCITY]: { factory: TCITY_FACTORY, creator: TCITY_CREATOR },
  [CLONE_A]: { factory: CLONE_CREATOR, creator: CLONE_CREATOR },
  [CLONE_B]: { factory: CLONE_CREATOR, creator: CLONE_CREATOR },
}

describe('meta_token_lookup for TCITY', () => {
  it('sends the facts Asset read by symbol, then one batch of creator reads', async () => {
    const { queryCalls, batchCalls, lookup } = harness({ creators: TCITY_CREATORS })
    await lookup({ network: 'robinhood', symbol: 'TCITY' })
    expect(queryCalls).toEqual([{ network: 'robinhood', query: TCITY_SYMBOL_READ }])
    expect(assetQuery('symbol', 'TCITY')).toBe(TCITY_SYMBOL_READ)
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0]!.queries).toEqual(
      [TCITY, CLONE_A, CLONE_B].map((contract) => ({
        id: `creator:${contract}`,
        query: `USE topology MATCH (f:Address)-[d:DEPLOYED_CONTRACT]->(t:Address {address: "${contract}"}) RETURN f.address AS factory, d.tx_origin AS creator LIMIT 1`,
      }))
    )
    expect(creatorQuery(TCITY)).toBe(batchCalls[0]!.queries[0]!.query)
  })

  it('returns three candidates in the server order, the golden contract first with its creator', async () => {
    const { result, structured } = await harness({ creators: TCITY_CREATORS }).lookup({
      network: 'robinhood',
      symbol: 'TCITY',
    })
    expect(result.isError).toBe(false)
    expect(structured.schema).toBe('chain-insights.meta-token-lookup.v1')
    expect(structured.network).toBe('robinhood')
    expect(structured.query).toBe('TCITY')
    expect(structured.matched_on).toBe('symbol')
    expect(structured.total).toBe(3)
    expect(structured.truncated).toBe(false)
    expect(structured.candidates.map((c) => c.contract)).toEqual([TCITY, CLONE_A, CLONE_B])
    expect(structured.candidates[0]).toEqual({
      contract: TCITY,
      symbol: 'TCITY',
      name: 'Tcity',
      token_standard: 'ERC20',
      decimals: 18,
      verified: true,
      verification_source: 'rhj_assets',
      first_seen_timestamp: 1_791_590_400_000,
      first_seen_timestamp_utc: '2026-10-10 00:00:00 UTC',
      creator: TCITY_CREATOR,
      factory: TCITY_FACTORY,
    })
    expect(structured.hint.startsWith(ANSWER_HINT)).toBe(true)
    expect(structured.hint).toContain('3 contracts on robinhood carry "TCITY"')
    expect(structured.hint).toContain('Tickers collide: never treat the first row as the token.')
    expect(structured.hint).not.toContain('creators were not read')
    // The text the host reads is the structured answer, every address in full.
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent)
    expect(result.content[0]!.text).not.toMatch(/0x[0-9a-f]*(…|\.\.\.)/)
  })

  it('reads by name when no contract carries the symbol', async () => {
    const { queryCalls, structured } = await run(
      {
        queries: [queryAnswer([]), queryAnswer([assetRow(TCITY, 1_791_590_400_000, true)])],
        creators: TCITY_CREATORS,
      },
      { network: 'robinhood', symbol: 'Tcity' }
    )
    expect(queryCalls.map((call) => call.query)).toEqual([
      assetQuery('symbol', 'Tcity'),
      assetQuery('name', 'Tcity'),
    ])
    expect(queryCalls[1]!.query).toContain('MATCH (t:Asset {name: "Tcity"})')
    expect(structured.matched_on).toBe('name')
    expect(structured.candidates).toHaveLength(1)
    expect(structured.hint).toContain(
      'No contract carries "Tcity" as its symbol; these carry it as their name.'
    )
  })

  it('returns 25 of 26 rows, truncated, and reads the creators in batches of at most 20', async () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      assetRow(`0x${(i + 1).toString(16).padStart(40, '0')}`, 1_791_590_400_000 + i)
    )
    const { batchCalls, structured } = await run(
      { queries: [queryAnswer(rows)] },
      { network: 'robinhood', symbol: 'PEPE' }
    )
    expect(structured.total).toBe(26)
    expect(structured.truncated).toBe(true)
    expect(structured.candidates).toHaveLength(25)
    expect(structured.candidates.map((c) => c.contract)).toEqual(
      rows.slice(0, 25).map((r) => r.contract)
    )
    expect(batchCalls.map((call) => call.queries.length)).toEqual([20, 5])
    expect(structured.hint).toContain('and more exist than the 25 listed')
  })

  it('answers a contract address with no graph call', async () => {
    const { queryCalls, batchCalls, result, structured } = await run(
      {},
      { network: 'robinhood', symbol: TCITY.toUpperCase().replace('0X', '0x') }
    )
    expect(queryCalls).toHaveLength(0)
    expect(batchCalls).toHaveLength(0)
    expect(result.isError).toBe(false)
    expect(structured.candidates).toEqual([])
    expect(structured.matched_on).toBeNull()
    expect(structured.hint).toContain(ADDRESS_INPUT_HINT)
    expect(structured.hint).toContain(TCITY)
  })

  it('says zero candidates is an answer and sends no creator batch', async () => {
    const { batchCalls, queryCalls, structured } = await run(
      { queries: [queryAnswer([])] },
      { network: 'robinhood', symbol: 'NOPE' }
    )
    expect(queryCalls).toHaveLength(2)
    expect(batchCalls).toHaveLength(0)
    expect(structured.candidates).toEqual([])
    expect(structured.total).toBe(0)
    expect(structured.matched_on).toBeNull()
    expect(structured.hint).toContain(
      'No contract on robinhood carries the symbol or the name "NOPE".'
    )
    expect(structured.hint).toContain('Do not search the web')
  })
})

describe('meta_token_lookup when a read fails', () => {
  it('keeps the candidates with empty creators when the batch throws', async () => {
    const { result, structured } = await harness({ batch: new Error('socket hang up') }).lookup({
      network: 'robinhood',
      symbol: 'TCITY',
    })
    expect(result.isError).toBe(false)
    expect(structured.candidates.map((c) => [c.contract, c.creator, c.factory])).toEqual([
      [TCITY, null, null],
      [CLONE_A, null, null],
      [CLONE_B, null, null],
    ])
    expect(structured.hint).toContain(
      'The creators were not read for 3 of 3: MCP call failed: socket hang up.'
    )
  })

  it('keeps the candidates when the batch is refused whole', async () => {
    const { structured } = await harness({
      batch: refusal('topology_busy: the topology layer is busy', {
        code: 'topology_busy',
        class: 'capacity',
      }),
    }).lookup({ network: 'robinhood', symbol: 'TCITY' })
    expect(structured.candidates).toHaveLength(3)
    expect(structured.candidates.every((c) => c.creator === null)).toBe(true)
    expect(structured.hint).toContain('The creators were not read for 3 of 3: topology_busy')
  })

  it('keeps a candidate whose own member timed out, and fills the others', async () => {
    const { structured } = await harness({
      creators: { ...TCITY_CREATORS, [CLONE_B]: 'failed' },
    }).lookup({ network: 'robinhood', symbol: 'TCITY' })
    expect(structured.candidates.map((c) => c.creator)).toEqual([
      TCITY_CREATOR,
      CLONE_CREATOR,
      null,
    ])
    expect(structured.hint).toContain('The creators were not read for 1 of 3: query_timeout')
  })

  it('leaves a creator empty with no note when the graph holds no deployment', async () => {
    const { structured } = await harness({
      creators: { [TCITY]: TCITY_CREATORS[TCITY]! },
    }).lookup({ network: 'robinhood', symbol: 'TCITY' })
    expect(structured.candidates.map((c) => c.creator)).toEqual([TCITY_CREATOR, null, null])
    expect(structured.hint).not.toContain('creators were not read')
  })

  it('tells the agent an older server does not serve the lookup, and does not throw', async () => {
    for (const answer of [
      refusal('facts_no_anchor: a facts read names an address pair with one day', {
        code: 'facts_no_anchor',
        class: 'refused',
      }),
      refusal('unknown label Asset on USE facts'),
    ]) {
      const { batchCalls, result, structured } = await run(
        { queries: [answer] },
        { network: 'robinhood', symbol: 'TCITY' }
      )
      expect(result.isError).toBe(false)
      expect(batchCalls).toHaveLength(0)
      expect(structured.candidates).toEqual([])
      expect(structured.matched_on).toBeNull()
      expect(structured.hint).toContain(
        'This Chain Insights server does not serve the token lookup yet'
      )
      expect(structured.hint).toContain("ask the user for the token's contract")
      expect(structured.hint).toContain('Do not search the web')
    }
  })

  it('returns an error, never "no contract", when the facts read was stopped or the call threw', async () => {
    for (const reply of [
      refusal('facts_query_timeout: the read ran past 10 s', {
        code: 'facts_query_timeout',
        class: 'killed',
      }),
      new Error('402 payment required'),
    ]) {
      const { batchCalls, result } = await run(
        { queries: [reply] },
        { network: 'robinhood', symbol: 'TCITY' }
      )
      expect(result.isError).toBe(true)
      expect(batchCalls).toHaveLength(0)
      expect(result.content[0]!.text).toMatch(/^The token read failed: /)
      expect(result.content[0]!.text).toContain('This is not "no contract"')
    }
  })

  it('sends nothing when the graph is not connected', async () => {
    const { queryCalls, result } = await run(
      { unavailable: 'Chain Insights Graph is not connected at https://mcp.chain-insights.ai/.' },
      { network: 'robinhood', symbol: 'TCITY' }
    )
    expect(queryCalls).toHaveLength(0)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(
      /^No token read was sent: Chain Insights Graph is not connected/
    )
  })
})

describe('meta_token_lookup arguments', () => {
  it.each([
    [{ network: 'robinhood' }, /^invalid_symbol: symbol is required/],
    [{ network: 'robinhood', symbol: '   ' }, /^invalid_symbol: symbol is required/],
    [
      { network: 'robinhood', symbol: 'X'.repeat(65) },
      /^invalid_symbol: symbol holds at most 64 characters/,
    ],
    [
      { network: 'robinhood', symbol: 'TC"}) RETURN 1 //' },
      /^invalid_symbol: a symbol holds no double quote/,
    ],
    [
      { network: 'robinhood', symbol: 'TC\\ITY' },
      /^invalid_symbol: a symbol holds no double quote/,
    ],
    [
      { network: 'robinhood', symbol: 'TC\nITY' },
      /^invalid_symbol: a symbol holds no double quote/,
    ],
    [{ symbol: 'TCITY' }, /^invalid_network: network is required/],
  ])('refuses %j before any read', async (args, message) => {
    const { queryCalls, lookup } = harness()
    const { result } = await lookup(args)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(message)
    expect(queryCalls).toHaveLength(0)
  })

  it('takes a 64-character name and an apostrophe as written', async () => {
    const { queryCalls, lookup } = harness({ queries: [queryAnswer([])] })
    await lookup({ network: 'robinhood', symbol: "Trump's Coin" })
    expect(queryCalls[0]!.query).toContain(`{symbol: "Trump's Coin"}`)
    await lookup({ network: 'robinhood', symbol: 'Y'.repeat(64) })
    expect(queryCalls.at(-1)!.query).toContain(`"${'Y'.repeat(64)}"`)
  })

  it('carries the symbol from `cia mcp call` as text', () => {
    expect(metaTokenLookupArgs({ network: 'robinhood', symbol: 'TCITY' })).toEqual({
      network: 'robinhood',
      symbol: 'TCITY',
    })
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS[META_TOKEN_LOOKUP_TOOL]).toEqual(['network', 'symbol'])
  })
})

describe('meta_token_lookup is a door every host reads', () => {
  it('is a local tool of the proxy with the description design.md lists', () => {
    expect(LOCAL_TOOL_NAMES.has('meta_token_lookup')).toBe(true)
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['meta_token_lookup']).toBe(DESIGN_DESCRIPTION)
  })

  it('the graph_query description sends a named token to the door', () => {
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query']).toContain(
      'A question that names a token by its ticker or name and gives no contract starts with meta_token_lookup'
    )
  })
})
