/**
 * The risk word of an address: the one fixed rule every risk answer applies.
 *
 * Two signals sit on an :Address node of the graph:
 *
 *   rules  the card's entries (identity, evidence, judgements), each a word the
 *          card dictionary (registry/address-card.json, list `words`) gives a
 *          level, a standing and a plain sentence;
 *   model  the risk model's `risk_level` (HIGH, MEDIUM, LOW, or unscored) and
 *          its `risk_score`, a number from 0 to 1.
 *
 * The word of the answer is the higher of the two. A label word is never
 * lowered by the model, and only a label gives `critical`. An address no label
 * and no model speaks about is `unscored`, which is neither `low` nor safe.
 *
 * The word is computed here from the entries, never taken from the node's own
 * `risk` property: a card resolved with an older dictionary may still hold the
 * level a word had then. Pure: no read, no clock.
 */

import type { AddressCardLevel, AddressCardWord } from './address-card.js'

/** The levels, lowest first: critical > high > medium > low > none. */
export const RISK_LEVELS = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
] as const satisfies readonly AddressCardLevel[]
export type RiskLevel = (typeof RISK_LEVELS)[number]

/** The words an answer's risk may carry. */
export const RISK_WORDS = ['critical', 'high', 'medium', 'low', 'unscored'] as const
export type RiskWord = (typeof RISK_WORDS)[number]

/** The model's word: it never gives critical. */
export const MODEL_WORDS = ['high', 'medium', 'low', 'not_scored'] as const
export type ModelWord = (typeof MODEL_WORDS)[number]

/** Who set the word: the labels, the model, both at the same level, or nobody (unscored). */
export type SetBy = 'rules' | 'model' | 'both' | 'none'

/** The questions whose words give the rules word. A judgement's level is always none today. */
export const RULES_QUESTIONS = ['evidence', 'identity', 'judgement'] as const

/**
 * On a card of the frozen words, a word whose dictionary item answers the
 * question `judgement` reaches a reader as `pattern`, with its value: a
 * judgement shows a pattern and accuses nobody. That holds for
 * `suspect:FAKE_TOKEN` and for `scam:FAKE_TOKEN` alike. On a card of the next
 * words a judgement shows its own word, `suspect`: a reader takes a suspect as
 * not fully safe, and it still sets no level.
 */
export const JUDGEMENT_WORD_SHOWN = 'pattern'

/** Why the word is what it is: one card entry, or the model. */
export interface Reason {
  word: string
  value?: string
  question: string
  standing?: string
  level: RiskLevel
  plain: string
}

export interface Risk {
  word: RiskWord
  score: number | null
  rules_word: RiskLevel
  model_word: ModelWord
  set_by: SetBy
}

export function levelRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level)
}

/** The rank of an answer's word: unscored below low, so any spoken word outranks it. */
export function riskWordRank(word: RiskWord): number {
  return word === 'unscored' ? -1 : levelRank(word)
}

const isLevel = (value: unknown): value is RiskLevel =>
  (RISK_LEVELS as readonly unknown[]).includes(value)

/** One card entry split at its first colon: `word` or `word:VALUE`. A value may hold colons. */
export function splitCardEntry(entry: string): { word: string; value: string | null } {
  const text = entry.trim()
  const cut = text.indexOf(':')
  if (cut < 0) return { word: text, value: null }
  const value = text.slice(cut + 1).trim()
  return { word: text.slice(0, cut).trim(), value: value === '' ? null : value }
}

/**
 * The dictionary item of one card entry, by word and value only, whatever
 * card list the entry came from: the item of the same word and the same value
 * (compared without case), else the item of that word with no value. Null for
 * a word the dictionary does not hold. The item's question is the entry's:
 * the graph writes `scam:FAKE_TOKEN_LP` in `evidence`, and the dictionary
 * says it is a judgement of level none.
 */
export function cardWordOf(
  entry: string,
  dictionaryWords: readonly AddressCardWord[]
): AddressCardWord | null {
  const { word, value } = splitCardEntry(entry)
  if (word === '') return null
  const wanted = word.toLowerCase()
  const items = dictionaryWords.filter((item) => item.word.toLowerCase() === wanted)
  if (value !== null) {
    const exact = items.find((item) => item.value?.toLowerCase() === value.toLowerCase())
    if (exact) return exact
  }
  return items.find((item) => item.value === undefined) ?? null
}

/**
 * The reason of one card entry, or null for a word the dictionary does not
 * hold. Its question, level, standing and plain sentence are the dictionary
 * item's; the value is the entry's own, as the card wrote it. `nextWords` is
 * true when the next dictionary reads the card: a judgement then shows its own
 * word, `suspect`.
 */
