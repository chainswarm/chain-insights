// The layer families of the graph, read from families.json.
//
// families.json is a verbatim copy of the graph server's own table, byte for
// byte. The server reports how
// far each family is complete in `graph_progress.families`, and the Head node
// carries one `behind_<family>` property for each block family. A whole-chain
// search on a link type is only sent when that link type's family is close to
// the head, so the skill reads the family of the link type it searches.
// tests/families-parity.test.ts holds this copy to the server's reply and to
// the family names the skill's whole-chain rule names.

import table from './families.json' with { type: 'json' }

/** One family: its name, the graph layers it groups, and the link types it serves. */
export interface LayerFamily {
  name: string
  layers: string[]
  link_types: string[]
}

/** The families in the server's order: money first, annotations last. */
export const LAYER_FAMILIES: readonly LayerFamily[] = table.families

/** The family a link type belongs to, or undefined for a link type outside the table. */
export function familyOfLinkType(type: string): LayerFamily | undefined {
  return LAYER_FAMILIES.find((family) => family.link_types.includes(type))
}
