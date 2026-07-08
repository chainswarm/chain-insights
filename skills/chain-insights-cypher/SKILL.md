---
name: chain-insights-cypher
description: Use when writing, reviewing, or debugging Chain Insights graph_query or graph_query_batch GQL/Cypher, choosing live_topology, archive_topology, or facts, capturing schema, or making schema-aware graph reads across networks.
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
`MATCH`, `WHERE`, `WITH`, aggregates, `CASE`, archive/facts projections, and
fixed-hop traversal batches.

For the construct-by-construct support matrix, live bounds, and the
archive/facts contract-error schema, read `docs/graph-query-compatibility.md`.

## Layer Choice

| Layer | Use for | Query style |
| --- | --- | --- |
| `USE live_topology` | Current or recent route discovery and fast topology reads | Native Memgraph Cypher over topology nodes and relationships, bounded. Prefer directed `MATCH` patterns and narrow projections. |
| `USE archive_topology` | Historical money-flow and long-window topology facts | Corpus-scoped Cypher subset compiled to StarRocks SQL. Keep to simple `MATCH`, `WHERE` (indexed predicate), property projections, aggregates (with a predicate), `ORDER BY`, and `LIMIT`. |
| `USE facts` | Labels, address features, risk scores, assets, and enrichment | Corpus-scoped Cypher subset compiled to StarRocks SQL. Verify the current network schema before assuming fact labels or relationships exist. |

`live_topology` is **native Memgraph Cypher** (MemGQL retired). Bounded
variable-length and path-algorithm traversal are first-class:
`-[:FLOWS_TO*1..5]->`, `-[:FLOWS_TO *BFS 1..5]->`,
`-[:FLOWS_TO *WSHORTEST 5 (r,n | coalesce(r.amount_usd_sum,1)) w]->`,
`-[:FLOWS_TO *KSHORTEST|3]->`, and per-hop filter lambdas
`-[:FLOWS_TO*1..5 (r,n | n.is_exchange IS NULL)]->`. Always add an explicit
upper hop bound — the live gate rejects unbounded (`*`, `*BFS` with no range)
and over-depth (> 5) traversal, KSHORTEST k > 16, and UNWIND lists > 1000.

Treat `archive_topology` and `facts` as a compiled Cypher subset, not full
Memgraph. Native traversal, `WITH` pipelines, `CASE`, grouped aggregates,
`collect()`, and metadata functions (`keys()`, `labels()`, `type()`) are
rejected there with a typed contract error before any SQL runs; predicate-less
global aggregates are refused by the cost-shape gate. When an archive/facts read
needs multi-hop traversal or per-hop filtering, either move it to
`live_topology` (native traversal) or rewrite it as a bounded
`graph_query_batch` of explicit fixed-hop `FLOWS_TO` patterns.

For any BFS, fixed-hop fallback, shortest-path, or custom `FLOWS_TO` traversal,
exchange hot wallets are terminal endpoints only. Do not expand from, through,
or classify exchange nodes as deposit, suspect, or intermediate candidates.
Filter every non-terminal traversal node with `is_exchange IS NULL`; only the
final exchange endpoint should use `is_exchange IS NOT NULL`.

## Common Schema

The public graph surface is address-grain over two Bittensor address-grain
networks. The current public Chain Insights Graph investigation networks are
`bittensor` (native SS58) and `bittensor_evm` (EVM-pallet `0x...`); do not
invent or query unsupported network names. Do not pass `network=bittensor` for
an EVM-pallet address, or vice versa — each address belongs to exactly one
network, and `LINKED` (below) is the only edge that crosses between them.

Topology is intentionally stable across networks:

- Node: `(:Address {address, network})` with sparse `labels`, `is_exchange`,
  `risk_score`, `risk_level`, and activity rollups. `address` is the raw
  chain-native form (SS58 or `0x...`); there is no separate identity key.
- Edge: `(:Address)-[:FLOWS_TO]->(:Address)` for money flow.
- Ownership overlay: `(:Address)-[:LINKED]-(:Address)` is an **undirected**
  edge asserting the two addresses are owned/controlled by the same actor
  (`basis` is `derived` or `associated`, plus `confidence`, `source_event`,
  `declared_owner`). `LINKED` is the only edge that can connect a `bittensor`
  address to a `bittensor_evm` address — use it for cross-space investigation
  (see the cross-space recipe below) and for actor-level exposure (surface a
  counterparty's exposure by walking one visible `LINKED` hop before
  `FLOWS_TO`, not by treating linked addresses as a single collapsed node).
- Flow fields commonly include `tx_count`, `amount_usd_sum`,
  `avg_tx_size_usd`, `first_seen_timestamp`, `last_seen_timestamp`,
  `first_tx_id`, `last_tx_id`, `dominant_asset`, and
  `price_coverage_ratio`. The public address contract is USD-only; do not
  rely on native `amount_sum`.
- Archive flow fields commonly include `period_granularity`,
  `period_start_date`, `period_end_date`, `tx_count`, `amount_usd_sum`,
  `first_seen_timestamp`, and `last_seen_timestamp`.
- Facts may expose `Address`, `AddressFeature`, `AddressLabel`, `RiskScore`,
  `Asset`, and network-specific fact nodes.

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
  'queries=[{"id":"live_address_sample","query":"USE live_topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp LIMIT 10"},{"id":"linked_sample","query":"USE live_topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_linked_sample","query":"USE archive_topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"facts_feature_sample","query":"USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN a.address AS address, f.tx_out_count AS tx_out_count LIMIT 10"}]'
```

If a query fails with a generic backend error, narrow it before changing the
investigation claim: remove metadata functions, remove cross-graph joins, use
one relationship, project fewer fields, and lower the limit.

## Query Examples

Live outflows from one address:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (src:Address {address: "FULL_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Archive flow history:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE archive_topology MATCH (src:Address {address: "FULL_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.last_seen_timestamp DESC LIMIT 50'
```

Facts lookup after schema proof:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE facts MATCH (a:Address {address: "FULL_ADDRESS"})-[:HAS_LABEL]->(label:AddressLabel) RETURN label.label AS label, label.entity_type AS entity_type, label.source AS source LIMIT 25'
```

Actor-level exposure via one visible `LINKED` hop (AC11 — FLOWS_TO reachability
UNIONed over one ownership hop, so an actor's exposure through a
LINKED-but-not-identical address is not missed):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (a:Address {address: "FULL_ADDRESS"})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN owned.address AS linked_via_address, b.address AS counterparty_address, r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 50'
```

Cross-space `LINKED` probe (the only edge bridging `bittensor` and
`bittensor_evm`):

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (a:Address {address: "FULL_ADDRESS"})-[l:LINKED]-(b:Address) WHERE a.network <> b.network RETURN b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence, l.source_event AS source_event, l.declared_owner AS declared_owner LIMIT 25'
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
