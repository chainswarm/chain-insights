import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION,
  EXCHANGE_DEPOSIT_BEHAVIOUR,
  EXCHANGE_INFERRED_RULE,
  depositCheckQueries,
  handleAmlExchangeDepositCheck,
  type AmlExchangeDepositCheckResult,
  type ExchangeDepositCheckDependencies,
} from '../src/mcp/exchange-deposit-check.js'
import type {
  ExchangeRegistryDocument,
  LoadedExchangeRegistry,
} from '../src/mcp/exchange-registry.js'
import {
  EXCHANGE_OPENING_RULE,
  META_EXCHANGE_LOOKUP_DESCRIPTION,
  handleMetaExchangeLookup,
  type MetaExchangeLookupResult,
} from '../src/mcp/exchange-tool.js'
import { PUBLIC_MCP_TOOL_ALLOWED_ARGS } from '../src/mcp/tool-visibility.js'
import { repoRoot } from './dex-registry.js'

// The two doors of the skill chain-insights-aml-exchange. meta_exchange_lookup
// answers from the served lookup file alone; aml_exchange_deposit_check sends one
// batch of six reads anchored on the address and names the exchange from the
// lookup. No graph is reached: the batch answers are written here in the shape
// the graph server returns.

const lookup = (network: string): LoadedExchangeRegistry => ({
  document: JSON.parse(
    readFileSync(join(repoRoot, 'registry', 'exchanges', `${network}.json`), 'utf8')
  ) as ExchangeRegistryDocument,
  source: 'packaged',
})
const loadExchangeRegistry = async (network: string) =>
  network === 'robinhood' || network === 'ethereum' ? lookup(network) : lookup('robinhood')

const lookupResult = async (args: Record<string, unknown>) => {
  const result = await handleMetaExchangeLookup(args, { loadExchangeRegistry })
  return { result, structured: result.structuredContent as unknown as MetaExchangeLookupResult }
}

const BITGET_HOT = '0xed9ab5bc05a0152b9dc2f7902e8369af7bc18771'
const DEPOSIT = '0x31a817802ee183eb8b13167ffe24bd28dcc6f30c'

