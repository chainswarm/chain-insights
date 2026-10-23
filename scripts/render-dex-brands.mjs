#!/usr/bin/env node
// Renders the exchange memo from tests/fixtures/dex-brands.json into the skills
// that carry it, between <!-- brands:start --> and <!-- brands:end -->:
//
//   skills/chain-insights-dex/SKILL.md        every brand row: the memo table
//   skills/chain-insights-virtuals/SKILL.md   the virtuals rows: its factories
//
//   node scripts/render-dex-brands.mjs          rewrite the blocks in place
//   node scripts/render-dex-brands.mjs --check  print nothing and exit 0 when
//                                              every block is what a fresh
//                                              render gives, else name the
//                                              file on stderr and exit 1
//
// The brand fixture is the pinned copy of the brand registry, so a skill never
// holds a hand-typed brand table: a new brand, factory or router is a registry
// row, a new pin and a fresh render. tests/dex-brands.test.ts runs the check.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const START = '<!-- brands:start -->'
const END = '<!-- brands:end -->'

export function readBrands(root = defaultRoot) {
  return JSON.parse(readFileSync(join(root, 'tests/fixtures/dex-brands.json'), 'utf8'))
}

const code = (address) => `\`${address}\``
const list = (addresses) => addresses.map(code).join(', ')

function contractsCell(row) {
  if (row.factories.length === 0) return 'none proven yet'
  if (row.trail_type === 'vault') return `manager ${list(row.factories)}`
  return list(row.factories)
}

function routerCell(row) {
  if (row.trail_type === 'vault') return 'the manager'
  if (row.routers.length > 0) return list(row.routers)
  return row.trail_type === 'gauge' ? 'none proven yet' : 'none'
}

// The memo of the index skill: one line per brand, every address in full.
export function renderIndexMemo(brands) {
  const lines = [
    `Memo of the brand registry, version ${brands.registry_version}, ${brands.network}, recorded ${brands.recorded_on}.`,
    '',
    '| Brand | Key | Also written | Trail | Factories, or the manager | Router | Note |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const row of brands.rows) {
    lines.push(
      `| ${row.display} | \`${row.brand}\` | ${row.aliases.join(', ')} | ${row.trail_type} | ${contractsCell(row)} | ${routerCell(row)} | ${row.note ?? ''} |`
    )
  }
  return lines.join('\n')
}

// The block of the Virtuals skill: the factories of the virtuals rows, each with
// the role the row names for it.
export function renderVirtualsMemo(brands) {
  const rows = brands.rows.filter((row) => row.brand === 'virtuals')
  if (rows.length === 0) throw new Error('dex-brands.json holds no virtuals row')
  const lines = [
    `The factories of the brand registry, version ${brands.registry_version}, row \`virtuals\`:`,
    '',
    '| Factory | Address |',
    '|---|---|',
  ]
  for (const row of rows) {
    for (const factory of row.factories) {
      const role = row.roles?.[factory]
      if (!role) throw new Error(`virtuals: factory ${factory} names no role`)
      lines.push(`| ${role} | ${code(factory)} |`)
    }
  }
  return lines.join('\n')
}

export const TARGETS = [
  { path: 'skills/chain-insights-dex/SKILL.md', render: renderIndexMemo },
  { path: 'skills/chain-insights-virtuals/SKILL.md', render: renderVirtualsMemo },
]

// The file with its block replaced by a fresh render.
export function withBlock(text, block, path) {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start < 0 || end < start) throw new Error(`${path}: no ${START} ... ${END} block`)
  if (text.indexOf(START, start + 1) >= 0) throw new Error(`${path}: two brands blocks`)
  return `${text.slice(0, start)}${START}\n${block}\n${text.slice(end)}`
}

/** Every target whose block differs from a fresh render. */
export function staleTargets(root = defaultRoot) {
  const brands = readBrands(root)
  return TARGETS.filter(({ path, render }) => {
    const text = readFileSync(join(root, path), 'utf8')
    return withBlock(text, render(brands), path) !== text
  }).map(({ path }) => path)
}

function main() {
  const root = defaultRoot
  if (process.argv.includes('--check')) {
    const stale = staleTargets(root)
    if (stale.length > 0) {
      console.error(
        `the brands block differs from tests/fixtures/dex-brands.json in:\n${stale.join('\n')}`
      )
      console.error('Run: node scripts/render-dex-brands.mjs')
      process.exit(1)
    }
    return
  }
  const brands = readBrands(root)
  for (const { path, render } of TARGETS) {
    const text = readFileSync(join(root, path), 'utf8')
    writeFileSync(join(root, path), withBlock(text, render(brands), path))
  }
  console.log(`rendered ${TARGETS.map(({ path }) => path).join(', ')}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
