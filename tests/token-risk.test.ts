import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AddressCardDocument, LoadedAddressCard } from '../src/mcp/address-card.js'
import type { DexRegistryDocument, LoadedRegistry } from '../src/mcp/dex-registry.js'
import type {
  ExchangeRegistryDocument,
  LoadedExchangeRegistry,
} from '../src/mcp/exchange-registry.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS, LOCAL_TOOL_NAMES } from '../src/mcp/proxy.js'
import {
  AML_TOKEN_RISK_ARGS,
  AML_TOKEN_RISK_DESCRIPTION,
  AML_TOKEN_RISK_SCHEMA,
  BATCH_LIMIT,
  BATCH_MEMBER_LIMIT,
  TOKEN_RISK_READING_RULE,
  askedAsOf,
  deploymentOf,
  handleAmlTokenRisk,
  type AmlTokenRiskResult,
  type TokenRiskDependencies,
} from '../src/mcp/token-risk.js'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS } from '../src/mcp/tool-visibility.js'
import { repoRoot } from './dex-registry.js'

// aml_token_risk is built on the address answer: at most four batches of at
// most 20 reads. No graph is reached: a fake answers each read by its id, in
// the shape the graph server returns, and counts the batches it was sent.

const read = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8')) as T
const card: LoadedAddressCard = { document: read<AddressCardDocument>('registry', 'address-card.json'), source: 'packaged' }
const exchanges: LoadedExchangeRegistry = {
  document: read<ExchangeRegistryDocument>('registry', 'exchanges', 'robinhood.json'),
  source: 'packaged',
}
const dex: LoadedRegistry = {
  document: read<DexRegistryDocument>('registry', 'robinhood.json'),
  source: 'packaged',
  loaded_at_ms: 0,
}

const hex = (prefix: string, n: number) => `0x${prefix}${n.toString(16).padStart(40 - prefix.length, '0')}`
const TOKEN = '0x766bd6598182586beda76414dc5f8deb1530a213'
const FOUNDER = '0xd8ab093fd32dee6566e300e62fbb200014f589e6'
// The bonding factory the exchange registry lists for Virtuals Protocol.
const FACTORY = '0xfc2e4da3edb2e18100473339c763705d263d20a9'
const GAS = '0x2fc617e933a52713247ce25730f6695920b3befe'
const POOL = '0x0adeeaea9aff53c9dfad6f0fb6df96c228b25d3e'
// The pool manager the exchange registry lists for Uniswap v4: its pools inside are one row.
const MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const POOL2 = '0x00000000000000000000000000000000000b0b02'
const VIRTUAL = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'
const CREATED = 1791000000000

type Member = { id: string; ok: boolean; results?: unknown[]; error?: string }
type Answer = Member | Array<Record<string, unknown>>
type Batch = { network: string; queries: Array<{ id: string; query: string }> }

const TOKEN_ROW = {
  node_labels: ['Address', 'Contract', 'Token'],
  card_version: '3',
  identity: 'launchpad',
  identity_name: 'virtuals:CIA:graduated',
  token_standard: 'ERC20',
  contract_creation_timestamp: CREATED,
}
const FACTORY_DEPLOYMENT = {
  deployer: FACTORY,
  tx_origin: FOUNDER,
  factory_address: FACTORY,
  kind: 'factory',
  tx_id: '0x9448a2cf',
  block_timestamp: CREATED,
}
const account = (fields: Record<string, unknown> = {}) => ({ node_labels: ['Address', 'Account'], ...fields })
const poolNode = (fields: Record<string, unknown> = {}) => ({
  node_labels: ['Address', 'Contract', 'Pool'],
  liquidity_added_usd: 2000,
  liquidity_removed_usd: 500,
  liquidity_net_usd: 1500,
  provider_count: 7,
  ...fields,
})
const provider = (address: string, fields: Record<string, unknown> = {}) => ({
  address,
  tokens_worth_usd: 300,
  priced: 2,
  events: 2,
  first_seen_height: 100,
  last_seen_height: 200,
  ...account(),
  ...fields,
})

