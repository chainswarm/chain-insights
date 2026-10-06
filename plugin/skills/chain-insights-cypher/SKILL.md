---
name: chain-insights-cypher
description: Use when writing or reviewing Chain Insights graph_query or graph_query_batch ISO GQL, when choosing between USE topology, USE facts and USE chain, or when a graph query is refused. Dialect, layer and refusal rules only. Load a schema skill for labels and properties.
---

# Chain Insights Cypher

ISO GQL for `graph_query` and `graph_query_batch`.

This skill teaches the dialect, which layer a question goes to, and what to do
when the server refuses a query. It is not a query cookbook. Load
`chain-insights-schema-evm` for the label, relationship, and property map.

## Tools

| Tool                | Use                        |
| ------------------- | -------------------------- |
| `graph_query`       | One read-only query.       |
| `graph_query_batch` | Related reads in one call. |

Use `cia workflows` to discover high-level CIA workflows. Use `cia mcp tools`
to inspect remote GraphRAG tools, and `cia mcp call graph_query` or
`cia mcp call graph_query_batch` for agent-authored low-level reads.

Always pass an explicit `network`. Always add your own `LIMIT`. Chain
Insights Graph does not append one.

`per_query_timeout_seconds` is optional and capped.

## Pick the layer first

Route by what you know: topology searches, while facts and chain look up one known thing.

1. I do not know the thing yet: `USE topology`.
2. I know the pair and the day, or the transaction hash, and want the indexed rows: `USE facts`.
3. I want the chain's own record of a transaction by its hash, a block by its number or hash, or the head: `USE chain`.

`USE chain` has no address lookup. Find the address on `USE topology`, then read the pair and one day on `USE facts`.

When two fit, as with a hash: ask `USE chain` first for the record and the result, then `USE facts` for the transfers it caused.

The layers hand each other keys. Topology gives the pair and the first and last seen time. Chain gives the `block_date` of a hash or a height. Facts gives the `tx_id`.

A list, a range or a whole-chain question is served on no layer. Say so, and go back to an anchored `USE topology` search.

| The question                                                | Layer      | First query                                                  |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| Who is connected to this address? Where did the money go?   | `topology` | One anchored hop on `FLOWS_TO`, with a `LIMIT`.              |
| What moved between A and B on one day?                      | `facts`    | `TRANSFER` with both addresses and `block_date`.             |
| Which days did A and B trade?                               | `topology` | The link's `first_seen_timestamp` and `last_seen_timestamp`. |
| Did transaction `0x…` succeed? Which block, which day?      | `chain`    | `Transaction {hash}`.                                        |
| Which day is block N?                                       | `chain`    | `Block {height}`, and return `block_date`.                   |
| How far behind are the graph and the warehouse?             | `chain`    | `Head`.                                                      |
| A route between two known addresses                         | `topology` | `SHORTEST 1`, with the pool guard.                           |
| All swaps through pool X                                    | `topology` | Anchored on the pool address.                                |
| Every transaction of block N, or every address with label X | none       | A list or a scan. Say so. Do not retry.                      |

| Graph          | Backend                    | Dialect           |
| -------------- | -------------------------- | ----------------- |
| `USE topology` | DozerDB over Bolt          | ISO GQL, bounded. |
| `USE facts`    | Warehouse, compiled        | GQL subset.       |
| `USE chain`    | The chain node, one lookup | One keyed node.   |

