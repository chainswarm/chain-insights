#!/usr/bin/env node
// Writes the served exchange lookup file registry/exchanges/<network>.json from
// the indexer-evm-cex registry of that network: one entry per centralized
// exchange, and under it only the wallets proven on that network's own data.
//
//   node scripts/pin-exchange-registry.mjs <wallets.json> [--write] [--recorded-on YYYY-MM-DD]
//
// The input is {network, version, exchanges: [{id, wallets: [{address, role,
// evidence, proven_at_block}]}]}, the file registry/<network>.json of
// indexer-evm-cex. Every exchange is kept, with its id, its display name and
// its aliases, so a user's word still finds it. A wallet is kept only when
// proven_at_block is above 0: a payer proof pinned at a block of this chain.
// A wallet with proven_at_block 0 (an exchange tag, or a wallet of another
// chain at the same address) stays in the indexer's registry and in the graph,
// never in the public file. An exchange may so list no wallet: its deposits
// and hot wallets are still read from the graph.
//
// The display name and the aliases of an exchange are kept from the file
// already served, or taken from DISPLAY below for a new one. With no --write
// the script prints the file and exits 1 when the served copy differs.
// tests/exchange-registry.test.ts holds every served file to the rules.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = 'chain-insights.exchange-registry.v1'
const ROLES = new Set(['hot_wallet', 'gas_wallet', 'spender'])
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// The name a user writes, and the other spellings, for an exchange id seen for
// the first time. An id missing here gets its id as its display name.
const DISPLAY = {
  azbit: ['Azbit', ['azbit']],
  biconomy: ['Biconomy', ['biconomy', 'biconomy.com']],
  bigone: ['BigONE', ['bigone']],
  binance: ['Binance', ['binance']],
  bingx: ['BingX', ['bingx']],
  bitbank: ['bitbank', ['bitbank']],
  bitfinex: ['Bitfinex', ['bitfinex']],
  bitflyer: ['bitFlyer', ['bitflyer']],
  bitget: ['Bitget', ['bitget']],
  bithumb: ['Bithumb', ['bithumb']],
  bitkub: ['Bitkub', ['bitkub']],
  bitrue: ['Bitrue', ['bitrue']],
  bitstamp: ['Bitstamp', ['bitstamp']],
  bitunix: ['Bitunix', ['bitunix']],
  bitvavo: ['Bitvavo', ['bitvavo']],
  blofin: ['BloFin', ['blofin']],
  btcturk: ['BtcTurk', ['btcturk']],
  btse: ['BTSE', ['btse']],
  bullish: ['Bullish', ['bullish']],
  bybit: ['Bybit', ['bybit']],
  bydfi: ['BYDFi', ['bydfi']],
  'cex-io': ['CEX.IO', ['cex-io', 'cex.io', 'cexio']],
  coinbase: ['Coinbase', ['coinbase']],
  coincheck: ['Coincheck', ['coincheck']],
  coinone: ['Coinone', ['coinone']],
  coinstore: ['Coinstore', ['coinstore']],
  coinw: ['CoinW', ['coinw']],
  'crypto-com': ['Crypto.com', ['crypto-com', 'crypto.com', 'cryptocom']],
  'dex-trade': ['Dex-Trade', ['dex-trade', 'dextrade']],
  digifinex: ['DigiFinex', ['digifinex']],
  exmo: ['EXMO', ['exmo']],
  gate: ['Gate', ['gate', 'gate.io', 'gateio']],
  gemini: ['Gemini', ['gemini']],
  hashkey: ['HashKey', ['hashkey', 'hashkey global']],
  hibt: ['HIBT', ['hibt']],
  hitbtc: ['HitBTC', ['hitbtc']],
  hotcoin: ['Hotcoin', ['hotcoin']],
  htx: ['HTX', ['htx', 'huobi']],
  indodax: ['Indodax', ['indodax']],
  kraken: ['Kraken', ['kraken']],
  kucoin: ['KuCoin', ['kucoin']],
  lbank: ['LBank', ['lbank']],
  mexc: ['MEXC', ['mexc']],
  okx: ['OKX', ['okx', 'okex']],
  orangex: ['OrangeX', ['orangex']],
  ourbit: ['Ourbit', ['ourbit']],
  p2b: ['P2B', ['p2b', 'p2pb2b']],
  paribu: ['Paribu', ['paribu']],
  phemex: ['Phemex', ['phemex']],
  pionex: ['Pionex', ['pionex']],
  poloniex: ['Poloniex', ['poloniex']],
  tapbit: ['Tapbit', ['tapbit']],
  toobit: ['Toobit', ['toobit']],
  tothemoon: ['ToTheMoon', ['tothemoon']],
  upbit: ['Upbit', ['upbit']],
  weex: ['WEEX', ['weex']],
  zoomex: ['Zoomex', ['zoomex']],
}

const args = process.argv.slice(2)
const write = args.includes('--write')
const dayAt = args.indexOf('--recorded-on')
const recordedOn = dayAt >= 0 ? args[dayAt + 1] : new Date().toISOString().slice(0, 10)
const input = args.find((arg, at) => !arg.startsWith('--') && at !== dayAt + 1)
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(recordedOn ?? '')) {
  console.error(
    'usage: pin-exchange-registry.mjs <wallets.json> [--write] [--recorded-on YYYY-MM-DD]'
  )
  process.exit(2)
}

const source = JSON.parse(readFileSync(input, 'utf8'))
const network = String(source.network ?? '')
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(network))
  throw new Error(`network ${network} is not an identifier`)
const target = join(root, 'registry', 'exchanges', `${network}.json`)
const served = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : { rows: [] }
const known = new Map(served.rows.map((row) => [row.exchange, row]))

const rows = [...source.exchanges]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((exchange) => {
    const wallets = exchange.wallets.flatMap((wallet) => {
      if (!ROLES.has(wallet.role))
        throw new Error(`${exchange.id}: role ${wallet.role} is not served`)
      if (!Number.isInteger(wallet.proven_at_block) || wallet.proven_at_block < 0)
        throw new Error(`${exchange.id}: ${wallet.address} proven_at_block is not a block or 0`)
      // Only a wallet proven on this chain's own data is public.
      if (wallet.proven_at_block === 0) return []
      return [
        {
          address: wallet.address.toLowerCase(),
          role: wallet.role,
          evidence: wallet.evidence,
          proven_at_block: wallet.proven_at_block,
        },
      ]
    })
    const before = known.get(exchange.id)
    const [display, aliases] = before
      ? [before.display, before.aliases]
      : (DISPLAY[exchange.id] ?? [exchange.id, [exchange.id]])
    return { exchange: exchange.id, display, aliases, wallets }
  })

const document = {
  schema: SCHEMA,
  network,
  registry_version: source.version,
  recorded_on: recordedOn,
  rows,
}
const text = JSON.stringify(document, null, 2) + '\n'
if (write) {
  writeFileSync(target, text)
  console.log(`wrote ${target}: ${rows.length} exchanges`)
} else {
  const now = existsSync(target) ? readFileSync(target, 'utf8') : ''
  process.stdout.write(text)
  if (now !== text) {
    console.error(`${target} differs; run with --write`)
    process.exit(1)
  }
}