/** The default answer of each read of a token; a test overrides any read by its id. */
function tokenAnswers(overrides: Record<string, Answer> = {}): (id: string) => Answer {
  const defaults: Record<string, Answer> = {
    node: [TOKEN_ROW],
    in: [],
    out: [],
    deployment: [FACTORY_DEPLOYMENT],
    adders: [],
    removers: [],
    assets: [],
    providers_added: [
      { pool: POOL, ...provider(hex('add', 1), { tokens_worth_usd: 3000 }) },
      { pool: POOL, ...provider(hex('add', 2), { tokens_worth_usd: 2000 }) },
      // 12 providers of one pool manager: one row for the manager, never 12 pools.
      ...Array.from({ length: 12 }, (_, index) => ({
        pool: MANAGER,
        ...provider(hex('ab', index + 1), { tokens_worth_usd: 75 }),
      })),
      { pool: POOL2, ...provider(hex('add', 3), { tokens_worth_usd: 0, priced: 0 }) },
    ],
    providers_removed: [
      { pool: POOL, ...provider(hex('de', 1), { tokens_worth_usd: 500 }) },
      { pool: MANAGER, ...provider(hex('de', 2), { tokens_worth_usd: 100 }) },
    ],
    founder_node: [account()],
    founder_in: [],
    founder_out: [],
    gas_wallets: [
      { address: GAS, tokens_worth_usd: 0.71, first_seen_timestamp: CREATED - 3_600_000, ...account({ risk_level: 'LOW', risk_score: 0.0016 }) },
    ],
    factory_node: [{ node_labels: ['Address', 'Contract'], risk_level: 'LOW', risk_score: 0.0001 }],
  }
  // The grouped pools reads, unless a test gives them: the groups of the providers rows given,
  // and the same refusal when those rows were refused.
  const grouped = (side: 'added' | 'removed', id: string): Answer => {
    const rows = overrides[`providers_${side}`] ?? defaults[`providers_${side}`]!
    if (!Array.isArray(rows)) return { ...rows, id }
    const byPool = new Map<string, { providers: Set<unknown>; usd: number; priced: number }>()
    for (const row of rows) {
      const group = byPool.get(row.pool as string) ?? { providers: new Set(), usd: 0, priced: 0 }
      group.providers.add(row.address)
      group.usd += Number(row.tokens_worth_usd ?? 0)
      group.priced += Number(row.priced ?? 0)
      byPool.set(row.pool as string, group)
    }
    return [...byPool].map(([pool, group]) => ({
      pool,
      [side === 'added' ? 'providers' : 'removers']: group.providers.size,
      [`${side}_usd`]: group.usd,
      priced: group.priced,
      events: group.providers.size,
    }))
  }
  return (id) => {
    if (id in overrides) return overrides[id]!
    if (id === 'pools_added') return grouped('added', id)
    if (id === 'pools_removed') return grouped('removed', id)
    if (id in defaults) return defaults[id]!
    if (/^pool\d+_node$/.test(id)) return [poolNode()]
    if (/^pool\d+_deployment$/.test(id)) return [{ ...FACTORY_DEPLOYMENT, tx_id: '0x1' }]
    return { id, ok: false, error: `no answer for ${id}` }
  }
}

function fakeGraph(answer: (id: string) => Answer) {
  const sent: Batch[] = []
  const graphQueryBatch: TokenRiskDependencies['graphQueryBatch'] = async (batch) => {
    sent.push(batch)
    const queries = batch.queries.map(({ id }) => {
      const given = answer(id)
      return Array.isArray(given) ? { id, ok: true, results: given } : { ...given, id }
    })
    return { structuredContent: { facts: { queries } } }
  }
  return { sent, graphQueryBatch }
}

const deps = (graph: ReturnType<typeof fakeGraph>): TokenRiskDependencies => ({
  loadAddressCard: async () => card,
  loadExchangeRegistry: async () => exchanges,
  loadDexRegistry: async () => dex,
  graphQueryBatch: graph.graphQueryBatch,
  describeFailure: (err) => (err as Error).message,
})

async function call(
  answer: (id: string) => Answer = tokenAnswers(),
  extra: Record<string, unknown> = {},
  address = TOKEN
) {
  const graph = fakeGraph(answer)
  const result = await handleAmlTokenRisk({ network: 'robinhood', address, ...extra }, deps(graph))
  return { result, structured: result.structuredContent as unknown as AmlTokenRiskResult, sent: graph.sent }
}

const ANSWER_KEYS = [
  'schema',
  'tool',
  'network',
  'address',
  'asked_as',
  'found',
  'token',
  'risk',
  'model',
  'founder',
  'factory',
  'deployment',
  'gas_wallets',
  'pools',
  'pools_found',
  'pools_truncated',
  'parties_truncated',
  'pool_tokens',
  'deployer',
  'exposure',
  'exchange_ends',
  'not_read',
]

const expectBudget = (sent: Batch[]) => {
  expect(sent.length).toBeLessThanOrEqual(BATCH_LIMIT)
  for (const batch of sent) expect(batch.queries.length).toBeLessThanOrEqual(BATCH_MEMBER_LIMIT)
}

