import { describe, expect, it } from 'vitest'

import { addBalanceText } from '../src/mcp/balance-text.js'
import {
  CONTRACT_CAPABILITY_WORDS,
  CONTRACT_LISTING_WORDS,
  CONTRACT_OBSERVED_WORDS,
  CONTRACT_PLAIN_WORDS,
  CONTRACT_READ_EXAMPLE,
  CONTRACT_READ_HINT,
  CONTRACT_READ_LISTS,
  CONTRACT_READ_MEANING,
  CONTRACT_READ_PROPERTIES,
  CONTRACT_READ_SHORT,
  GRAPH_QUERY_CONTRACT_READ_SENTENCE,
} from '../src/mcp/contract-read.js'
import { FACTS_TRANSFER_COLUMNS } from '../src/mcp/graph-schema.js'
import { ROUTING_CONTRACT, routingHead } from '../src/mcp/layer-routing.js'
import { formatMcpTextContent } from '../src/mcp/print-result.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS } from '../src/mcp/proxy.js'
import { addTimestampText, withoutUtcProperties } from '../src/mcp/timestamp-text.js'
import { factsReadViolations, isContractRead, isFactsRead } from './support/facts-contract.js'
import { markdownQueries } from './support/pool-walk-guard.js'
import { flat, read, runtimeSkill, servedGraphHints } from './support/schema-text.js'

// The Contract read of the facts layer: what one contract is and what its code
// lets its owner do, by its address. `graph_query` and `graph_query_batch` carry
// it; there is no tool of its own. So three things are held here:
//
//   the read       the text this package teaches is the text the graph server
//                  serves, and the proxy sends it on unchanged
//   the texts      a host that loads no skill reads the rule in the tool
//                  description; the skill, the guide and the hints repeat it
//   the answer     a row whose cells are lists prints as a table and gains no
//                  twin column
//
// The two server texts below are copied from the graph server's own source
// (ContractReadExample and ContractReadSentence of its facts contract). They
// are the pin of this read: neither the read shapes nor the mapping the two
// facts pins read (tests/fixtures/facts-contract.json, facts-columns.json)
// names a node read.

const SERVER_EXAMPLE =
  'USE facts MATCH (c:Contract {address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}) RETURN c.contract_address AS contract, c.capabilities AS capabilities, ' +
  'c.observed AS observed, c.standards AS standards, c.roles AS roles, c.listings AS listings, ' +
  'c.implementation_address AS implementation, c.beacon_address AS beacon, c.created_block AS created_block'

const SERVER_SENTENCE =
  '`USE facts MATCH (c:Contract {address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}) RETURN c.capabilities AS capabilities, c.observed AS observed, c.implementation_address AS implementation` ' +
  'answers what a contract is by its address: capabilities is what the code lets its owner do, observed is what was seen on the chain, ' +
  'and zero rows means the contract is not classified yet, never that it is safe; it states what the bytecode allows and is never a verdict'

// The answer of the server for USDG on robinhood, a proxy, as recorded.
const RECORDED_ROW = {
  capabilities: ['blacklist', 'owner_mint', 'pause', 'upgradeable'],
  observed: [],
  standards: ['erc20', 'eip1967_proxy'],
  roles: [],
  listings: [],
  implementation_address: '0x68184c449e1a8f34fa18d289737129fd27b66f8f',
  beacon_address: null,
  created_block: 57,
}

const SKILL = 'skills/chain-insights-cypher/SKILL.md'
const GUIDE = 'docs/graph-tools.md'

