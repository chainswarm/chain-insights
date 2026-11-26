import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { read } from './support/schema-text.js'

// registry/address-card.json is the dictionary the released line reads. It is
// frozen while the next words are built in registry/address-card-next.json:
// no entry leaves, no level moves and no question changes. The hash pins the
// sorted (word, value, level, question) entries as they stood at 4460035, so
// any such edit fails here before it reaches a release.

type Word = { word: string; value?: string; level: string; question: string }
type Card = {
  properties: { name: string }[]
  marks: { name: string; words: string[] }[]
  flags: { name: string; words: string[] }[]
  words: Word[]
}

const FROZEN_SHA256 = 'b80443825ba02befc9b1a0cf68065af115b211c5c279b7871924c90f4c0b6b12'

const text = read('registry/address-card.json')
const card = JSON.parse(text) as Card

function frozenEntries(words: Word[]): string {
  const rows = words.map((w) => [w.word, w.value ?? '', w.level, w.question])
  rows.sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : a.join('\u0000') > b.join('\u0000') ? 1 : 0))
  return JSON.stringify(rows)
}

describe('the frozen address card', () => {
  it('keeps every entry with its level and question', () => {
    const sha = createHash('sha256').update(frozenEntries(card.words)).digest('hex')
    expect(sha).toBe(FROZEN_SHA256)
  })

  it('a removed entry or a moved level changes the pin', () => {
    const moved = card.words.map((w, i) => (i === 0 ? { ...w, level: w.level === 'none' ? 'high' : 'none' } : w))
    const removed = card.words.slice(1)
    for (const words of [moved, removed]) {
      expect(createHash('sha256').update(frozenEntries(words)).digest('hex')).not.toBe(FROZEN_SHA256)
    }
  })

  it('holds none of the next words', () => {
    expect(card.marks.map((m) => m.name)).not.toContain('Malicious')
    expect(card.flags.map((f) => f.name)).not.toContain('is_malicious')
    const properties = card.properties.map((p) => p.name)
    for (const name of ['category', 'type', 'role']) expect(properties).not.toContain(name)
    expect(card.words.map((w) => w.word)).not.toContain('malicious')
    expect(text).not.toMatch(/\bmalicious\b/i)
  })
})