describe('aml_token_risk: a token', () => {
  it('names the founder (the sending wallet), the factory by its registry name, the gas wallet and the pools', async () => {
    const { result, structured, sent } = await call()
    expect(result.isError).toBe(false)
    expect(Object.keys(structured)).toEqual(ANSWER_KEYS)
    expect(JSON.parse(result.content[0]!.text)).toEqual(structured)
    expect(structured).toMatchObject({
      schema: AML_TOKEN_RISK_SCHEMA,
      asked_as: 'token',
      found: true,
      token: {
        address: TOKEN,
        standard: 'ERC20',
        created_utc: '2026-10-03 04:00:00 UTC',
        identity: { word: 'launchpad', name: 'virtuals:CIA:graduated' },
      },
      deployment: { tx_id: FACTORY_DEPLOYMENT.tx_id, created_utc: '2026-10-03 04:00:00 UTC', kind: 'factory' },
      pools_found: 3,
      pools_truncated: false,
      parties_truncated: false,
      pool_tokens: [],
      deployer: null,
      not_read: [],
    })
    expect(structured.founder).toMatchObject({
      role: 'founder',
      address: FOUNDER,
      kind: 'account',
      risk: { word: 'unscored' },
      exposure: { counterparties_read: 0 },
      exchange_ends: [],
    })
    expect(structured.factory).toMatchObject({
      role: 'factory',
      address: FACTORY,
      name: 'Virtuals Protocol',
      named_by: 'registry',
      risk: { word: 'low', set_by: 'model', score: 0.0001 },
    })
    expect('exposure' in structured.factory!).toBe(false)
    expect(structured.gas_wallets).toEqual([
      expect.objectContaining({
        role: 'gas_wallet',
        address: GAS,
        tokens_worth_usd: 0.71,
        first_seen_utc: '2026-10-03 03:00:00 UTC',
        risk: expect.objectContaining({ word: 'low', score: 0.0016 }),
      }),
    ])
    // The low factory and gas wallet never raise the word: the own pool's node is unscored too.
    expect(structured.risk).toMatchObject({
      word: 'unscored',
      set_by: 'none',
      score: null,
      raised_by: null,
      raised_by_address: null,
    })
    expect(structured.risk.own).toMatchObject({ word: 'unscored', card_version: '3' })
    // The two whole-chain providers reads go first in their batch; the manager gets no node read.
    // Call 1 is the node alone; call 2 the subject's other reads.
    expect(sent.map((batch) => batch.queries.map((read) => read.id)).slice(0, 2)).toEqual([
      ['node'],
      ['in', 'out', 'deployment', 'adders', 'removers', 'assets'],
    ])
    expect(sent[2]!.queries.slice(0, 4).map((read) => read.id)).toEqual([
      'pools_added',
      'pools_removed',
      'providers_added',
      'providers_removed',
    ])
    expect(sent.map((batch) => batch.queries.map((read) => read.id))[3]).toEqual([
      'pool0_node',
      'pool0_deployment',
      'pool2_node',
      'pool2_deployment',
    ])
    expectBudget(sent)
  })

  it('a pool row is one address: a pool manager is one row with its providers and this token side', async () => {
    const { structured } = await call()
    expect(structured.pools.map((pool) => [pool.pool, pool.exchange, pool.is_manager, pool.detail, pool.providers])).toEqual([
      [POOL, 'Virtuals Protocol', false, true, 2],
      [MANAGER, 'Uniswap v4', true, true, 12],
      [POOL2, 'Virtuals Protocol', false, true, 1],
    ])
    expect(structured.pools[0]).toMatchObject({
      token_side: { added_usd: 5000, removed_usd: 500 },
      liquidity: { added_usd: 2000, removed_usd: 500, net_usd: 1500 },
      risk: { word: 'unscored' },
    })
    expect(structured.pools[0]!.adders.map((party) => party.address)).toEqual([hex('add', 1), hex('add', 2)])
    expect(structured.pools[1]).toMatchObject({
      pools_inside: null,
      token_side: { added_usd: 900, removed_usd: 100 },
      liquidity: null,
      risk: null,
    })
    expect(structured.pools[1]!.adders).toHaveLength(5)
    // Unpriced added stays null; no removal row in a removals read that answered whole is 0.
    expect(structured.pools[2]!.token_side).toEqual({ added_usd: null, removed_usd: 0 })
    expect(Object.keys(structured.pools[0]!)).not.toContain('pools_inside')
  })

  it('a token factory with no registry row is named by the token launchpad identity, else left unnamed', async () => {
    // The Virtuals token factory creates tokens, not pools: no exchange registry row of its own.
    const tokenFactory = '0x43e4c17b15365596caae8e7d00e42bc8e988c2d4'
    const deployment = [{ ...FACTORY_DEPLOYMENT, deployer: tokenFactory, factory_address: tokenFactory }]
    const cases: Array<[string, Record<string, unknown>, string | null, string | null]> = [
      ['the top identity', TOKEN_ROW, 'Virtuals Protocol', 'launchpad'],
      [
        'an entry of identities',
        { ...TOKEN_ROW, identity: 'token', identity_name: 'CIA', identities: ['launchpad:virtuals:CIA:graduated'] },
        'Virtuals Protocol',
        'launchpad',
      ],
      ['a launchpad key the registry does not hold', { ...TOKEN_ROW, identity_name: 'nolaunch:X' }, null, null],
      ['no launchpad identity', { ...TOKEN_ROW, identity: 'token', identity_name: 'CIA' }, null, null],
    ]
    for (const [name, node, factoryName, namedBy] of cases) {
      const { structured } = await call(tokenAnswers({ node: [node], deployment }))
      expect(structured.factory, name).toMatchObject({ address: tokenFactory, name: factoryName, named_by: namedBy })
    }
  })

  it('a hand deployment has no factory; with no tx_origin the deployer is the founder', async () => {
    expect(
      deploymentOf({ deployer: FOUNDER, tx_origin: FOUNDER, factory_address: null, kind: 'create', tx_id: '0x1' })
    ).toMatchObject({ founder: FOUNDER, factory: null })
    expect(deploymentOf({ deployer: FOUNDER, kind: 'factory', factory_address: FOUNDER })).toMatchObject({
      founder: FOUNDER,
      factory: null,
    })
    expect(deploymentOf(undefined)).toBeNull()
    const { structured, sent } = await call(
      tokenAnswers({ deployment: [{ deployer: FOUNDER, tx_origin: FOUNDER, kind: 'create', tx_id: '0x1' }] })
    )
    expect(structured.factory).toBeNull()
    expect(structured.founder?.address).toBe(FOUNDER)
    expect(sent[2]!.queries.some((read) => read.id === 'factory_node')).toBe(false)
  })

  it('with 12 pool addresses: 10 in detail, every one listed, within 4 batches of 20 reads', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      pool: hex('b0', index + 1),
      ...provider(hex('add', index + 1), { tokens_worth_usd: 1000 - index }),
    }))
    const { structured, sent } = await call(tokenAnswers({ providers_added: rows, providers_removed: [] }))
    expect(structured.pools_found).toBe(12)
    expect(structured.pools_truncated).toBe(true)
    expect(structured.pools).toHaveLength(12)
    expect(structured.pools.filter((pool) => pool.detail)).toHaveLength(10)
    expect(
      structured.pools.slice(10).every((pool) => !pool.detail && pool.risk === null && pool.liquidity === null && pool.adders.length === 0)
    ).toBe(true)
    // The removals read answered with no row for the pool: nothing removed.
    expect(structured.pools[11]!.token_side).toEqual({ added_usd: 989, removed_usd: 0 })
    expect(sent).toHaveLength(4)
    expect(sent[3]!.queries).toHaveLength(BATCH_MEMBER_LIMIT)
    expectBudget(sent)
  })

  it('a token with 300 pools and a full providers read: every pool counted, the parties may miss someone', async () => {
    const groups = Array.from({ length: 300 }, (_, index) => ({
      pool: hex('b0', index + 1),
      providers: 40,
      added_usd: 10_000 - index,
      priced: 40,
      events: 40,
    }))
    const rows = Array.from({ length: 200 }, (_, index) => ({ pool: hex('b0', (index % 5) + 1), ...provider(hex('add', index + 1)) }))
    const { structured, sent } = await call(
      tokenAnswers({ pools_added: groups, pools_removed: [], providers_added: rows, providers_removed: [] })
    )
    expect(structured).toMatchObject({ pools_found: 300, pools_truncated: true, parties_truncated: true })
    expect(structured.not_read).toEqual([expect.objectContaining({ part: 'pool_parties', code: 'truncated' })])
    expect(structured.pools[0]!.adders).toHaveLength(5)
    // A pool beyond the 10 detailed keeps its providers and its side from the grouped read.
    expect(structured.pools[299]).toMatchObject({
      detail: false,
      providers: 40,
      token_side: { added_usd: 9701, removed_usd: 0 },
      adders: [],
    })
    expect(sent).toHaveLength(4)
    expectBudget(sent)
  })

  it('a grouped pools read full at 500 says more pools exist; a pool missing from a full removals read is null', async () => {
    const groups = Array.from({ length: 500 }, (_, index) => ({
      pool: hex('b0', index + 1),
      providers: 1,
      added_usd: 1000,
      priced: 1,
    }))
    const removed = Array.from({ length: 500 }, (_, index) => ({
      pool: hex('c0', index + 1),
      removers: 1,
      removed_usd: 5,
      priced: 1,
    }))
    const { structured } = await call(tokenAnswers({ pools_added: groups, pools_removed: removed }))
    expect(structured.pools_found).toBe(1000)
    expect(structured.pools_truncated).toBe(true)
    expect(structured.not_read.map((entry) => [entry.part, entry.code])).toEqual([
      ['pools', 'truncated'],
      ['pool_removals', 'truncated'],
    ])
    expect(structured.pools[0]!.token_side).toEqual({ added_usd: 1000, removed_usd: null })
  })

  it('a grouped pools read that is refused falls back to the providers rows, and is named', async () => {
    const { structured } = await call(
      tokenAnswers({ pools_added: { id: 'pools_added', ok: false, error: 'query_timeout: 10 s' } })
    )
    expect(structured.pools_found).toBe(3)
    expect(structured.pools.map((pool) => [pool.pool, pool.providers])).toEqual([
      [POOL, 2],
      [MANAGER, 12],
      [POOL2, 1],
    ])
    expect(structured.not_read).toEqual([{ part: 'pools', code: 'query_timeout', reason: 'query_timeout: 10 s' }])
  })

  it('a pools read that is refused is named as not read; the founder still answers', async () => {
    const { structured } = await call(
      tokenAnswers({
        providers_added: { id: 'providers_added', ok: false, error: 'family_behind: the dex family is 400000 blocks behind' },
      })
    )
    expect(structured.pools_found).toBeNull()
    expect(structured.pools).toEqual([])
    const reason = 'family_behind: the dex family is 400000 blocks behind'
    expect(structured.not_read).toEqual([
      { part: 'pool_parties', code: 'family_behind', reason },
      { part: 'pools', code: 'family_behind', reason },
    ])
    expect(structured.founder?.address).toBe(FOUNDER)
  })

  it('names every other part that did not answer, and a batch that failed whole', async () => {
    const { structured } = await call(
      tokenAnswers({
        // A code named inside the text, not as its prefix, is the code.
        providers_removed: { id: 'providers_removed', ok: false, error: 'the read stopped: query_timeout after 10 s' },
        founder_in: { id: 'founder_in', ok: false, error: 'query_timeout: 10 s' },
        factory_node: { id: 'factory_node', ok: false },
        pool0_node: { id: 'pool0_node', ok: false, error: 'memory_limit: over' },
        deployment: [FACTORY_DEPLOYMENT],
      })
    )
    expect(structured.not_read.map((entry) => [entry.part, entry.code, entry.pool ?? null])).toEqual([
      ['founder_senders', 'query_timeout', null],
      ['factory', 'not_answered', null],
      ['pool_parties', 'query_timeout', null],
      ['pool_removals', 'query_timeout', null],
      ['pool', 'memory_limit', POOL],
    ])
    expect(structured.factory).toBeNull()
    expect(structured.pools[0]!.risk).toBeNull()
    expect(structured.pools[0]!.token_side?.removed_usd).toBeNull()

    let calls = 0
    const graph = fakeGraph(tokenAnswers())
    const result = await handleAmlTokenRisk(
      { network: 'robinhood', address: TOKEN },
      {
        ...deps(graph),
        graphQueryBatch: async (batch) => {
          calls += 1
          if (calls === 3) throw new Error('payment required')
          return graph.graphQueryBatch(batch)
        },
      }
    )
    const answer = result.structuredContent as unknown as AmlTokenRiskResult
    expect(answer.founder).toBeNull()
    expect(answer.pools_found).toBeNull()
    expect(answer.not_read.map((entry) => entry.part)).toEqual([
      'founder',
      'gas_wallets',
      'factory',
      'pool_parties',
      'pool_parties',
      'pools',
    ])
    expect(answer.not_read[0]!.reason).toBe('payment required')
  })
})

