import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AddressCardDocument } from '../src/mcp/address-card.js'
import { rowRisk } from '../src/mcp/address-risk.js'
import {
  cardWordOf,
  modelScoreOf,
  modelWordOf,
  riskOf,
  rulesWordOf,
  splitCardEntry,
} from '../src/mcp/risk-word.js'
import { repoRoot } from './dex-registry.js'

// The one rule of the risk word: the higher of what the labels prove and what
// the risk model predicts, computed from the card entries and the packaged card
// dictionary. Every case is one node row, as the graph returns it.

const card = JSON.parse(
  readFileSync(join(repoRoot, 'registry', 'address-card.json'), 'utf8')
) as AddressCardDocument
const words = card.words

type Case = {
  name: string
  row: Record<string, unknown>
  word: string
  rules_word: string
  model_word: string
  set_by: string
  score?: number | null
  reasons: Array<Record<string, unknown>>
  unknown_words?: string[]
}

const cases: Case[] = [
  {
    name: 'a scam label with the model at low: the label wins, the score stays the model number',
    row: { evidence: ['scam'], risk_level: 'LOW', risk_score: 0.01 },
    word: 'critical',
    rules_word: 'critical',
    model_word: 'low',
    set_by: 'rules',
    score: 0.01,
    reasons: [
      {
        word: 'scam',
        question: 'evidence',
        standing: 'proven',
        level: 'critical',
        plain: 'Named as a scam actor, with a proven act or on an imported list.',
      },
    ],
  },
  {
    name: 'no label and the model at HIGH: the model sets it, said as a prediction',
    row: { risk_level: 'HIGH', risk_score: 0.93 },
    word: 'high',
    rules_word: 'none',
    model_word: 'high',
    set_by: 'model',
    score: 0.93,
    reasons: [
      {
        word: 'model',
        question: 'model',
        standing: 'predicted',
        level: 'high',
        plain: 'The risk model scores this address high.',
      },
    ],
  },
  {
    name: 'a label and the model at the same level: both',
    row: { evidence: ['traced'], risk_level: 'high', risk_score: '0.8' },
    word: 'high',
    rules_word: 'high',
    model_word: 'high',
    set_by: 'both',
    score: 0.8,
    reasons: [
      expect.objectContaining({ word: 'traced', level: 'high' }),
      expect.objectContaining({ word: 'model', standing: 'predicted', level: 'high' }),
    ],
  },
  {
    name: 'only a fake-token pattern and no model row: unscored, the pattern shown as a pattern',
    row: { judgements: ['suspect:FAKE_TOKEN'] },
    word: 'unscored',
    rules_word: 'none',
    model_word: 'not_scored',
    set_by: 'none',
    score: null,
    reasons: [
      {
        word: 'pattern',
        value: 'FAKE_TOKEN',
        question: 'judgement',
        level: 'none',
        plain: 'Copies the name or symbol of a verified token.',
      },
    ],
  },
  {
    name: 'a mixer deposit pattern and a trail: the trail sets high',
    row: { evidence: ['traced'], judgements: ['suspect:MIXER_DEPOSITOR'] },
    word: 'high',
    rules_word: 'high',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [
      expect.objectContaining({ word: 'traced', level: 'high' }),
      expect.objectContaining({ word: 'pattern', value: 'MIXER_DEPOSITOR', plain: 'Deposited into a mixer.' }),
    ],
  },
  {
    name: 'a laundering trail takes the level of its value',
    row: { evidence: ['traced:LAUNDERED'], risk_level: 'MEDIUM', risk_score: 0.4 },
    word: 'critical',
    rules_word: 'critical',
    model_word: 'medium',
    set_by: 'rules',
    reasons: [
      expect.objectContaining({
        word: 'traced',
        value: 'LAUNDERED',
        level: 'critical',
        plain: 'Received stolen funds on a money trail and moved them on.',
      }),
    ],
  },
  {
    name: 'a victim alone carries no level: unscored',
    row: { evidence: ['victim'] },
    word: 'unscored',
    rules_word: 'none',
    model_word: 'not_scored',
    set_by: 'none',
    reasons: [expect.objectContaining({ word: 'victim', level: 'none', standing: 'reported' })],
  },
  {
    name: 'an unknown word is listed and sets nothing; the model at low is low, set by the model',
    row: { evidence: ['frobnicated:X'], risk_level: 'Low', risk_score: 0.02 },
    word: 'low',
    rules_word: 'none',
    model_word: 'low',
    set_by: 'model',
    reasons: [expect.objectContaining({ word: 'model', level: 'low' })],
    unknown_words: ['frobnicated'],
  },
  {
    name: 'a value with a colon is cut at the first colon and falls back to the word',
    row: { evidence: ['sanctioned:OFAC:SDN'], risk_level: 'UNSCORED' },
    word: 'critical',
    rules_word: 'critical',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [
      expect.objectContaining({ word: 'sanctioned', value: 'OFAC:SDN', level: 'critical', standing: 'reported' }),
    ],
  },
  {
    name: 'a mixer identity is high; a name on the card is no entry',
    row: { identity: 'mixer', identity_name: 'tornado:0.1' },
    word: 'high',
    rules_word: 'high',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [expect.objectContaining({ word: 'mixer', question: 'identity', level: 'high' })],
  },
  {
    name: 'a fake-token deployer written as scam in evidence is the pattern fact the dictionary says it is',
    row: { evidence: ['scam:FAKE_TOKEN_DEPLOYER'] },
    word: 'unscored',
    rules_word: 'none',
    model_word: 'not_scored',
    set_by: 'none',
    reasons: [
      {
        word: 'pattern',
        value: 'FAKE_TOKEN_DEPLOYER',
        question: 'judgement',
        level: 'none',
        plain: 'Deployed a token that copies the name or symbol of a verified token.',
      },
    ],
  },
  {
    name: 'a scam value the dictionary does not list falls back to the word: critical',
    row: { evidence: ['scam:APPROVAL_DRAINER'] },
    word: 'critical',
    rules_word: 'critical',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [
      {
        word: 'scam',
        value: 'APPROVAL_DRAINER',
        question: 'evidence',
        standing: 'proven',
        level: 'critical',
        plain: 'Named as a scam actor, with a proven act or on an imported list.',
      },
    ],
  },
  {
    name: 'a mixer that is not the top identity still raises the word; a word of level none adds no reason',
    row: { identity: 'exchange', identity_name: 'gate', identities: ['exchange', 'mixer', 'hub', 'nonsense'] },
    word: 'high',
    rules_word: 'high',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [
      expect.objectContaining({ word: 'exchange', question: 'identity', level: 'none' }),
      expect.objectContaining({ word: 'mixer', question: 'identity', level: 'high' }),
    ],
    unknown_words: ['nonsense'],
  },
  {
    name: 'a value is matched without case',
    row: { evidence: ['traced:mixed'] },
    word: 'critical',
    rules_word: 'critical',
    model_word: 'not_scored',
    set_by: 'rules',
    reasons: [expect.objectContaining({ word: 'traced', value: 'mixed', level: 'critical' })],
  },
]

