import { describe, expect, it } from 'vitest'

import { read, flat } from './support/schema-text.js'

// The graph server's refusal codes are pinned in tests/fixtures/server-refusal-codes.json,
// read from the server's own constants. Each refusal comes back with a code, a class
// (refused, killed, capacity or failed), a fix and an example, so the cypher skill
// teaches the move by class and never lists the codes: a table of every code went
// stale each time the server added one, and the refusal already carries its own fix.
// The class lines of the skill are held word for word by tests/layer-routing.test.ts.

type PinnedCode = { code: string; layer: string; class: string }
type Pinned = { source: string; server_commit: string; codes: PinnedCode[] }

const pinned = JSON.parse(read('tests/fixtures/server-refusal-codes.json')) as Pinned

const SKILL = 'skills/chain-insights-cypher/SKILL.md'
const CLASSES = ['refused', 'killed', 'capacity', 'failed']
const LAYERS = ['any', 'topology', 'facts', 'chain']

describe('the pinned list of refusal codes', () => {
  it('holds each code once, with a layer and a class the skill can name', () => {
    expect(pinned.codes).toHaveLength(40)
    expect(new Set(pinned.codes.map((entry) => entry.code)).size).toBe(pinned.codes.length)
    for (const entry of pinned.codes) {
      expect(LAYERS, entry.code).toContain(entry.layer)
      expect(CLASSES, entry.code).toContain(entry.class)
      expect(entry.code, entry.code).toMatch(/^[a-z]+(?:_[a-z]+)+$/)
    }
  })

  it('holds the layer rule: a code of one layer carries that layer prefix, and the three scope codes are any', () => {
    for (const entry of pinned.codes) {
      if (entry.code.startsWith('facts_')) expect(entry.layer, entry.code).toBe('facts')
      if (entry.code.startsWith('chain_')) expect(entry.layer, entry.code).toBe('chain')
    }
    expect(
      pinned.codes.filter((entry) => entry.layer === 'any').map((entry) => entry.code)
    ).toEqual(['invalid_scope', 'invalid_network', 'missing_network'])
  })

  it('names no repository path: no value holds a slash or a backslash', () => {
    const values: string[] = []
    JSON.stringify(pinned, (_key, value: unknown) => {
      if (typeof value === 'string') values.push(value)
      return value
    })
    expect(values.length).toBeGreaterThan(40)
    for (const value of values) expect(value, value).not.toMatch(/[/\\]/)
  })
})

describe('the cypher skill and the refusal codes', () => {
  const skill = flat(read(SKILL))

  it('teaches the move for every class a pinned code carries', () => {
    const classes = new Set(pinned.codes.map((entry) => entry.class))
    expect([...classes].sort()).toEqual([...CLASSES].sort())
    for (const cls of classes) {
      expect(skill, `the skill has no move for class ${cls}`).toContain(`Class \`${cls}\`:`)
    }
  })

  it('sends the reader to the fix and the example the refusal carries', () => {
    expect(skill).toContain('`error_detail`: `code`, `rule`, `class`, `fix` and `example`')
    expect(skill).toContain('read `fix`, rewrite the query from `example`, and send it once')
  })

  it('holds no table of codes: no pinned code is written down as a row', () => {
    const rows = read(SKILL)
      .split('\n')
      .filter((line) => /^\|\s*`[a-z]+(?:_[a-z]+)+`\s*\|/.test(line))
    expect(rows).toEqual([])
  })
})
