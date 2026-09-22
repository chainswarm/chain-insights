---
name: chain-insights-cypher
description: Use when writing or reviewing Chain Insights graph_query or graph_query_batch ISO GQL. Dialect and layer rules only. Load a schema skill for labels and properties.
---

# Chain Insights Cypher

ISO GQL for `graph_query` and `graph_query_batch`.

This skill is dialect only. It is not a query cookbook. Load
`chain-insights-schema-evm` or `chain-insights-schema-bittensor` for the
label, relationship, and property map.

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

## Layer choice

| Graph          | Backend             | Dialect           |
| -------------- | ------------------- | ----------------- |
| `USE topology` | DozerDB over Bolt   | ISO GQL, bounded. |
| `USE facts`    | Warehouse, compiled | GQL subset.       |

`topology` serves the address graph, money flow (`FLOWS_TO`, `OPERATED_BY`), the `LINKED` overlay,
node risk, and the swap stamp. `facts` serves bounded `TRANSFER` rows.

The `network` argument selects the graph. On topology, unscoped
`:Address` matches must also filter `:Address.network` when more than one
address space is present. Exact-address lookups do not need that extra
filter. Facts `Address` has no `network` property.

## ISO GQL on topology

Accepted, with bounds:

- Directed `MATCH` and narrow projections
- `WHERE`, `WITH`, `CASE`, `collect()`, `UNION`, `UNWIND`
- Bounded quantified paths: `-[:FLOWS_TO]-{1,5}`
- Shortest paths: `MATCH SHORTEST 1`, `MATCH ANY SHORTEST`, or
  `MATCH ALL SHORTEST`

Use an upper hop bound of `5` or less. These are the shortest-path forms:

Route between two known addresses:
`MATCH p = SHORTEST 1 (a:Address {address: $from})-[:FLOWS_TO]-{0,5}(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route`

Open target:
`MATCH SHORTEST 1 (a:Address {address: $addr})-[:FLOWS_TO]-{1,5}(b:Address) RETURN b.address LIMIT 50`

Use `{0,5}` when both ends are known and different: it returns the same
routes as `{1,5}` and runs on the fast early-stop search; keep `{1,5}` for
an open target, where `{0,5}` would also return the start address itself.

Rejected on topology:

- No upper hop bound, or hop bound above 5
- Legacy shortest-path functions and non-GQL path operators
- `UNWIND` lists above 1000
- Writes and catalog changes: `CREATE`, `MERGE`, `SET`, `DELETE`,
  `REMOVE`, `DROP`, `ADD`, `CONNECT`, `CALL`

Treat exchange hot wallets as terminals. Filter intermediate nodes with
`is_exchange IS NULL`.

## Facts is not full GQL

Facts rejects native traversal, `FLOWS_TO`, `OPERATED_BY`, `LINKED`, `WITH` pipelines,
`CASE`, grouped aggregates, `collect()`, and metadata functions
(`keys()`, `labels()`, `type()`). Predicate-less global aggregates are
refused. `TRANSFER` always needs an indexed predicate: address equality
on either endpoint, or `tx_id`. A bare `LIMIT` is not enough.

Weighted money paths are not supported. Hop-count shortest paths only.

When a facts read needs hops or money flow, move it to topology.

## Swap attribution

Swap attribution rides on the `FLOWS_TO` edge a leg already has. It creates no
node and no relationship, and moves no value. Topology only.

**Every property name contains a dot, so every one must be backquoted.** The
dot is part of the name, not a path. `r.swap.kind` is a syntax error.

| Property | Meaning |
| --- | --- |
| `` r.`swap.kind` `` | `swap`, `swap_like` or `swap_unsplit` |
| `` r.`swap.family` `` | `uniswap-v2`, `uniswap-v3`, `uniswap-v4`, or `unknown` |
| `` r.`swap.deployment` `` | `official` or `clone:<factory address>` |
| `` r.`swap.pool` `` | pool address |
| `` r.`swap.reason` `` | why a claim is weaker than `swap` |
| `` r.`swap.route_id` `` | ties every leg of one route together |
| `` r.`swap.interpreter_version` `` | the interpretation that wrote it |

An edge with no `` `swap.kind` `` was never part of a swap-shaped transaction.

### Read the three kinds correctly

- `swap` — the complete route is proven: payer, recipient, assets, exact raw
  amounts and conservation.
- `swap_like` — the shape is a swap, but the pool bytecode matches no reviewed
  family. The money moved; the protocol is unidentified.
- `swap_unsplit` — the legs are real but could not be paired into one route.
  `` `swap.reason` `` names why, for example `batch_partition_ambiguous` or
  `capture_missing`.

**`swap_unsplit` never means "no swap happened."** It means the pairing is
unproven. Reporting it as no swap is a false negative.

A `clone:` deployment is decoded with its family's own rules. It is a full
result, not a lesser one.

### Swap legs of one address

```cypher
USE topology
MATCH (a:Address {address: $addr})-[r:FLOWS_TO]-(b:Address)
WHERE r.`swap.kind` IS NOT NULL
RETURN b.address AS counterparty, r.`swap.kind` AS kind,
       r.`swap.family` AS family, r.`swap.pool` AS pool,
       r.`swap.reason` AS reason, r.amount_usd_sum AS amount_usd_sum
LIMIT 50
```

### One whole route

```cypher
USE topology
MATCH (from:Address)-[r:FLOWS_TO]-(to:Address)
WHERE r.`swap.route_id` = $route_id
RETURN from.address AS from_address, to.address AS to_address,
       r.`swap.kind` AS kind, r.amount_usd_sum AS amount_usd_sum
```

### Detailed facts, when the stamp is not enough

Ordinary tracing never needs these. They are separate topology nodes keyed by
transaction:

```
(:DexTransaction)-[:HAS_DEX_ROUTE]->(:DexRoute)
                 -[:HAS_DEX_POOL_FACT]->(:DexPoolFact)
                 -[:HAS_DEX_CONTRIBUTION]->(:DexPairContribution)
```

`DexTransaction` carries `network`, `block_hash`, `block_height`,
`transaction_hash`, `transaction_index`. `DexRoute` carries `route_id`,
`rule_id`, `pool_ids` and the parallel `input_*`, `output_*`, `fee_*` and
`refund_*` address, asset and raw-amount arrays. `DexPoolFact` carries
`protocol`, `pool_address` and `pool_key`.

```cypher
USE topology
MATCH (t:DexTransaction {transaction_hash: $tx})-[:HAS_DEX_ROUTE]->(route:DexRoute)
RETURN route.route_id AS route_id, route.input_assets AS input_assets,
       route.input_raw_amounts AS input_raw_amounts,
       route.output_assets AS output_assets,
       route.output_raw_amounts AS output_raw_amounts
```

Route amounts are **exact raw token quantities**, not USD. They are not
interchangeable with `amount_usd_sum` on `FLOWS_TO`.

## Hard stops

- Read-only. No writes.
- No raw warehouse table names.
- No dynamic labels such as `:Exchange`. Use `is_exchange` or proven
  label properties.
- Empty results mean no indexed match. They are not proof of safety.
- Do not reuse one network's labels on another network unless that
  network advertises them.
- Never write `r.swap.kind`. Every swap property name holds a dot and must be
  backquoted.
- Never report `swap_unsplit` as "no swap". It is an unproven pairing, not an
  absence.
