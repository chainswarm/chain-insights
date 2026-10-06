#!/usr/bin/env node
// Pins the columns of the facts relationships of the graph server into
// tests/fixtures/facts-columns.json, so a test can hold the skills, the docs and
// the served hints to what a facts row really carries.
//
//   node scripts/pin-facts-columns.mjs --mapping <mapping.json> --commit <sha>
//       writes tests/fixtures/facts-columns.json (or the file named by --out)
//   node scripts/pin-facts-columns.mjs --mapping ... --commit <sha> --check <file>
//       prints nothing and exits 0 when <file> is what a fresh pin gives,
//       otherwise names the difference on stderr and exits 1
//
// The input is the server's own mapping of graph labels and relationships to its
// views, read from its main branch. The output keeps each relationship and the
// names of the properties it serves, in the server's order. It drops every view,
// column, key and filter, so no table name or private path is copied.
//
// Why this pin exists: the swap route (a list of pools and a list of families)
// left the facts `SWAP` row, and an internal transfer became a `TRANSFER` row
// marked by a `kind`. A text that still listed the route columns, or that said no
// read lists an internal transfer, sent an agent to a refusal or to a false
// answer, and nothing in the package caught it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_OUT = join(repoRoot, 'tests/fixtures/facts-columns.json')

function fail(message) {
  console.error(`pin-facts-columns: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (!['--mapping', '--commit', '--check', '--out'].includes(flag))
      fail(`unknown argument ${flag}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`)
    args[flag.slice(2)] = value
    i += 1
  }
  if (!args.mapping || !args.commit) fail('--mapping <file> and --commit <sha> are required')
  return args
}

export function pinFactsColumns(mappingText, commit) {
  const mapping = JSON.parse(mappingText)
  if (!Array.isArray(mapping.edges)) fail('the mapping holds no "edges"')
  return {
    source: 'graph server facts relationship properties',
    server_commit: commit,
    relationships: mapping.edges.map((edge) => {
      if (typeof edge.rel_type !== 'string' || !edge.properties) {
        fail('an edge of the mapping names no relationship or no properties')
      }
      return { relationship: edge.rel_type, properties: Object.keys(edge.properties) }
    }),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const pinned = `${JSON.stringify(
    pinFactsColumns(readFileSync(args.mapping, 'utf8'), args.commit),
    null,
    2
  )}\n`
  if (args.check) {
    const committed = readFileSync(args.check, 'utf8')
    if (committed !== pinned) {
      fail(
        `${args.check} differs from the pin of the server's mapping: run this script without --check`
      )
    }
    return
  }
  const out = args.out ?? DEFAULT_OUT
  writeFileSync(out, pinned)
  console.log(`wrote ${out}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