`topology` serves the address graph, money flow (`FLOWS_TO`, `OPERATED_BY`), the `LINKED` overlay,
node risk, swaps and liquidity (`SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`, the `:Pool`
label) and bridges (`BRIDGED`). `facts` serves bounded `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`,
`LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows. `chain` serves the lookups that
`chain_admission.lookups` lists, one node at a time.

The `network` argument selects the graph. On topology, unscoped
`:Address` matches must also filter `:Address.network` when more than one
address space is present. Exact-address lookups do not need that extra
filter. Facts `Address` has no `network` property.

## When a query is refused

A refusal is an answer, not an outage. Act on its class.

A refused, killed, busy or failed query comes back with `error_detail`: `code`, `rule`, `class`, `fix` and `example`. The `class` decides your next move.

- Class `refused`: read `fix`, rewrite the query from `example`, and send it once.
- Class `killed`: narrow the query (fewer properties, rows or hops) and send it once.
- Class `capacity`: wait at least 5 seconds, then send the same query once.
- Class `failed`: tell the user what is down. Do not retry.

A `fix` that names another layer means move to that layer.

One rewrite or one retry for each query. When it is refused or busy again, stop and tell the user. Quote the `fix` text and send nothing more for that question.

Never send the same text again after `refused` or `killed`.

In a batch, send again only the members that came back `capacity`.

One row for each code that the server returns:

| Code                           | Layer    | Class    | Your next move                                                                                                                                                                                     |
| ------------------------------ | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_scope`                | any      | refused  | Begin the query with `USE topology`, `USE facts` or `USE chain`.                                                                                                                                   |
| `invalid_network`              | any      | refused  | Pass a network that `meta_network_capabilities` lists.                                                                                                                                             |
| `missing_network`              | any      | refused  | Pass `network=`, and pick one that `meta_network_capabilities` lists.                                                                                                                              |
| `unsupported_topology_dialect` | topology | refused  | Send one read statement in ISO GQL. Use a quantified path or `ANY SHORTEST`. `PROFILE`, the legacy shortest-path functions, a `*` range, writes, `CALL` and admin words are not served.            |
| `anchor_missing`               | topology | refused  | Pin one node to an address. Search on topology from an anchor, then read the pair and the day on facts, or one key on chain. A whole-chain question is served on no layer: say so.                 |
| `aggregate_unanchored`         | topology | refused  | Anchor every pattern before a sort, an aggregate, `DISTINCT` or `collect()`. A whole-chain ranking is served on no layer: say so.                                                                  |
| `cartesian_product`            | topology | refused  | Join the patterns with a shared variable, or anchor each of them.                                                                                                                                  |
| `hop_budget`                   | topology | refused  | Cut the path to `topology_admission.max_hops_per_path` hops, or to the number in the `fix`. Give every quantifier an upper bound.                                                                  |
| `route_search_refused`         | topology | refused  | Ask for one path: `SHORTEST 1` or `ANY SHORTEST`. Keep the repeated part short, as the `fix` says.                                                                                                 |
| `limit_missing`                | topology | refused  | End the read with a literal `LIMIT` within `topology_admission.max_limit`, or within the number in the `fix`.                                                                                      |
| `unsupported_expression_shape` | topology | refused  | Rewrite from `example`. Use `range()` or `reduce()` only inside `UNWIND`, and keep `OPTIONAL MATCH` and `UNION` few, as the `fix` says.                                                            |
| `query_too_large`              | topology | refused  | Shorten the query text and nest brackets less deep, as the `fix` says.                                                                                                                             |
| `query_timeout`                | topology | killed   | Narrow the query: fewer hops, a smaller `LIMIT`, fewer properties, or an address with a lower `degree_out` and `degree_in`.                                                                        |
| `query_memory_limit`           | topology | killed   | Return fewer rows or fewer properties. Anchor on an address with fewer links.                                                                                                                      |
| `topology_busy`                | topology | capacity | Wait at least 5 seconds (longer if the `fix` says so), then send the same query once.                                                                                                              |
| `topology_query_failed`        | topology | failed   | Tell the user the topology layer failed. Do not retry.                                                                                                                                             |
| `money_flow_facts_forbidden`   | facts    | refused  | Money flow is topology only. Move the read to `USE topology`.                                                                                                                                      |
| `facts_no_anchor`              | facts    | refused  | Name both addresses with one day, or one `tx_id`. Find the addresses on topology first. A whole-chain question is served on no layer: say so.                                                      |
| `facts_pair_required`          | facts    | refused  | Find the counterparties on `USE topology` first. Then name both addresses, from then to, with one day.                                                                                             |
| `facts_day_required`           | facts    | refused  | Name one day: `t.block_date = "YYYY-MM-DD"`.                                                                                                                                                       |
| `facts_window_too_wide`        | facts    | refused  | Name one day. For more days, send one read for each day.                                                                                                                                           |
| `facts_hops_refused`           | facts    | refused  | Read one relationship. Move the walk to `USE topology`.                                                                                                                                            |
| `facts_order_not_served`       | facts    | refused  | Drop `ORDER BY`. Sort the page yourself.                                                                                                                                                           |
| `facts_plan_refused`           | facts    | refused  | Rewrite from `example`. Name the two addresses and one day, or follow the `fix`. Do not widen the day.                                                                                             |
| `facts_query_memory_limit`     | facts    | killed   | Name fewer columns and a smaller `LIMIT`.                                                                                                                                                          |
| `facts_query_timeout`          | facts    | killed   | Name fewer columns and a smaller `LIMIT`.                                                                                                                                                          |
| `facts_query_cpu_limit`        | facts    | killed   | Name fewer columns and a smaller `LIMIT`.                                                                                                                                                          |
| `facts_busy`                   | facts    | capacity | Wait at least 5 seconds, then send the same query once.                                                                                                                                            |
| `facts_query_failed`           | facts    | failed   | Tell the user the facts layer failed. Do not retry.                                                                                                                                                |
| `chain_not_a_lookup`           | chain    | refused  | Look up one node by its key, as in `example`. A search or a path goes to `USE topology`.                                                                                                           |
| `chain_key_invalid`            | chain    | refused  | Write the key as `example` does: a full `0x` hash, or a block number.                                                                                                                              |
| `chain_not_served`             | chain    | refused  | Ask for a lookup that `chain_admission.lookups` lists, with the properties that the `fix` lists.                                                                                                   |
| `chain_range_refused`          | chain    | refused  | Look up one key. A range goes to `USE topology`, or to one day on `USE facts`.                                                                                                                     |
| `chain_block_out_of_range`     | chain    | refused  | Read the head with `Head`, then ask for a block at or below it.                                                                                                                                    |
| `chain_batch_too_large`        | chain    | refused  | Send at most `chain_admission.batch_max` chain lookups in one batch.                                                                                                                               |
| `chain_query_timeout`          | chain    | killed   | Name fewer properties. In a batch, put the chain lookups first, or send them alone.                                                                                                                |
| `chain_response_too_large`     | chain    | killed   | Name fewer properties.                                                                                                                                                                             |
| `chain_busy`                   | chain    | capacity | Wait at least 5 seconds, then send the same query once.                                                                                                                                            |
| `chain_node_error`             | chain    | failed   | Tell the user the chain node returned an error. Do not retry.                                                                                                                                      |
| `chain_unavailable`            | chain    | failed   | Read `chain_admission.status`. Tell the user the chain layer is off or behind. `USE topology` and `USE facts` still work. Retry once after 10 seconds, and only when the status is not `disabled`. |

