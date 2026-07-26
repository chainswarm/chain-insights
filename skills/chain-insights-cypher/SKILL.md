---
name: chain-insights-cypher
description: Use when writing, reviewing, or debugging Chain Insights graph_query or graph_query_batch GQL/Cypher, choosing topology or facts, capturing schema, or making schema-aware graph reads across networks.
---

# Chain Insights Cypher

Use this for manual `graph_query` and `graph_query_batch` work. For case work,
combine it with `chain-insights-investigation`. If a network-specific Cypher
skill exists, load it after this one.

## First Moves

1. Inspect the endpoint before writing network-specific queries:
   ```bash
   cia mcp networks
   cia mcp call meta_usage_status
   ```
2. Always pass an explicit `network`.
3. Always add your own `LIMIT`; Chain Insights Graph does not append one.
4. Use `graph_query_batch` for related schema, topology, and facts reads.
5. Save material query output as workspace evidence before summarizing it.

For practical query recipes and Memgraph deep traversal fallbacks, read
`references/memgraph-examples.md`. It contains staging-tested examples for
`MATCH`, `WHERE`, `WITH`, aggregates, `CASE`, facts projections, and
fixed-hop traversal batches.

For the construct-by-construct support matrix, topology bounds, and the
facts contract-error schema, read `docs/graph-query-compatibility.md`.

## Layer Choice

| Graph | Use for | Query style |
| --- | --- | --- |
| `USE topology` | Route discovery and fund-flow topology reads over unified recent + full historical activity, plus the node risk verdict (`risk_score`/`risk_level`) and labels + per-label risk (`labels`, `label_risk`) | Native Memgraph Cypher over topology nodes and relationships, bounded. Prefer directed `MATCH` patterns and narrow projections. |
| `USE facts` | Bounded individual transfer rows (`TRANSFER` edges) and, until P3, address features/enrichment | Corpus-scoped Cypher subset compiled to StarRocks SQL. Verify the current network schema before assuming fact labels or relationships exist. |

`topology` is **native Memgraph Cypher** (MemGQL retired). Bounded
variable-length and path-algorithm traversal are first-class:
`-[:FLOWS_TO*1..5]->`, `-[:FLOWS_TO *BFS 1..5]->`,
`-[:FLOWS_TO *WSHORTEST 5 (r,n | coalesce(r.amount_usd_sum,1)) w]->`,
`-[:FLOWS_TO *KSHORTEST|3]->`, and per-hop filter lambdas
`-[:FLOWS_TO*1..5 (r,n | n.is_exchange IS NULL)]->`. Always add an explicit
upper hop bound — the topology gate rejects unbounded (`*`, `*BFS` with no range)
and over-depth (> 5) traversal, KSHORTEST k > 16, and UNWIND lists > 1000.

Treat `facts` as a compiled Cypher subset, not full Memgraph. Native traversal,
`FLOWS_TO`/money-flow entities, `WITH` pipelines, `CASE`, grouped aggregates,
`collect()`, and metadata functions (`keys()`, `labels()`, `type()`) are
rejected there with a typed contract error before any SQL runs; predicate-less
global aggregates are refused by the cost-shape gate. When a facts read needs
multi-hop traversal or money flow, move it to `topology` (native traversal).

For any BFS, fixed-hop fallback, shortest-path, or custom `FLOWS_TO` traversal,
exchange hot wallets are terminal endpoints only. Do not expand from, through,
or classify exchange nodes as deposit, suspect, or intermediate candidates.
Filter every non-terminal traversal node with `is_exchange IS NULL`; only the
final exchange endpoint should use `is_exchange IS NOT NULL`.

## Common Schema

The public graph surface is address-grain. The current public Chain Insights
Graph investigation network is `bittensor` — always pass `network=bittensor`,
for native SS58 and EVM-pallet `0x...` (H160) inputs alike; do not invent or
query other network names. The SS58/H160 split lives on the node as the
`:Address.network` PROPERTY (`bittensor` for SS58, `bittensor_evm` for H160),
not as a separate query network: a single `network=bittensor` query spans both
spaces by walking `FLOWS_TO` within a space and hopping the bridge (money) or
`LINKED` (ownership) edge across the boundary.

### The `network` argument selects the GRAPH, not the addresses in it

This is the highest-value rule in this skill. Two network views of one chain
are **two views over ONE address-grain topology graph** — the SS58 and H160
address spaces live in the same topology shards, separated only by the
`:Address.network` node property.

So a `USE topology` query that matches `:Address` without an exact address
**must** scope itself by that property, or it scans every view's addresses and
returns rows from an address space you did not ask for — wrong-network results
at double the metered cost:

```cypher
-- WRONG: returns SS58 and H160 addresses regardless of intent
USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 100

-- RIGHT
USE topology MATCH (a:Address) WHERE a.network = "bittensor_evm"
RETURN a.address AS address LIMIT 100
```

Exact-address lookups (`MATCH (a:Address {address: "0x…"})`) need no predicate:
the address is already a unique key, and adding one fails closed on an EVM
address screened under the chain's primary network name.

