#!/usr/bin/env node
// Writes the served copy of one network's exchange registry: registry/<network>.md,
// the reviewed table, becomes registry/<network>.json, the file the proxy tool
// meta_dex_lookup fetches, the skill memo renders from, and the tests read.
//
//   node scripts/pin-dex-registry.mjs registry/robinhood.md          write registry/robinhood.json
//   node scripts/pin-dex-registry.mjs --check registry/robinhood.md  exit 1 on a refused row, or
//                                                                    when the committed copy differs
//
// Only the rows marked `served` are pinned. One refused row stops the pin: a copy
// is never written from a file whose rows fail the review rule (registry/README.md).
// One entry per exchange, in the order the file first names it:
//
//   factories     the addresses of its factory and manager rows
//   routers       its router rows, or, with no router row, its manager rows (a vault forwards its own swaps)
//   adapters      every adapter of its factory and manager rows, in order
//   roles         address -> factory, manager or router
//   since_block   the lowest valid-from block of its factory and manager rows
//   source        the source link of the first of them
//   example_pool, pool_floor   the exchange's optional cells, null when empty
//
// registry_version and recorded_on come from the file's "Registry version: N" and
// "Recorded on: YYYY-MM-DD" lines, so the same file always pins the same copy.
// tests/dex-registry.test.ts runs the check, and so does the T1 job of
// .github/workflows/verify.yml.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 'chain-insights.dex-registry.v1'
export const ADDRESS_RE = /^0x[0-9a-f]{40}$/
// An example pool is a pool address, or a pool id of a manager that keeps its pools by id (Uniswap v4).
const POOL_RE = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/
export const DEX_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/
const ADAPTER_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/
const NETWORK_RE = /^[a-z0-9-]+$/
const LINK_RE = /^\[[^\]]*\]\((https:\/\/[^\s)]+)\)$/
const VERSION_RE = /^Registry version:\s*(\d+)/m
const RECORDED_RE = /^Recorded on:\s*(\d{4}-\d{2}-\d{2})\b/m
const SEPARATOR_RE = /^\|\s*:?-{3,}/
const SECTION = '## Rows'
export const COLUMNS = [
  'dex',
  'display',
  'aliases',
  'trail type',
  'adapter',
  'role',
  'address',
  'valid from block',
  'example pool',
  'pool floor',
  'source link',
  'verification',
]
export const ROLES = ['factory', 'manager', 'router']
const POOL_ROLES = ['factory', 'manager']
export const TRAIL_TYPES = ['plain', 'vault', 'gauge', 'launchpad']
const MAX_DISPLAY = 96
const MAX_ALIASES = 256
const MAX_SOURCE = 512
export const REFUSAL_REASONS = [
  'malformed row',
  'duplicate row',
  'bad dex key',
  'bad address',
  'unknown role',
  'unknown trail type',
  'bad adapter',
  'no source link',
  'bad block',
  'bad example pool',
  'bad pool floor',
  'too long',
  'dex rows disagree',
  'no factory or manager row for the dex',
]

function splitCells(line) {
  const trimmed = line.trim()
  if (!(trimmed.startsWith('|') && trimmed.endsWith('|'))) return null
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

/** The data rows of the "## Rows" table, in document order. A row of the wrong width is malformed. */
export function parseRows(text) {
  const rows = []
  let inside = false
  let headerSeen = false
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      inside = line.trim() === SECTION
      headerSeen = false
      continue
    }
    if (!inside) continue
    const cells = splitCells(line)
    if (cells === null) continue
    if (!headerSeen) {
      headerSeen = true
      continue
    }
    if (SEPARATOR_RE.test(line.trim())) continue
    if (cells.length !== COLUMNS.length) {
      rows.push({ malformed: line.trim() })
      continue
    }
    const row = Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index]]))
    row['address'] = row['address'].replace(/`/g, '').trim()
    row['example pool'] = row['example pool'].replace(/`/g, '').trim()
    rows.push(row)
  }
  return rows
}

const blank = (cell) => cell === '' || cell === '-'
const splitAliases = (cell) =>
  blank(cell)
    ? []
    : cell
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)
const digits = (cell) => /^\d+$/.test(cell)

function rowLabel(row) {
  if (row.malformed) return row.malformed
  return `${row.dex || '?'} ${row.role || '?'} ${row.address || '?'}`
}

