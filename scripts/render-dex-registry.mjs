#!/usr/bin/env node
// Renders the exchange memo from registry/robinhood.json, the served copy of the
// exchange registry, into the skills that carry it, between
// <!-- dex-registry:start --> and <!-- dex-registry:end -->:
//
//   skills/chain-insights-dex/SKILL.md        every exchange: the memo table
//   skills/chain-insights-virtuals/SKILL.md   the virtuals row: its factories
//
//   node scripts/render-dex-registry.mjs          rewrite the blocks in place
//   node scripts/render-dex-registry.mjs --check  print nothing and exit 0 when
//                                                every block is what a fresh
//                                                render gives and no exchange
//                                                skill names a factory, router
//                                                or manager the registry lacks;
//                                                else name the file on stderr
//                                                and exit 1
//
// The memo is what a host with no meta_dex_lookup tool reads. The tool reads the
// same file over the network, so a skill never holds a hand-typed exchange
// table: a new exchange, factory or router is a registry row, a new pin and a
// fresh render. tests/dex-registry.test.ts runs the check.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))
export const START = '<!-- dex-registry:start -->'
export const END = '<!-- dex-registry:end -->'
export const REGISTRY_PATH = 'registry/robinhood.json'

export function readRegistry(root = defaultRoot) {
  return JSON.parse(readFileSync(join(root, REGISTRY_PATH), 'utf8'))
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

// The memo of the index skill: one line per exchange, every address in full.
export function renderIndexMemo(registry) {
  const lines = [
    `Memo of the exchange registry, version ${registry.registry_version}, ${registry.network}, recorded ${registry.recorded_on}.`,
    '',
    '| Exchange | Key | Also written | Trail | Factories, or the manager | Router |',
    '|---|---|---|---|---|---|',
  ]
  for (const row of registry.rows) {
    lines.push(
      `| ${row.display} | \`${row.dex}\` | ${row.aliases.join(', ')} | ${row.trail_type} | ${contractsCell(row)} | ${routerCell(row)} |`
    )
  }
  return lines.join('\n')
}

// The block of the Virtuals skill: the factories of the virtuals row, each with
// the role the row names for it.
export function renderVirtualsMemo(registry) {
  const rows = registry.rows.filter((row) => row.dex === 'virtuals')
  if (rows.length === 0) throw new Error(`${REGISTRY_PATH} holds no virtuals row`)
  const lines = [
    `The factories of the exchange registry, version ${registry.registry_version}, row \`virtuals\`:`,
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
  if (text.indexOf(START, start + 1) >= 0) throw new Error(`${path}: two dex-registry blocks`)
  return `${text.slice(0, start)}${START}\n${block}\n${text.slice(end)}`
}

/** Every target whose block differs from a fresh render. */
export function staleTargets(root = defaultRoot) {
  const registry = readRegistry(root)
  return TARGETS.filter(({ path, render }) => {
    const text = readFileSync(join(root, path), 'utf8')
    return withBlock(text, render(registry), path) !== text
  }).map(({ path }) => path)
}

/** Every page of the exchange skills (skills/chain-insights-dex*), sorted. */
export function exchangeSkillPages(root = defaultRoot) {
  return readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chain-insights-dex(-[a-z0-9-]+)?$/.test(entry.name))
    .flatMap((entry) =>
      readdirSync(join(root, 'skills', entry.name), { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.md'))
        .map((file) => `skills/${entry.name}/${file}`)
    )
    .sort()
}

// A line that names a factory, a router or a pool manager names a contract of
// an exchange: every address on it must be a contract or the example pool of a
// registry row. "path:line address" for each that is not.
export function handTypedContracts(root = defaultRoot) {
  const registry = readRegistry(root)
  const known = new Set(
    registry.rows.flatMap((row) => [
      ...Object.keys(row.roles ?? {}),
      ...row.factories,
      ...row.routers,
      ...(row.example_pool ? [row.example_pool] : []),
    ])
  )
  const found = []
  for (const path of exchangeSkillPages(root)) {
    const text = readFileSync(join(root, path), 'utf8')
    const start = text.indexOf(START)
    const end = text.indexOf(END)
    const lines = text.split('\n')
    let offset = 0
    lines.forEach((line, index) => {
      const at = offset
      offset += line.length + 1
      if (start >= 0 && at > start && at < end) return
      if (!/\b(factory|factories|router|routers|pool manager)\b/i.test(line)) return
      for (const [address] of line.matchAll(/0x[0-9a-f]{40}(?![0-9a-f])/g)) {
        if (!known.has(address)) found.push(`${path}:${index + 1} ${address}`)
      }
    })
  }
  return found
}

function main() {
  const root = defaultRoot
  if (process.argv.includes('--check')) {
    const stale = staleTargets(root)
    const typed = handTypedContracts(root)
    if (stale.length > 0) {
      console.error(`the dex-registry block differs from ${REGISTRY_PATH} in:\n${stale.join('\n')}`)
      console.error('Run: node scripts/render-dex-registry.mjs')
    }
    if (typed.length > 0) {
      console.error(
        `an exchange skill names a contract that no row of ${REGISTRY_PATH} holds:\n${typed.join('\n')}`
      )
      console.error('Add a registry row, or take the address out of the skill.')
    }
    if (stale.length > 0 || typed.length > 0) process.exit(1)
    return
  }
  const registry = readRegistry(root)
  for (const { path, render } of TARGETS) {
    const text = readFileSync(join(root, path), 'utf8')
    writeFileSync(join(root, path), withBlock(text, render(registry), path))
  }
  console.log(`rendered ${TARGETS.map(({ path }) => path).join(', ')}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