describe('meta_exchange_lookup', () => {
  it('turns a name into the hot wallets proven on the network, each with its evidence and block', async () => {
    const { result, structured } = await lookupResult({ network: 'robinhood', name: 'Bitget' })
    expect(result.isError).toBe(false)
    expect(structured.matched).toEqual({
      exchange: 'bitget',
      display: 'Bitget',
      hot_wallets: [
        {
          address: BITGET_HOT,
          evidence:
            '1987 clean payers 2026-10-09 to 2026-11-07; 199 of 200 sampled pay only this exchange',
          proven_at_block: 108803217,
        },
      ],
      gas_wallets: [],
      spenders: [],
    })
    expect(structured.hint).toContain('Bitget on robinhood: 1 hot wallet proven on this chain.')
    expect(structured.hint).toContain(EXCHANGE_OPENING_RULE)
  })

  it('takes a misspelling and says so; takes another spelling silently', async () => {
    const near = await lookupResult({ network: 'ethereum', name: 'binanse' })
    expect(near.structured.matched?.exchange).toBe('binance')
    expect(near.structured.took_for).toBe('binanse')
    expect(near.structured.hint).toContain('I took Binance for binanse.')
    const alias = await lookupResult({ network: 'ethereum', name: 'gate.io' })
    expect(alias.structured.matched?.exchange).toBe('gate')
    expect(alias.structured.took_for).toBeUndefined()
  })

  it('turns a wallet into its exchange and its role', async () => {
    const { structured } = await lookupResult({
      network: 'ethereum',
      address: '0x9430801EBAF509AD49202AABC5F5BC6FD8A3DAF8',
    })
    expect(structured.matched?.exchange).toBe('binance')
    expect(structured.took_for).toBe('a gas wallet')
    expect(structured.hint).toContain(
      '0x9430801ebaf509ad49202aabc5f5bc6fd8a3daf8 is a gas wallet of Binance on ethereum.'
    )
  })

  it('lists every exchange of the network with no name, with its hot wallet count', async () => {
    const { structured } = await lookupResult({ network: 'robinhood' })
    expect(structured.exchanges).toEqual([
      { exchange: 'bitget', display: 'Bitget', hot_wallets: 1 },
      { exchange: 'bitrue', display: 'Bitrue', hot_wallets: 0 },
      { exchange: 'bitunix', display: 'Bitunix', hot_wallets: 0 },
      { exchange: 'blofin', display: 'BloFin', hot_wallets: 0 },
      { exchange: 'bybit', display: 'Bybit', hot_wallets: 1 },
      { exchange: 'gate', display: 'Gate', hot_wallets: 1 },
      { exchange: 'pionex', display: 'Pionex', hot_wallets: 0 },
    ])
  })

  it('an exchange with no wallet proven on the chain is still found, and the hint sends the trail to the graph', async () => {
    const { result, structured } = await lookupResult({ network: 'robinhood', name: 'pionex' })
    expect(result.isError).toBe(false)
    expect(structured.matched).toMatchObject({ exchange: 'pionex', hot_wallets: [] })
    expect(structured.hint).toContain('the graph marks its deposits and hot wallets')
    expect(structured.hint).toContain('call aml_exchange_deposit_check')
    expect(structured.hint).not.toMatch(/not (covered|served|supported)|unsupported|unknown/i)
  })

  it('a wallet the file leaves out sends the reader to the graph check', async () => {
    const { structured } = await lookupResult({
      network: 'robinhood',
      address: '0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17',
    })
    expect(structured.matched).toBeNull()
    expect(structured.hint).toContain('the file lists only wallets proven on this chain')
    expect(structured.hint).toContain(
      'call aml_exchange_deposit_check {network: "robinhood", address: "0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17"}'
    )
  })

  it('a name with no row sends the user to an address and never says the exchange is unsupported', async () => {
    const { result, structured } = await lookupResult({ network: 'robinhood', name: 'Kraken' })
    expect(result.isError).toBe(false)
    expect(structured.matched).toBeNull()
    expect(structured.listed).toEqual([
      'Bitget',
      'Bitrue',
      'Bitunix',
      'BloFin',
      'Bybit',
      'Gate',
      'Pionex',
    ])
    expect(structured.hint).toContain('call aml_exchange_deposit_check with it')
    expect(structured.hint).toContain('Send no graph search by name.')
    expect(structured.hint).not.toMatch(/not (covered|served|supported)|unsupported|unknown/i)
  })

  it('refuses a name and an address together, and a malformed address, before reading the file', async () => {
    let reads = 0
    const counted = async (network: string) => {
      reads += 1
      return loadExchangeRegistry(network)
    }
    const both = await handleMetaExchangeLookup(
      { network: 'robinhood', name: 'OKX', address: BITGET_HOT },
      { loadExchangeRegistry: counted }
    )
    expect(both).toMatchObject({
      isError: true,
      content: [{ text: 'Give a name or an address, not both.' }],
    })
    const short = await handleMetaExchangeLookup(
      { network: 'robinhood', address: '0xed9a' },
      { loadExchangeRegistry: counted }
    )
    expect(short.isError).toBe(true)
    expect(reads).toBe(0)
  })

  it('passes its arguments through the proxy', () => {
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['meta_exchange_lookup']).toEqual([
      'network',
      'name',
      'address',
    ])
    expect(PUBLIC_MCP_TOOL_ALLOWED_ARGS['aml_exchange_deposit_check']).toEqual([
      'network',
      'address',
    ])
  })

  it('both descriptions carry the opening rule and the exchange names a host triggers on', () => {
    for (const description of [
      META_EXCHANGE_LOOKUP_DESCRIPTION,
      AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION,
    ]) {
      expect(description).toContain(EXCHANGE_OPENING_RULE)
      for (const name of ['Binance', 'Bitget', 'Bybit', 'OKX']) expect(description).toContain(name)
    }
  })
})

type Batch = { network: string; queries: Array<{ id: string; query: string }> }

