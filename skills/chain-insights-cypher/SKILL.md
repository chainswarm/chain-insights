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
   cia mcp call usage_status
   ```
2. Always pass an explicit `network`.
3. Always add your own `LIMIT`; GraphRAG MCP does not append one.
4. Use `graph_query_batch` for related schema, topology, and facts reads.
5. Save material query output as workspace evidence before summarizing it.

## Layer Choice

| Layer | Use for | Query style |
| --- | --- | --- |
| `USE live_topology` | Current or recent route discovery and fast topology reads | Memgraph-backed Cypher over topology nodes and relationships. Prefer directed `MATCH` patterns and narrow projections. |
| `USE archive_topology` | Historical money-flow and long-window topology facts | StarRocks/MemGQL GQL-Cypher subset. Keep to simple `MATCH`, `WHERE`, property projections, aggregates, `ORDER BY`, and `LIMIT`. |
| `USE facts` | Labels, address features, risk scores, assets, and enrichment | StarRocks/MemGQL facts mapping. Verify the current network schema before assuming fact labels or relationships exist. |

Treat `archive_topology` and `facts` as mapped graph views, not full Memgraph.
Avoid backend-specific functions such as `keys()`, `labels()`, `type()`,
procedures, native BFS syntax, catalog operations, and variable-length path
tricks unless the current endpoint has just accepted the exact pattern.

## Common Schema

Topology is intentionally stable across networks:

- Node: `(:Address)` with `address`, usually sparse `labels` and `is_exchange`.
- Edge: `(:Address)-[:FLOWS_TO]->(:Address)` for money flow.
- Archive flow fields commonly include `edge_id`, `from_address`, `to_address`,
  `period_granularity`, `period_start_date`, `period_end_date`,
  `asset_contract`, `asset_symbol`, `tx_count`, `amount_sum`,
  `amount_usd_sum`, `first_seen_timestamp`, `last_seen_timestamp`,
  `first_tx_id`, and `last_tx_id`.
- Facts may expose `AddressFeature`, `AddressLabel`, `RiskScore`, `Asset`, and
  network-specific fact nodes.

Different networks expose different schemas. Do not reuse a Bittensor stake
query on Base or Ethereum unless that network advertises and proves the same
labels and fields.

## Schema Capture

Use projections instead of metadata functions so the same probe works on both
Memgraph-backed and mapped layers:

```bash
cia mcp call graph_query_batch \
  network=<network> \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"live_address_sample","query":"USE live_topology MATCH (n:Address) RETURN n.address AS address, n.labels AS labels, n.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"facts_address_sample","query":"USE facts MATCH (a:Address) RETURN a.address AS address, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 10"}]'
```

If a query fails with a generic backend error, narrow it before changing the
investigation claim: remove metadata functions, remove cross-graph joins, use
one relationship, project fewer fields, and lower the limit.

## Query Examples

Live outflows from one address:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE live_topology MATCH (src:Address {address: "FULL_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Archive flow history:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE archive_topology MATCH (src:Address {address: "FULL_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.last_seen_timestamp DESC LIMIT 50'
```

Facts lookup after schema proof:

```bash
cia mcp call graph_query \
  network=<network> \
  'query=USE facts MATCH (a:Address {address: "FULL_ADDRESS"})-[:HAS_LABEL]->(label:AddressLabel) RETURN label.label AS label, label.entity_type AS entity_type, label.address_type AS address_type, label.source AS source LIMIT 25'
```

## Hard Stops

- No writes or catalog changes: no `CREATE`, `MERGE`, `SET`, `DELETE`,
  `REMOVE`, `DROP`, `ADD`, `CONNECT`, or `CALL`.
- No raw StarRocks table names through GraphRAG MCP.
- Do not rely on dynamic labels such as `:Exchange`; use `is_exchange` or
  label facts when the schema proves they exist.
- Empty results mean no indexed match in the selected layer, not proof of
  safety or non-existence.
