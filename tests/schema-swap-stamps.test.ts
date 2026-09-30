import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Swap stamps are read from SWAPPED, never from FLOWS_TO. FLOWS_TO carries
// value only. SWAPPED gives the aggregate (strength, pools, families), and the
// facts graph SWAP row gives one route. The two skills and the two documents
// name no swap property on FLOWS_TO: no swap.kind, swap.family,
// swap.deployment, swap.pool, swap.route_id, swap_envelope or assets_paired.
// The served graph hints in src/mcp/proxy.ts are pinned the same way in
// tests/mcp-proxy.test.ts.

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const SKILLS_AND_DOCS = [
  'skills/chain-insights-schema-evm/SKILL.md',
  'skills/chain-insights-cypher/SKILL.md',
  'docs/graph-tools.md',
  'docs/graph-query-compatibility.md',
]

// The files the served hints come from, checked with the same stamp names.
const SERVED_TEXT = [...SKILLS_AND_DOCS, 'src/mcp/proxy.ts', 'src/workspace/init.ts']

const SWAP_STAMP = /swap\.(kind|family|deployment|pool|route_id|reason|interpreter_version)/
const RETIRED_STAMP_NAMES = ['swap_envelope', 'assets_paired', 'generic_assets_paired']

// One `## ` section of a Markdown file, up to the next `## ` heading.
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`)
  expect(start, `no section ## ${heading}`).toBeGreaterThan(-1)
  const rest = markdown.slice(start + 1)
  const next = rest.indexOf('\n## ', 4)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('no swap property is named on FLOWS_TO', () => {
  it.each(SERVED_TEXT)('%s names no swap stamp', (file) => {
    const text = read(file)
    expect(SWAP_STAMP.test(text), `${file} names a swap.* stamp`).toBe(false)
    for (const name of RETIRED_STAMP_NAMES) {
      expect(text.includes(name), `${file} names ${name}`).toBe(false)
    }
  })

  it('the FLOWS_TO properties table of the schema skill lists value fields only', () => {
    const flows = section(read('skills/chain-insights-schema-evm/SKILL.md'), 'FLOWS_TO properties')
    const rows = flows.split('\n').filter((line) => line.startsWith('| `'))
    expect(rows.map((row) => row.split('|')[1]!.trim())).toEqual([
      '`tx_count`',
      '`amount_usd_sum`',
      '`first_seen_timestamp` / `last_seen_timestamp`',
    ])
    expect(/swap/i.test(rows.join('\n'))).toBe(false)
    expect(/first_tx_id|last_tx_id/.test(flows)).toBe(false)
  })
})

describe('swap attribution is read from SWAPPED or the facts SWAP row', () => {
  it.each(SKILLS_AND_DOCS)('%s says FLOWS_TO carries value only', (file) => {
    const text = read(file).replace(/\s+/g, ' ')
    expect(text.includes('`FLOWS_TO` carries value only'), `${file} does not say it`).toBe(true)
  })

  it.each(SKILLS_AND_DOCS)(
    '%s points swap attribution at SWAPPED and the facts SWAP row',
    (file) => {
      const text = read(file).replace(/\s+/g, ' ')
      expect(
        /Swap attribution[^.]*`SWAPPED`[^.]*`SWAP`/.test(text),
        `${file} does not point swap attribution at SWAPPED and SWAP`
      ).toBe(true)
    }
  )

  it('SWAPPED carries the aggregate: strength, pools and families', () => {
    const swapped = section(read('skills/chain-insights-schema-evm/SKILL.md'), 'SWAPPED properties')
    for (const property of ['`strength`', '`pools`', '`families`']) {
      expect(swapped.includes(property), `SWAPPED lacks ${property}`).toBe(true)
    }
  })

  it('the facts SWAP row carries one route: route_id, strength, pools', () => {
    const facts = read('skills/chain-insights-schema-evm/SKILL.md')
    const swapRow = facts.slice(facts.indexOf('`SWAP` holds one row per route'))
    for (const property of ['`route_id`', '`strength`', '`pools`']) {
      expect(swapRow.includes(property), `facts SWAP lacks ${property}`).toBe(true)
    }
  })
})
