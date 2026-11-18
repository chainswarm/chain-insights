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

/**
 * One contract by its address is a facts lookup too, with one node and no day
 * (src/mcp/contract-read.ts holds the read and what its answer means).
 */
export const ROUTING_CONTRACT =
  '"What is this contract" and "what can its owner do", for one contract address, is a `USE facts` `Contract` read by that address, with no pair and no day.'

/** The chain layer reads one address at one block. A search for counterparties stays on topology. */
export const ROUTING_ADDRESS_ON_CHAIN =
  '`USE chain` with `Address` reads the balance, the nonce or the kind of one address, now or at a past block with `at_block`. A past block must be at least `chain_admission.at_block_min_depth` blocks below the tip. To find the counterparties of an address, search `USE topology`, then read the pair and one day on `USE facts`.'

/** What to do when two layers fit. */
export const ROUTING_TWO_FIT =
  'A transaction is a chain question: read it on `USE chain` by its `tx_id`. Chain gives its `block_date`; the transfers between a pair on that day are a `USE facts` read.'

/** The key that each layer hands to the next. Each key keeps its name. */
export const ROUTING_HANDOFF =
  'The layers hand each other keys, and each key keeps its name. Topology gives the pair and the first and last seen time. Facts gives the `tx_id` and the `block_height`. Chain takes an `address`, a `tx_id`, a `block_height` or a `block_hash`, and gives the `block_date` of a transaction or a block.'

/**
 * Where money entered an exchange: the link `SWEPT` (layer `cex_sweeps`, family
 * annotations) and the node property `cex_role`. A trail ends at it.
 */
export const ROUTING_SWEPT =
  "`SWEPT` runs from an exchange deposit to the hot wallet it swept into (layer `cex_sweeps`, family annotations), and `cex_role` on an `:Exchange` address says which wallet of its exchange it is: `deposit`, `hot_wallet`, `cold_wallet` or `withdrawal`. A trail that reaches a `SWEPT` link ends there: say the money entered the exchange at that deposit, swept n times into that hot wallet, name the exchange from `labels`, and never walk on past a hot wallet. Read `SWEPT` anchored on an address; call `aml_exchange_deposit_check` for one address and `meta_exchange_lookup` for an exchange by name. With no `cex_role`, `inferred_exchange_role` (`deposit` or `hot_wallet`, with its `ml:exchange-roles:` entry in `inferred_sources`) is the exchange model's guess, never a label: say it is inferred by that model, never a confirmed exchange address."

/**
 * A whole-chain question is a time-bounded topology search, sent only when the
 * family of its link type is close to the head; a refusal names the family.
 */
export const ROUTING_NOT_SERVED =
  "A question about the whole chain (recent activity, the biggest senders, a top list) is a `USE topology` search: bound it by time with `f.last_seen_timestamp >= <epoch ms>` on the `FLOWED_TO` link, then sort and `LIMIT`. A search has 10 s. Read `Head` first (`USE chain MATCH (h:Head) RETURN h.behind_money, h.behind_dex, h.behind_transfers`, under a second): a `FLOWED_TO` or `ROUTED_TO` search is sent when `behind_money` is at most 100000; a `SWAPPED`, `ADDED_LIQUIDITY` or `REMOVED_LIQUIDITY` search when `behind_dex` is at most 100000; a `TRANSFERRED` search when `behind_transfers` is at most 100000 (100000 blocks is a few hours: a robinhood block is about a tenth of a second apart from the next). When the family is further behind, the search cannot finish, so do not send it: say which family, how many blocks, and ask for an address. On a server whose Head has no `behind_money`, read `h.graph_blocks_behind` and hold it to the same limit. On a server whose Head has no `behind_transfers`, it serves no `TRANSFERRED` link: send no `TRANSFERRED` search. Never turn the block count into days or hours by head. To say how fresh the data is, give the newest `_utc` time you read on the layer you used: a family's lag counts its slowest layer, and the links of an address and the facts rows are often newer than it. If the server refuses the search with `anchor_missing` or `family_behind`, or stops it with `query_timeout`, it cannot search the whole chain now: say so in one line, name the family the refusal names, and ask for an address or drop the link type that is behind. A narrower window times out the same way, so do not send it again."

/**
 * The level rule, in one sentence. The descriptions of graph_query and
 * meta_dex_lookup carry it word for word, so a host that loads no skill reads
 * it, and every skill that teaches the levels repeats it
 * (tests/host-parity.test.ts).
 */
export const LEVEL_RULE =
  'Money is read on three levels: level 2 (`FLOWED_TO`, `ROUTED_TO`) traces money, one link per pair of addresses in USD, level 1 (`TRANSFERRED`, `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`) holds the assets and the pools, and a single transaction is a `USE facts` row.'

