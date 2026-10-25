import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The served exchange registry (registry/robinhood.json, written from
// registry/robinhood.md by scripts/pin-dex-registry.mjs) and the pinned indexer
// adapter list (tests/fixtures/dex-adapters.json), with their readers. Shared by
// tests/dex-registry.test.ts, tests/dex-coverage.test.ts and the live suites.

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const TRAIL_TYPES = ['plain', 'vault', 'gauge', 'launchpad'] as const
export type TrailType = (typeof TRAIL_TYPES)[number]

export type DexRow = {
  dex: string
  display: string
  aliases: string[]
  trail_type: TrailType
  adapters: string[]
  /** address -> factory, manager or router. */
  roles: Record<string, string>
  /** The factories that deploy the exchange's pools, or the one manager of a vault row. */
  factories: string[]
  routers: string[]
  example_pool: string | null
  pool_floor: number | null
  since_block: number
  source: string
}

export type RegistryFile = {
  schema: string
  network: string
  registry_version: number
  recorded_on: string
  rows: DexRow[]
}

export type AdapterPin = { id: string; discovery_kind: string; anchors: string[] }
export type AdapterFile = { registry_version: number; network: string; adapters: AdapterPin[] }

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T
}

export const readRegistry = (root = repoRoot): RegistryFile =>
  readJson<RegistryFile>(root, 'registry/robinhood.json')

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
//   for each adapter of dex-adapters.json of discovery kind launch (a generic
//   rule whose factories no registry row names, on purpose):
//     skills/chain-insights-dex-launchpad/SKILL.md holding the id    else "no launchpad skill section: <id>"
//     a plugin/evals/dex-*/case.yaml holding the id                  else "no launch eval: <id>"
//   for each other adapter of dex-adapters.json:
//     a row of registry/robinhood.json whose adapters hold the id    else "no exchange row: <id>"
//     for each such row:
//       skills/chain-insights-dex-<type>/SKILL.md, or type plain
//         (served by skills/chain-insights-dex/SKILL.md)          else "no type skill: <type> (<dex>)"
//       plugin/evals/dex-<dex>/case.yaml whose prompt holds the
//         row's display, key or an alias, and no 0x address         else "no name-only eval: <dex>"
//   for each row: every adapter in dex-adapters.json             else "row names an unknown adapter: <dex> (<adapter>)"
export function coverageGaps(adapterId: string | null, root = repoRoot): string[] {
  const registry = readRegistry(root)
  const adapters = readAdapters(root)
  const known = new Set(adapters.adapters.map((adapter) => adapter.id))
  const pin = adapters.adapters.find((adapter) => adapter.id === adapterId)
  if (adapterId !== null && pin?.discovery_kind === 'launch') return launchGaps(adapterId, root)
  const gaps: string[] = []
  const rowGaps = (row: DexRow): string[] => {
    const out: string[] = []
    const skill =
      row.trail_type === 'plain'
        ? 'skills/chain-insights-dex/SKILL.md'
        : `skills/chain-insights-dex-${row.trail_type}/SKILL.md`
    if (!existsSync(join(root, skill))) out.push(`no type skill: ${row.trail_type} (${row.dex})`)
    const casePath = join(root, 'plugin/evals', `dex-${row.dex}`, 'case.yaml')
    const prompt = existsSync(casePath) ? evalPrompt(readFileSync(casePath, 'utf8')) : null
    if (
      prompt === null ||
      ![row.display, row.dex, ...row.aliases].some((name) => prompt.toLowerCase().includes(name.toLowerCase())) ||
      /0x[0-9a-f]/i.test(prompt)
    ) {
      out.push(`no name-only eval: ${row.dex}`)
    }
    return out
  }
  if (adapterId === null) {
    for (const row of registry.rows) {
      for (const id of row.adapters) if (!known.has(id)) {
        gaps.push(`row names an unknown adapter: ${row.dex} (${id})`)
      }
    }
    return gaps
  }
  const rows = registry.rows.filter((row) => row.adapters.includes(adapterId))
  if (rows.length === 0) gaps.push(`no exchange row: ${adapterId}`)
  for (const row of rows) gaps.push(...rowGaps(row))
  return gaps
}

// A launch adapter (discovery kind launch) has no exchange to name: its
// factories are found on the chain by their shape. The launchpad trail skill
// teaches the shape under the adapter id, and an eval asks for one factory.
function launchGaps(adapterId: string, root: string): string[] {
  const gaps: string[] = []
  const skill = join(root, 'skills/chain-insights-dex-launchpad/SKILL.md')
  if (!existsSync(skill) || !readFileSync(skill, 'utf8').includes(adapterId)) {
    gaps.push(`no launchpad skill section: ${adapterId}`)
  }
  const evals = join(root, 'plugin/evals')
  const asked =
    existsSync(evals) &&
    readdirSync(evals).some((dir) => {
      const casePath = join(evals, dir, 'case.yaml')
      return (
        dir.startsWith('dex-') &&
        existsSync(casePath) &&
        readFileSync(casePath, 'utf8').includes(adapterId)
      )
    })
  if (!asked) gaps.push(`no launch eval: ${adapterId}`)
  return gaps
}