describe('aml_token_risk: who raises the word', () => {
  const scam = { evidence: ['scam:APPROVAL_DRAINER'] }
  const cases: Array<[string, Record<string, Answer>, string, string | null, string | null]> = [
    ['a critical founder raises the token', { founder_node: [account(scam)] }, 'critical', 'founder', FOUNDER],
    ['a pool own word raises the token', { pool0_node: [poolNode(scam)] }, 'critical', 'pool', POOL],
    ['the token own word', { node: [{ ...TOKEN_ROW, risk_level: 'MEDIUM', risk_score: 0.5 }] }, 'medium', 'token', TOKEN],
    [
      'a critical factory, gas wallet, adder and remover never raise it',
      {
        factory_node: [{ node_labels: ['Address', 'Contract'], ...scam }],
        gas_wallets: [{ address: GAS, tokens_worth_usd: 1, first_seen_timestamp: CREATED, ...account(scam) }],
        providers_added: [{ pool: POOL, ...provider(hex('add', 1), scam) }],
        providers_removed: [{ pool: POOL, ...provider(hex('de', 1), scam) }],
      },
      'unscored',
      null,
      null,
    ],
  ]
  it.each(cases)('%s', async (_name, overrides, word, by, at) => {
    const { structured } = await call(tokenAnswers(overrides))
    expect(structured.risk).toMatchObject({ word, raised_by: by, raised_by_address: at })
    expect(structured.risk.set_by).toBe(word === 'unscored' ? 'none' : word === 'medium' ? 'model' : 'rules')
  })

  it('the parties that never raise it still carry their own word', async () => {
    const scam = { evidence: ['scam'] }
    const { structured } = await call(
      tokenAnswers({
        factory_node: [{ node_labels: ['Address', 'Contract'], ...scam }],
        providers_added: [{ pool: POOL, ...provider(hex('add', 1), scam) }],
      })
    )
    expect(structured.factory?.risk.word).toBe('critical')
    expect(structured.pools[0]!.adders[0]!.risk.word).toBe('critical')
    expect(structured.risk.word).toBe('unscored')
  })
})

