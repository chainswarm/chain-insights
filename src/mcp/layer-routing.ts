// The one source of the routing rule of the three read layers, and of the move
// that each class of refusal asks of an agent.
//
// Three places teach them: the graph hints that the MCP proxy serves
// (GRAPH_SCHEMA_HINTS in proxy.ts builds its two routing hints from this file),
// the `chain-insights-cypher` skill and docs/graph-tools.md. The skill and the
// guide are Markdown and hold the lines word for word. tests/layer-routing.test.ts
// fails when one of the three differs from this file by one word.
//
// The rule is the graph server's own: topology searches, while facts and chain
// look up one known thing. Nothing here is a limit. A limit that the server
// publishes is read from `meta_network_capabilities`, and the text names the
// field, never the number.

/** The routing rule, in one sentence. The server states it in the same words. */
export const ROUTING_RULE =
  'Route by what you know: topology searches, while facts and chain look up one known thing.'

/** The rule in three lines, one for each layer. */
export const ROUTING_LINES = [
  'I do not know the thing yet: `USE topology`.',
  'I know the pair and the day, or the transaction hash, and want the indexed rows: `USE facts`.',
  "I know one address, hash or block and want the chain's own record of it: `USE chain`.",
] as const

/** What to do when two layers fit. */
export const ROUTING_TWO_FIT =
  'When two fit, as with a hash: ask `USE chain` first for the record and the result, then `USE facts` for the transfers it caused.'

/** The key that each layer hands to the next. */
export const ROUTING_HANDOFF =
  'The layers hand each other keys. Topology gives the pair and the first and last seen time. Chain gives the `block_date` of a hash or a height. Facts gives the `tx_id`.'

/** A question that no layer serves. */
export const ROUTING_NOT_SERVED =
  'A list, a range or a whole-chain question is served on no layer. Say so, and go back to an anchored `USE topology` search.'

/** What a refusal carries, and which part of it decides the move. */
export const MOVE_INTRO =
  'A refused, killed, busy or failed query comes back with `error_detail`: `code`, `rule`, `class`, `fix` and `example`. The `class` decides your next move.'

/** The move for each class of the refusal envelope. */
export const MOVE_BY_CLASS = {
  refused: 'Class `refused`: read `fix`, rewrite the query from `example`, and send it once.',
  killed: 'Class `killed`: narrow the query (fewer properties, rows or hops) and send it once.',
  capacity: 'Class `capacity`: wait at least 5 seconds, then send the same query once.',
  failed: 'Class `failed`: tell the user what is down. Do not retry.',
} as const

/** A `fix` that names another layer. */
export const MOVE_OTHER_LAYER = 'A `fix` that names another layer means move to that layer.'

/** One try, then the user. Never a loop. */
export const MOVE_ONCE =
  'One rewrite or one retry for each query. When it is refused or busy again, stop and tell the user. Quote the `fix` text and send nothing more for that question.'

/** After a refusal or a kill the server has already said no. */
export const MOVE_NEVER_SAME = 'Never send the same text again after `refused` or `killed`.'

/** A batch has good members that already ran. */
export const MOVE_BATCH = 'In a batch, send again only the members that came back `capacity`.'

/** The routing sentences, in the order a reader meets them. */
export function routingLines(): string[] {
  return [ROUTING_RULE, ...ROUTING_LINES, ROUTING_TWO_FIT, ROUTING_HANDOFF, ROUTING_NOT_SERVED]
}

/** The move-by-class sentences, in the order a reader meets them. */
export function moveLines(): string[] {
  return [
    MOVE_INTRO,
    MOVE_BY_CLASS.refused,
    MOVE_BY_CLASS.killed,
    MOVE_BY_CLASS.capacity,
    MOVE_BY_CLASS.failed,
    MOVE_OTHER_LAYER,
    MOVE_ONCE,
    MOVE_NEVER_SAME,
    MOVE_BATCH,
  ]
}

/**
 * The two hints that the MCP proxy serves for routing and for refusals. Each is
 * one line of the served instructions.
 */
export function routingHintLines(): string[] {
  return [
    `- Pick the layer first. ${ROUTING_RULE} 1. ${ROUTING_LINES[0]} 2. ${ROUTING_LINES[1]} 3. ${ROUTING_LINES[2]} ${ROUTING_TWO_FIT} ${ROUTING_HANDOFF} ${ROUTING_NOT_SERVED} The lookups that USE chain serves are listed in chain_admission.lookups of meta_network_capabilities. Read every limit that the server publishes from meta_network_capabilities (chain_admission and, when the server sends them, topology_admission and facts_admission). Never write a limit down.`,
    `- Act on a refusal by its class. ${moveLines().join(' ')}`,
  ]
}
