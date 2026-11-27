import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  addressCardFault,
  cardDictionariesOf,
  packagedAddressCardPath,
  readPackagedAddressCard,
  type AddressCardDocument,
  type LoadedAddressCard,
} from '../src/mcp/address-card.js'
import {
  addressRiskFromMembers,
  handleAmlAddressRisk,
  rowRisk,
  type AmlAddressRiskResult,
} from '../src/mcp/address-risk.js'
import { partyOf } from '../src/mcp/pool-risk.js'
import {
  NEXT_CARD_VERSION,
  holdsNextWords,
  wordsFor,
  type CardDictionaries,
} from '../src/mcp/risk-word.js'
import type { Member } from '../src/mcp/token-lookup.js'
import { repoRoot } from './dex-registry.js'

// Cards as the staging graph served them on 2026-11-27, read with graph_query
// (`properties(a)`), card_version 4: the card holds the next words (malicious,
// suspect, victim) in evidence and judgements, and categories and
// case_judgements beside them. They are read by registry/address-card-next.json.
// A card of an older version is read by the frozen registry/address-card.json.

const readCard = (file: string): LoadedAddressCard => ({
  document: JSON.parse(
    readFileSync(join(repoRoot, 'registry', file), 'utf8')
  ) as AddressCardDocument,
  source: 'packaged',
})
const frozen = readCard('address-card.json')
const next = readCard('address-card-next.json')
const dictionaries: CardDictionaries = {
  frozen: frozen.document.words,
  next: next.document.words,
  nextVersion: NEXT_CARD_VERSION,
}

const OFAC = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'
const IMPERSONATOR = '0x00077705952c90b728c6d7dc450beb4429331111'
const DEPLOYER = '0x01917b0c50898a56769e4f49c6fb08d24d543149'
const COPIED_TOKEN = '0xd60e1de4eb0e14f49dc49c2579c07d4c69a1b46c'
const VICTIM = '0x792093f44d08d27989b4cbfaebacfffa2ea53897'
const POISONER = '0x0025f4ea78dc7d7293585d47e0f95243e5079e7c'

const STAGING: Record<string, Record<string, unknown>> = {
  [OFAC]: {
    node_labels: ['Address', 'Malicious'],
    card_version: '4',
    evidence: ['malicious:Lazarus Group'],
    categories: ['malicious'],
    case_judgements: ['malicious|sanctioned||list:data:ofac-sanctions'],
    is_malicious: true,
    sources: ['registry'],
    risk_level: null,
    risk_score: null,
  },
  [IMPERSONATOR]: {
    node_labels: ['Address', 'Account', 'Malicious'],
    card_version: '4',
    evidence: ['malicious:INBOUND_IMPERSONATION'],
    categories: ['malicious'],
    case_judgements: ['malicious|inbound-impersonation|scammer|'],
    is_malicious: true,
    sources: ['evidence'],
    risk_level: 'HIGH',
    risk_score: 0.800000011920929,
  },
  [DEPLOYER]: {
    node_labels: ['Address', 'Account', 'Malicious'],
    card_version: '4',
    evidence: ['malicious:FAKE_TOKEN_DEPLOYER'],
    judgements: ['suspect:FAKE_TOKEN_LP'],
    categories: ['malicious'],
    case_judgements: ['malicious|fake-token|deployer|', 'suspect|fake-token||'],
    is_malicious: true,
    sources: ['evidence'],
    risk_level: 'MEDIUM',
    risk_score: 0.45299145579338074,
  },
  [COPIED_TOKEN]: {
    node_labels: ['Address', 'Contract', 'Token'],
    card_version: '4',
    evidence: null,
    judgements: ['suspect:FAKE_TOKEN'],
    categories: ['suspect'],
    case_judgements: ['suspect|fake-token|fake_token|'],
    sources: ['evidence'],
    risk_level: null,
    risk_score: null,
  },
  [VICTIM]: {
    node_labels: ['Address', 'Account', 'Victim'],
    card_version: '4',
    evidence: ['victim'],
    judgements: null,
    categories: ['victim'],
    case_judgements: ['victim|||'],
    sources: ['evidence'],
    risk_level: 'LOW',
    risk_score: 0.0006451786612160504,
  },
  // A card of the frozen words (tests/fixtures/label-words-both-forms.json).
  [POISONER]: {
    node_labels: ['Address', 'Poisoned'],
    card_version: '2',
    evidence: ['poisoning:ADDRESS_POISONING'],
    judgements: null,
    sources: ['evidence'],
    risk_level: null,
    risk_score: null,
  },
}

