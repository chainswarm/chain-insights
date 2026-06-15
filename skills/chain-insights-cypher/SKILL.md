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

## Layer Choice

| Layer | Use for | Query style |
| --- | --- | --- |
| `USE live_topology` | Current or recent route discovery and fast topology reads | Memgraph-backed Cypher over topology nodes and relationships. Prefer directed `MATCH` patterns and narrow projections. |
| `USE archive_topology` | Historical money-flow and long-window topology facts | StarRocks/MemGQL GQL-Cypher subset. Keep to simple `MATCH`, `WHERE`, property projections, aggregates, `ORDER BY`, and `LIMIT`. |
| `USE facts` | Labels, address features, risk scores, assets, and enrichment | StarRocks/MemGQL facts mapping. Verify the current network schema before assuming fact labels or relationships exist. |

Treat `archive_topology` and `facts` as mapped graph views, not full Memgraph.
Avoid backend-specific functions such as `keys()`, `labels()`, `type()`,
procedures, native BFS syntax, catalog operations, and variable-length path
tricks unless the current endpoint has just accepted the exact pattern. When a
Memgraph deep traversal pattern fails, rewrite it as a bounded
`graph_query_batch` of explicit fixed-hop `FLOWS_TO` patterns.

For any BFS, fixed-hop fallback, shortest-path, or custom `FLOWS_TO` traversal,
exchange hot wallets are terminal endpoints only. Do not expand from, through,
or classify exchange nodes as deposit, suspect, or intermediate candidates.
Filter every non-terminal traversal node with `is_exchange IS NULL`; only the
final exchange endpoint should use `is_exchange IS NOT NULL`.

## Common Schema

The public graph surface is identity-grain over semantic network domains.
The current public Chain Insights Graph investigation network is `bittensor`; do not invent
or query unsupported network names. Bittensor native SS58 and Bittensor
EVM-pallet `0x...` member addresses both belong under `network=bittensor`.

Topology is intentionally stable across semantic networks:

- Node: `(:Identity)` with `identity_id`, usually sparse `labels`,
  `is_exchange`, `risk_score`, `risk_level`, and activity rollups.
- Member-address satellite: `(:Address {address, network})`, reached from an
  identity with `(:Identity)-[:HAS_ADDRESS]->(:Address)`. Use this only for
  exact member-address lookup and enumeration; money-flow topology is not
  address-grain.
- Edge: `(:Identity)-[:FLOWS_TO]->(:Identity)` for money flow.
- Flow fields commonly include `tx_count`, `amount_usd_sum`,
  `avg_tx_size_usd`, `first_seen_timestamp`, `last_seen_timestamp`,
  `first_tx_id`, `last_tx_id`, `dominant_asset`, and
  `price_coverage_ratio`. The public identity contract is USD-only; do not
  rely on native `amount_sum`.
- Archive flow fields commonly include `period_granularity`,
  `period_start_date`, `period_end_date`, `tx_count`, `amount_usd_sum`,
  `first_seen_timestamp`, and `last_seen_timestamp`.
- Facts may expose `Identity`, `AddressFeature`, `AddressLabel`, `RiskScore`,
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
  'queries=[{"id":"live_identity_sample","query":"USE live_topology MATCH (i:Identity) RETURN i.identity_id AS identity_id, i.labels AS labels, i.risk_level AS risk_level, i.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity) RETURN src.identity_id AS from_identity, dst.identity_id AS to_identity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp LIMIT 10"},{"id":"member_address_sample","query":"USE live_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity) RETURN src.identity_id AS from_identity, dst.identity_id AS to_identity, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_member_address_sample","query":"USE archive_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 10"},{"id":"facts_feature_sample","query":"USE facts MATCH (i:Identity)-[:HAS_FEATURE]->(f:AddressFeature) RETURN i.identity_id AS identity_id, f.tx_out_count AS tx_out_count LIMIT 10"}]'
```

If a query fails with a generic backend error, narrow it before changing the
investigation claim: remove metadata functions, remove cross-graph joins, use
one relationship, project fewer fields, and lower the limit.

## Query Examples

Resolve a member address to an identity:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (m:Address {address: "FULL_MEMBER_ADDRESS"})<-[:HAS_ADDRESS]-(i:Identity) RETURN i.identity_id AS identity_id LIMIT 1'
```

Live outflows from one identity:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (src:Identity {identity_id: "FULL_IDENTITY_ID"})-[flow:FLOWS_TO]->(dst:Identity) RETURN dst.identity_id AS to_identity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Archive flow history:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE archive_topology MATCH (src:Identity {identity_id: "FULL_IDENTITY_ID"})-[flow:FLOWS_TO]->(dst:Identity) RETURN dst.identity_id AS to_identity, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.last_seen_timestamp DESC LIMIT 50'
```

Facts lookup after schema proof:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE facts MATCH (i:Identity {identity_id: "FULL_IDENTITY_ID"})-[:HAS_LABEL]->(label:AddressLabel) RETURN label.label AS label, label.entity_type AS entity_type, label.source AS source LIMIT 25'
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