describe('the Contract read is the one the graph server serves', () => {
  it('the example and the short read are the server texts, word for word', () => {
    expect(CONTRACT_READ_EXAMPLE).toBe(SERVER_EXAMPLE)
    expect(SERVER_SENTENCE).toContain(`\`${CONTRACT_READ_SHORT}\``)
    expect(SERVER_SENTENCE).toContain(CONTRACT_READ_MEANING)
  })

  it('names the nine properties of the read, five of them lists', () => {
    const returned = [...CONTRACT_READ_EXAMPLE.matchAll(/\bc\.(\w+) AS /g)].map((m) => m[1])
    expect(returned).toEqual([...CONTRACT_READ_PROPERTIES])
    expect(CONTRACT_READ_PROPERTIES).toHaveLength(9)
    for (const list of CONTRACT_READ_LISTS) expect(CONTRACT_READ_PROPERTIES).toContain(list)
    // A Contract is no relationship: none of its properties is a TRANSFER column.
    for (const property of CONTRACT_READ_PROPERTIES) {
      expect(FACTS_TRANSFER_COLUMNS, property).not.toContain(property)
    }
  })

  it('the skill shows the read in full, and the guide sends the same one', () => {
    const fenced = markdownQueries(read(SKILL))
      .map(flat)
      .map((query) => query.trim())
    expect(fenced).toContain(CONTRACT_READ_EXAMPLE)
    expect(markdownQueries(read(GUIDE)).map(flat)).toContain(CONTRACT_READ_EXAMPLE)
    expect(servedGraphHints()).toContain(CONTRACT_READ_EXAMPLE)
  })
})

describe('the reader of the facts limits knows the Contract read', () => {
  const address = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

  it.each([
    ['the read in full', CONTRACT_READ_EXAMPLE, []],
    ['the short read', CONTRACT_READ_SHORT, []],
    [
      'an address in upper case',
      'USE facts MATCH (c:Contract {address: "0x5FC5360D0400A0FD4F2AF552ADD042D716F1D168"}) RETURN c.capabilities AS capabilities',
      [],
    ],
    [
      'LIMIT 1',
      `USE facts MATCH (c:Contract {address: "${address}"}) RETURN c.capabilities LIMIT 1`,
      [],
    ],
    [
      'a larger LIMIT',
      `USE facts MATCH (c:Contract {address: "${address}"}) RETURN c.capabilities LIMIT 5`,
      ['facts_no_anchor'],
    ],
    [
      'a search by capability',
      'USE facts MATCH (c:Contract) WHERE "owner_mint" IN c.capabilities RETURN c.contract_address',
      ['facts_no_anchor'],
    ],
    [
      'a search by implementation',
      'USE facts MATCH (c:Contract {implementation_address: "0x68184c449e1a8f34fa18d289737129fd27b66f8f"}) RETURN c.contract_address',
      ['facts_no_anchor'],
    ],
    [
      'a parameter',
      'USE facts MATCH (c:Contract {address: $address}) RETURN c.capabilities',
      ['facts_no_anchor'],
    ],
    [
      'a property the read does not hold',
      `USE facts MATCH (c:Contract {address: "${address}"}) RETURN c.code_hash`,
      ['facts_no_anchor'],
    ],
    [
      'a shortened address',
      'USE facts MATCH (c:Contract {address: "0x5fc5…f1d168"}) RETURN c.capabilities',
      ['facts_no_anchor'],
    ],
    [
      'a WHERE beside the key',
      `USE facts MATCH (c:Contract {address: "${address}"}) WHERE c.created_block > 5 RETURN c.capabilities`,
      ['facts_no_anchor'],
    ],
    [
      'the whole node',
      `USE facts MATCH (c:Contract {address: "${address}"}) RETURN c`,
      ['facts_no_anchor'],
    ],
    [
      'a Contract at an end of a relationship',
      `USE facts MATCH (a:Address {address: "0xa"})-[t:TRANSFER]->(b:Contract {address: "${address}"}) WHERE t.block_date = "2026-07-11" RETURN t.tx_id LIMIT 10`,
      ['facts_no_anchor'],
    ],
    [
      'the Asset read by symbol that meta_token_lookup sends',
      'USE facts MATCH (t:Asset {symbol: "TCITY"}) RETURN t.asset_contract AS contract, t.verified AS verified LIMIT 26',
      [],
    ],
    [
      'an Asset by its address',
      `USE facts MATCH (t:Asset {address: "${address}"}) RETURN t.asset_symbol AS symbol`,
      ['facts_no_anchor'],
    ],
  ])('%s', (_name, query, expected) => {
    expect(factsReadViolations(query)).toEqual(expected)
  })

  it('tells a facts Contract read from a topology read of the kind label', () => {
    expect(isContractRead(CONTRACT_READ_EXAMPLE)).toBe(true)
    expect(isFactsRead(CONTRACT_READ_EXAMPLE)).toBe(true)
    // A hint query has no USE line: the properties it returns tell its layer.
    expect(isContractRead(CONTRACT_READ_EXAMPLE.replace(/^USE facts /, ''))).toBe(true)
    expect(
      isContractRead(`USE topology MATCH (c:Contract {address: "${address}"}) RETURN c.labels`)
    ).toBe(false)
    expect(isContractRead(`MATCH (c:Contract {address: "${address}"}) RETURN c.labels`)).toBe(false)
    expect(
      isContractRead(
        `MATCH (c:Contract {address: "${address}"})-[f:FLOWED_TO]->(b:Address) RETURN b.address LIMIT 5`
      )
    ).toBe(false)
  })
})

