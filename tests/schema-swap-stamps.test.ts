import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Swap stamps are read from SWAPPED, never from FLOWS_TO. FLOWS_TO carries
// value only. SWAPPED gives the aggregate (strength, pools, families), and the
// facts graph SWAP row gives one route, without a route list. The skill and the two documents
// name no swap property on FLOWS_TO: no swap.kind, swap.family,
// swap.deployment, swap.pool, swap.route_id, swap_envelope or assets_paired.
// The served graph hints in src/mcp/proxy.ts are pinned the same way in
// tests/mcp-proxy.test.ts.

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

// The two documents are the homes of swap attribution. The cypher skill is short
// and holds no swap section, so it only takes the stamp-name check below.
const SKILLS_AND_DOCS = ['docs/graph-tools.md', 'docs/graph-query-compatibility.md']

// The files the served hints come from, checked with the same stamp names.
const SERVED_TEXT = [
  ...SKILLS_AND_DOCS,
  'skills/chain-insights-cypher/SKILL.md',
  'src/mcp/proxy.ts',
  'src/workspace/init.ts',
]

const SWAP_STAMP = /swap\.(kind|family|deployment|pool|route_id|reason|interpreter_version)/
const RETIRED_STAMP_NAMES = ['swap_envelope', 'assets_paired', 'generic_assets_paired']

describe('no swap property is named on FLOWS_TO', () => {
  it.each(SERVED_TEXT)('%s names no swap stamp', (file) => {
    const text = read(file)
    expect(SWAP_STAMP.test(text), `${file} names a swap.* stamp`).toBe(false)
    for (const name of RETIRED_STAMP_NAMES) {
      expect(text.includes(name), `${file} names ${name}`).toBe(false)
    }
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
})