describe('aml_token_risk: a pool, a wallet, nothing', () => {
  it('reads what the node labels say: Pool wins over Token', () => {
    expect([['Address', 'Token', 'Pool'], ['Address', 'Token'], ['Address', 'Account'], []].map(askedAsOf)).toEqual([
      'pool',
      'token',
      'address',
      'address',
    ])
  })

  it('a pool: its own word only, its sums and parties, its tokens and its deployer beside it', async () => {
    const { structured, sent } = await call(
      tokenAnswers({
        node: [poolNode({ node_labels: ['Address', 'Contract', 'Token', 'Pool'], risk_level: 'LOW', risk_score: 0.2 })],
        deployment: [FACTORY_DEPLOYMENT],
        adders: [provider(hex('add', 1)), provider(hex('add', 2), { evidence: ['scam'] })],
        removers: [provider(hex('de', 1))],
        assets: [{ assets: [TOKEN, VIRTUAL, 'NATIVE'] }],
        token0_node: [TOKEN_ROW],
        token1_node: [{ node_labels: ['Address', 'Contract', 'Token'], evidence: ['scam'] }],
        deployer_node: [account()],
      }),
      {},
      POOL
    )
    expect(Object.keys(structured)).toEqual(ANSWER_KEYS)
    expect(structured.asked_as).toBe('pool')
    expect(structured.token).toBeNull()
    expect(structured.risk).toMatchObject({ word: 'low', score: 0.2, raised_by: 'pool', raised_by_address: POOL })
    expect(structured.pools).toHaveLength(1)
    expect(structured.pools[0]).toMatchObject({
      pool: POOL,
      exchange: 'Virtuals Protocol',
      is_manager: false,
      detail: true,
      providers: 7,
      token_side: null,
      liquidity: { added_usd: 2000, removed_usd: 500, net_usd: 1500 },
    })
    expect(structured.pools[0]!.adders.map((party) => party.risk.word)).toEqual(['unscored', 'critical'])
    expect(structured.pool_tokens.map((party) => [party.address, party.risk.word])).toEqual([
      [TOKEN, 'unscored'],
      [VIRTUAL, 'critical'],
    ])
    expect(structured.deployer).toMatchObject({ role: 'deployer', address: FOUNDER })
    expect(structured.exposure).not.toBeNull()
    expect(sent.map((batch) => batch.queries.length)).toEqual([1, 6, 3])
  })

  it('a pool manager asked about itself: one row, no word of a pool, and its own word raises nothing', async () => {
    // The graph labels no pool manager :Pool; the exchange registry says what it is.
    const { structured, sent } = await call(
      tokenAnswers({
        node: [{ node_labels: ['Address', 'Contract'], evidence: ['scam'] }],
        deployment: [],
        assets: [],
      }),
      {},
      MANAGER
    )
    expect(structured.asked_as).toBe('pool')
    expect(structured.pools[0]).toMatchObject({
      is_manager: true,
      exchange: 'Uniswap v4',
      liquidity: null,
      risk: null,
      adders: [],
      removers: [],
    })
    // No party read is sent for a manager, and none is named as not read.
    expect(sent.map((batch) => batch.queries.map((read) => read.id)).slice(0, 2)).toEqual([
      ['node'],
      ['in', 'out', 'deployment'],
    ])
    expect(structured.not_read.filter((entry) => ['adders', 'removers', 'tokens'].includes(entry.part))).toEqual([])
    expect(structured.pool_tokens).toEqual([])
    expect(structured.risk).toMatchObject({ word: 'critical', set_by: 'rules', raised_by: null })
  })

  it('a hub pool manager asked as a pool: no partner and no party read, the hub named, one row', async () => {
    const { structured, sent } = await call(
      tokenAnswers({ node: [{ node_labels: ['Address', 'Contract'], degree_total: 207_581 }], deployment: [] }),
      {},
      MANAGER
    )
    expect(sent.map((batch) => batch.queries.map((read) => read.id)).slice(0, 2)).toEqual([
      ['node'],
      ['deployment'],
    ])
    expect(structured.exposure).toMatchObject({ hub: true, degree_total: 207_581, counterparties_read: 0 })
    expect(structured.not_read).toEqual([expect.objectContaining({ part: 'counterparties', code: 'hub' })])
    expect(structured.pools[0]).toMatchObject({ is_manager: true, adders: [], removers: [] })
  })

  it('a hub token: its partners are not read, everything else is', async () => {
    const { structured, sent } = await call(
      tokenAnswers({ node: [{ ...TOKEN_ROW, degree_total: 1_000_000, risk_level: 'MEDIUM', risk_score: 0.4 }] })
    )
    expect(sent[1]!.queries.map((read) => read.id)).toEqual(['deployment', 'adders', 'removers', 'assets'])
    expect(structured.exposure).toMatchObject({ hub: true, with_risk: [] })
    expect(structured.risk).toMatchObject({ word: 'medium', raised_by: 'token' })
    expect(structured.founder?.address).toBe(FOUNDER)
    expect(structured.pools_found).toBe(3)
    expect(structured.not_read.map((entry) => entry.part)).toEqual(['counterparties'])
  })

  it('a wallet is answered as an address: its own word, and nothing else read', async () => {
    const { structured, sent } = await call(
      tokenAnswers({ node: [account({ evidence: ['scam'] })] }),
      {},
      FOUNDER
    )
    expect(Object.keys(structured)).toEqual(ANSWER_KEYS)
    expect(structured).toMatchObject({
      asked_as: 'address',
      found: true,
      token: null,
      founder: null,
      pools: [],
      pools_found: null,
      exposure: null,
      not_read: [],
      risk: { word: 'critical', set_by: 'rules', raised_by: null, raised_by_address: null, own: { word: 'critical' } },
    })
    expect(sent).toHaveLength(1)
  })

  it('an address the graph does not hold is not found', async () => {
    const { result, structured, sent } = await call(tokenAnswers({ node: [] }))
    expect(result.isError).toBe(false)
    expect(structured).toMatchObject({
      asked_as: 'address',
      found: false,
      risk: { word: 'unscored', set_by: 'none', raised_by: null },
    })
    expect(sent).toHaveLength(1)
  })

  it('a subject read that fails is an error, never "no risk"', async () => {
    const { result } = await call(tokenAnswers({ node: { id: 'node', ok: false, error: 'memory_limit' } }))
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('This is not "no risk"')
  })
})

