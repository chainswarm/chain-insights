#!/usr/bin/env node
// Pins the chain lookup catalogue of the graph server into
// tests/fixtures/chain-catalogue.json, so a test can hold every `USE chain`
// recipe and the chain routing line to the labels the chain layer really serves.
//
//   node scripts/pin-chain-catalogue.mjs --catalogue <chain_catalogue.json> --commit <sha>
//       writes tests/fixtures/chain-catalogue.json (or the file named by --out)
//   node scripts/pin-chain-catalogue.mjs --catalogue ... --commit <sha> --check <file>
//       prints nothing and exits 0 when <file> is what a fresh pin gives,
//       otherwise names the difference on stderr and exits 1
//
// The input is the server's own catalogue, read from its main branch. The output
// keeps the grammar, and each label with the keys it takes and the properties it
// serves. It drops every locator, source and derivation field, so no internal
// node call or private path is copied.
//
// Why this pin exists: the catalogue serves three labels, `Transaction`, `Block`
// and `Head`. It has no address lookup. A routing line that offered one sent an
// agent to a `chain_not_served` refusal, and nothing in the package caught it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_OUT = join(repoRoot, 'tests/fixtures/chain-catalogue.json')

function fail(message) {
  console.error(`pin-chain-catalogue: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (!['--catalogue', '--commit', '--check', '--out'].includes(flag))
      fail(`unknown argument ${flag}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`)
    args[flag.slice(2)] = value
    i += 1
  }
  if (!args.catalogue || !args.commit) fail('--catalogue <file> and --commit <sha> are required')
  return args
}

export function pinChainCatalogue(catalogueText, commit) {
  const catalogue = JSON.parse(catalogueText)
  const labels = catalogue.labels
  if (!labels || typeof labels !== 'object') fail('the catalogue holds no "labels"')
  return {
    source: 'graph server chain lookup catalogue',
    server_commit: commit,
    rules_version: catalogue.rules_version ?? '',
    grammar: catalogue.grammar ?? '',
    labels: Object.entries(labels).map(([label, entry]) => {
      if (!entry.properties) fail(`${label}: the catalogue names no properties`)
      return {
        label,
        answers: entry.answers ?? '',
        keys: Object.keys(entry.keys ?? {}).sort(),
        key_rule: entry.key_rule ?? '',
        properties: Object.keys(entry.properties).sort(),
      }
    }),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const pinned = `${JSON.stringify(
    pinChainCatalogue(readFileSync(args.catalogue, 'utf8'), args.commit),
    null,
    2
  )}\n`
  if (args.check) {
    const committed = readFileSync(args.check, 'utf8')
    if (committed !== pinned) {
      fail(
        `${args.check} differs from the pin of the server's catalogue: run this script without --check`
      )
    }
    return
  }
  const out = args.out ?? DEFAULT_OUT
  writeFileSync(out, pinned)
  console.log(`wrote ${out}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
