import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The pinned brand registry (tests/fixtures/dex-brands.json) and the pinned
// indexer adapter list (tests/fixtures/dex-adapters.json), with their readers.
// Shared by tests/dex-brands.test.ts and tests/dex-coverage.test.ts.

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const TRAIL_TYPES = ['plain', 'vault', 'gauge', 'launchpad'] as const
export type TrailType = (typeof TRAIL_TYPES)[number]

export type BrandRow = {
  brand: string
  display: string
  aliases: string[]
  trail_type: TrailType
  adapter: string
  adapters?: string[]
  roles?: Record<string, string>
  /** The factories that deploy the brand's pools, or the one manager of a vault row. */
  factories: string[]
  routers: string[]
  /** Optional: the role of a factory or router in plain words, keyed by its address. */
  roles?: Record<string, string>
  example_pool: string | null
  pool_floor: number | null
  since_block: number
  source: string
  /** Why a row lacks a factory, a router or an example pool. */
  note?: string
}

export type BrandFile = {
  recorded_on: string
  network: string
  registry_version: number
  rows: BrandRow[]
}

export type AdapterPin = { id: string; discovery_kind: string; anchors: string[] }
export type AdapterFile = { registry_version: number; network: string; adapters: AdapterPin[] }

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T
}

export const readBrands = (root = repoRoot): BrandFile =>
  readJson<BrandFile>(root, 'tests/fixtures/dex-brands.json')

export const readAdapters = (root = repoRoot): AdapterFile =>
  readJson<AdapterFile>(root, 'tests/fixtures/dex-adapters.json')

// The prompt of a plugin eval case: the `prompt:` of its `execution`, a block
// scalar (`prompt: |`) or a one-line value.
export function evalPrompt(caseYaml: string): string | null {
  const lines = caseYaml.split('\n')
  const at = lines.findIndex((line) => /^\s+prompt:/.test(line))
  if (at < 0) return null
  const head = lines[at] ?? ''
  const inline = /^\s+prompt:\s*([^|>\s].*)$/.exec(head)
  if (inline) return (inline[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2')
  const indent = (head.match(/^\s*/)?.[0].length ?? 0) + 1
  const body: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && (line.match(/^\s*/)?.[0].length ?? 0) < indent) break
    body.push(line.trim())
  }
  return body.join('\n').trim()
}

// What the coverage rule finds missing, one line per gap:
//
//   for each adapter of dex-adapters.json:
//     a row of dex-brands.json with row.adapter == adapter.id     else "no brand row: <id>"
//     for each such row:
//       skills/chain-insights-dex-<type>/SKILL.md, or type plain
//         (served by skills/chain-insights-dex/SKILL.md)          else "no type skill: <type> (<brand>)"
//       plugin/evals/dex-<brand>/case.yaml whose prompt holds the
//         row's display, key or an alias, and no 0x address                         else "no name-only eval: <brand>"
//   for each row: row.adapter in dex-adapters.json                else "row names an unknown adapter: <brand> (<adapter>)"
export function coverageGaps(adapterId: string | null, root = repoRoot): string[] {
  const brands = readBrands(root)
  const adapters = readAdapters(root)
  const known = new Set(adapters.adapters.map((adapter) => adapter.id))
  const gaps: string[] = []
  const rowGaps = (row: BrandRow): string[] => {
    const out: string[] = []
    const skill =
      row.trail_type === 'plain'
        ? 'skills/chain-insights-dex/SKILL.md'
        : `skills/chain-insights-dex-${row.trail_type}/SKILL.md`
    if (!existsSync(join(root, skill))) out.push(`no type skill: ${row.trail_type} (${row.brand})`)
    const casePath = join(root, 'plugin/evals', `dex-${row.brand}`, 'case.yaml')
    const prompt = existsSync(casePath) ? evalPrompt(readFileSync(casePath, 'utf8')) : null
    if (
      prompt === null ||
      ![row.display, row.brand, ...row.aliases].some((name) => prompt.toLowerCase().includes(name.toLowerCase())) ||
      /0x[0-9a-f]/i.test(prompt)
    ) {
      out.push(`no name-only eval: ${row.brand}`)
    }
    return out
  }
  if (adapterId === null) {
    for (const row of brands.rows) {
      for (const id of row.adapters ?? [row.adapter]) if (!known.has(id)) {
        gaps.push(`row names an unknown adapter: ${row.brand} (${id})`)
      }
    }
    return gaps
  }
  const rows = brands.rows.filter((row) => (row.adapters ?? [row.adapter]).includes(adapterId))
  if (rows.length === 0) gaps.push(`no brand row: ${adapterId}`)
  for (const row of rows) gaps.push(...rowGaps(row))
  return gaps
}
