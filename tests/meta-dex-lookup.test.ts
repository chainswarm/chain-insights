import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ANSWER_HINT } from '../src/mcp/answer-hint.js'
import type { DexRegistryDocument, LoadedRegistry } from '../src/mcp/dex-registry.js'
import {
  META_DEX_LOOKUP_DESCRIPTION,
  handleMetaDexLookup,
  lookupQueries,
  type BatchAnswer,
  type DexToolDependencies,
  type MetaDexLookupResult,
} from '../src/mcp/dex-tool.js'
import { repoRoot } from './dex-registry.js'

// meta_dex_lookup against a recorded graph_query_batch reply
// (tests/fixtures/meta-dex-lookup-aero-batch-20261024.json): the request the
// tool sends for Aero is the recorded request, and the reply it receives is the
// recorded reply. No graph is reached. A name that is not covered must send no
// batch at all.

const document = JSON.parse(
  readFileSync(join(repoRoot, 'registry/robinhood.json'), 'utf8')
) as DexRegistryDocument
const recorded = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/meta-dex-lookup-aero-batch-20261024.json'), 'utf8')
) as {
  recorded_on: string
  request: { network: string; queries: Array<{ id: string; query: string }> }
  reply: BatchAnswer
}

// The retired graph property, built by concatenation so its name does not
// appear as a literal: no read may name it.
const RETIRED_PROPERTY = ['br', 'and'].join('')
const RETIRED_READ = new RegExp(`\\.${RETIRED_PROPERTY}\\b|\\{${RETIRED_PROPERTY}:|CONTAINS`)

const AERO_FACTORY = '0xc63d7338c178e805c544b8f897066bd3bbcbe136'
const AERO_ROUTERS = [
  '0x72e46c9edf828002fdbfdd0952419790576c0f18',
  '0x0fef9e88a7b76bcdbf451780c6774fe32965ee98',
  '0x9ee35bf1bd69a03c6f0393582030fce8bb93d418',
]
const AERO_TOP_POOL = '0x7615926023bb149f36095645c2a81dc367d39750'

function harness(reply: BatchAnswer = recorded.reply, unavailable?: string) {
  const calls: Array<{ network: string; queries: Array<{ id: string; query: string }> }> = []
  const deps: DexToolDependencies = {
    loadRegistry: async (): Promise<LoadedRegistry> => ({
      document,
      source: 'packaged',
      loaded_at_ms: 0,
    }),
    graphQueryBatch: async (args) => {
      calls.push(args)
      return reply
    },
    unavailable: () => unavailable,
    describeFailure: (err) => `MCP call failed: ${(err as Error).message}`,
  }
  const lookup = async (args: Record<string, unknown>) => {
    const result = await handleMetaDexLookup(args, deps)
    return { result, structured: result.structuredContent as unknown as MetaDexLookupResult }
  }
  return { calls, lookup }
}

