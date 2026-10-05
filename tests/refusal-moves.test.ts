import { describe, expect, it } from 'vitest'

import { read, sectionWith } from './support/schema-text.js'

// Every refusal code of the graph server has one row in the move table of the
// cypher skill, with the layer and the class the server gives it. The list of
// codes is pinned in tests/fixtures/server-refusal-codes.json, read from the
// server's own constants. A code the server adds fails here until the skill
// has a row for it, and a row for a code the server never returns fails too.

type PinnedCode = { code: string; layer: string; class: string }
type Pinned = { source: string; server_commit: string; codes: PinnedCode[] }
type MoveRow = { code: string; layer: string; class: string; move: string }

const pinned = JSON.parse(read('tests/fixtures/server-refusal-codes.json')) as Pinned

const SKILL = 'skills/chain-insights-cypher/SKILL.md'
const CLASSES = ['refused', 'killed', 'capacity', 'failed']
const LAYERS = ['any', 'topology', 'facts', 'chain']

// The rows of the move table of one Markdown section: `| `code` | layer | class | move |`.
function moveRows(section: string): MoveRow[] {
  return section
    .split('\n')
    .filter((line) => /^\|\s*`[a-z_]+`\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
      return {
        code: (cells[0] ?? '').replaceAll('`', ''),
        layer: (cells[1] ?? '').replaceAll('`', ''),
        class: (cells[2] ?? '').replaceAll('`', ''),
        move: cells.slice(3).join(' | '),
      }
    })
}

// What is wrong with a move table, as one line each. An empty list is a table
// that holds exactly one row for every pinned code, with its layer and class,
// and no row for any other code.
function moveTableFindings(rows: MoveRow[], codes: PinnedCode[]): string[] {
  const findings: string[] = []
  const known = new Map(codes.map((entry) => [entry.code, entry]))
  for (const entry of codes) {
    const found = rows.filter((row) => row.code === entry.code)
    if (found.length === 0) findings.push(`${entry.code}: no row in the move table`)
    if (found.length > 1) findings.push(`${entry.code}: ${found.length} rows, want one`)
    for (const row of found) {
      if (row.class !== entry.class) {
        findings.push(`${entry.code}: class ${row.class}, the server says ${entry.class}`)
      }
      if (row.layer !== entry.layer) {
        findings.push(`${entry.code}: layer ${row.layer}, the server says ${entry.layer}`)
      }
      if (row.move.trim() === '') findings.push(`${entry.code}: the row names no move`)
    }
  }
  for (const row of rows) {
    if (!known.has(row.code))
      findings.push(`${row.code}: a row for a code the server never returns`)
  }
  return findings
}

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

describe('the move table of the cypher skill', () => {
  const rows = moveRows(sectionWith(read(SKILL), 'refused'))

  it('holds exactly one row for each of the pinned codes, with its class and its layer', () => {
    expect(moveTableFindings(rows, pinned.codes)).toEqual([])
    expect(rows).toHaveLength(pinned.codes.length)
  })

  it('fails and names the code when the server adds a code the skill has no row for', () => {
    const added = [...pinned.codes, { code: 'facts_new_rule', layer: 'facts', class: 'refused' }]
    expect(moveTableFindings(rows, added)).toEqual(['facts_new_rule: no row in the move table'])
  })

  it('fails and names the code when the skill names a code the server never returns', () => {
    const invented = [
      ...rows,
      { code: 'facts_window_exceeded', layer: 'facts', class: 'refused', move: 'Name one day.' },
    ]
    expect(moveTableFindings(invented, pinned.codes)).toEqual([
      'facts_window_exceeded: a row for a code the server never returns',
    ])
  })

  it('fails when a code has two rows or the wrong class', () => {
    const first = rows[0] as MoveRow
    expect(moveTableFindings([...rows, first], pinned.codes)).toEqual([
      `${first.code}: 2 rows, want one`,
    ])
    const wrong = rows.map((row) =>
      row.code === 'facts_busy' ? { ...row, class: 'refused' } : row
    )
    expect(moveTableFindings(wrong, pinned.codes)).toEqual([
      'facts_busy: class refused, the server says capacity',
    ])
  })

  it('gives every code of a class a move that fits the class', () => {
    for (const row of rows) {
      if (row.class === 'capacity') expect(row.move, row.code).toMatch(/wait/i)
      if (row.class === 'failed' && row.code !== 'chain_unavailable') {
        expect(row.move, row.code).toMatch(/tell the user/i)
      }
    }
  })
})