/** [reason, parsed] for one served row; reason is null when its own cells are valid. */
function checkRow(row) {
  if (row.malformed) return ['malformed row', null]
  if (!DEX_RE.test(row['dex'])) return ['bad dex key', null]
  if (!ROLES.includes(row['role'])) return ['unknown role', null]
  if (!ADDRESS_RE.test(row['address'])) return ['bad address', null]
  if (!TRAIL_TYPES.includes(row['trail type'])) return ['unknown trail type', null]
  if (!ADAPTER_RE.test(row['adapter'])) return ['bad adapter', null]
  const link = LINK_RE.exec(row['source link'])
  if (!link) return ['no source link', null]
  if (!digits(row['valid from block'])) return ['bad block', null]
  const examplePool = blank(row['example pool']) ? null : row['example pool']
  if (examplePool !== null && !POOL_RE.test(examplePool)) return ['bad example pool', null]
  const poolFloor = blank(row['pool floor']) ? null : row['pool floor']
  if (poolFloor !== null && !digits(poolFloor)) return ['bad pool floor', null]
  if (!row['display']) return ['malformed row', null]
  if (row['display'].length > MAX_DISPLAY || link[1].length > MAX_SOURCE) return ['too long', null]
  return [
    null,
    {
      dex: row['dex'],
      role: row['role'],
      address: row['address'],
      display: row['display'],
      aliases: splitAliases(row['aliases']),
      trail_type: row['trail type'],
      adapter: row['adapter'],
      valid_from_block: Number(row['valid from block']),
      source: link[1],
      example_pool: examplePool,
      pool_floor: poolFloor === null ? null : Number(poolFloor),
    },
  ]
}

/**
 * The rows split into served (parsed, with the exchange's whole alias list),
 * refused ([reason, label]) and the count not marked served. An exchange with
 * no served factory or manager row is refused whole, and so is every row of an
 * exchange whose rows disagree.
 */
export function validate(rows) {
  const candidates = []
  const refused = []
  const seen = new Set()
  let notServed = 0
  for (const row of rows) {
    if (!row.malformed && !row['verification'].startsWith('served')) {
      notServed += 1
      continue
    }
    const [reason, parsed] = checkRow(row)
    if (reason) {
      refused.push([reason, rowLabel(row)])
      continue
    }
    const key = `${parsed.dex}\n${parsed.role}\n${parsed.address}`
    if (seen.has(key)) {
      refused.push(['duplicate row', rowLabel(row)])
      continue
    }
    seen.add(key)
    candidates.push(parsed)
  }
  const served = []
  for (const dex of [...new Set(candidates.map((row) => row.dex))]) {
    const mine = candidates.filter((row) => row.dex === dex)
    const aliases = [...new Set(mine.flatMap((row) => row.aliases))]
    const distinct = (values) => new Set(values).size
    let reason = null
    if (
      distinct(mine.map((row) => row.display)) > 1 ||
      distinct(mine.map((row) => row.trail_type)) > 1
    ) {
      reason = 'dex rows disagree'
    } else if (
      distinct(mine.map((row) => row.example_pool).filter(Boolean)) > 1 ||
      distinct(mine.map((row) => row.pool_floor).filter((floor) => floor !== null)) > 1
    ) {
      reason = 'dex rows disagree'
    } else if (aliases.join(', ').length > MAX_ALIASES) {
      reason = 'too long'
    } else if (!mine.some((row) => POOL_ROLES.includes(row.role))) {
      reason = 'no factory or manager row for the dex'
    }
    if (reason) {
      for (const row of mine) refused.push([reason, rowLabel(row)])
      continue
    }
    for (const row of mine) served.push({ ...row, dex_aliases: aliases })
  }
  return { served, refused, notServed }
}

