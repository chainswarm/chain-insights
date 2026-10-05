import { read } from './schema-text.js'

// The chain lookup catalogue of the graph server, pinned in
// tests/fixtures/chain-catalogue.json by scripts/pin-chain-catalogue.mjs. It is
// the only list of what `USE chain` serves. Every label, key and property a
// `USE chain` query names is read from here, never written down in a test.

export type ChainLabel = {
  label: string
  answers: string
  keys: string[]
  key_rule: string
  properties: string[]
}

export type ChainCatalogue = {
  source: string
  server_commit: string
  rules_version: string
  grammar: string
  labels: ChainLabel[]
}

let pinned: ChainCatalogue | undefined

export function chainCatalogue(): ChainCatalogue {
  pinned ??= JSON.parse(read('tests/fixtures/chain-catalogue.json')) as ChainCatalogue
  return pinned
}

// A lookup is one node of a served label, with its key in braces as a literal, a
// RETURN of properties of that node, and no WHERE, no relationship and no range.
const CHAIN_LOOKUP =
  /^USE chain MATCH \((\w+):(\w+)(?: \{([^{}]*)\})?\) RETURN ((?:\w+\.\w+)(?:, \w+\.\w+)*)(?: LIMIT (\d+))?$/
const LITERAL_KEY = String.raw`(?:"[^"$]*"|\d+)`

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** The problem of a `USE chain` lookup, read against the pinned catalogue, or null. */
export function chainLookupProblem(
  query: string,
  catalogue: ChainCatalogue = chainCatalogue()
): string | null {
  const served = catalogue.labels.map((entry) => entry.label)
  const found = CHAIN_LOOKUP.exec(query)
  if (!found) {
    return `is not one node of ${list(served)} with a RETURN of properties`
  }
  const [, variable, label, keys, returned, limit] = found
  const entry = catalogue.labels.find((candidate) => candidate.label === label)
  if (!entry) return `names :${label}, and the catalogue serves ${list(served)}`
  if (limit !== undefined && Number(limit) > 1) return `has a LIMIT of ${limit}, at most 1`
  for (const item of (returned ?? '').split(', ')) {
    if (!item.startsWith(`${variable}.`)) {
      return `returns ${item}, which is not a property of ${variable}`
    }
    const property = item.slice(variable.length + 1)
    if (!entry.properties.includes(property)) {
      return `returns ${item}, and ${label} does not serve ${property}`
    }
  }
  const key = new RegExp(String.raw`^(\w+): (${LITERAL_KEY})$`).exec(keys ?? '')
  if (entry.keys.length === 0) {
    return keys === undefined ? null : `names a key, and ${label} takes none`
  }
  if (keys === undefined) return `names no key, and ${label} takes one`
  if (!key) return `names a key that is not a literal: ${keys}`
  if (!entry.keys.includes(key[1])) {
    return `names a ${label} by ${key[1]}, and it takes ${list(entry.keys)}`
  }
  return null
}

/**
 * Every `USE chain` lookup written in a text: a fenced query of a skill, a
 * `cia mcp call` line of the guide, a query inside a served hint. The query runs
 * to the end of the fence or of the quoted argument that holds it.
 */
export function chainLookupsIn(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ')
  return [...flat.matchAll(/USE chain MATCH [^`']*/g)].map((match) => {
    // A query holds no ". " and no " | ": a property reads as `t.status`, with no
    // space after the dot. So the first of those ends the query and starts the
    // prose or the next table cell that follows it.
    const sentence = match[0].search(/\.\s|\s\|/)
    const query = sentence === -1 ? match[0] : match[0].slice(0, sentence)
    return query.trim().replace(/[.,;]+$/, '')
  })
}