/** Which links a trace walks, and which links answer a pool question. */
export const LEVEL_TRACE =
  "Where money went or came from is a walk on `FLOWED_TO` and `ROUTED_TO`: a `ROUTED_TO` step is a swap that changes the asset, a self link when the payer got the bought asset itself, and the payer's `SWAPPED` links name what it sold, what it got and at which pool. A router or a pool never holds the money. Who traded at a pool is its `SWAPPED` links, each from a trader to the pool, and who provides its liquidity is `ADDED_LIQUIDITY` and `REMOVED_LIQUIDITY`."

/** How a reader tells the two graph shapes apart, lane by lane. */
export const LEVEL_LANE =
  'A lane whose `money` family in `meta_network_capabilities` lists no `ROUTED_TO` has the graph of before: there `SWAPPED` runs from a payer to a recipient and holds the whole route, with its `pools`.'

/** What a pool is on the levels: no trace, its level 1 links. */
export const LEVEL_POOL =
  'A pool has no level 2 link. Asked about a pool, say it is a pool and offer its traders and its liquidity providers from level 1, never an empty trace.'

/** The actor exposure read (AC11 hint) on a lane with the levels. */
export const LEVEL_EXPOSURE =
  'On a lane whose `money` family lists `ROUTED_TO`, the actor exposure read over one `LINKED` hop walks `FLOWED_TO|ROUTED_TO` and returns `r.amount_usd_sum` and `r.tx_count`, which both links carry, in place of `FLOWED_TO|SWAPPED` and `coalesce(r.amount_usd_sum, r.bought_usd)`.'

/** Which link list a guarded walk or route sends, lane by lane. */
export const LEVEL_WALK =
  'A guarded walk or route writes `FLOWED_TO|ROUTED_TO` on a lane whose `money` family lists `ROUTED_TO`, and `FLOWED_TO|SWAPPED` on the graph of before; nothing else in it changes.'

/** The level sentences, in the order a reader meets them. */
export function levelLines(): string[] {
  return [LEVEL_RULE, LEVEL_TRACE, LEVEL_POOL, LEVEL_LANE, LEVEL_WALK, LEVEL_EXPOSURE]
}

/**
 * The shape of the swap links a lane serves. `levels`: `ROUTED_TO` is the whole
 * route of a payer and a receiver (level 2) and `SWAPPED` runs from a trader to
 * one pool (level 1). `route`: the graph of before, where `SWAPPED` runs from a
 * payer to a recipient and holds the route.
 */
export type SwapLinkShape = 'levels' | 'route'

/** One family as `meta_network_capabilities` reports it in `graph_progress.families`. */
export interface ServedFamily {
  name: string
  layers: string[]
  link_types?: string[]
  link_levels?: Record<string, number>
}

/**
 * The shape of a lane, from its `money` family: `levels` when the family lists
 * `ROUTED_TO` (in `link_types` or `link_levels`) or its layer `routed`, else
 * `route`. A lane that reports no families has the graph of before.
 */
export function swapLinkShape(families: readonly ServedFamily[] | undefined): SwapLinkShape {
  const money = families?.find((family) => family.name === 'money')
  if (!money) return 'route'
  const lists =
    money.link_types?.includes('ROUTED_TO') === true ||
    (money.link_levels !== undefined && 'ROUTED_TO' in money.link_levels) ||
    money.layers.includes('routed')
  return lists ? 'levels' : 'route'
}

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
    ROUTING_CONTRACT,
    ROUTING_ADDRESS_ON_CHAIN,
    ROUTING_TWO_FIT,
    ROUTING_HANDOFF,
    ROUTING_SWEPT,
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
  return `Pick the layer first. ${ROUTING_RULE} 1. ${ROUTING_LINES[0]} 2. ${ROUTING_LINES[1]} 3. ${ROUTING_LINES[2]} ${ROUTING_CONTRACT} ${ROUTING_NOT_SERVED}`
}

/**
 * The three hints that the MCP proxy serves for routing, for refusals and for
 * the levels of money. Each is one line of the served instructions.
 */
export function routingHintLines(): string[] {
  return [
    `- Pick the layer first. ${ROUTING_RULE} 1. ${ROUTING_LINES[0]} 2. ${ROUTING_LINES[1]} 3. ${ROUTING_LINES[2]} ${ROUTING_CONTRACT} ${ROUTING_NOT_SERVED} ${ROUTING_ADDRESS_ON_CHAIN} ${ROUTING_TWO_FIT} ${ROUTING_HANDOFF} ${ROUTING_SWEPT} The lookups that USE chain serves are listed in chain_admission.lookups of meta_network_capabilities. Read every limit that the server publishes from meta_network_capabilities (chain_admission and, when the server sends them, topology_admission and facts_admission). Never write a limit down.`,
    `- Act on a refusal by its class. ${moveLines().join(' ')}`,
    `- ${levelLines().join(' ')}`,
  ]
}