## Read the limits, never write them down

The server publishes the limits of a layer in `meta_network_capabilities`.
`cia network robinhood --json` prints the same reply. Read a limit there. Do
not write one down and do not trust a number you remember: a number goes stale
the day the server changes it.

- `USE chain`: the `chain_admission` block. It holds `enabled`, `status`,
  `lookups`, `slots`, `slots_per_caller`, `calls_per_second_per_caller`,
  `batch_max` and `ceiling_seconds`.
- `USE topology`: read `topology_admission`. When it is absent, the server
  publishes no limit yet, and the `fix` of a refusal names the limit.
- `USE facts`: the limits are in the facts section below. When the server sends
  `facts_admission`, read its members.

## Topology reads stop at a limit

A topology query stops at its time or memory limit, or waits for a free slot.
The errors `topology_busy`, `query_timeout` and `query_memory_limit` mean the
query was stopped, not that data is missing. See
[When a query is refused](#when-a-query-is-refused) for the move.

A topology read that filters on a link property needs an address anchor. With
no address in its pattern, the read starts from every link of the type it
names. Do not count on the filter to narrow that. `WHERE x.strength = 'swap'`
on `SWAPPED` checks every `SWAPPED` link. `LIMIT` stops the read only after it
has found enough rows, so a filter that matches few or none can run to the
60-second limit and fail with `query_timeout`. A discovery probe with no
filter, such as
`MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.tx_count LIMIT 20`, finds
its rows at once and stays valid.

Put an address in the pattern, and pick one with few links. Read `degree_out`
and `degree_in` on the node first. They are a rough guide, not a guarantee:
they count neighbours, not links, and one pair of addresses can hold many
`SWAPPED` links. An address with hundreds of thousands of neighbours can fail
the same way. The queries of one batch share a 100-second budget.

Anchored on one address:

```cypher
USE topology
MATCH (a:Address {address: "0x…"})-[x:SWAPPED]->(b:Address)
WHERE x.swap_count >= 2
RETURN b.address AS recipient, x.swap_count AS swap_count
ORDER BY x.swap_count DESC
LIMIT 25
```

## Anchor every topology read

Put an address in every connected pattern: `{address: "0x…"}` in the node, or
an equality in the top-level `WHERE`. A list of at most 25 address literals is
an anchor too. An address in the `RETURN` list, in an `OR`, in a comment or in
a `$parameter` is no anchor. The one read without an anchor is the probe: one
hop or one node, no `WHERE`, no `ORDER BY`, no aggregate, and a `LIMIT` of 100
or less. A sort, an aggregate, `DISTINCT` or `collect()` needs an anchor on
every pattern. A read with no anchor is refused with `anchor_missing`, or with
`aggregate_unanchored` when it sorts or aggregates.

End every read with a literal `LIMIT` of 5,000 or less. A path has at most 5
hops and a query at most 8. A route search asks for one path. A refusal comes
back at once, before the query runs. It carries `error_detail` with a `code`,
a `rule`, a `class`, a `fix` and an `example` that the server itself admits.
Read the `fix`, and do not send the same query again.

## ISO GQL on topology

Accepted, with bounds:

- Directed `MATCH` and narrow projections
- `WHERE`, `WITH`, `CASE`, `collect()`, `UNION`, `UNWIND`
- Bounded quantified paths: `-[:FLOWS_TO]-{1,5}`
- Quantified path patterns with an inner `WHERE`:
  `(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4}`
- One shortest path: `MATCH SHORTEST 1` or `MATCH ANY SHORTEST`

Use an upper hop bound of `5` or less.

A trace walks `FLOWS_TO` and `SWAPPED`. `SWAPPED` carries it across a swap,
from payer to recipient, without passing through the pool. A walk carries the
pool guard on its start and on every address in its middle: neither is a
`:Pool`. Both apply the pool trace rule in `chain-insights-schema-evm`.
A walk may end at a pool. It never starts at one or passes through one.

These are the shortest-path forms, with the guard:

Route between two known addresses:
`MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route LIMIT 5`

`ANY SHORTEST` takes the same pattern in place of `SHORTEST 1`. A count above
1, `GROUPS`, `PATHS` and a repeated part with an upper bound above 4 are
refused.

Open target:
`MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address) RETURN b.address LIMIT 50`

How the guard reads:

- `(a:Address {address: $from} WHERE NOT a:Pool)` is the start. When the
  start address is a pool, the walk returns no row.
- `(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4}` walks up
  to 4 hops. Every address it reaches must not be a pool.
- `()-[:FLOWS_TO|SWAPPED]-(b)` is the last hop. It may end on a pool.
- So the walk is 1 to 5 hops, and only its target end may be a pool.

Use these shapes as written. Change only the addresses and the `RETURN`.

Keep the guard inside the path pattern. A `WHERE` placed after a `SHORTEST`
pattern runs after the shortest route is chosen. When that route crosses a
pool, the query returns no row, even when a longer route without a pool
exists.

A fixed-hop walk names its start and each address in the middle and guards
them in `WHERE`: `WHERE NOT src:Pool AND NOT mid:Pool`. Each guard is its own
`AND` term. Inside an `OR` it guards nothing.

Rejected on topology:

- No upper hop bound, or hop bound above 5
- Legacy shortest-path functions and non-GQL path operators
- `UNWIND` lists above 1000
- Writes and catalog changes: `CREATE`, `MERGE`, `SET`, `DELETE`,
  `REMOVE`, `DROP`, `ADD`, `CONNECT`, `CALL`

Treat exchange hot wallets as terminals. Filter intermediate nodes with
`is_exchange IS NULL`.

The four role flags are `is_exchange`, `is_scam`, `is_victim` and
`is_sanctioned`. Each is absent unless true, so a node without the role has
no such property and reads null. Test a flag with `IS NOT NULL` or `IS NULL`.
Never test `= false`. `:Exchange` is a node label now, and so are `:Scam`,
`:Victim` and `:Sanctioned`. Only `is_exchange` ends a walk. Load
`chain-insights-schema-evm` for the role labels and flags.

Treat pools by the pool trace rule in `chain-insights-schema-evm`. `:Pool`
is a real label, so a pattern or a `WHERE` may name it: `(p:Pool)`,
`WHERE NOT mid:Pool`, or `WHERE NOT via:Pool` inside a quantified path.

## Facts reads: an address pair with one day

Facts rejects native traversal, `FLOWS_TO`, `OPERATED_BY`, `LINKED`, `WITH` pipelines,
the topology edges `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED`,
the `:Pool` label, `CASE`, grouped aggregates, `collect()`, and metadata functions
(`keys()`, `labels()`, `type()`). Predicate-less global aggregates are
refused. A facts read names an address pair with one day, or one `tx_id`. A
pair is both endpoint addresses of the relationship, from then to, each as
`{address: "0x…"}`, and the day is `t.block_date = "YYYY-MM-DD"`. One address,
a day alone, a window of days, a block range and a bare `LIMIT` are not
enough. The limits of a facts read are fixed:

- A reply holds at most 200 rows. The server cuts a longer page at 200 rows,
  whatever the `LIMIT`.
- A facts read has one relationship and no hop. A longer chain is a path: move
  it to topology.
- A facts read takes no `ORDER BY`. Rows come in the server's own order. Sort
  the page yourself.
- A facts read covers one day. For more days, send one read for each day.

This holds for `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and
`BRIDGE_CROSSING`.

On EVM networks `tx_id` is the `0x` transaction hash:
`MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "0x…" RETURN from.address AS from_address, to.address AS to_address, t.amount AS amount LIMIT 10`

A time window is one day plus `block_timestamp` bounds in epoch milliseconds,
on a pair:
`MATCH (from:Address {address: "0x…"})-[t:TRANSFER]->(to:Address {address: "0x…"}) WHERE t.block_date = "2026-07-11" AND t.block_timestamp >= 1783738500000 AND t.block_timestamp < 1783738560000 RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp LIMIT 10`

`block_timestamp` or `block_height` bounds without the `block_date` bound are
refused: they do not name the day.

Every `TRANSFER` row has a `kind`: `token`, `native` or `internal`. An `internal`
row is ETH a contract sends while it runs a call, such as the ETH leg of a wrap.
The `FLOWS_TO` link counts all three, so the rows of a pair are the transfers its
link counts, up to the height the link was built to. `kind` is a column and a
filter. Add `t.kind = "internal"` to the pair and the day to read only the
internal rows. For example:

```cypher
USE facts
MATCH (from:Address {address: "0x…"})-[t:TRANSFER]->(to:Address {address: "0x…"})
WHERE t.block_date = "2026-07-11" AND t.kind = "internal"
RETURN t.tx_id AS tx_id, t.event_index AS event_index, t.kind AS kind,
       t.amount AS amount, t.amount_usd AS amount_usd
LIMIT 50
```

A `kind` filter narrows the read of a pair and one day. It never replaces them.

Weighted money paths are not supported. Hop-count shortest paths only.

When a facts read needs hops or money flow, move it to topology.

## Chain lookups: one key, one node

`USE chain` asks the chain node for one known thing by its key. It serves the
lookups that `chain_admission.lookups` lists: `Transaction` by `hash`, `Block`
by `height` or `hash`, and `Head`, which takes no key. No lookup takes an
address: `:Address` is a topology and a facts label, never a chain one. A
lookup is one node with literal keys in braces and a `RETURN` of
`var.property` items. It takes no `WHERE`, no relationship and no range. A
lookup that the list does not name is
refused with `chain_not_served`, and so is a property that the label does not
serve.

A transaction, with its result and the day it was mined:

```cypher
USE chain
MATCH (t:Transaction {hash: "0x…"})
RETURN t.status, t.block_height, t.block_date
```

A block by height, with the day it belongs to:

```cypher
USE chain
MATCH (b:Block {height: 79841521})
RETURN b.hash, b.block_date
```

The head of the chain, and how far the graph and the warehouse are behind it:

```cypher
USE chain
MATCH (h:Head)
RETURN h.height, h.age_seconds, h.warehouse_blocks_behind, h.graph_blocks_behind
```

The `block_date` of a `Transaction` or a `Block` is the day to name in a facts
read. A chain lookup that comes back `chain_unavailable` means the chain layer is
off or behind. Topology and facts still work.

## Swaps, liquidity and bridges

Each is a plain relationship name. None needs backquotes.

| Question                              | Layer      | Pattern                                                                                 |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Who paid whom across swaps, in total  | `topology` | `(:Address)-[:SWAPPED]->(:Address)`                                                     |
| Who added to or took out of a pool    | `topology` | `(:Address)-[:ADDED_LIQUIDITY]->(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)`               |
| Which bridge endpoint an address used | `topology` | `(:Address)-[:BRIDGED]-(:Chain)`                                                        |
| One swap route and its strength       | `facts`    | `(:Address)-[:SWAP]->(:Address)`                                                        |
| One liquidity event                   | `facts`    | `(:Address)-[:LIQUIDITY_ADD]->(:Address)`, `(:Address)-[:LIQUIDITY_REMOVE]->(:Address)` |
| One bridge event                      | `facts`    | `(:Address)-[:BRIDGE_CROSSING]->(:Address)`                                             |

The topology edges hold lifetime totals per pair. The facts rows hold single
events. Load `chain-insights-schema-evm` for every property.

Swap attribution is read from `SWAPPED`, the aggregate (`strength`, `pools`,
`families`), or from the facts `SWAP` row, one route. `FLOWS_TO` carries value
only.

A `USE facts` `SWAP` row carries no route: it has no `pools` and no `families`
column. A read that names one of them, to return it, to filter on it or to
order by it, is refused. The route of a swap stays a topology question.

- For the pools of the swaps of an address, read `SWAPPED.pools` and
  `SWAPPED.families` on `USE topology`, anchored on the payer or the recipient.
  `SWAPPED` has one link per payer, recipient, sold asset and bought asset, so
  its `pools` cover every route on the link, not one route.
- Read `SWAP` rows by `tx_id`, or by the payer, the recipient and one day.
  `route_id` stays on the row. It ties every leg of one route together and names
  no pool.

Today every served swap has `strength` `swap_like`, and `SWAPPED.families` reads
`unknown`. Do not filter on `strength = 'swap'`: it matches nothing. A swap that could
not be paired (`swap_unsplit`) has no edge and no row. Every Uniswap v4 swap
is one. Load `chain-insights-schema-evm` for what each strength means.

A trace that reaches a `:Pool` follows the pool trace rule in
`chain-insights-schema-evm`. The probes below follow it.

Swaps an address paid for, topology:

```cypher
USE topology
MATCH (a:Address {address: $addr})-[s:SWAPPED]->(b:Address)
RETURN b.address AS recipient, s.sold_asset AS sold_asset,
       s.bought_asset AS bought_asset, s.sold_usd AS sold_usd,
       s.bought_usd AS bought_usd, s.pools AS pools,
       s.strength AS strength, s.swap_count AS swap_count
LIMIT 50
```

Who took liquidity out of the pools an address paid into, topology:

```cypher
USE topology
MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(p:Pool)-[r:REMOVED_LIQUIDITY]->(b:Address)
WHERE NOT a:Pool AND b.address <> a.address
RETURN p.address AS pool, b.address AS receiver, r.usd AS removed_usd,
       r.receiver_added_usd AS receiver_added_usd,
       r.receiver_provided AS receiver_provided
LIMIT 50
```

One transaction's swap routes, facts, with their strength and the two sides:

```cypher
USE facts
MATCH (payer:Address)-[s:SWAP]->(recipient:Address)
WHERE s.tx_id = "0x…"
RETURN payer.address AS payer, recipient.address AS recipient,
       s.strength AS strength, s.reason AS reason, s.route_id AS route_id,
       s.sold_asset_symbol AS sold, s.sold_usd AS sold_usd,
       s.bought_asset_symbol AS bought, s.bought_usd AS bought_usd
LIMIT 10
```

Raw amounts (`*_raw`) are exact token quantities, not USD. USD comes from the
daily price services. On a facts row it is empty when no service prices the
asset, and the matching `…price_missing` is true. On `SWAPPED` it sums the
routes, and a side with no price adds 0, so 0 can mean no price. Read the
facts `SWAP` row to tell.

## Hard stops

- Read-only. No writes.
- No raw warehouse table names.
- Role labels are real node labels, `:Exchange` among them. A pattern or a
  `WHERE` may name one. Prefer the role flags: each is absent unless true, so
  test `IS NOT NULL` or `IS NULL`, never `= false`.
- Empty results mean no indexed match. They are not proof of safety.
- Do not reuse one network's labels on another network unless that
  network advertises them.
- At a `:Pool`, follow the pool trace rule in `chain-insights-schema-evm`.
- A missing `SWAPPED` edge or `SWAP` row is not proof that no swap happened.
- `USE chain` looks up one known thing by its key. It never searches, lists or
  ranges.
- A refusal is an answer, not an outage. Act on its class, once, and then tell
  the user.
