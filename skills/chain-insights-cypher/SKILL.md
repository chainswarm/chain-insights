---
name: chain-insights-cypher
description: Use when writing or reviewing Chain Insights graph_query or graph_query_batch Memgraph Cypher. Dialect and layer rules only. Load a schema skill for labels and properties.
---

# Chain Insights Cypher

Memgraph Cypher for `graph_query` and `graph_query_batch`.

This skill is dialect only. It is not a query cookbook. Load
`chain-insights-schema-evm` or `chain-insights-schema-bittensor` for the
label, relationship, and property map.

## Tools

| Tool | Use |
| --- | --- |
| `graph_query` | One read-only query. |
| `graph_query_batch` | Related reads in one call. |

Always pass an explicit `network`. Always add your own `LIMIT`. Chain
Insights Graph does not append one.

`per_query_timeout_seconds` is optional and capped.

## Layer choice

| Graph | Backend | Dialect |
| --- | --- | --- |
| `USE topology` | Memgraph over Bolt | native Memgraph Cypher, bounded. |
| `USE facts` | Warehouse, compiled | Cypher subset. Not full Memgraph. |

`topology` serves the address graph, money flow, the `LINKED` overlay, and
node risk. `facts` serves bounded `TRANSFER` rows.

The `network` argument selects the graph. On topology, unscoped
`:Address` matches must also filter `:Address.network` when more than one
address space is present. Exact-address lookups do not need that extra
filter. Facts `Address` has no `network` property.

## Native Memgraph Cypher on topology

Accepted, with bounds:

- Directed `MATCH` and narrow projections
- `WHERE`, `WITH`, `CASE`, `collect()`, `UNION`, `UNWIND`
- Bounded variable-length: `-[:FLOWS_TO*1..5]->`
- Path forms: `*BFS`, `*WSHORTEST`, `*ALLSHORTEST`, `*KSHORTEST`
- Per-hop filter lambdas

Rejected on topology:

- No upper hop bound, or hop bound above 5
- `KSHORTEST` k above 16
- `UNWIND` lists above 1000
- Writes and catalog changes: `CREATE`, `MERGE`, `SET`, `DELETE`,
  `REMOVE`, `DROP`, `ADD`, `CONNECT`, `CALL`

Treat exchange hot wallets as terminals. Filter intermediate nodes with
`is_exchange IS NULL`.

## Facts is not full Memgraph

Facts rejects native traversal, `FLOWS_TO`, `LINKED`, `WITH` pipelines,
`CASE`, grouped aggregates, `collect()`, and metadata functions
(`keys()`, `labels()`, `type()`). Predicate-less global aggregates are
refused. `TRANSFER` always needs an indexed predicate: address equality
on either endpoint, or `tx_id`. A bare `LIMIT` is not enough.

When a facts read needs hops or money flow, move it to topology.

## Hard stops

- Read-only. No writes.
- No raw warehouse table names.
- No dynamic labels such as `:Exchange`. Use `is_exchange` or proven
  label properties.
- Empty results mean no indexed match. They are not proof of safety.
- Do not reuse one network's labels on another network unless that
  network advertises them.