const ok = (id: string, results: unknown[]): Member => ({ id, ok: true, results })

function answer(
  address: string,
  words: CardDictionaries | CardDictionaries['frozen'] = dictionaries
) {
  const members = new Map<string, Member>([
    ['node', ok('node', [STAGING[address]])],
    ['in', ok('in', [])],
    ['out', ok('out', [])],
  ])
  const built = addressRiskFromMembers('robinhood', address, members, words, [])
  if ('failure' in built) throw new Error(built.failure)
  return built.result
}

describe('aml_address_risk: a card on the next words', () => {
  it('the OFAC-sanctioned address is critical from the label rules', () => {
    const result = answer(OFAC)
    expect(result.risk).toMatchObject({
      word: 'critical',
      rules_word: 'critical',
      set_by: 'rules',
      unknown_words: [],
      card_version: '4',
    })
    expect(result.risk.reasons[0]).toMatchObject({
      word: 'malicious',
      value: 'Lazarus Group',
      question: 'evidence',
      level: 'critical',
      standing: 'reported',
    })
    expect(result).toMatchObject({ category: 'malicious', type: 'sanctioned' })
  })

  it('an inbound impersonator is critical from the label rules, above the model high', () => {
    const result = answer(IMPERSONATOR)
    expect(result.risk).toMatchObject({
      word: 'critical',
      rules_word: 'critical',
      model_word: 'high',
      set_by: 'rules',
      unknown_words: [],
    })
    expect(result).toMatchObject({
      category: 'malicious',
      type: 'inbound-impersonation',
      role: 'scammer',
    })
  })

  it('a fake-token deployer is critical from the label rules, above the model medium; its suspect pattern sets nothing', () => {
    const result = answer(DEPLOYER)
    expect(result.risk).toMatchObject({
      word: 'critical',
      rules_word: 'critical',
      model_word: 'medium',
      set_by: 'rules',
      unknown_words: [],
    })
    expect(result.risk.reasons.map((reason) => [reason.word, reason.value, reason.level])).toEqual([
      ['malicious', 'FAKE_TOKEN_DEPLOYER', 'critical'],
      ['pattern', 'FAKE_TOKEN_LP', 'none'],
    ])
    expect(result).toMatchObject({ category: 'malicious', type: 'fake-token', role: 'deployer' })
  })

  it('a suspect fake token sets no word: it is shown as a pattern', () => {
    const result = answer(COPIED_TOKEN)
    expect(result.risk).toMatchObject({
      word: 'unscored',
      rules_word: 'none',
      set_by: 'none',
      unknown_words: [],
    })
    expect(result.risk.reasons).toEqual([
      expect.objectContaining({
        word: 'pattern',
        value: 'FAKE_TOKEN',
        question: 'judgement',
        level: 'none',
      }),
    ])
    expect(result).toMatchObject({ category: 'pattern', type: 'fake-token', role: 'fake_token' })
  })

  it('a victim sets no word: the model speaks alone', () => {
    const result = answer(VICTIM)
    expect(result.risk).toMatchObject({
      word: 'low',
      rules_word: 'none',
      set_by: 'model',
      unknown_words: [],
    })
    expect(result.risk.reasons[0]).toMatchObject({
      word: 'victim',
      question: 'evidence',
      level: 'none',
    })
    expect(result.category).toBe('victim')
  })

  it('a card of the frozen words still scores by the frozen dictionary', () => {
    const result = answer(POISONER)
    expect(result.risk).toMatchObject({
      word: 'critical',
      rules_word: 'critical',
      set_by: 'rules',
      unknown_words: [],
    })
    expect(result.risk.reasons[0]).toMatchObject({ word: 'poisoning', value: 'ADDRESS_POISONING' })
    expect(answer(POISONER, frozen.document.words).risk).toEqual(result.risk)
  })

  it('a card whose entries name no category still gets its level from case_judgements', () => {
    const row = { ...STAGING[OFAC], evidence: null }
    const risk = rowRisk(row, dictionaries)
    expect(risk).toMatchObject({ word: 'critical', rules_word: 'critical', unknown_words: [] })
    expect(risk.reasons[0]).toMatchObject({
      word: 'malicious',
      value: 'sanctioned',
      level: 'critical',
    })
  })

  it('a mule that still holds the money is high, never raised to critical by its case judgement', () => {
    const row = {
      card_version: '4',
      evidence: ['malicious:RECEIVED'],
      categories: ['malicious'],
      case_judgements: ['malicious|poisoning|mule|case:7'],
    }
    expect(rowRisk(row, dictionaries)).toMatchObject({ word: 'high', rules_word: 'high' })
    expect(rowRisk({ ...row, evidence: null }, dictionaries).word).toBe('critical')
  })

  it('without the next dictionary, the words are listed as unknown and set nothing', () => {
    const result = answer(IMPERSONATOR, { ...dictionaries, next: null })
    expect(result.risk.unknown_words).toEqual(['malicious'])
    expect(result.risk).toMatchObject({ word: 'high', set_by: 'model' })
  })
})