function deps(members: unknown[], sent: Batch[] = []): ExchangeDepositCheckDependencies {
  return {
    loadExchangeRegistry,
    graphQueryBatch: async (batch) => {
      sent.push(batch)
      return { structuredContent: { facts: { queries: members } } }
    },
    describeFailure: (err) => (err as Error).message,
  }
}

const check = async (members: unknown[], sent: Batch[] = []) => {
  const result = await handleAmlExchangeDepositCheck(
    { network: 'robinhood', address: DEPOSIT.toUpperCase().replace('0X', '0x') },
    deps(members, sent)
  )
  return {
    result,
    structured: result.structuredContent as unknown as AmlExchangeDepositCheckResult,
  }
}

const nodeMember = (row: Record<string, unknown> | null) => ({
  id: 'node',
  ok: true,
  results: row ? [row] : [],
})
const sweptMember = (rows: Record<string, unknown>[]) => ({ id: 'swept', ok: true, results: rows })

/** The four behaviour members, as the graph server answers a count read: one row each. */
const behaviourMembers = (counts: {
  payers: number
  payers_exchange: number
  receivers: number
  receivers_exchange: number
  dex_pools: number
  approvals: number
}) => [
  { id: 'paid_by', ok: true, results: [{ payers: counts.payers, payers_exchange: counts.payers_exchange }] },
  { id: 'paid', ok: true, results: [{ receivers: counts.receivers, receivers_exchange: counts.receivers_exchange }] },
  { id: 'swapped', ok: true, results: [{ dex_pools: counts.dex_pools }] },
  { id: 'approved', ok: true, results: [{ approvals: counts.approvals }] },
]

