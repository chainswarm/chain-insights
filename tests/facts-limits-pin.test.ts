import { describe, expect, it } from 'vitest'

import { FACTS_CODES, factsReadViolations } from './support/facts-contract.js'
import { flat, read, sectionWith, servedGraphHints } from './support/schema-text.js'

// The facts limits are stated in words by the skill and the served hints, and
// they are the server's own. tests/fixtures/facts-contract.json is a projection
// of the server's list of read shapes and of its contract numbers, made by
// scripts/pin-facts-contract.mjs. Every number below is read from that file and
// never written here: when the server changes a number and the file is
// regenerated, the skill line that still says the old number fails here.

type Contract = {
  window_days: number
  row_cap: number
  max_hops: number
  caller_sort: boolean
  anchors: string[]
  codes: string[]
  refusals: {
    id: string
    code: string
    rule: string
    relationship: string
    query: string
  }[]
}

const contract = JSON.parse(read('tests/fixtures/facts-contract.json')) as Contract

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n)

// Markdown and quotes folded away, so a sentence that a line break or a code
// span splits still reads as one.
const plain = (text: string): string => flat(text).replace(/\\?`/g, '').replace(/\*\*/g, '')

describe('the pinned facts contract', () => {
  it('holds the numbers, the anchors, the six codes and every refusal of the server', () => {
    expect(contract.anchors).toEqual(['pair', 'transaction'])
    expect(contract.refusals).toHaveLength(53)
    expect(contract.refusals.filter((refusal) => refusal.relationship !== '')).toHaveLength(51)
    for (const refusal of contract.refusals) {
      expect(contract.codes, refusal.id).toContain(refusal.code)
    }
  })

  it('names no repository path: no value holds a path of the server', () => {
    const values: string[] = []
    JSON.stringify(contract, (_key, value: unknown) => {
      if (typeof value === 'string') values.push(value)
      return value
    })
    for (const value of values) expect(value, value).not.toMatch(/[/\\]|\.go\b|\.json\b/)
  })

  it('FACTS_CODES of the reader is the set of codes of the contract', () => {
    expect([...FACTS_CODES].sort()).toEqual([...contract.codes].sort())
  })

  it('the reader gives each refusal that names a relationship exactly its own code', () => {
    const named = contract.refusals.filter((refusal) => refusal.relationship !== '')
    const disagreements = named
      .map((refusal) => ({ refusal, got: factsReadViolations(refusal.query) }))
      .filter(({ refusal, got }) => got.length !== 1 || got[0] !== refusal.code)
      .map(({ refusal, got }) => `${refusal.id}: want ${refusal.code}, got [${got.join(', ')}]`)
    expect(disagreements).toEqual([])
  })

  it('the reader refuses the two reads of a node alone with facts_no_anchor', () => {
    const nodes = contract.refusals.filter((refusal) => refusal.relationship === '')
    expect(nodes).toHaveLength(2)
    for (const refusal of nodes) {
      expect(factsReadViolations(refusal.query), refusal.id).toEqual(['facts_no_anchor'])
    }
  })
})

// Each statement of the limits is derived from the fixture. The facts section of
// the skill and the facts hint of the proxy both carry all of them.
const skillFacts = (): string =>
  plain(sectionWith(read('skills/chain-insights-cypher/SKILL.md'), 'Facts'))
const hintFacts = (): string => {
  const line = servedGraphHints()
    .split('\n')
    .find((candidate) => candidate.includes('A facts read names an address pair'))
  expect(line, 'the served hints hold no facts read contract line').toBeDefined()
  return plain(line ?? '')
}

describe('the skill and the served hints state the facts limits of the server', () => {
  const surfaces: [string, () => string][] = [
    ['the facts section of skills/chain-insights-cypher/SKILL.md', skillFacts],
    ['the facts hint of src/mcp/proxy.ts', hintFacts],
  ]

  it.each(surfaces)(
    '%s names an address pair with one day, or one transaction hash',
    (_n, text) => {
      expect(contract.anchors).toContain('pair')
      expect(contract.anchors).toContain('transaction')
      expect(text()).toMatch(
        new RegExp(
          String.raw`address pair with ${numberWord(contract.window_days)} day,? or (?:one |a )?(?:tx_id|transaction hash)`,
          'i'
        )
      )
    }
  )

  it.each(surfaces)('%s states the row cap of the contract', (_n, text) => {
    expect(text()).toContain(`${contract.row_cap} rows`)
  })

  it.each(surfaces)('%s states no other row cap', (_n, text) => {
    for (const match of text().matchAll(/\b(\d[\d,]*)\s+rows\b/g)) {
      expect(Number((match[1] ?? '').replaceAll(',', '')), match[0]).toBe(contract.row_cap)
    }
  })

  it.each(surfaces)('%s states the hop limit: one relationship and no hop', (_n, text) => {
    expect(text()).toMatch(
      new RegExp(String.raw`${numberWord(contract.max_hops)} relationship,? and no hop`, 'i')
    )
  })

  it.each(surfaces)('%s says the caller has no ORDER BY and sorts the page itself', (_n, text) => {
    expect(contract.caller_sort).toBe(false)
    expect(text()).toMatch(/no ORDER BY/i)
    expect(text()).toMatch(/sort the page/i)
  })
})