describe('the proxy sends the read on as written', () => {
  it('graph_query and graph_query_batch arguments pass through unchanged', () => {
    const upper = CONTRACT_READ_EXAMPLE.replace(
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
      '0x5FC5360D0400A0FD4F2AF552ADD042D716F1D168'
    )
    for (const query of [CONTRACT_READ_EXAMPLE, CONTRACT_READ_SHORT, upper]) {
      const args = { network: 'robinhood', query }
      expect(withoutUtcProperties('graph_query', args)).toEqual(args)
      const batch = { network: 'robinhood', queries: [{ id: 'usdg', query }] }
      expect(withoutUtcProperties('graph_query_batch', batch)).toEqual(batch)
    }
  })

  it('spells a label in the wrong case the way the server reads it', () => {
    const args = {
      network: 'robinhood',
      query: CONTRACT_READ_SHORT.replace(':Contract', ':contract'),
    }
    expect(withoutUtcProperties('graph_query', args)).toEqual({
      network: 'robinhood',
      query: CONTRACT_READ_SHORT,
    })
  })
})

describe('a Contract answer row', () => {
  it('gains no time or ETH twin: its lists, its addresses and its block stay as answered', () => {
    expect(addTimestampText(RECORDED_ROW)).toEqual(RECORDED_ROW)
    expect(addBalanceText(RECORDED_ROW)).toEqual(RECORDED_ROW)
  })

  it('prints as one table row in the shell, each list as a list and an empty one as []', () => {
    const text = formatMcpTextContent(
      JSON.stringify({
        schema: 'chain-insights.result.v1',
        tool: 'graph_query',
        subject: { network: 'robinhood' },
        facts: {
          query: { count: 1, billable_units: 9, truncated: false, results: [RECORDED_ROW] },
        },
      }),
      'graph_query'
    )
    const lines = text.split('\n')
    const header = lines.find((line) => line.startsWith('capabilities'))
    const row = lines[lines.length - 1] ?? ''
    expect(header?.split('|').map((cell) => cell.trim())).toEqual(Object.keys(RECORDED_ROW))
    expect(row.split(' | ').map((cell) => cell.trim())).toEqual([
      '["blacklist","owner_mint","pause","upgradeable"]',
      '[]',
      '["erc20","eip1967_proxy"]',
      '[]',
      '[]',
      '0x68184c449e1a8f34fa18d289737129fd27b66f8f',
      '',
      '57',
    ])
    expect(text).toContain('Rows: 1')
    expect(text).toContain('Billed units: 9')
  })
})