describe('which dictionary reads a card', () => {
  it('card_version 4 and above reads the next words; an older version reads the frozen words', () => {
    expect(holdsNextWords({ card_version: '4' })).toBe(true)
    expect(holdsNextWords({ card_version: 5 })).toBe(true)
    expect(holdsNextWords({ card_version: '2', categories: ['malicious'] })).toBe(false)
    expect(holdsNextWords({ categories: ['malicious'] })).toBe(true)
    expect(holdsNextWords({ case_judgements: ['victim|||'] })).toBe(true)
    expect(holdsNextWords({ is_malicious: true })).toBe(false)
    expect(holdsNextWords(undefined)).toBe(false)
    expect(wordsFor(STAGING[OFAC], dictionaries)).toBe(dictionaries.next)
    expect(wordsFor(STAGING[POISONER], dictionaries)).toBe(dictionaries.frozen)
    expect(wordsFor(STAGING[OFAC], frozen.document.words)).toBe(frozen.document.words)
  })

  it('the packaged next dictionary is valid and is found beside the frozen one', () => {
    expect(addressCardFault(next.document)).toBeNull()
    expect(packagedAddressCardPath('next')).toMatch(/registry[\\/]address-card-next\.json$/)
    expect(readPackagedAddressCard(packagedAddressCardPath('next'))?.version).toBe(
      next.document.version
    )
  })

  it('a next dictionary that fails to load leaves the frozen one answering', async () => {
    const loaded = await cardDictionariesOf(
      async () => frozen,
      async () => {
        throw new Error('offline')
      }
    )
    expect(loaded).toEqual({
      frozen: frozen.document.words,
      next: null,
      nextVersion: NEXT_CARD_VERSION,
    })
    await expect(cardDictionariesOf(async () => null)).rejects.toThrow(/no copy/)
  })
})

describe('the handlers read the next dictionary', () => {
  it('aml_address_risk answers critical for the OFAC-sanctioned address', async () => {
    const result = await handleAmlAddressRisk(
      { network: 'robinhood', address: OFAC },
      {
        loadAddressCard: async () => frozen,
        loadAddressCardNext: async () => next,
        loadExchangeRegistry: async () => {
          throw new Error('no registry in this test')
        },
        graphQueryBatch: async (batch) => ({
          structuredContent: {
            facts: {
              queries: batch.queries.map(({ id }) =>
                ok(id, id === 'node' ? [{ ...STAGING[OFAC], degree_total: 3 }] : [])
              ),
            },
          },
        }),
        describeFailure: (err) => (err as Error).message,
      }
    )
    expect(result.isError).toBe(false)
    const structured = result.structuredContent as unknown as AmlAddressRiskResult
    expect(structured.risk).toMatchObject({ word: 'critical', set_by: 'rules', unknown_words: [] })
  })

  it('a token-risk party (the deployer of a fake token) reads its card by the same rule', () => {
    const party = partyOf('deployer', DEPLOYER, STAGING[DEPLOYER], dictionaries)
    expect(party.risk).toMatchObject({
      word: 'critical',
      set_by: 'rules',
      unknown_words: [],
      card_version: '4',
    })
  })
})
