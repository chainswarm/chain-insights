import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS } from '../src/mcp/proxy.js'
import {
  GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE,
  JUDGEMENT_ANSWER_EXAMPLES,
  JUDGEMENT_CLAIMS,
} from '../src/mcp/judgement-marks.js'
import { servedGraphHints } from './support/schema-text.js'

// A user asks "is this a fake-token scam, a poisoner, a drainer, a victim".
// The graph answers from the judgement marks and the claims lists the labels
// layer writes beside them. Every host must know the vocabulary: Claude
// Desktop chat reads only the graph_query description, the skill hosts read
// the cypher skill, the others the server instructions. The answer says each
// value in plain words, never the code.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')
const CODE =
  /\b[A-Z]{2,}(?:_[A-Z]+)+\b|\b(?:VICTIM|SANCTIONED|LAUNDERED|RECEIVED|FUNDER|MIXED)\b|_claims|suspect_labels/
const MARKS = [':Scam', ':Victim', ':Poisoned', ':Targeted', ':OnMoneyTrail', ':Sanctioned']
const LISTS = ['risk_claims', 'protection_claims', 'traced_claims', 'suspect_labels']

describe('the judgement marks and their claims', () => {
  const skill = read('skills/chain-insights-cypher/SKILL.md')
  const section =
    skill.split('### Judgement marks: scams, victims and trails\n')[1]?.split('\n## ')[0] ?? ''

  it('reach Claude Desktop chat through the graph_query description', () => {
    const description = KNOWN_PUBLIC_TOOL_DESCRIPTIONS['graph_query'] ?? ''
    expect(description).toContain(GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE)
    for (const claim of JUDGEMENT_CLAIMS) expect(description, claim.value).toContain(claim.value)
    for (const name of [...MARKS, ...LISTS]) expect(description, name).toContain(name)
  })

  it('are taught by the skill section, the served hints and the guides, every value', () => {
    expect(section, 'the skill has no Judgement marks section').not.toBe('')
    const hints = servedGraphHints()
    for (const claim of JUDGEMENT_CLAIMS) {
      expect(section, `skill misses ${claim.value}`).toContain(`\`${claim.value}\``)
      expect(hints, `served hints miss ${claim.value}`).toMatch(new RegExp(`\\b${claim.value}\\b`))
      expect(read('docs/graph-tools.md'), `graph-tools misses ${claim.value}`).toContain(
        `\`${claim.value}\``
      )
    }
    for (const name of [...MARKS, ...LISTS]) {
      expect(section, name).toContain(name)
      expect(hints, name).toContain(name)
    }
  })

  it('answer a risk question, and never volunteer one on a flow question', () => {
    const flat = skill.replace(/\s+/g, ' ')
    expect(flat).toContain('4. A risk question is answered from the graph')
    expect(flat).toContain('Do not volunteer a risk screen when the user asked about flows')
    expect(flat).not.toContain('The graph serves no risk verdict today')
  })

  it('give every value plain words with no code and no list name in them', () => {
    for (const claim of JUDGEMENT_CLAIMS) {
      expect(claim.plain, claim.value).not.toMatch(CODE)
      expect(claim.plain.length, claim.value).toBeGreaterThan(10)
    }
    for (const example of JUDGEMENT_ANSWER_EXAMPLES) expect(example).not.toMatch(CODE)
    // The example answers of the skill are quoted plain words too.
    const said =
      /The answer says what each one means, in plain words: (.+?)\. Never print/.exec(
        section.replace(/\s+/g, ' ')
      )?.[1] ?? ''
    expect(said).toContain('"a fake-token scam"')
    expect(said).not.toMatch(CODE)
  })

  it('never call a dust receiver or a poisoning target a victim', () => {
    const flat = section.replace(/\s+/g, ' ')
    expect(flat).toContain('Receiving a fake token or dust never makes a victim.')
    expect(flat).toContain('Never call it a victim.')
    expect(GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE).toContain(
      'Receiving a fake token or dust never makes a victim.'
    )
  })

  it('say the graph holds no link from an accused address to its victims', () => {
    expect(section.replace(/\s+/g, ' ')).toContain(
      'The graph holds no link from an accused address to its victims, so answer per address.'
    )
    expect(GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE).toContain(
      'The graph holds no link from an accused address to its victims'
    )
  })
})
