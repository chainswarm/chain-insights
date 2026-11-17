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
//
// `levels` names the level of a link type: 2 traces money, one link per pair of
// addresses in USD (`FLOWED_TO`, `ROUTED_TO`); 1 holds the assets and the pools
// (`TRANSFERRED`, `SWAPPED`, the liquidity links). Level 0 is the single
// transaction, a facts row, and is never a link. A link type with no level is
// absent from the map, and a family with no levelled link has no map.

import table from './families.json' with { type: 'json' }

/** The level of a link type: 2 traces money per pair of addresses, 1 holds the assets and the pools. */
export type LinkLevel = 1 | 2

/** One family: its name, the graph layers it groups, the link types it serves, and their levels. */
export interface LayerFamily {
  name: string
  layers: string[]
  link_types: string[]
  levels?: Record<string, LinkLevel>
}

/** The families in the server's order: money first, transfers last. */
export const LAYER_FAMILIES: readonly LayerFamily[] = table.families as LayerFamily[]

/** The family a link type belongs to, or undefined for a link type outside the table. */
export function familyOfLinkType(type: string): LayerFamily | undefined {
  return LAYER_FAMILIES.find((family) => family.link_types.includes(type))
}

/** The level of a link type, or undefined for a link type with no level. */
export function levelOfLinkType(type: string): LinkLevel | undefined {
  return familyOfLinkType(type)?.levels?.[type]
}

/** The link types of one level, in the table's order. */
export function linkTypesOfLevel(level: LinkLevel): string[] {
  return LAYER_FAMILIES.flatMap((family) =>
    family.link_types.filter((type) => family.levels?.[type] === level)
  )
}