export function reasonOf(
  entry: string,
  dictionaryWords: readonly AddressCardWord[],
  nextWords = false
): Reason | null {
  const item = cardWordOf(entry, dictionaryWords)
  if (!item || !isLevel(item.level)) return null
  const { word, value } = splitCardEntry(entry)
  const shown = item.question === 'judgement' && !nextWords ? JUDGEMENT_WORD_SHOWN : word.toLowerCase()
  return {
    word: shown,
    ...(value !== null ? { value } : {}),
    question: item.question,
    ...(item.standing ? { standing: item.standing } : {}),
    level: item.level,
    plain: item.plain,
  }
}

// ─── Which dictionary reads a card ────────────────────────────────────────────

/**
 * The two card dictionaries: the frozen words (registry/address-card.json) and
 * the next words (registry/address-card-next.json: malicious, suspect, victim,
 * with categories and case_judgements on the card). A card resolved with the
 * next words is read by the next dictionary, every other card by the frozen
 * one. `next` is null when no copy of the next dictionary loaded.
 */
export interface CardDictionaries {
  frozen: readonly AddressCardWord[]
  next: readonly AddressCardWord[] | null
  /** The first card_version of the next words: a card of this version or above holds them. */
  nextVersion: number
}

/** A plain word list (one dictionary for every card) or the two dictionaries. */
export type CardWords = readonly AddressCardWord[] | CardDictionaries

/** The first card_version resolved with the next words (label vocabulary v4). */
export const NEXT_CARD_VERSION = 4

export function isCardDictionaries(words: CardWords): words is CardDictionaries {
  return !Array.isArray(words)
}

const nonEmptyList = (value: unknown): boolean =>
  Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.trim() !== '')

/**
 * True when the card holds the next words. The card_version decides when the
 * card carries one: 4 (the first version of the next words) or above. A card
 * with no version holds them when it carries a field only the next words
 * write: categories or case_judgements.
 */
export function holdsNextWords(
  row: Record<string, unknown> | undefined,
  nextVersion: number = NEXT_CARD_VERSION
): boolean {
  if (!row) return false
  const raw = typeof row.card_version === 'string' ? row.card_version.trim() : row.card_version
  if (raw !== null && raw !== undefined && raw !== '') {
    const version = Number(raw)
    if (Number.isFinite(version)) return version >= nextVersion
  }
  return nonEmptyList(row.categories) || nonEmptyList(row.case_judgements)
}

/** True when the next dictionary reads this card row: it is loaded and the card holds the next words. */
export function readsNextWords(row: Record<string, unknown> | undefined, words: CardWords): boolean {
  return isCardDictionaries(words) && words.next !== null && holdsNextWords(row, words.nextVersion)
}

/** The dictionary that reads one card row. */
export function wordsFor(
  row: Record<string, unknown> | undefined,
  words: CardWords
): readonly AddressCardWord[] {
  if (!isCardDictionaries(words)) return words
  return readsNextWords(row, words) && words.next ? words.next : words.frozen
}

// ─── case_judgements ──────────────────────────────────────────────────────────

/** The categories of the next words, the strongest first: malicious wins over suspect, suspect over victim. */
export const CARD_CATEGORIES = ['malicious', 'suspect', 'victim'] as const

/** One case_judgements entry, `category|type|role|case`, each part trimmed; empty parts are null. */
export interface CaseJudgement {
  category: string
  type: string | null
  role: string | null
  case: string | null
}

export function splitCaseJudgement(entry: string): CaseJudgement | null {
  const [category = '', type = '', role = '', ...rest] = entry.split('|').map((part) => part.trim())
  if (category === '') return null
  const caseText = rest.join('|').trim()
  return {
    category: category.toLowerCase(),
    type: type === '' ? null : type,
    role: role === '' ? null : role,
    case: caseText === '' ? null : caseText,
  }
}

type NextWord = AddressCardWord & { category?: string; type?: string; role?: string }

/** The item of the highest level; the first one on a tie. */
function highest<T extends AddressCardWord>(items: readonly T[]): T {
  return items.reduce((best, item) =>
    isLevel(item.level) && isLevel(best.level) && levelRank(item.level) > levelRank(best.level)
      ? item
      : best
  )
}

/**
 * The dictionary item of one case judgement: an item of the category's word
 * whose type and role both match, else one with no type and the same role (a
 * mule), else one of the same type, else one of the same role, else the
 * category's item with no value. Among equal matches the
 * highest level wins. Null when the dictionary holds no item of the category.
 */