describe('aml_exchange_deposit_check', () => {
  it('sends one batch of six reads, all anchored on the lowercase address, every read bounded', async () => {
    const sent: Batch[] = []
    await check([nodeMember(null), sweptMember([])], sent)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.queries).toEqual(depositCheckQueries(DEPOSIT))
    expect(sent[0]!.queries.map((query) => query.id)).toEqual([
      'node',
      'swept',
      'paid_by',
      'paid',
      'swapped',
      'approved',
    ])
    for (const { query } of sent[0]!.queries) {
      expect(query.startsWith(`USE topology MATCH (a:Address {address: "${DEPOSIT}"})`)).toBe(true)
      expect(query).toMatch(/ LIMIT \d+$/)
    }
    expect(sent[0]!.queries[1]!.query).toContain('-[s:SWEPT]->(h:Address)')
    expect(sent[0]!.queries[0]!.query).toContain('a.cex_role AS cex_role')
  })

  it('a deposit names its exchange from the hot wallet it swept into, with the sweeps', async () => {
    const { result, structured } = await check([
      nodeMember({
        address: DEPOSIT,
        node_labels: ['Address', 'Exchange'],
        labels: ['Exchange', 'bitget'],
        cex_role: 'deposit',
      }),
      sweptMember([
        {
          hot_wallet: BITGET_HOT,
          hot_wallet_labels: ['Exchange', 'bitget'],
          hot_wallet_role: 'hot_wallet',
          sweep_count: 3,
          amount_usd_sum: 1250.5,
          paths: ['plain', 'gas_topped'],
          first_seen_timestamp: 1791000000000,
          last_seen_timestamp: 1791500000000,
        },
      ]),
    ])
    expect(result.isError).toBe(false)
    expect(structured).toMatchObject({
      found: true,
      is_deposit: true,
      cex_role: 'deposit',
      exchange: 'bitget',
      exchange_display: 'Bitget',
    })
    expect(structured.swept).toEqual([
      expect.objectContaining({
        hot_wallet: BITGET_HOT,
        hot_wallet_exchange: 'bitget',
        sweep_count: 3,
        paths: ['plain', 'gas_topped'],
        first_seen_utc: expect.stringMatching(/UTC/),
      }),
    ])
    expect(structured.hint).toContain(
      `Say: "${DEPOSIT} is a deposit address of Bitget on robinhood."`
    )
    expect(structured.hint).toContain(`It swept 3 times into the hot wallet ${BITGET_HOT}.`)
  })

  it('a deposit that swept into a hot wallet the file leaves out is named from the label words of that wallet', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: [], cex_role: 'deposit' }),
      sweptMember([
        {
          hot_wallet: '0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17',
          hot_wallet_labels: ['Exchange', 'bitget'],
          hot_wallet_role: 'hot_wallet',
          sweep_count: 1,
        },
      ]),
    ])
    expect(structured).toMatchObject({ is_deposit: true, exchange: 'bitget' })
    expect(structured.swept[0]).toMatchObject({ hot_wallet_exchange: 'bitget' })
    expect(structured.hint).toContain('is a deposit address of Bitget on robinhood.')
  })

  it('a hot wallet is an exchange wallet but no deposit', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: ['Exchange', 'gate'], cex_role: 'hot_wallet' }),
      sweptMember([]),
    ])
    expect(structured).toMatchObject({
      is_deposit: false,
      cex_role: 'hot_wallet',
      exchange: 'gate',
    })
    expect(structured.hint).toContain(
      'is a hot wallet of Gate on robinhood, not a deposit address.'
    )
  })

  it('an address with no mark says what the graph shows, and is no proof either way', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: [], cex_role: null }),
      sweptMember([]),
    ])
    expect(structured).toMatchObject({
      found: true,
      is_deposit: false,
      cex_role: null,
      exchange: null,
    })
    expect(structured.hint).toContain('carries no deposit mark: no SWEPT link and no cex_role')
    // A host that re-judges the address from its payers invents a rule.
    expect(structured.hint).toContain('set no threshold of your own')
    expect(structured.hint).not.toMatch(/not (covered|served|supported)|unsupported/i)
  })

  it('an unmarked address that trades and pays outsiders gets those two facts, and no threshold', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: [], cex_role: null }),
      sweptMember([]),
      ...behaviourMembers({ payers: 214, payers_exchange: 1, receivers: 57, receivers_exchange: 1, dex_pools: 291, approvals: 11 }),
    ])
    expect(structured.behaviour).toEqual({
      payers: 214,
      payers_exchange: 1,
      receivers: 57,
      receivers_exchange: 1,
      dex_pools: 291,
      approvals: 11,
      count_cap: 5000,
    })
    expect(structured.does_not_fit_deposit).toEqual([
      'it swapped on 291 DEX pools',
      'it paid 56 addresses that are no exchange wallet',
    ])
    expect(structured.hint).toContain(
      '214 addresses paid it (1 of them exchange wallets), it paid 57 addresses (1 of them exchange wallets), it swapped on 291 DEX pools, it approved 11 spenders'
    )
    expect(structured.hint).toContain('What a deposit address does not do, and this one did')
  })

  it('an unmarked address that pays only an exchange wallet has no misfit: the payer count is for the rule to judge', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: [], cex_role: null }),
      sweptMember([]),
      ...behaviourMembers({ payers: 24, payers_exchange: 0, receivers: 1, receivers_exchange: 1, dex_pools: 0, approvals: 0 }),
    ])
    expect(structured.is_deposit).toBe(false)
    expect(structured.does_not_fit_deposit).toEqual([])
    expect(structured.hint).toContain('Its counts alone rule nothing out; the missing mark does')
    expect(structured.hint).toContain('24 addresses paid it (0 of them exchange wallets)')
  })

  it('a deposit carries its counts and no misfit, whatever the counts are', async () => {
    const { structured } = await check([
      nodeMember({ address: DEPOSIT, labels: ['Exchange', 'gate'], cex_role: 'deposit' }),
      sweptMember([]),
      ...behaviourMembers({ payers: 2, payers_exchange: 1, receivers: 2, receivers_exchange: 1, dex_pools: 0, approvals: 1 }),
    ])
    expect(structured.is_deposit).toBe(true)
    expect(structured.behaviour?.receivers).toBe(2)
    expect(structured.does_not_fit_deposit).toEqual([])
    expect(structured.hint).toContain('2 addresses paid it (1 of them exchange wallets)')
  })

  it('a behaviour read that fails leaves its counts null and the check still answers', async () => {
    const { result, structured } = await check([
      nodeMember({ address: DEPOSIT, labels: [], cex_role: null }),
      sweptMember([]),
      { id: 'paid_by', ok: false, error: 'query_timeout' },
      { id: 'paid', ok: true, results: [{ receivers: 5000, receivers_exchange: 6 }] },
      { id: 'swapped', ok: true, results: [{ dex_pools: 5000 }] },
    ])
    expect(result.isError).toBe(false)
    expect(structured.behaviour).toMatchObject({ payers: null, approvals: null, dex_pools: 5000 })
    // A count at the cap is a floor, said as one.
    expect(structured.does_not_fit_deposit).toEqual([
      'it swapped on 5000 or more DEX pools',
      'it paid 4994 or more addresses that are no exchange wallet',
    ])
  })

  it('an address the graph does not hold is not found', async () => {
    const { structured } = await check([nodeMember(null), sweptMember([])])
    expect(structured.found).toBe(false)
    expect(structured.behaviour).toBeNull()
    expect(structured.hint).toContain('is not in the Chain Insights Graph of robinhood')
    expect(structured.hint).toContain('unproven on this network')
    // Every answer hands the host the profile, this one too: "how does a deposit behave" needs no activity.
    expect(structured.deposit_profile).toBe(EXCHANGE_DEPOSIT_BEHAVIOUR)
    expect(structured.hint).toContain('answer with deposit_profile')
    expect(AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION).toContain(EXCHANGE_DEPOSIT_BEHAVIOUR)
  })

  it('a failed read is an error, never "no deposit"', async () => {
    const { result } = await check([
      nodeMember(null),
      { id: 'swept', ok: false, error: 'query_timeout' },
    ])
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('query_timeout')
    expect(result.content[0]!.text).toContain('This is not "no deposit"')
  })

  it('refuses a name in place of an address, before any read', async () => {
    const sent: Batch[] = []
    const result = await handleAmlExchangeDepositCheck(
      { network: 'robinhood', address: 'Bitget' },
      deps([], sent)
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('call meta_exchange_lookup')
    expect(sent).toEqual([])
  })
})

