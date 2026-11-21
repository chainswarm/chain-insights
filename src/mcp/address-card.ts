/**
 * The address card dictionary, as meta_schema serves it.
 *
 * Every :Address node of the graph carries one resolved card: what the address
 * is (identity), which wallet it is (address_roles), what one week of counts
 * shows (behaviour), what it did or what was done to it (evidence), the risky
 * patterns that convict nobody (judgements), its risk, and who gave the
 * answers (sources). registry/address-card.json names each card property with
 * its question, its meaning and its closed values, each mark and each flag with
 * the words that give it, each card word with its question, its level and its
 * plain sentence (words), and the one rule an agent follows. The file is
 * generated from the label vocabulary and never edited by hand.
 *
 * The proxy reads it through the shared public file loader
 * (src/mcp/public-file.ts):
 *
 *   cached    ~/.chain-insights/cache/address-card.json, younger than one hour
 *   fetched   https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/address-card.json
 *   packaged  registry/address-card.json of the installed package
 *
 * A malformed file is refused with one line naming the fault, and the packaged
 * copy answers. A dictionary merged on main reaches every running proxy within
 * the hour, with no release.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chainInsightsHome } from './cache-location.js'
import { loadPublicFile, type LoadedPublicFile, type PublicFileOptions } from './public-file.js'

export const ADDRESS_CARD_URL_ENV = 'CHAIN_INSIGHTS_ADDRESS_CARD_URL'
export const ADDRESS_CARD_PUBLIC_URL =
  'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/address-card.json'
export const ADDRESS_CARD_FILE = 'registry/address-card.json'

/**
 * The `rule` of registry/address-card.json, word for word. It is the one text
 * of the card every host reads: the meta_schema description carries it.
 * tests/graph-schema-address-card.test.ts holds it to the file.
 */
export const ADDRESS_CARD_RULE =
  'Read the address card (identity, address_roles, behaviour, evidence, judgements, risk), not the labels list.'

/** One property of the card on an :Address node. */
export interface AddressCardProperty {
  name: string
  /** `string`, `integer` or `list<string>`. */
  type: string
  /** The question it answers: identity, role, behaviour, evidence, judgement, or card for the card's own fields. */
  question: string
  means: string
  /** The closed values, when the property has them. */
  values?: string[]
  /** How one entry is written when it carries a value: `word:VALUE`. */
  value_form?: string
}

/** A mark (a node label) or a flag (a true-or-false property) and the card words that give it. */
export interface AddressCardMark {
  name: string
  question: string
  words: string[]
}

/** The levels a card word may carry, lowest first. */
export const ADDRESS_CARD_LEVELS = ['none', 'low', 'medium', 'high', 'critical'] as const
export type AddressCardLevel = (typeof ADDRESS_CARD_LEVELS)[number]

/**
 * One word of the card dictionary: the word, the question it answers, its
 * level, and the one fixed sentence that says what it means. An item with a
 * value is the meaning of `word:VALUE`; the item with none is every other
 * value of the word.
 */
export interface AddressCardWord {
  word: string
  question: string
  level: AddressCardLevel
  value?: string
  /** proven or reported, when the word says how it is known. */
  standing?: string
  plain: string
}

export interface AddressCardDocument {
  generated_from?: string
  version: string
  rule: string
  properties: AddressCardProperty[]
  marks: AddressCardMark[]
  flags: AddressCardMark[]
  sources: string[]
  words: AddressCardWord[]
}

export type LoadedAddressCard = LoadedPublicFile<AddressCardDocument>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isWord = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const isWordList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isWord)

function markFault(list: unknown, field: 'marks' | 'flags'): string | null {
  if (!Array.isArray(list)) return `${field} is not a list`
  const names = new Set<string>()
  for (const [index, entry] of list.entries()) {
    const at = `${field}[${index}]`
    if (!isRecord(entry)) return `${at} is not an object`
    if (!isWord(entry.name)) return `${at} has no name`
    if (names.has(entry.name)) return `${at} ${entry.name} is listed twice`
    names.add(entry.name)
    if (!isWord(entry.question)) return `${at} (${entry.name}) has no question`
    if (!isWordList(entry.words)) return `${at} (${entry.name}) words is not a list of words`
  }
  return null
}

/** The fault of a card dictionary, or null when it is valid. */
export function addressCardFault(value: unknown): string | null {
  if (!isRecord(value)) return 'the file is not a JSON object'
  if (!isWord(value.version)) return 'version is missing'
  if (!isWord(value.rule)) return 'rule is missing'
  if (!Array.isArray(value.properties) || value.properties.length === 0) {
    return 'properties is empty'
  }
  const names = new Set<string>()
  for (const [index, property] of value.properties.entries()) {
    const at = `properties[${index}]`
    if (!isRecord(property)) return `${at} is not an object`
    if (typeof property.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(property.name)) {
      return `${at} name is not a property name: ${String(property.name)}`
    }
    if (names.has(property.name)) return `${at} ${property.name} is listed twice`
    names.add(property.name)
    for (const field of ['type', 'question', 'means'] as const) {
      if (!isWord(property[field])) return `${at} (${property.name}) has no ${field}`
    }
    if (property.values !== undefined && !isWordList(property.values)) {
      return `${at} (${property.name}) values is not a list of words`
    }
    if (property.value_form !== undefined && !isWord(property.value_form)) {
      return `${at} (${property.name}) value_form is empty`
    }
  }
  const marks = markFault(value.marks, 'marks')
  if (marks) return marks
  const flags = markFault(value.flags, 'flags')
  if (flags) return flags
  if (!isWordList(value.sources)) return 'sources is not a list of words'
  return wordsFault(value.words)
}

