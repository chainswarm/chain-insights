import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEX_REGISTRY_TTL_MS } from '../src/mcp/dex-registry.js'
import {
  EXCHANGE_REGISTRY_SCHEMA,
  exchangeOfLabels,
  exchangeOfWallet,
  exchangeRegistryCachePath,
  exchangeRegistryFault,
  exchangeRegistryUrl,
  loadExchangeRegistry,
  matchExchange,
  type ExchangeRegistryDocument,
} from '../src/mcp/exchange-registry.js'
import { repoRoot } from './dex-registry.js'

// The centralized exchange lookup: registry/exchanges/<network>.json lists every
// exchange of the indexer-evm-cex registry, and under it only the wallets proven
// on that chain's own data (proven_at_block above 0). Every served file holds to the
// rules, the pin script rewrites it unchanged, the name and the address lookups
// find the right exchange, and the loader takes the public file, then the cache,
// then the packaged copy. HOME points at a fresh directory: the cache is this
// test's own.

const dir = join(repoRoot, 'registry', 'exchanges')
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
const read = (network: string) =>
  JSON.parse(readFileSync(join(dir, `${network}.json`), 'utf8')) as ExchangeRegistryDocument

describe('the served exchange lookup files', () => {
  it('serve ethereum and robinhood', () => {
    expect(files).toEqual(['ethereum.json', 'robinhood.json'])
  })

  for (const file of files) {
    const network = file.replace(/\.json$/, '')
    it(`${file} holds to the rules: one id per exchange, only wallets proven on this chain, each with its evidence`, () => {
      const document = read(network)
      expect(exchangeRegistryFault(document, network)).toBeNull()
      expect(document.schema).toBe(EXCHANGE_REGISTRY_SCHEMA)
      for (const row of document.rows) {
        for (const wallet of row.wallets) {
          expect(wallet.evidence.trim(), `${row.exchange} ${wallet.address}`).not.toBe('')
          expect(wallet.proven_at_block).toBeGreaterThan(0)
        }
      }
      // Nothing a reader sees says an exchange is missing: the file lists served exchanges only.
      expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(/not served|unsupported|unknown/i)
    })
  }

  it('robinhood lists seven exchanges and the three hot wallets proven on robinhood', () => {
    const document = read('robinhood')
    expect(document.rows.map((row) => [row.exchange, row.wallets.length])).toEqual([
      ['bitget', 1],
      ['bitrue', 0],
      ['bitunix', 0],
      ['blofin', 0],
      ['bybit', 1],
      ['gate', 1],
      ['pionex', 0],
    ])
    const gate = document.rows.find((row) => row.exchange === 'gate')!
    expect(gate.wallets[0]).toMatchObject({
      address: '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
      role: 'hot_wallet',
      proven_at_block: 108803217,
    })
    // A wallet carried from ethereum at the same address stays in the indexer's
    // registry and in the graph, never in the public file.
    const listed = document.rows.flatMap((row) => row.wallets.map((wallet) => wallet.address))
    expect(listed).not.toContain('0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17')
  })

  it('ethereum lists 57 exchanges, 72 proven wallets, binance with 4 hot wallets and one gas wallet', () => {
    const document = read('ethereum')
    expect(document.registry_version).toBe(2)
    expect(document.rows).toHaveLength(57)
    expect(document.rows.flatMap((row) => row.wallets)).toHaveLength(72)
    expect(document.rows.filter((row) => row.wallets.length > 0)).toHaveLength(12)
    const binance = document.rows.find((row) => row.exchange === 'binance')!
    expect(binance.wallets.filter((w) => w.role === 'hot_wallet')).toHaveLength(4)
    expect(binance.wallets.filter((w) => w.role === 'gas_wallet').map((w) => w.address)).toEqual([
      '0x9430801ebaf509ad49202aabc5f5bc6fd8a3daf8',
    ])
    // A new id gets the name a user writes, from the pin script.
    expect(document.rows.find((row) => row.exchange === 'crypto-com')?.display).toBe('Crypto.com')
  })

  it('the pin script rewrites a file from its own wallets unchanged', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'exchange-pin-'))
    try {
      for (const file of files) {
        const document = read(file.replace(/\.json$/, ''))
        const source = join(scratch, file)
        writeFileSync(
          source,
          JSON.stringify({
            network: document.network,
            version: document.registry_version,
            exchanges: document.rows.map((row) => ({ id: row.exchange, wallets: row.wallets })),
          })
        )
        // No --write: exit 0 only when the served copy equals the output.
        execFileSync(
          'node',
          ['scripts/pin-exchange-registry.mjs', source, '--recorded-on', document.recorded_on],
          { cwd: repoRoot, stdio: 'pipe' }
        )
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('the pin script leaves out a wallet with no block and keeps its exchange', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'exchange-pin-'))
    try {
      const document = read('robinhood')
      const source = join(scratch, 'robinhood.json')
      const tagged = {
        address: '0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17',
        role: 'hot_wallet',
        evidence: 'ethereum registry wallet, same address; 6 clean payers on robinhood',
        proven_at_block: 0,
      }
      writeFileSync(
        source,
        JSON.stringify({
          network: document.network,
          version: document.registry_version,
          exchanges: document.rows.map((row) => ({
            id: row.exchange,
            wallets: row.exchange === 'bitget' ? [...row.wallets, tagged] : row.wallets,
          })),
        })
      )
      // Exit 0: the output, with the tagged wallet left out, is the served copy.
      const out = execFileSync(
        'node',
        ['scripts/pin-exchange-registry.mjs', source, '--recorded-on', document.recorded_on],
        { cwd: repoRoot, stdio: 'pipe' }
      ).toString()
      expect(out).not.toContain(tagged.address)
      expect((JSON.parse(out) as ExchangeRegistryDocument).rows).toHaveLength(7)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('refuses a wallet listed for two exchanges, a role it does not know, and a wallet with no block', () => {
    const document = read('robinhood')
    const twice = structuredClone(document)
    twice.rows[1]!.wallets.push({ ...twice.rows[0]!.wallets[0]! })
    expect(exchangeRegistryFault(twice, 'robinhood')).toMatch(/is also a wallet of bitget/)
    const role = structuredClone(document) as unknown as {
      rows: Array<{ wallets: Array<{ role: string }> }>
    }
    role.rows[0]!.wallets[0]!.role = 'deposit'
    expect(exchangeRegistryFault(role, 'robinhood')).toMatch(/role deposit is not/)
    const tagged = structuredClone(document)
    tagged.rows[0]!.wallets[0]!.proven_at_block = 0
    expect(exchangeRegistryFault(tagged, 'robinhood')).toMatch(
      /proven_at_block is not a block above 0/
    )
    expect(exchangeRegistryFault(document, 'ethereum')).toMatch(/network is "robinhood"/)
  })
})

describe('the name and the address lookups', () => {
  const rows = read('ethereum').rows

  it.each([
    ['OKX', 'okx', undefined],
    ['okex', 'okx', undefined],
    ['gate.io', 'gate', undefined],
    ['Kucoin', 'kucoin', undefined],
    ['binanse', 'binance', 'binanse'],
    ['coinbas', 'coinbase', 'coinbas'],
  ])('%s is %s', (name, exchange, tookFor) => {
    const match = matchExchange(name, rows)
    expect(match.matched?.exchange).toBe(exchange)
    expect(match.took_for).toBe(tookFor)
  })

  it('a name that fits none matches nothing and lists the exchanges of the file', () => {
    const match = matchExchange('Deribit', rows)
    expect(match.matched).toBeNull()
    expect(match.candidates).toEqual([])
    expect(match.listed).toHaveLength(57)
    expect(match.listed).toContain('Kraken')
  })

  it('a wallet address names its exchange and its role; a label word names its exchange', () => {
    expect(exchangeOfWallet('0x9430801ebaf509ad49202aabc5f5bc6fd8a3daf8', rows)).toMatchObject({
      entry: { exchange: 'binance' },
      wallet: { role: 'gas_wallet' },
    })
    expect(exchangeOfWallet('0x0000000000000000000000000000000000000001', rows)).toBeNull()
    expect(exchangeOfLabels(['Exchange', 'bitget'], rows)?.exchange).toBe('bitget')
    expect(exchangeOfLabels(['Exchange'], rows)).toBeNull()
  })
})

describe('loadExchangeRegistry', () => {
  const savedHome = process.env['HOME']
  let home = ''
  const lines: string[] = []
  const log = (line: string) => lines.push(line)
  const packaged = readFileSync(join(dir, 'robinhood.json'), 'utf8')
  const answering = (body: string, status = 200) => {
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(body, { status })
    }) as typeof fetch
    return { calls, fetchImpl }
  }
  const offline = (async () => {
    throw new Error('connect ECONNREFUSED')
  }) as typeof fetch

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'exchange-registry-home-'))
    process.env['HOME'] = home
    lines.length = 0
  })
  afterEach(() => {
    process.env['HOME'] = savedHome
    rmSync(home, { recursive: true, force: true })
  })

  it('reads the public file on main, then answers from the cache for an hour', async () => {
    expect(exchangeRegistryUrl('robinhood', {})).toBe(
      'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/exchanges/robinhood.json'
    )
    const { calls, fetchImpl } = answering(packaged)
    const first = await loadExchangeRegistry('robinhood', {
      fetch: fetchImpl,
      log,
      now: () => 1_000,
    })
    expect(first.source).toBe('fetched')
    expect(calls).toHaveLength(1)
    expect(exchangeRegistryCachePath('robinhood').startsWith(home)).toBe(true)
    const again = await loadExchangeRegistry('robinhood', {
      fetch: fetchImpl,
      log,
      now: () => 1_000 + DEX_REGISTRY_TTL_MS - 1,
    })
    expect(again.source).toBe('cached')
    expect(calls).toHaveLength(1)
  })

  it('falls back to the packaged copy offline, and never takes a malformed public file', async () => {
    const down = await loadExchangeRegistry('robinhood', { fetch: offline, log })
    expect(down.source).toBe('packaged')
    expect(down.document.rows.map((row) => row.exchange)).toEqual([
      'bitget',
      'bitrue',
      'bitunix',
      'blofin',
      'bybit',
      'gate',
      'pionex',
    ])
    expect(lines.join('\n')).toContain('unreachable')

    rmSync(home, { recursive: true, force: true })
    const { fetchImpl } = answering(JSON.stringify({ schema: 'other' }))
    const bad = await loadExchangeRegistry('robinhood', { fetch: fetchImpl, log })
    expect(bad.source).toBe('packaged')
    expect(lines.join('\n')).toContain('is malformed')
  })

  it('answers a network with no file anywhere with no rows, and never throws', async () => {
    const { fetchImpl } = answering('', 404)
    const loaded = await loadExchangeRegistry('base', { fetch: fetchImpl, log })
    expect(loaded.source).toBe('none')
    expect(loaded.document.rows).toEqual([])
  })
})
