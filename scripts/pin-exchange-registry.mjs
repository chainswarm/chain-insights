#!/usr/bin/env node
// Writes the served exchange lookup file registry/exchanges/<network>.json from
// a proven wallet list: one entry per centralized exchange, each wallet with
// its role, the proof the chain gave and the block it was proven at.
//
//   node scripts/pin-exchange-registry.mjs <wallets.json> [--write] [--recorded-on YYYY-MM-DD]
//
// The input is {network, version, exchanges: [{id, wallets: [{address, role,
// evidence, proven_at_block}]}]}. Only proven wallets are in it, so only served
// exchanges are listed. The display name and the aliases of an exchange are
// kept from the file already served, or taken from DISPLAY below for a new one.
// With no --write the script prints the file and exits 1 when the served copy
// differs. tests/exchange-registry.test.ts holds every served file to the rules.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = 'chain-insights.exchange-registry.v1'
const ROLES = new Set(['hot_wallet', 'gas_wallet', 'spender'])
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// The name a user writes, and the other spellings, for an exchange id seen for
// the first time. An id missing here gets its id as its display name.
const DISPLAY = {
  binance: ['Binance', ['binance']],
  bitfinex: ['Bitfinex', ['bitfinex']],
  bitget: ['Bitget', ['bitget']],
  bitstamp: ['Bitstamp', ['bitstamp']],
  bybit: ['Bybit', ['bybit']],
  coinbase: ['Coinbase', ['coinbase']],
  'crypto-com': ['Crypto.com', ['crypto.com', 'cryptocom']],
  gate: ['Gate', ['gate', 'gate.io', 'gateio']],
  htx: ['HTX', ['htx', 'huobi']],
  kraken: ['Kraken', ['kraken']],
  kucoin: ['KuCoin', ['kucoin']],
  mexc: ['MEXC', ['mexc']],
  okx: ['OKX', ['okx', 'okex']],
  upbit: ['Upbit', ['upbit']],
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
    const wallets = exchange.wallets.map((wallet) => {
      if (!ROLES.has(wallet.role))
        throw new Error(`${exchange.id}: role ${wallet.role} is not served`)
      return {
        address: wallet.address.toLowerCase(),
        role: wallet.role,
        evidence: wallet.evidence,
        proven_at_block: wallet.proven_at_block,
      }
    })
    const before = known.get(exchange.id)
    const [display, aliases] = before
      ? [before.display, before.aliases]
      : (DISPLAY[exchange.id] ?? [exchange.id, [exchange.id]])
    return { exchange: exchange.id, display, aliases, wallets }
  })
  .filter((row) => row.wallets.some((wallet) => wallet.role === 'hot_wallet'))

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
