import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AML_EXCHANGE_DEPOSIT_CHECK_DESCRIPTION,
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
// batch of two reads anchored on the address and names the exchange from the
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

describe('aml_exchange_deposit_check', () => {
  it('sends one batch of two reads, both anchored on the lowercase address, the SWEPT read bounded', async () => {
    const sent: Batch[] = []
    await check([nodeMember(null), sweptMember([])], sent)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.queries).toEqual(depositCheckQueries(DEPOSIT))
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
    expect(structured.hint).not.toMatch(/not (covered|served|supported)|unsupported/i)
  })

  it('an address the graph does not hold is not found', async () => {
    const { structured } = await check([nodeMember(null), sweptMember([])])
    expect(structured.found).toBe(false)
    expect(structured.hint).toContain('is not in the Chain Insights Graph of robinhood')
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
