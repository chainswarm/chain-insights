import { read } from './schema-text.js'

// The properties each facts relationship serves, as the graph server maps them,
// pinned in tests/fixtures/facts-columns.json by scripts/pin-facts-columns.mjs. A
// text that lists the columns of a facts row, or names one in a query, is held to
// this list and never to a literal of its own.

export type FactsRelationship = { relationship: string; properties: string[] }

export type FactsColumns = {
  source: string
  server_commit: string
  relationships: FactsRelationship[]
}

let pinned: FactsColumns | undefined

export function factsColumns(): FactsColumns {
  pinned ??= JSON.parse(read('tests/fixtures/facts-columns.json')) as FactsColumns
  return pinned
}

/** The properties a facts relationship serves, in the server's order. */
export function propertiesOf(relationship: string): string[] {
  const found = factsColumns().relationships.find((entry) => entry.relationship === relationship)
  if (!found) throw new Error(`the pin holds no facts relationship ${relationship}`)
  return found.properties
}
