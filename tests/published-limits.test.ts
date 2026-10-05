import { describe, expect, it } from 'vitest'

import { flat, read, servedGraphHints } from './support/schema-text.js'

// A limit that the server publishes in the capabilities reply is read from the
// reply, never written down. Production already answers 3 calls per second per
// caller where the design of the chain layer said 10, so a number in a skill, a
// guide or a hint goes stale the day the server changes it. The skills, the
// guide and the served hints name the field, such as `chain_admission.batch_max`.
//
// tests/fixtures/capabilities-robinhood-20261005.json is the public reply, saved
// once. A literal inside a fenced query is allowed, such as LIMIT 25.

type Admission = Record<string, unknown>
const reply = JSON.parse(read('tests/fixtures/capabilities-robinhood-20261005.json')) as {
  networks: { network: string; chain_admission: Admission }[]
}
const admission = reply.networks.find((network) => network.network === 'robinhood')!.chain_admission

// What each published number means, in the words a sentence uses for it. A
// sentence that states the number of a member beside its meaning is a finding.
const MEANING: { field: string; value: number; meaning: RegExp }[] = [
  { field: 'slots', value: admission['slots'] as number, meaning: /\bslots?\b/i },
  { field: 'past_slots', value: admission['past_slots'] as number, meaning: /\bpast[- ]slots?\b/i },
  {
    field: 'slots_per_caller',
    value: admission['slots_per_caller'] as number,
    meaning: /\bper[- ]caller\b|\beach caller\b/i,
  },
  {
    field: 'calls_per_second_per_caller',
    value: admission['calls_per_second_per_caller'] as number,
    meaning: /\b(?:calls?|lookups?|requests?)\s+(?:per|a|each)\s+second\b|\bper[- ]second\b/i,
  },
  {
    field: 'batch_max',
    value: admission['batch_max'] as number,
    meaning: /\bbatch(?:es)?\b|\bmembers?\b/i,
  },
  ...Object.entries(admission['ceiling_seconds'] as Record<string, number>).map(
    ([name, value]) => ({
      field: `ceiling_seconds.${name}`,
      value,
      meaning: /\bceilings?\b|\btime limit\b/i,
    })
  ),
  { field: 'call_gas', value: admission['call_gas'] as number, meaning: /\bgas\b/i },
  {
    field: 'head_ttl_ms',
    value: admission['head_ttl_ms'] as number,
    meaning: /\bttl\b|\bcache[sd]?\b/i,
  },
  {
    field: 'max_head_age_seconds',
    value: admission['max_head_age_seconds'] as number,
    meaning: /\bhead\b[^.]*\b(?:age|older|stale)\b|\b(?:age|older|stale)\b[^.]*\bhead\b/i,
  },
]

const NUMBER_WORDS: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
}

function statesNumber(sentence: string, value: number): boolean {
  const digits = new RegExp(
    String.raw`(?<![\w.,/-])${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',?')}(?![\w.,/-])`
  )
  const word = NUMBER_WORDS[value]
  return (
    digits.test(sentence) ||
    (word !== undefined && new RegExp(String.raw`\b${word}\b`, 'i').test(sentence))
  )
}

// Every sentence of a text outside its fenced blocks. A table row is one sentence
// for each cell, so a number in one cell is never read beside a word of another.
function sentences(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, '')
  return prose
    .split(/\n\s*\n|\n(?=[-*|#]|\d+\. )/)
    .flatMap((block) =>
      block.trim().startsWith('|') ? block.split('|') : block.split(/(?<=[.!?])\s+/)
    )
    .map((sentence) => flat(sentence).trim())
    .filter(Boolean)
}

function publishedNumberFindings(markdown: string): string[] {
  const findings: string[] = []
  for (const sentence of sentences(markdown)) {
    for (const { field, value, meaning } of MEANING) {
      if (meaning.test(sentence) && statesNumber(sentence, value)) {
        findings.push(`chain_admission.${field} (${value}): ${sentence}`)
      }
    }
  }
  return findings
}

describe('the number detector', () => {
  it('names the line and the field when a skill writes a published number', () => {
    expect(publishedNumberFindings('Send at most 5 lookups in a batch.')).toEqual([
      'chain_admission.batch_max (5): Send at most 5 lookups in a batch.',
    ])
    expect(
      publishedNumberFindings('The chain layer allows 3 calls per second for each caller.')
    ).toEqual(expect.arrayContaining([expect.stringContaining('calls_per_second_per_caller')]))
    expect(publishedNumberFindings('Topology queries share 4 slots.')).toEqual([
      'chain_admission.slots (4): Topology queries share 4 slots.',
    ])
  })

  it('passes the field name, a literal in a fenced query and a number with another meaning', () => {
    expect(
      publishedNumberFindings('Send at most `chain_admission.batch_max` lookups in one batch.')
    ).toEqual([])
    expect(
      publishedNumberFindings('```cypher\nUSE chain MATCH (h:Head) RETURN h.height LIMIT 5\n```')
    ).toEqual([])
    expect(publishedNumberFindings('Wait at least 5 seconds, then send the query once.')).toEqual(
      []
    )
    expect(publishedNumberFindings('A path has at most 5 hops and a query at most 8.')).toEqual([])
  })
})

describe('no skill, guide or served hint writes a number that the capabilities reply publishes', () => {
  const surfaces: [string, () => string][] = [
    ['skills/chain-insights-cypher/SKILL.md', () => read('skills/chain-insights-cypher/SKILL.md')],
    [
      'skills/chain-insights-schema-evm/SKILL.md',
      () => read('skills/chain-insights-schema-evm/SKILL.md'),
    ],
    ['docs/graph-tools.md', () => read('docs/graph-tools.md')],
    ['src/mcp/proxy.ts graph hints', servedGraphHints],
  ]

  it('the saved reply publishes the chain_admission members the detector knows', () => {
    for (const { field, value } of MEANING) {
      expect(Number.isInteger(value), field).toBe(true)
    }
  })

  it.each(surfaces)('%s', (_name, text) => {
    expect(publishedNumberFindings(text())).toEqual([])
  })

  it('the old slot line is gone from the cypher skill', () => {
    expect(read('skills/chain-insights-cypher/SKILL.md')).not.toContain('share 4 slots')
  })
})
