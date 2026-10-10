// The one source of the routing rule of the three read layers, and of the move
// that each class of refusal asks of an agent.
//
// Three places teach them: the graph hints that the MCP proxy serves
// (GRAPH_SCHEMA_HINTS in proxy.ts builds its two routing hints from this file),
// the `chain-insights-cypher` skill and docs/graph-tools.md. The skill and the
// guide are Markdown and hold the lines word for word. tests/layer-routing.test.ts
// fails when one of the three differs from this file by one word.
//
// The rule follows the graph server's own: topology searches outward from one
// known address, while facts and chain look up one known thing. The wording asks
// the agent to say first what the question names (an address, a pair with a day,
// a transaction, a block), because a question that names none of them is served
// on no layer today. Nothing here is a limit. A limit that the server publishes
// is read from `meta_network_capabilities`, and the text names the field, never
// the number.
//
// `USE chain` serves the four labels of the server's chain catalogue and no
// other: a transaction by its `tx_id`, a block by its `block_height` or its
// `block_hash`, an address at one block (`Address`, with an optional `at_block`),
// and the head, which takes no key. A kind (`:Account`, `:Contract`) is never a
// lookup label: the `Address` lookup reads it as `is_contract` and `nonce`.
// tests/fixtures/chain-catalogue.json pins the labels, and
// tests/chain-catalogue-pin.test.ts holds every chain recipe and the chain
// routing line to them. The depth below which a past block is served is a limit
// that the server publishes, so the text names its field and never its number.

/** The routing rule, in one sentence. The server states it in the same words. */
export const ROUTING_RULE =
  'Route by what the question names: an address, a pair with a day, a transaction or a block. Topology searches outward from an address, while facts and chain look up one known thing.'

/** The rule in three lines, one for each layer. */
export const ROUTING_LINES = [
  'I know an address and want its links, senders, receivers, hops or a route: `USE topology`, anchored on that address.',
  'I know both addresses of a pair and one day, and want the rows of that day: `USE facts`.',
  "I want the chain's own record of a transaction by its `tx_id`, a block by its `block_height` or `block_hash`, an address at one block (`Address`), or the head: `USE chain`.",
] as const

/** The chain layer reads one address at one block. A search for counterparties stays on topology. */
export const ROUTING_ADDRESS_ON_CHAIN =
  '`USE chain` with `Address` reads the balance, the nonce or the kind of one address, now or at a past block with `at_block`. A past block must be at least `chain_admission.at_block_min_depth` blocks below the tip. To find the counterparties of an address, search `USE topology`, then read the pair and one day on `USE facts`.'

/** What to do when two layers fit. */
export const ROUTING_TWO_FIT =
  'A transaction is a chain question: read it on `USE chain` by its `tx_id`. Chain gives its `block_date`; the transfers between a pair on that day are a `USE facts` read.'

/** The key that each layer hands to the next. Each key keeps its name. */
export const ROUTING_HANDOFF =
  'The layers hand each other keys, and each key keeps its name. Topology gives the pair and the first and last seen time. Facts gives the `tx_id` and the `block_height`. Chain takes an `address`, a `tx_id`, a `block_height` or a `block_hash`, and gives the `block_date` of a transaction or a block.'

/** A whole-chain question is a time-bounded topology search; a server without search mode refuses it once. */
export const ROUTING_NOT_SERVED =
  'A question about the whole chain (recent activity, the biggest senders, a top list) is a `USE topology` search: bound it by time with `f.last_seen_timestamp >= <epoch ms>` on the `FLOWS_TO` link, then sort and `LIMIT`. A search has 10 s. Read `Head` first (`USE chain MATCH (h:Head) RETURN h.graph_blocks_behind`, under a second): when `graph_blocks_behind` is above 100000, about a day of blocks, the search cannot finish, so do not send it; say the graph is that many blocks behind the head and ask for an address. If the server refuses the search with `anchor_missing`, or stops it with `query_timeout`, it cannot search the whole chain now: say so in one line and ask for an address. A narrower window times out the same way, so do not send it again.'

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
  return [
    ROUTING_RULE,
    ...ROUTING_LINES,
    ROUTING_ADDRESS_ON_CHAIN,
    ROUTING_TWO_FIT,
    ROUTING_HANDOFF,
    ROUTING_NOT_SERVED,
  ]
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
 * The routing rule and its three lines, with the question that no layer serves,
 * as one paragraph. The proxy serves it first among its instructions: a host
 * that keeps only the start of the instructions (Claude Code keeps 2 KB) still
 * shows the agent where each kind of question goes, and which kind goes nowhere.
 */
export function routingHead(): string {
  return `Pick the layer first. ${ROUTING_RULE} 1. ${ROUTING_LINES[0]} 2. ${ROUTING_LINES[1]} 3. ${ROUTING_LINES[2]} ${ROUTING_NOT_SERVED}`
}

/**
 * The two hints that the MCP proxy serves for routing and for refusals. Each is
 * one line of the served instructions.
 */
export function routingHintLines(): string[] {
  return [
    `- Pick the layer first. ${ROUTING_RULE} 1. ${ROUTING_LINES[0]} 2. ${ROUTING_LINES[1]} 3. ${ROUTING_LINES[2]} ${ROUTING_NOT_SERVED} ${ROUTING_ADDRESS_ON_CHAIN} ${ROUTING_TWO_FIT} ${ROUTING_HANDOFF} The lookups that USE chain serves are listed in chain_admission.lookups of meta_network_capabilities. Read every limit that the server publishes from meta_network_capabilities (chain_admission and, when the server sends them, topology_admission and facts_admission). Never write a limit down.`,
    `- Act on a refusal by its class. ${moveLines().join(' ')}`,
  ]
}