// The exchange model's guess (graph sync layer `inferred`) rides on the node
// beside the sourced marks. A sourced mark always wins; a guess alone is
// answered as inferred, with the model version, and never as the verdict.
const MODEL = 'gnn_robinhood_2026-11-14-r3_exchange'
const WRITTEN = 1794000000000
const INFERRED_FIELDS = ['inferred', 'inferred_role', 'inferred_model', 'inferred_basis', 'inferred_at']

describe('aml_exchange_deposit_check: the exchange model inferred a role', () => {
  const cases: Array<{
    name: string
    node: Record<string, unknown>
    swept?: Record<string, unknown>[]
    inferred: null | {
      inferred_role: string
      inferred_basis: string
      inferred_model: string
      inferred_at: string | null
      says: string
    }
    sourced?: { is_deposit: boolean; cex_role: string | null; says: string }
  }> = [
    {
      name: 'sourced only',
      node: { address: DEPOSIT, labels: ['Exchange', 'gate'], cex_role: 'hot_wallet' },
      inferred: null,
      sourced: { is_deposit: false, cex_role: 'hot_wallet', says: 'is a hot wallet of Gate on robinhood' },
    },
    {
      name: 'a deposit behind a listed hot wallet (rule)',
      node: {
        address: DEPOSIT,
        labels: [],
        cex_role: null,
        inferred_exchange_role: 'deposit',
        inferred_sources: ['ml:infrastructure:v7:hub', `ml:exchange-roles:${MODEL}:rule`],
        inferred_exchange_role_updated_timestamp: WRITTEN,
      },
      inferred: {
        inferred_role: 'deposit',
        inferred_basis: 'listed_hot_wallet',
        inferred_model: MODEL,
        inferred_at: new Date(WRITTEN).toISOString(),
        says: `is an exchange deposit, inferred by model ${MODEL}, on robinhood.`,
      },
    },
    {
      name: 'a deposit behind a hot wallet the model inferred (rule-p)',
      node: {
        address: DEPOSIT,
        inferred_exchange_role: 'deposit',
        inferred_sources: [`ml:exchange-roles:${MODEL}:rule-p`],
      },
      inferred: {
        inferred_role: 'deposit',
        inferred_basis: 'predicted_hot_wallet',
        inferred_model: MODEL,
        inferred_at: null,
        says: `is an exchange deposit, inferred by model ${MODEL}, on robinhood.`,
      },
    },
    {
      name: 'a hot wallet the model inferred (p-hub)',
      node: {
        address: DEPOSIT,
        inferred_exchange_role: 'hot_wallet',
        inferred_sources: [`ml:exchange-roles:${MODEL}:p-hub`],
        inferred_exchange_role_updated_timestamp: WRITTEN,
      },
      inferred: {
        inferred_role: 'hot_wallet',
        inferred_basis: 'predicted',
        inferred_model: MODEL,
        inferred_at: new Date(WRITTEN).toISOString(),
        says: `is an exchange hot wallet, inferred by model ${MODEL}, on robinhood.`,
      },
    },
    {
      name: 'a sourced deposit with a guess too: the sourced mark wins',
      node: {
        address: DEPOSIT,
        labels: ['Exchange', 'bitget'],
        cex_role: 'deposit',
        inferred_exchange_role: 'hot_wallet',
        inferred_sources: [`ml:exchange-roles:${MODEL}:p-hub`],
      },
      swept: [{ hot_wallet: BITGET_HOT, hot_wallet_labels: ['Exchange', 'bitget'], sweep_count: 2 }],
      inferred: null,
      sourced: { is_deposit: true, cex_role: 'deposit', says: 'is a deposit address of Bitget on robinhood.' },
    },
    {
      name: 'a role with no entry of the exchange model is no inferred mark',
      node: {
        address: DEPOSIT,
        labels: [],
        inferred_exchange_role: 'deposit',
        inferred_sources: ['ml:infrastructure:v7:hub'],
      },
      inferred: null,
      sourced: { is_deposit: false, cex_role: null, says: 'carries no deposit mark' },
    },
  ]

  it.each(cases)('$name', async ({ node, swept, inferred, sourced }) => {
    const { result, structured } = await check([nodeMember(node), sweptMember(swept ?? [])])
    const text = result.content[0]!.text
    expect(result.isError).toBe(false)
    expect(structured.found).toBe(true)
    expect(text).not.toMatch(/unknown|not supported|unsupported|PREDICTED/)
    if (inferred) {
      const { says, ...fields } = inferred
      expect(structured).toMatchObject({ ...fields, inferred: true, is_deposit: false, cex_role: null })
      expect(structured.hint).toContain(`Say: "${DEPOSIT} ${says}`)
      expect(structured.hint).toContain('No listed source names it as an exchange address.')
      expect(structured.hint).toContain('never as a confirmed exchange address')
      expect(text).toContain('inferred')
      expect(text).toContain(MODEL)
    } else {
      for (const field of INFERRED_FIELDS) expect(structured).not.toHaveProperty(field)
      expect(structured).toMatchObject({ is_deposit: sourced!.is_deposit, cex_role: sourced!.cex_role })
      expect(structured.hint).toContain(sourced!.says)
      expect(text).not.toMatch(/inferred/i)
      expect(text).not.toContain(MODEL)
    }
  })

  it('reads the model version whole, hyphens, underscores and colons kept, and takes the entry that fits the role', async () => {
    const model = 'gnn_base_2026-12-01-r10_exchange:cpu'
    const { structured } = await check([
      nodeMember({
        address: DEPOSIT,
        inferred_exchange_role: 'hot_wallet',
        inferred_sources: [`ml:exchange-roles:${MODEL}:rule`, `ml:exchange-roles:${model}:p-hub`],
      }),
      sweptMember([]),
    ])
    expect(structured).toMatchObject({ inferred_model: model, inferred_basis: 'predicted' })
  })

  it('the description and the skill tell every host to report a guess as inferred', () => {
    expect(AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION).toContain(EXCHANGE_INFERRED_RULE)
    const skill = readFileSync(
      join(repoRoot, 'skills', 'chain-insights-aml-exchange', 'SKILL.md'),
      'utf8'
    )
    expect(skill.replace(/\s+/g, ' ')).toContain(EXCHANGE_INFERRED_RULE)
  })
})