describe('meta_dex_lookup for Aero, against the recorded batch', () => {
  it('sends the recorded request: Head, each contract anchored, the pools of the factory', async () => {
    const { calls, lookup } = harness()
    await lookup({ network: 'robinhood', name: 'Aerodrome' })
    expect(recorded.recorded_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(calls).toEqual([recorded.request])
    for (const { query } of calls[0]!.queries) {
      expect(query, 'no read by name, no retired property').not.toMatch(RETIRED_READ)
      expect(query).not.toContain(':Protocol')
      expect(query).toMatch(
        /^USE (chain MATCH \(h:Head\)|topology MATCH \(\w:Address \{address: "0x[0-9a-f]{40}"\}\))/
      )
    }
  })

  it('returns 1 factory and 3 routers confirmed, the busiest pool first, the family lag and the recipe', async () => {
    const { lookup } = harness()
    const { result, structured } = await lookup({ network: 'robinhood', name: 'Aerodrome' })
    expect(result.isError).toBe(false)
    expect(structured.schema).toBe('chain-insights.meta-dex-lookup.v1')
    expect(structured.registry_version).toBe(3)
    expect(structured.registry_source).toBe('packaged')
    const matched = structured.matched!
    expect(matched.dex).toBe('aero')
    expect(matched.trail_type).toBe('gauge')
    expect(matched.skill).toBe('chain-insights-dex-gauge')
    expect(matched.factories).toEqual([
      { address: AERO_FACTORY, role: 'factory', confirmed: true, confirmed_by: 'is_contract' },
    ])
    expect(matched.routers.map((router) => [router.address, router.confirmed])).toEqual(
      AERO_ROUTERS.map((a) => [a, true])
    )
    expect(matched.manager).toBeNull()
    expect(matched.pools[0]).toMatchObject({ address: AERO_TOP_POOL, labels: ['cl-gauge-v1'] })
    // The exchange family is far behind; the lookup is returned the same, with the number.
    expect(structured.families).toEqual({
      behind_money: 545,
      behind_dex: 393139,
      behind_transfers: 342,
    })
    expect(matched.recipe[0]!.query).toContain(`{address: "${AERO_ROUTERS[0]}"}`)
    expect(matched.recipe[0]!.query).toMatch(/^USE topology .* LIMIT \d+$/)
    expect(structured.took_for).toBeUndefined()
    expect(structured.hint.startsWith(ANSWER_HINT)).toBe(true)
    expect(structured.notes).toBeUndefined()
    // The text the host reads is the structured answer, every address in full.
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent)
    expect(result.content[0]!.text).not.toMatch(/0x[0-9a-f]*(…|\.\.\.)/)
  })

  it('names a typo in took_for and in the hint', async () => {
    const { structured } = await harness().lookup({ network: 'robinhood', name: 'Aerodome' })
    expect(structured.matched?.dex).toBe('aero')
    expect(structured.took_for).toBe('Aerodome')
    expect(structured.hint).toContain('I took Aero (Aerodrome and Velodrome, merged) for Aerodome.')
  })

  it('returns a router the graph does not show as a contract with confirmed false, and the others untouched', async () => {
    const reply = structuredClone(recorded.reply) as {
      structuredContent: {
        facts: { queries: Array<{ id: string; results: unknown[]; count: number }> }
      }
    }
    const member = reply.structuredContent.facts.queries.find(
      (m) => m.id === `contract:${AERO_ROUTERS[2]}`
    )!
    member.results = []
    member.count = 0
    const { structured } = await harness(reply as BatchAnswer).lookup({
      network: 'robinhood',
      name: 'Aero',
    })
    expect(structured.matched!.routers.map((router) => router.confirmed)).toEqual([
      true,
      true,
      false,
    ])
    expect(structured.matched!.factories[0]!.confirmed).toBe(true)
  })

  it('ranks the pools of every factory by lifetime volume', async () => {
    const reply = structuredClone(recorded.reply) as {
      structuredContent: {
        facts: { queries: Array<{ id: string; results: Array<Record<string, unknown>> }> }
      }
    }
    const pools = reply.structuredContent.facts.queries.find((m) => m.id.startsWith('pools:'))!
    pools.results.unshift({
      to_address: '0x0000000000000000000000000000000000000001',
      to_labels: ['cl-gauge-v1'],
      total_volume_usd: 5,
      tx_total_count: 1,
    })
    const { structured } = await harness(reply as BatchAnswer).lookup({
      network: 'robinhood',
      name: 'Aero',
    })
    const ranked = structured.matched!.pools.map((pool) => pool.address)
    expect(ranked[0]).toBe(AERO_TOP_POOL)
    // the smallest pool falls off the end: the tool serves ten pools at most
    expect(ranked).not.toContain('0x0000000000000000000000000000000000000001')
    expect(ranked).toHaveLength(10)
  })

  it('drops the pool reads with pools: false', async () => {
    const { calls, lookup } = harness()
    await lookup({ network: 'robinhood', name: 'Aero', pools: false })
    expect(calls[0]!.queries.map((q) => q.id)).toEqual([
      'head',
      ...[AERO_FACTORY, ...AERO_ROUTERS].map((a) => `contract:${a}`),
    ])
  })

  it('answers from the registry with nothing confirmed when the graph cannot be reached', async () => {
    const { calls, lookup } = harness(
      recorded.reply,
      'Chain Insights Graph is not connected at https://mcp.chain-insights.ai/.'
    )
    const { structured } = await lookup({ network: 'robinhood', name: 'Aero' })
    expect(calls).toHaveLength(0)
    expect(structured.matched!.factories[0]).toMatchObject({
      address: AERO_FACTORY,
      confirmed: false,
    })
    expect(structured.families).toBeNull()
    expect(structured.notes?.[0]).toMatch(
      /No graph read was sent: Chain Insights Graph is not connected/
    )
  })
})

