#!/usr/bin/env node
// Pins the facts read contract of the graph server into
// tests/fixtures/facts-contract.json, so the skills can state its numbers and a
// test can hold them to the server.
//
//   node scripts/pin-facts-contract.mjs --shapes <read-shapes.json> --limits <readspec.go>
//       writes tests/fixtures/facts-contract.json (or the file named by --out)
//   node scripts/pin-facts-contract.mjs --shapes ... --limits ... --check <file>
//       prints nothing and exits 0 when <file> is what a fresh pin gives,
//       otherwise names the difference on stderr and exits 1
//
// The two inputs are the server's own files, read from its main branch:
//
//   --shapes  the list of read shapes. Its "refusals" are the reads the contract
//             refuses, each with the code and the rule it must get. Its "shapes"
//             give the anchors the contract admits.
//   --limits  the Go file that holds the contract numbers (defaultWindowDays,
//             defaultRowCap, defaultMaxHops) and the list of the six codes of the
//             contract (ContractCodes).
//
// The output keeps the numbers, the anchors, the codes and each refusal with its
// query rendered with the values of its own fixture. It drops the list's "note"
// and "fixture" fields, so no path of the server's own repository is copied.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_OUT = join(repoRoot, 'tests/fixtures/facts-contract.json')

function fail(message) {
  console.error(`pin-facts-contract: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (!['--shapes', '--limits', '--check', '--out'].includes(flag))
      fail(`unknown argument ${flag}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a file`)
    args[flag.slice(2)] = value
    i += 1
  }
  if (!args.shapes || !args.limits) fail('--shapes <file> and --limits <file> are required')
  return args
}

function constants(source) {
  const found = new Map()
  for (const match of source.matchAll(/^\s*(?:const\s+)?(\w+)\s*=\s*"([a-z_]+)"\s*$/gm)) {
    found.set(match[1], match[2])
  }
  return found
}

function numberOf(source, name) {
  const match = new RegExp(String.raw`^\s*${name}\s*=\s*(\d+)\s*$`, 'm').exec(source)
  if (!match) fail(`${name} is not set in the limits file`)
  return Number(match[1])
}

function contractCodes(source) {
  const body = /func ContractCodes\(\) \[\]string \{\s*return \[\]string\{([^}]*)\}/.exec(source)
  if (!body) fail('ContractCodes is not in the limits file')
  const names = new Map(constants(source))
  return body[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const code = names.get(name)
      if (!code) fail(`ContractCodes names ${name}, which the limits file does not define`)
      return code
    })
}

function render(cypher, fixture, id) {
  return cypher.replace(/\{\{(\w+)\}\}/g, (_all, name) => {
    const value = fixture?.[name]
    if (typeof value !== 'string') fail(`${id}: the fixture holds no value for {{${name}}}`)
    return value
  })
}

export function pinFactsContract(shapesText, limitsText) {
  const list = JSON.parse(shapesText)
  if (!Array.isArray(list.refusals) || !Array.isArray(list.shapes)) {
    fail('the shapes file holds no "shapes" and "refusals"')
  }
  const codes = contractCodes(limitsText)
  const refusals = list.refusals.map((refusal) => {
    if (!codes.includes(refusal.code)) {
      fail(`${refusal.id}: the code ${refusal.code} is not one of the codes of the contract`)
    }
    return {
      id: refusal.id,
      code: refusal.code,
      rule: refusal.rule,
      relationship: refusal.relationship ?? '',
      query: render(refusal.cypher, refusal.fixture, refusal.id),
    }
  })
  return {
    source: 'graph server facts read contract',
    window_days: numberOf(limitsText, 'defaultWindowDays'),
    row_cap: numberOf(limitsText, 'defaultRowCap'),
    max_hops: numberOf(limitsText, 'defaultMaxHops'),
    caller_sort: !refusals.some((refusal) => refusal.code === 'facts_order_not_served'),
    anchors: [...new Set(list.shapes.map((shape) => shape.anchor))].sort(),
    codes,
    refusals,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const pinned = `${JSON.stringify(
    pinFactsContract(readFileSync(args.shapes, 'utf8'), readFileSync(args.limits, 'utf8')),
    null,
    2
  )}\n`
  if (args.check) {
    const committed = readFileSync(args.check, 'utf8')
    if (committed !== pinned) {
      fail(
        `${args.check} differs from the pin of the server's files: run this script without --check`
      )
    }
    return
  }
  const out = args.out ?? DEFAULT_OUT
  writeFileSync(out, pinned)
  console.log(`wrote ${out}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