/** The fault of the words list, or null. A file with no words is refused, so the packaged copy answers. */
function wordsFault(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return 'words is not a list'
  for (const [index, entry] of list.entries()) {
    const at = `words[${index}]`
    if (!isRecord(entry)) return `${at} is not an object`
    if (!isWord(entry.word)) return `${at} has no word`
    if (!isWord(entry.question)) return `${at} (${entry.word}) has no question`
    if (!(ADDRESS_CARD_LEVELS as readonly unknown[]).includes(entry.level)) {
      return `${at} (${entry.word}) level is not one of ${ADDRESS_CARD_LEVELS.join(', ')}`
    }
    if (!isWord(entry.plain)) return `${at} (${entry.word}) has no plain sentence`
    if (entry.value !== undefined && !isWord(entry.value)) return `${at} (${entry.word}) value is empty`
    if (entry.standing !== undefined && !isWord(entry.standing)) {
      return `${at} (${entry.word}) standing is empty`
    }
  }
  return null
}

/** The version as a number, so a newer packaged copy wins; 0 when it is not a number. */
export function addressCardVersion(document: AddressCardDocument): number {
  const version = Number(document.version)
  return Number.isFinite(version) ? version : 0
}

/** The URL of the served copy: the public file on main, or the override. */
export function addressCardUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env[ADDRESS_CARD_URL_ENV]?.trim() || ADDRESS_CARD_PUBLIC_URL
}

export function addressCardCachePath(): string {
  return path.join(chainInsightsHome(), 'cache', 'address-card.json')
}

/** registry/address-card.json of the installed package: next to dist/, or the repository root when run from source. */
export function packagedAddressCardPath(): string {
  const candidates = [
    fileURLToPath(new URL('../registry/address-card.json', import.meta.url)),
    fileURLToPath(new URL('../../registry/address-card.json', import.meta.url)),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

/** The packaged copy, or null when the package carries none. A packaged copy that fails the rules throws. */
export function readPackagedAddressCard(
  file: string = packagedAddressCardPath()
): AddressCardDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const fault = addressCardFault(parsed)
  if (fault) throw new Error(`the packaged ${ADDRESS_CARD_FILE} is malformed: ${fault}`)
  return parsed as AddressCardDocument
}

export interface LoadAddressCardOptions extends PublicFileOptions {
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
  /** The packaged file, for a test. */
  packagedFile?: string
}

const defaultLog = (line: string): void => {
  process.stderr.write(`[chain-insights] address-card: ${line}\n`)
}

/** The card dictionary: the fresh cache, else the public file, else the stale cache, else the packaged copy. Null when there is none. */
export async function loadAddressCard(
  options: LoadAddressCardOptions = {}
): Promise<LoadedAddressCard | null> {
  return loadPublicFile<AddressCardDocument>(
    {
      url: addressCardUrl(options.env),
      cachePath: addressCardCachePath(),
      fault: addressCardFault,
      packaged: readPackagedAddressCard(options.packagedFile),
      version: addressCardVersion,
      log: options.log ?? defaultLog,
    },
    options
  )
}

// ─── The answer of meta_schema ────────────────────────────────────────────────

/** The card as meta_schema serves it: the file's rows, unchanged, and where they came from. */
export interface AddressCardSection {
  file: typeof ADDRESS_CARD_FILE
  version: string
  source: LoadedAddressCard['source']
  rule: string
  properties: AddressCardProperty[]
  marks: AddressCardMark[]
  flags: AddressCardMark[]
}

export function addressCardSection(loaded: LoadedAddressCard): AddressCardSection {
  const { document } = loaded
  return {
    file: ADDRESS_CARD_FILE,
    version: document.version,
    source: loaded.source,
    rule: document.rule,
    properties: document.properties,
    marks: document.marks,
    flags: document.flags,
  }
}

function propertyLine(property: AddressCardProperty): string {
  const entries = property.value_form ? `, entries ${property.value_form}` : ''
  const values = property.values?.length ? ` Values: ${property.values.join(', ')}.` : ''
  return `- ${property.name} (${property.type}, question ${property.question}${entries}): ${property.means}${values}`
}

function markLine(mark: AddressCardMark): string {
  return `- ${mark.name} (question ${mark.question}): ${mark.words.join(', ')}`
}

/** The card as the model and the terminal read it. */
export function formatAddressCardLines(card: AddressCardSection): string[] {
  return [
    `Address card, on every :Address node (${card.file}, version ${card.version}, ${card.source})`,
    `Rule: ${card.rule}`,
    'Card properties:',
    ...card.properties.map(propertyLine),
    'Marks, the node labels a card word gives:',
    ...card.marks.map(markLine),
    'Flags, true when the card holds one of the words:',
    ...card.flags.map(markLine),
  ]
}