describe('meta_dex_lookup without a graph read', () => {
  it('says Kyber is not covered, lists the 31 covered exchanges, and sends no batch', async () => {
    const { calls, lookup } = harness()
    const { structured } = await lookup({ network: 'robinhood', name: 'Kyber' })
    expect(calls).toHaveLength(0)
    expect(structured.matched).toBeNull()
    expect(structured.candidates).toEqual([])
    expect(structured.covered).toHaveLength(31)
    expect(structured.hint).toContain('Kyber is not covered. Send no query for the name')
  })

  it('lists the Balancer tie and sends no batch', async () => {
    const { calls, lookup } = harness()
    const { structured } = await lookup({ network: 'robinhood', name: 'Balancer' })
    expect(calls).toHaveLength(0)
    expect(structured.candidates.map((candidate) => candidate.dex)).toEqual([
      'swaap',
      'balancer-v3',
    ])
    expect(structured.hint).toMatch(/2 rows fit "Balancer".*Name both or pick one/)
  })

  it('with no name lists every covered exchange with its key, display name and trail type, and sends no batch', async () => {
    const { calls, lookup } = harness()
    const { structured } = await lookup({ network: 'robinhood' })
    expect(calls).toHaveLength(0)
    expect(structured.exchanges).toHaveLength(31)
    expect(structured.exchanges![0]).toMatchObject({
      dex: 'aero',
      display: 'Aero (Aerodrome and Velodrome, merged)',
      trail_type: 'gauge',
    })
  })

  it('refuses a bad argument before the registry is read', async () => {
    const { lookup } = harness()
    expect((await lookup({})).result.content[0]!.text).toMatch(/^invalid_network/)
    expect((await lookup({ network: 'robinhood', name: 7 })).result.content[0]!.text).toMatch(
      /^invalid_name/
    )
    expect(
      (await lookup({ network: 'robinhood', name: 'Aero', pools: 'yes' })).result.content[0]!.text
    ).toMatch(/^invalid_pools/)
  })
})

describe('meta_dex_lookup by address', () => {
  it('answers a known router as its exchange, with the role and the verification cell', async () => {
    const { calls, lookup } = harness()
    const { structured } = await lookup({ network: 'robinhood', address: AERO_ROUTERS[0] })
    expect(structured.matched).toMatchObject({ dex: 'aero', trail_type: 'gauge' })
    expect(structured.matched!.display).toBe('Aero (Aerodrome and Velodrome, merged)')
    expect(structured.matched!.routers.map((router) => router.address)).toEqual(AERO_ROUTERS)
    expect(structured.took_for).toBe('router, served')
    expect(structured.hint).toContain('is a router, served row of')
    // the same reads as the name path: the recorded request
    expect(calls).toEqual([recorded.request])
  })

  it('takes a factory of any role and a mixed-case address', async () => {
    const { lookup } = harness()
    const mixed = AERO_FACTORY.replace('0x', '0X').toUpperCase().replace('0X', '0x')
    const { structured } = await lookup({ network: 'robinhood', address: `  ${mixed}  ` })
    expect(structured.matched!.dex).toBe('aero')
    expect(structured.took_for).toBe('factory, served')
  })

  it('answers an unknown address with no match and no read', async () => {
    const { calls, lookup } = harness()
    const unknown = '0x00000000000000000000000000000000000000aa'
    const { structured } = await lookup({ network: 'robinhood', address: unknown })
    expect(structured.matched).toBeNull()
    expect(structured.candidates).toEqual([])
    expect(structured.covered).toHaveLength(31)
    expect(structured.hint).toContain(`No exchange row holds ${unknown}. Send no read for it.`)
    expect(calls).toHaveLength(0)
  })

  it('refuses a name together with an address', async () => {
    const { calls, lookup } = harness()
    const { result } = await lookup({ network: 'robinhood', name: 'Aero', address: AERO_ROUTERS[0] })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('Give a name or an address, not both.')
    expect(calls).toHaveLength(0)
  })

  it('refuses a malformed address', async () => {
    const { lookup } = harness()
    const { result } = await lookup({ network: 'robinhood', address: '0x1234' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/^invalid_address/)
  })

  it('names the address form in the description', () => {
    expect(META_DEX_LOOKUP_DESCRIPTION).toContain('address')
    expect(META_DEX_LOOKUP_DESCRIPTION).toContain('Give a name or an address, not both.')
  })
})

describe('the reads of every exchange', () => {
  it('stay anchored and within one batch for all 31 rows', () => {
    for (const entry of document.rows) {
      const queries = lookupQueries(entry, true)
      expect(queries.length, entry.dex).toBeLessThanOrEqual(20)
      for (const { query } of queries) {
        expect(query, entry.dex).not.toMatch(RETIRED_READ)
        if (query.startsWith('USE topology'))
          expect(query, entry.dex).toMatch(/\{address: "0x[0-9a-f]{40}"\}|a\.address IN \[/)
      }
    }
  })

  it('carry the trigger words in the description every host reads', () => {
    for (const word of ['Aero', 'Aerodrome', 'Uniswap', 'Virtuals'])
      expect(META_DEX_LOOKUP_DESCRIPTION).toContain(word)
    expect(META_DEX_LOOKUP_DESCRIPTION).toMatch(
      /^Call this first when a question names a decentralized exchange/
    )
    expect(META_DEX_LOOKUP_DESCRIPTION).toContain(
      'Never ask the user for a pool, factory or router address.'
    )
  })
})