/** The served copy of the served rows, in the shape of chain-insights.dex-registry.v1. */
export function pinDocument({ network, version, recordedOn, served }) {
  const rows = []
  for (const dex of [...new Set(served.map((row) => row.dex))]) {
    const mine = served.filter((row) => row.dex === dex)
    const pools = mine.filter((row) => POOL_ROLES.includes(row.role))
    let routers = mine.filter((row) => row.role === 'router').map((row) => row.address)
    if (routers.length === 0) {
      routers = pools.filter((row) => row.role === 'manager').map((row) => row.address)
    }
    rows.push({
      dex,
      display: mine[0].display,
      aliases: mine[0].dex_aliases,
      trail_type: mine[0].trail_type,
      adapters: [...new Set(pools.map((row) => row.adapter))],
      roles: Object.fromEntries(mine.map((row) => [row.address, row.role])),
      factories: pools.map((row) => row.address),
      routers,
      example_pool: mine.find((row) => row.example_pool)?.example_pool ?? null,
      pool_floor: mine.find((row) => row.pool_floor !== null)?.pool_floor ?? null,
      since_block: Math.min(...pools.map((row) => row.valid_from_block)),
      source: pools[0].source,
    })
  }
  return { schema: SCHEMA, network, registry_version: version, recorded_on: recordedOn, rows }
}

export const documentText = (document) => `${JSON.stringify(document, null, 2)}\n`

/** The registry file read and checked: its network, version, recorded day, rows and served copy. */
export function readRegistry(path) {
  const text = readFileSync(path, 'utf8')
  const network = basename(path).replace(/\.md$/, '')
  if (!NETWORK_RE.test(network))
    throw new Error(`the registry file name is not a network: ${basename(path)}`)
  const versionMatch = VERSION_RE.exec(text)
  const recordedMatch = RECORDED_RE.exec(text)
  const checked = validate(parseRows(text))
  const version = versionMatch ? Number(versionMatch[1]) : null
  const recordedOn = recordedMatch ? recordedMatch[1] : null
  const document =
    checked.refused.length === 0 && version !== null && recordedOn !== null
      ? pinDocument({ network, version, recordedOn, served: checked.served })
      : null
  return {
    network,
    version,
    recordedOn,
    checked,
    document,
    jsonPath: join(dirname(path), `${network}.json`),
  }
}

/** The lines of a check, and whether it passed. */
export function checkRegistry(path) {
  const registry = readRegistry(path)
  const { checked } = registry
  const lines = [
    `rows: ${checked.served.length} served, ${checked.refused.length} refused, ${checked.notServed} not served`,
  ]
  for (const reason of REFUSAL_REASONS) {
    for (const [found, label] of checked.refused)
      if (found === reason) lines.push(`  refused, ${reason}: ${label}`)
  }
  if (registry.version === null) lines.push(`${path} has no "Registry version: N" line`)
  if (registry.recordedOn === null) lines.push(`${path} has no "Recorded on: YYYY-MM-DD" line`)
  if (!registry.document) return { ok: false, lines }
  let committed = null
  try {
    committed = readFileSync(registry.jsonPath, 'utf8')
  } catch {
    lines.push(`${registry.jsonPath} is missing: run node scripts/pin-dex-registry.mjs ${path}`)
    return { ok: false, lines }
  }
  if (committed === documentText(registry.document)) {
    lines.push(`${registry.jsonPath} up to date, registry version ${registry.version}`)
    return { ok: true, lines }
  }
  let committedVersion = 'unreadable'
  try {
    committedVersion = String(JSON.parse(committed).registry_version)
  } catch {
    /* keep "unreadable" */
  }
  lines.push(
    `${registry.jsonPath} differs from ${path}: the file gives registry version ${registry.version}, the committed copy says registry version ${committedVersion}`,
    `Run: node scripts/pin-dex-registry.mjs ${path}`
  )
  return { ok: false, lines }
}

function main(argv) {
  const check = argv.includes('--check')
  const path = argv.find((arg) => !arg.startsWith('--'))
  if (!path) {
    console.error('usage: node scripts/pin-dex-registry.mjs [--check] registry/<network>.md')
    return 2
  }
  if (check) {
    const { ok, lines } = checkRegistry(path)
    for (const line of lines) (ok ? console.log : console.error)(line)
    return ok ? 0 : 1
  }
  const registry = readRegistry(path)
  if (!registry.document) {
    for (const line of checkRegistry(path).lines) console.error(line)
    console.error('refused: no copy is pinned from a file whose rows fail the review rule')
    return 1
  }
  writeFileSync(registry.jsonPath, documentText(registry.document))
  console.log(
    `wrote ${registry.jsonPath}: registry version ${registry.version}, ${registry.document.rows.length} exchanges, ${registry.checked.served.length} rows`
  )
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