// Host parity: Claude Desktop chat loads no skill and ignores the server
// instructions, so the rule of the read is in the description of the two tools
// that carry it. The skill, the guide, the hints and the workspace notes repeat it.
describe('every host reads the rule of the Contract read', () => {
  const plain = (text: string): string => flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')

  it.each(['graph_query', 'graph_query_batch'])('the %s description carries it', (tool) => {
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool] ?? ''
    expect(description).toContain(GRAPH_QUERY_CONTRACT_READ_SENTENCE)
    // The routing rule, the read, can against did, zero rows, and the answer rule.
    expect(description).toContain(
      '"what can its owner do", for one contract address, is a USE facts Contract read'
    )
    expect(description).toContain(CONTRACT_READ_SHORT)
    expect(description).toContain('capabilities is what the code lets its owner do')
    expect(description).toContain('observed is what was seen on the chain')
    expect(description).toContain(
      'zero rows means the contract is not classified yet, never that it is safe'
    )
    expect(description).toContain('is never a verdict')
    expect(description).toContain('never "scam", "rug pull", "safe" or a score')
    expect(description).toContain(CONTRACT_PLAIN_WORDS)
  })

  it('the routing line is in the head of the instructions, the hints, the skill and the guide', () => {
    expect(routingHead()).toContain(ROUTING_CONTRACT)
    expect(servedGraphHints()).toContain(ROUTING_CONTRACT)
    expect(flat(read(SKILL))).toContain(ROUTING_CONTRACT)
    expect(flat(read(GUIDE))).toContain(ROUTING_CONTRACT)
  })

  it('the hint is one served line and names every property and every word', () => {
    expect(servedGraphHints().split('\n')).toContain(CONTRACT_READ_HINT)
    for (const word of [
      ...CONTRACT_READ_PROPERTIES,
      ...CONTRACT_CAPABILITY_WORDS,
      ...CONTRACT_OBSERVED_WORDS,
      ...CONTRACT_LISTING_WORDS,
    ]) {
      expect(CONTRACT_READ_HINT, word).toMatch(new RegExp(`\\b${word}\\b`))
    }
    expect(CONTRACT_READ_HINT).toContain('Each word of a list is one billed element.')
  })

  it.each([SKILL, GUIDE])('%s names every property and every word of the read', (path) => {
    const text = read(path)
    for (const word of [
      ...CONTRACT_READ_PROPERTIES,
      ...CONTRACT_CAPABILITY_WORDS,
      ...CONTRACT_OBSERVED_WORDS,
      ...CONTRACT_LISTING_WORDS,
    ]) {
      expect(text, `${path} lacks ${word}`).toContain(`\`${word}\``)
    }
  })

  it('every surface says the three things that keep an answer honest', async () => {
    const surfaces: [string, string][] = [
      [SKILL, read(SKILL)],
      [GUIDE, read(GUIDE)],
      ['src/mcp/proxy.ts graph hints', servedGraphHints()],
      ['the graph_query description', KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query'] ?? ''],
      ['workspace runtime notes', await runtimeSkill()],
    ]
    for (const [surface, text] of surfaces) {
      const body = plain(text)
      expect(body, `${surface}: zero rows`).toMatch(
        /zero rows means (?:the contract is )?not classified yet/i
      )
      expect(body, `${surface}: never safe`).toMatch(
        /never (?:that it is |"|means "no capability" and never ")?safe/i
      )
      expect(body, `${surface}: never a verdict`).toMatch(/never a verdict/i)
    }
  })

  it('the skill, the guide, the hints and the tool text give the same plain words for the three first capabilities', () => {
    const sayings = [
      'the owner can create new tokens',
      'the owner can block an address from moving the token',
      'the code behind the address can be replaced',
    ]
    const surfaces: [string, string][] = [
      [SKILL, read(SKILL)],
      [GUIDE, read(GUIDE)],
      ['src/mcp/proxy.ts graph hints', servedGraphHints()],
      ['the graph_query description', KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query'] ?? ''],
    ]
    for (const [surface, text] of surfaces) {
      for (const saying of sayings) expect(plain(text), `${surface}: ${saying}`).toContain(saying)
    }
  })

  it('no surface tells a reader that facts refuses every :Contract', async () => {
    const surfaces: [string, string][] = [
      [SKILL, read(SKILL)],
      [GUIDE, read(GUIDE)],
      ['docs/graph-query-compatibility.md', read('docs/graph-query-compatibility.md')],
      ['src/mcp/proxy.ts graph hints', servedGraphHints()],
      ['workspace runtime notes', await runtimeSkill()],
    ]
    for (const [surface, text] of surfaces) {
      expect(plain(text), surface).not.toMatch(/names :Account or :Contract is refused/)
    }
  })
})
