---
name: chain-insights-cypher
description: Use when writing or reviewing Chain Insights graph_query or graph_query_batch ISO GQL. Dialect and layer rules only. Load a schema skill for labels and properties.
---

# Chain Insights Cypher

ISO GQL for `graph_query` and `graph_query_batch`.

This skill is dialect only. It is not a query cookbook. Load
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

Topology queries share 4 slots and stop at their time or memory limit. The
errors `topology_busy` (retry later), `query_timeout` (anchor on an address,
use fewer hops or a tighter `LIMIT`), and `query_memory_limit` (return fewer
rows or properties) mean the query was stopped, not that data is missing.

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

## Layer choice

| Graph          | Backend             | Dialect           |
| -------------- | ------------------- | ----------------- |
| `USE topology` | DozerDB over Bolt   | ISO GQL, bounded. |
| `USE facts`    | Warehouse, compiled | GQL subset.       |

`topology` serves the address graph, money flow (`FLOWS_TO`, `OPERATED_BY`), the `LINKED` overlay,
node risk, swaps and liquidity (`SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`, the `:Pool`
label) and bridges (`BRIDGED`). `facts` serves bounded `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`,
`LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows.

The `network` argument selects the graph. On topology, unscoped
`:Address` matches must also filter `:Address.network` when more than one
address space is present. Exact-address lookups do not need that extra
filter. Facts `Address` has no `network` property.

## ISO GQL on topology

Accepted, with bounds:

- Directed `MATCH` and narrow projections
- `WHERE`, `WITH`, `CASE`, `collect()`, `UNION`, `UNWIND`
- Bounded quantified paths: `-[:FLOWS_TO]-{1,5}`
- Quantified path patterns with an inner `WHERE`:
  `(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4}`
- Shortest paths: `MATCH SHORTEST 1`, `MATCH ANY SHORTEST`, or
  `MATCH ALL SHORTEST`

Use an upper hop bound of `5` or less.

A trace walks `FLOWS_TO` and `SWAPPED`. `SWAPPED` carries it across a swap,
from payer to recipient, without passing through the pool. A walk carries the
pool guard on its start and on every address in its middle: neither is a
`:Pool`. Both apply the pool trace rule in `chain-insights-schema-evm`.
A walk may end at a pool. It never starts at one or passes through one.

These are the shortest-path forms, with the guard:

Route between two known addresses:
`MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route`

`ANY SHORTEST` and `ALL SHORTEST` take the same pattern in place of
`SHORTEST 1`.

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

## Facts is not full GQL

Facts rejects native traversal, `FLOWS_TO`, `OPERATED_BY`, `LINKED`, `WITH` pipelines,
the topology edges `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED`,
the `:Pool` label, `CASE`, grouped aggregates, `collect()`, and metadata functions
(`keys()`, `labels()`, `type()`). Predicate-less global aggregates are
refused. A facts read names an address pair with one day, or one `tx_id`. A
pair is both endpoint addresses of the relationship, from then to, each as
`{address: "0x…"}`, and the day is `t.block_date = "YYYY-MM-DD"`. One address,
a day alone, a window of days, a block range and a bare `LIMIT` are not
enough. A facts read has one relationship and takes no `ORDER BY`. This holds
for `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and
`BRIDGE_CROSSING`.

On EVM networks `tx_id` is the `0x` transaction hash:
`MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "0x…" RETURN from.address AS from_address, to.address AS to_address, t.amount AS amount LIMIT 10`

A time window is one day plus `block_timestamp` bounds in epoch milliseconds,
on a pair:
`MATCH (from:Address {address: "0x…"})-[t:TRANSFER]->(to:Address {address: "0x…"}) WHERE t.block_date = "2026-07-11" AND t.block_timestamp >= 1783738500000 AND t.block_timestamp < 1783738560000 RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp LIMIT 10`

`block_timestamp` or `block_height` bounds without the `block_date` bound are
refused: they do not name the day.

Weighted money paths are not supported. Hop-count shortest paths only.

When a facts read needs hops or money flow, move it to topology.

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

**Temporary, until graph server issue 1121 is fixed. Remove this note when it ships.**

- Do not return, filter or order by `pools` in a `USE facts` `SWAP` read. Every
  such read fails at the warehouse query memory limit with
  `facts query could not be completed`: by address, by day and by `tx_id`.
- Only `pools` is built by the failing part of the warehouse view. `pool_keys`
  and `families` come from the main read.
- Read `SWAP` rows by `tx_id`, or by the payer, the recipient and one day, and
  leave `pools` out.
- For the pools of a swap, read `SWAPPED.pools` on `USE topology`, anchored on
  the payer or the recipient. `SWAPPED` has one link per payer, recipient, sold
  asset and bought asset, so its `pools` cover every route on the link, not one
  route.

Today every served swap has `strength` `swap_like` and `families` `unknown`.
Do not filter on `strength = 'swap'`: it matches nothing. A swap that could
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

One transaction's swap routes, facts, with no `pools`:

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
