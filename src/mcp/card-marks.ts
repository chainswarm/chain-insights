/**
 * The judgement marks of one address node, read by the card's own words.
 *
 * A card of the frozen words (card_version below 4) carries the role flags
 * `is_scam`, `is_sanctioned` and `is_victim`. A card of the next words
 * (card_version 4 and above, see holdsNextWords) no longer carries `is_scam`
 * or `is_sanctioned`: it carries `is_malicious`, the list `categories`
 * (malicious, suspect, victim) and the list `case_judgements`
 * (`category|type|role|case`), whose type says which kind of malicious it is,
 * such as `sanctioned`. A suspect accuses nobody, so it sets no mark.
 *
 * Every tool that names a role or a crime from a node reads it here, so the
 * flows role, the details view and the deployer screen agree on both cards.
 * Pure: no read.
 */
import { holdsNextWords, splitCaseJudgement, type CaseJudgement } from './risk-word.js'

/** The node fields a reader asks for to tell the two cards apart and read either. */
export const CARD_MARK_FIELDS = [
  'card_version',
  'is_sanctioned',
  'is_scam',
  'is_victim',
  'is_malicious',
  'categories',
  'case_judgements',
] as const

export interface CardMarks {
  /** True when the card holds the next words and was read by them. */
  next_words: boolean
  sanctioned: boolean
  /** The frozen words' scam mark (is_scam); always false on a card of the next words. */
  scam: boolean
  /** The next words' malicious mark (is_malicious or the category); false on a frozen card. */
  malicious: boolean
  victim: boolean
  /**
   * The malicious case judgements of a card of the next words, in card order;
   * empty on a frozen card. A sanctioned case is in this list too.
   */
  malicious_cases: CaseJudgement[]
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** The case type of a sanctions listing. */
export const SANCTIONED_CASE_TYPE = 'sanctioned'

const isSanctionedCase = (judgement: CaseJudgement): boolean =>
  judgement.type !== null && judgement.type.toLowerCase() === SANCTIONED_CASE_TYPE

/** The marks of one node row whose fields are named as in CARD_MARK_FIELDS. */
export function cardMarksOf(row: Record<string, unknown> | undefined): CardMarks {
  const source = row ?? {}
  if (!holdsNextWords(source)) {
    return {
      next_words: false,
      sanctioned: source.is_sanctioned === true,
      scam: source.is_scam === true,
      malicious: false,
      victim: source.is_victim === true,
      malicious_cases: [],
    }
  }
  const categories = strings(source.categories).map((category) => category.trim().toLowerCase())
  const cases = strings(source.case_judgements)
    .map(splitCaseJudgement)
    .filter((judgement): judgement is CaseJudgement => judgement !== null)
  const maliciousCases = cases.filter((judgement) => judgement.category === 'malicious')
  return {
    next_words: true,
    sanctioned: maliciousCases.some(isSanctionedCase),
    scam: false,
    malicious:
      source.is_malicious === true || categories.includes('malicious') || maliciousCases.length > 0,
    victim:
      source.is_victim === true ||
      categories.includes('victim') ||
      cases.some((judgement) => judgement.category === 'victim'),
    malicious_cases: maliciousCases,
  }
}

/** True when the card carries a malicious case other than a sanctions listing. */
export function hasMaliciousAct(marks: CardMarks): boolean {
  return (
    marks.malicious_cases.some((judgement) => !isSanctionedCase(judgement)) ||
    (marks.malicious && marks.malicious_cases.length === 0)
  )
}

/**
 * The fields of one side of a prefixed row (`launcher_card_version`, ...) as
 * a plain node row, for cardMarksOf.
 */
export function cardFieldsOf(
  row: Record<string, unknown>,
  prefix: string
): Record<string, unknown> {
  return Object.fromEntries(CARD_MARK_FIELDS.map((field) => [field, row[`${prefix}_${field}`]]))
}

/** `n.card_version AS <prefix>card_version, ...` for a read of node `n`. */
export function cardMarkColumns(node: string, prefix = ''): string {
  return CARD_MARK_FIELDS.map((field) => `${node}.${field} AS ${prefix}${field}`).join(', ')
}