export function caseJudgementWordOf(
  judgement: CaseJudgement,
  dictionaryWords: readonly AddressCardWord[]
): AddressCardWord | null {
  const items = (dictionaryWords as readonly NextWord[]).filter(
    (item) => item.word.toLowerCase() === judgement.category && item.question !== 'identity'
  )
  if (items.length === 0) return null
  const same = (a: string | undefined, b: string | null) =>
    a !== undefined && b !== null && a.toLowerCase() === b.toLowerCase()
  const tiers: Array<(item: NextWord) => boolean> = [
    (item) => same(item.type, judgement.type) && same(item.role, judgement.role),
    // A mule's type is the type of its trail: its items name the role and no type.
    (item) => item.type === undefined && same(item.role, judgement.role),
    (item) => same(item.type, judgement.type),
    (item) => same(item.role, judgement.role),
    (item) => item.value === undefined,
  ]
  for (const tier of tiers) {
    const found = items.filter(tier)
    if (found.length === 0) continue
    return highest(found)
  }
  return highest(items)
}

/**
 * The reason of one case judgement, or null when the dictionary does not hold
 * its category. A judgement shows its own word when the next dictionary reads
 * the card (`nextWords`), `pattern` otherwise.
 */
export function caseJudgementReasonOf(
  judgement: CaseJudgement,
  dictionaryWords: readonly AddressCardWord[],
  nextWords = false
): Reason | null {
  const item = caseJudgementWordOf(judgement, dictionaryWords)
  if (!item || !isLevel(item.level)) return null
  return {
    word: item.question === 'judgement' && !nextWords ? JUDGEMENT_WORD_SHOWN : judgement.category,
    ...(judgement.type !== null ? { value: judgement.type } : {}),
    question: item.question,
    ...(item.standing ? { standing: item.standing } : {}),
    level: item.level,
    plain: item.plain,
  }
}

/** The category a dictionary item gives, when it names one. */
export function categoryOfWord(item: AddressCardWord): string | null {
  const category = (item as NextWord).category
  return typeof category === 'string' && category.trim() !== '' ? category.toLowerCase() : null
}

/** The highest level among the reasons of the rules questions; none when no reason carries one. */
export function rulesWordOf(reasons: readonly Reason[]): RiskLevel {
  let best: RiskLevel = 'none'
  for (const reason of reasons) {
    if (!(RULES_QUESTIONS as readonly string[]).includes(reason.question)) continue
    if (levelRank(reason.level) > levelRank(best)) best = reason.level
  }
  return best
}

/** The model's word from the node's risk_level: HIGH, MEDIUM, LOW in any case; anything else is not_scored. */
export function modelWordOf(riskLevel: unknown): ModelWord {
  const level = typeof riskLevel === 'string' ? riskLevel.trim().toLowerCase() : ''
  return level === 'high' || level === 'medium' || level === 'low' ? level : 'not_scored'
}

/** The model's number, unchanged: a finite number from 0 to 1, else null. */
export function modelScoreOf(riskScore: unknown): number | null {
  const score =
    typeof riskScore === 'number'
      ? riskScore
      : typeof riskScore === 'string' && riskScore.trim() !== ''
        ? Number(riskScore)
        : Number.NaN
  return Number.isFinite(score) && score >= 0 && score <= 1 ? score : null
}

/** The one sentence of the model's reason per level: the same for every address. */
export const MODEL_REASON_PLAIN: Record<Exclude<ModelWord, 'not_scored'>, string> = {
  high: 'The risk model scores this address high.',
  medium: 'The risk model scores this address medium.',
  low: 'The risk model scores this address low.',
}

/** The reason a model-set word carries: a prediction, and said as one. */
export function modelReasonOf(modelWord: Exclude<ModelWord, 'not_scored'>): Reason {
  return {
    word: 'model',
    question: 'model',
    standing: 'predicted',
    level: modelWord,
    plain: MODEL_REASON_PLAIN[modelWord],
  }
}

/**
 * The word: the higher of the rules word and the model word. `unscored` when
 * neither speaks. The score is the model's, never one made for a label.
 */
export function riskOf(input: {
  rulesWord: RiskLevel
  modelWord: ModelWord
  score: number | null
}): Risk {
  const { rulesWord, modelWord } = input
  const score = modelScoreOf(input.score)
  if (rulesWord === 'none' && modelWord === 'not_scored') {
    return { word: 'unscored', score, rules_word: rulesWord, model_word: modelWord, set_by: 'none' }
  }
  const rules = levelRank(rulesWord)
  const model = modelWord === 'not_scored' ? levelRank('none') : levelRank(modelWord)
  // Either side speaks here, so the top level is above none.
  const setBy: SetBy =
    modelWord === 'not_scored' || rules > model ? 'rules' : model > rules ? 'model' : 'both'
  const top = RISK_LEVELS[Math.max(rules, model)] as Exclude<RiskLevel, 'none'>
  return {
    word: top,
    score,
    rules_word: rulesWord,
    model_word: modelWord,
    set_by: setBy,
  }
}