describe('the risk word', () => {
  it.each(cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const risk = rowRisk(entry.row, words)
    expect(risk).toMatchObject({
      word: entry.word,
      rules_word: entry.rules_word,
      model_word: entry.model_word,
      set_by: entry.set_by,
    })
    if (entry.score !== undefined) expect(risk.score).toBe(entry.score)
    expect(risk.reasons).toEqual(entry.reasons)
    expect(risk.unknown_words).toEqual(entry.unknown_words ?? [])
  })

  it('never shows the word suspect, and a label never makes a number', () => {
    for (const entry of cases) {
      const risk = rowRisk(entry.row, words)
      expect(JSON.stringify(risk)).not.toContain('suspect')
      if (entry.row.risk_score === undefined) expect(risk.score).toBeNull()
    }
  })

  it('the model never gives critical, and reads anything but its three levels as not scored', () => {
    expect(['HIGH', 'medium', ' Low ', 'CRITICAL', 'UNSCORED', null, undefined, 3].map(modelWordOf)).toEqual([
      'high',
      'medium',
      'low',
      'not_scored',
      'not_scored',
      'not_scored',
      'not_scored',
      'not_scored',
    ])
  })

  it('the score is the model number from 0 to 1, or null', () => {
    expect([0, 1, 0.5, '0.25', -0.1, 1.5, Number.NaN, 'x', null].map(modelScoreOf)).toEqual([
      0, 1, 0.5, 0.25, null, null, null, null, null,
    ])
  })

  it('the higher word wins and the label word is never lowered', () => {
    expect(riskOf({ rulesWord: 'medium', modelWord: 'high', score: 0.7 })).toEqual({
      word: 'high',
      score: 0.7,
      rules_word: 'medium',
      model_word: 'high',
      set_by: 'model',
    })
    expect(riskOf({ rulesWord: 'low', modelWord: 'low', score: null }).set_by).toBe('both')
    expect(riskOf({ rulesWord: 'critical', modelWord: 'low', score: 0.1 }).word).toBe('critical')
  })

  it('splits an entry at its first colon, and finds the item of the word or of its value', () => {
    expect(splitCardEntry('word')).toEqual({ word: 'word', value: null })
    expect(splitCardEntry('a:b:c')).toEqual({ word: 'a', value: 'b:c' })
    expect(splitCardEntry('a:')).toEqual({ word: 'a', value: null })
    expect(cardWordOf('poisoning:address_poisoning', words)?.value).toBe('ADDRESS_POISONING')
    expect(cardWordOf('poisoning:OTHER', words)?.value).toBeUndefined()
    expect(cardWordOf('', words)).toBeNull()
    expect(cardWordOf('nothing', words)).toBeNull()
    expect(cardWordOf('scam', words)?.question).toBe('evidence')
    expect(cardWordOf('scam:fake_token_lp', words)?.question).toBe('judgement')
  })

  it('takes the highest level among the rules questions only', () => {
    expect(
      rulesWordOf([
        { word: 'model', question: 'model', level: 'high', plain: 'x' },
        { word: 'exchange', question: 'identity', level: 'none', plain: 'x' },
      ])
    ).toBe('none')
  })
})
