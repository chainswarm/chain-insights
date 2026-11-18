#!/usr/bin/env node
// Records the real tool answers the plugin evals replay.
//
// An eval case calls aml_exchange_deposit_check for real; a stand-in answers
// with the file this script wrote. So the answers the model reads are the ones
// a Chain Insights Graph endpoint gave, never hand-written ones.
//
//   npm run build
//   node scripts/record-eval-fixtures.mjs
//
// It runs the built CLI (`cia mcp call --json aml_exchange_deposit_check ...`)
// with your own Chain Insights Graph access, once per address of
// plugin/evals/datasets/aml-exchange-check.json (its rows and `also_record`),
// and writes plugin/evals/mocks/chain-insights/fixtures/deposit-check/<address>.json.
//
// An address the dataset writes in mixed case gets a copy under that spelling,
// because the stand-in picks the file by the argument the model sent.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DATASET_FILE = join('plugin', 'evals', 'datasets', 'aml-exchange-check.json')
export const FIXTURES_DIR = join('plugin', 'evals', 'mocks', 'chain-insights', 'fixtures')

/** The file names one address is recorded under: lowercase, and as the dataset spells it. */
export function addressSpellings(address) {
  return [...new Set([address.toLowerCase(), address])]
}

function call(tool, args) {
  const text = execFileSync(
    process.execPath,
    [join(root, 'bin', 'cli.js'), 'mcp', 'call', '--json', tool, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
  JSON.parse(text) // a recorded answer is JSON, or the run stops here
  return text.endsWith('\n') ? text : `${text}\n`
}

function main() {
  const dataset = JSON.parse(readFileSync(join(root, DATASET_FILE), 'utf8'))
  const depositDir = join(root, FIXTURES_DIR, 'deposit-check')
  mkdirSync(depositDir, { recursive: true })

  // `also_record` lists the addresses of hand-written cases outside the dataset.
  const addresses = [...dataset.rows.map((row) => row.address), ...(dataset.also_record ?? [])]
  for (const written of addresses) {
    const address = written.toLowerCase()
    const check = call('aml_exchange_deposit_check', [
      `network=${dataset.network}`,
      `address=${address}`,
    ])
    for (const spelling of addressSpellings(written)) {
      writeFileSync(join(depositDir, `${spelling}.json`), check)
    }
    console.log(`recorded ${address}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