describe('aml_token_risk: the answer', () => {
  it('writes no hint, no summary, no verdict, and never the word suspect', async () => {
    const { structured } = await call(
      tokenAnswers({ node: [{ ...TOKEN_ROW, evidence: ['scam:FAKE_TOKEN'], judgements: ['suspect:FAKE_TOKEN'] }] }),
      { surroundings: true }
    )
    expect(Object.keys(structured)).toEqual([...ANSWER_KEYS, 'surroundings'])
    const text = JSON.stringify(structured)
    expect(text).not.toMatch(/"(hint|summary|verdict|advice)"/)
    expect(text).not.toMatch(/\bsafe\b/i)
    expect(text).not.toContain('suspect')
    expect(structured.risk.own.reasons.map((reason) => reason.word)).toEqual(['launchpad', 'pattern', 'pattern'])
  })

  it('draws the surroundings only when asked, every link between listed nodes', async () => {
    const without = await call()
    expect('surroundings' in without.structured).toBe(false)
    const { structured } = await call(tokenAnswers(), { surroundings: true })
    const { nodes, links, truncated } = structured.surroundings!
    expect(truncated).toBe(false)
    expect(nodes.map((node) => [node.address, node.role]).slice(0, 7)).toEqual([
      [TOKEN, 'subject'],
      [FOUNDER, 'founder'],
      [FACTORY, 'factory'],
      [GAS, 'gas_wallet'],
      [POOL, 'pool'],
      [hex('add', 1), 'adder'],
      [hex('add', 2), 'adder'],
    ])
    expect(nodes[2]!.name).toBe('Virtuals Protocol')
    expect(nodes.find((node) => node.address === MANAGER)).toMatchObject({ role: 'pool', kind: 'contract', name: 'Uniswap v4' })
    const listed = new Set(nodes.map((node) => node.address))
    for (const link of links) expect(listed.has(link.from_address) && listed.has(link.to_address)).toBe(true)
    expect(links.map((link) => [link.link, link.from_address, link.to_address]).slice(0, 4)).toEqual([
      ['DEPLOYED_CONTRACT', FACTORY, TOKEN],
      ['FLOWED_TO', GAS, FOUNDER],
      ['ADDED_LIQUIDITY', hex('add', 1), POOL],
      ['ADDED_LIQUIDITY', hex('add', 2), POOL],
    ])
    expect(links.some((link) => link.link === 'REMOVED_LIQUIDITY' && link.from_address === POOL && link.to_address === hex('de', 1))).toBe(true)
  })

  it('keeps at most 60 nodes: partners go first, then removers, then adders', async () => {
    const partners = Array.from({ length: 25 }, (_, index) => ({
      address: hex('c', index + 1),
      node_labels: ['Address', 'Account'],
      tokens_worth_usd: 10,
      tx_count: 1,
      first_seen_timestamp: CREATED,
      last_seen_timestamp: CREATED,
    }))
    const many = (prefix: string) =>
      Array.from({ length: 10 }, (_, pool) =>
        Array.from({ length: 5 }, (_, index) => ({
          pool: hex('b0', pool + 1),
          ...provider(hex(prefix, pool * 10 + index + 1)),
        }))
      ).flat()
    const overrides: Record<string, Answer> = { in: partners, providers_added: many('add'), providers_removed: many('de') }
    const { structured } = await call(tokenAnswers(overrides), { surroundings: true })
    const { nodes, truncated } = structured.surroundings!
    expect(nodes).toHaveLength(60)
    expect(truncated).toBe(true)
    const count = (role: string) => nodes.filter((node) => node.role === role).length
    expect([count('partner'), count('remover'), count('adder'), count('pool')]).toEqual([0, 0, 46, 10])
  })

  it('refuses a bad argument before any read, and sends none without the dictionary', async () => {
    for (const args of [
      { network: 'robinhood', address: 'CIA' },
      { network: 'robinhood' },
      { network: '', address: TOKEN },
      { network: 'robinhood', address: TOKEN, surroundings: 'yes' },
    ]) {
      const graph = fakeGraph(tokenAnswers())
      const result = await handleAmlTokenRisk(args, deps(graph))
      expect(result.isError).toBe(true)
      expect(graph.sent).toEqual([])
    }
    const graph = fakeGraph(tokenAnswers())
    const noCard = await handleAmlTokenRisk({ network: 'robinhood', address: TOKEN }, { ...deps(graph), loadAddressCard: async () => null })
    expect(noCard.content[0]!.text).toContain('address card dictionary did not load')
    const down = await handleAmlTokenRisk(
      { network: 'robinhood', address: TOKEN },
      { ...deps(graph), unavailable: () => 'the graph is not connected.' }
    )
    expect(down.content[0]!.text).toContain('the graph is not connected.')
    expect(graph.sent).toEqual([])
    const offline = await handleAmlTokenRisk(
      { network: 'robinhood', address: TOKEN },
      {
        ...deps(graph),
        loadDexRegistry: async () => {
          throw new Error('offline')
        },
        loadExchangeRegistry: async () => {
          throw new Error('offline')
        },
      }
    )
    expect((offline.structuredContent as unknown as AmlTokenRiskResult).factory?.name).toBeNull()
  })

  it('is a listed local tool, and its description tells the host how to judge', () => {
    expect(LOCAL_TOOL_NAMES.has('aml_token_risk')).toBe(true)
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['aml_token_risk']).toEqual([...AML_TOKEN_RISK_ARGS])
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS['aml_token_risk']).toBe(AML_TOKEN_RISK_DESCRIPTION)
    expect(AML_TOKEN_RISK_DESCRIPTION).toContain(TOKEN_RISK_READING_RULE)
    for (const term of ['aml_address_risk', 'raised_by', 'never raise', 'pools_found', 'not_read', 'in full', 'tokens worth']) {
      expect(AML_TOKEN_RISK_DESCRIPTION).toContain(term)
    }
  })
})