`USE facts` is the opposite case. Facts is the one place each network gets its
own backing database (reported as `facts.routing.starrocks_database`), and
because the database already scopes the network, the facts `Address` label has
**no mapped `network` property at all** — projecting it returns
`unknown graph identifier: property "network" is not mapped on label "Address"`
rather than degrading. `Address` on facts is served only as a `TRANSFER`
relationship endpoint, so a single-node `MATCH (a:Address)` is refused there
too. Read address-grain node properties, `network` included, on `USE topology`.

Topology is intentionally stable across address spaces:

- Node: `(:Address {address, network})` with sparse `labels`, `is_exchange`,
  `risk_score`, `risk_level`, `label_risk` (per-label risk: a list of
  `{label, risk_level, updated_timestamp}` maps), and activity rollups.
  `address` is the raw chain-native form (SS58 or `0x...`); there is no
  separate identity key.
- Edge: `(:Address)-[:FLOWS_TO]->(:Address)` for money flow.
- Ownership overlay: `(:Address)-[:LINKED]-(:Address)` is an **undirected**
  edge asserting the two addresses are owned/controlled by the same actor
  (`basis` is `derived` or `associated`, plus `confidence`, `source_event`,
  `declared_owner`). `LINKED` is the ownership edge across the SS58/H160
  space boundary — use it for cross-space investigation (see the cross-space
  recipe below) and for actor-level exposure (surface a counterparty's
  exposure by walking one visible `LINKED` hop before `FLOWS_TO`, not by
  treating linked addresses as a single collapsed node). `LINKED` is served
  on both the topology and facts graphs.
- Flow fields commonly include `tx_count`, `amount_usd_sum`,
  `avg_tx_size_usd`, `first_seen_timestamp`, `last_seen_timestamp`,
  `first_tx_id`, `last_tx_id`, `dominant_asset`, and
  `price_coverage_ratio`. These are lifetime aggregates (first/last endpoints
  only). The public address contract is USD-only; do not rely on native
  `amount_sum`.
- Facts may expose `Address`, `Asset`, and network-specific fact nodes.
  Lifetime address metrics (`degree_in`/`degree_out`/`degree_total`,
  `tx_in_count`/`tx_out_count`/`tx_total_count`, `total_in_usd`/
  `total_out_usd`/`total_volume_usd`, `net_flow_usd`,
  `first_activity_timestamp`/`last_activity_timestamp`/`activity_span_days`)
  are node properties on `USE topology`, not facts.

Future networks may expose different schemas. Do not reuse a Bittensor
relationship or feature query on another network unless that network advertises
support and proves the same labels and fields.

## Schema Capture

Use projections instead of metadata functions so the same probe works on both
Memgraph-backed and mapped layers:

```bash
cia mcp call graph_query_batch \
  network=<network> \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"address_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"flow_sample","query":"USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp LIMIT 10"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"node_metric_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.tx_out_count AS tx_out_count LIMIT 10"}]'
```

If a query fails with a generic backend error, narrow it before changing the
investigation claim: remove metadata functions, remove cross-graph joins, use
one relationship, project fewer fields, and lower the limit.

## Query Examples

Top outflows from one address (topology covers full lifetime history):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE topology MATCH (src:Address {address: "FULL_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Lifetime node-metric lookup after schema proof:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE topology MATCH (a:Address {address: "FULL_ADDRESS"}) RETURN a.address AS address, a.tx_out_count AS tx_out_count, a.tx_in_count AS tx_in_count LIMIT 1'
```

Individual transfer rows by address (bounded — the `{address: ...}` endpoint
predicate is the required indexed predicate for `TRANSFER`):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE facts MATCH (from:Address {address: "FULL_ADDRESS"})-[t:TRANSFER]->(to:Address) RETURN to.address AS to_address, t.tx_id AS tx_id, t.block_height AS block_height, t.amount_usd AS amount_usd, t.asset_symbol AS asset_symbol LIMIT 25'
```

Individual transfer rows by `tx_id` (the indexed predicate for `TRANSFER` may
be address equality on either endpoint OR a `tx_id` equality — a bare `LIMIT`
alone is rejected):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "TX_ID" RETURN from.address AS from_address, to.address AS to_address, t.event_index AS event_index, t.amount_usd AS amount_usd LIMIT 25'
```

Actor-level exposure via one visible `LINKED` hop (AC11 — FLOWS_TO reachability
UNIONed over one ownership hop, so an actor's exposure through a
LINKED-but-not-identical address is not missed):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE topology MATCH (a:Address {address: "FULL_ADDRESS"})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN owned.address AS linked_via_address, b.address AS counterparty_address, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 50'
```

Cross-space `LINKED` probe (the ownership edge across the SS58/H160 space
boundary; runs on the single public `network=bittensor`):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE topology MATCH (a:Address {address: "FULL_ADDRESS"})-[l:LINKED]-(b:Address) WHERE a.network <> b.network RETURN b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence, l.source_event AS source_event, l.declared_owner AS declared_owner LIMIT 25'
```

More examples: `references/memgraph-examples.md`.

## Hard Stops

- No writes or catalog changes: no `CREATE`, `MERGE`, `SET`, `DELETE`,
  `REMOVE`, `DROP`, `ADD`, `CONNECT`, or `CALL`.
- No raw StarRocks table names through Chain Insights Graph.
- Do not rely on dynamic labels such as `:Exchange`; use `is_exchange` or
  label facts when the schema proves they exist.
- Empty results mean no indexed match in the selected layer, not proof of
  safety or non-existence.
