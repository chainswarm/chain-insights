# Chain Insights Graph Cypher Examples

Use these examples when an investigation needs practical graph-language reads
instead of only schema probes. They are adapted from Memgraph query and deep
path traversal features, then bounded to the Chain Insights Graph surface.

Official Memgraph references:

- Querying: https://memgraph.com/docs/querying
- Deep path traversal: https://memgraph.com/docs/advanced-algorithms/deep-path-traversal

## Staging Validation

Validated against the address-serving contract on 2026-07-07 with
`network=bittensor` and `per_query_timeout_seconds=5`.

Accepted through Chain Insights Graph:

- `MATCH`, directed relationship patterns, property equality, `WHERE`
- `STARTS WITH`
- `WITH`, `count`, `sum`
- `CASE`
- `ORDER BY`, explicit `LIMIT`
- fixed-hop patterns written as explicit relationships
- simple `facts` counts and filtered projections
- `facts` `Address` projections and feature/label/risk relationships when the
  current schema probe proves them

Rejected through the current hosted path with a generic backend error:

- variable-length relationship syntax such as `[:FLOWS_TO*1..2]`
- Memgraph native BFS syntax such as `*BFS` and `USING HOPS LIMIT`
- weighted/all/K shortest path operators: `*WSHORTEST`, `*ALLSHORTEST`,
  `*KSHORTEST`
- `OPTIONAL MATCH`
- `UNION ALL`

Treat rejected syntax as direct-Memgraph reference material only unless the
current endpoint accepts the exact query. For Chain Insights agents, use the
fixed-hop `graph_query_batch` fallback below for traversal.

## Topology Examples

Top outflows by amount:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 25'
```

Rank addresses by live out-degree and transferred USD:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) WITH src, count(dst) AS out_degree, sum(flow.amount_usd_sum) AS total_usd RETURN src.address AS address, out_degree, total_usd ORDER BY out_degree DESC LIMIT 25'
```

Bucket flows for quick triage:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, CASE WHEN flow.amount_usd_sum IS NULL THEN "unknown" WHEN flow.amount_usd_sum >= 100000 THEN "large" WHEN flow.amount_usd_sum >= 10000 THEN "medium" ELSE "small" END AS amount_bucket, flow.amount_usd_sum AS amount_usd_sum LIMIT 25'
```

Prefix search for address completion:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address) WHERE a.address STARTS WITH "5Ggf" RETURN a.address AS address, a.network AS network LIMIT 10'
```

`LINKED` ownership-overlay census by network:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN b.network AS linked_network, count(b) AS linked_addresses ORDER BY linked_addresses DESC LIMIT 10'
```

Cross-space `LINKED` resolution — the ownership edge across the SS58/H160
space boundary (`:Address.network` values `bittensor` / `bittensor_evm`); all
of this runs on the single public `network=bittensor`:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address {address: "0x20d09f2881602eee806147ceee9275d33ff31df8"})-[l:LINKED]-(b:Address) WHERE a.network <> b.network RETURN b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 5'
```

## Historical Flows

`USE topology` already covers full lifetime history — there is no separate mode
to opt into for older activity. Top lifetime outflows for one address:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (src:Address {address: "5Ggf..."})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.last_seen_timestamp DESC LIMIT 25'
```

`FLOWS_TO` edges are lifetime aggregates (first/last endpoints only); there are
no period-granular rollups. The `LINKED` ownership overlay is topology-only.
Topology `LINKED` sample:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 25'
```

Remember that facts numeric fields may arrive as strings.

## Facts Examples

Facts `Address` projection:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE facts MATCH (a:Address) RETURN a.address AS address, a.labels AS labels, a.risk_level AS risk_level LIMIT 25'
```

Risk scores after schema proof:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE facts MATCH (a:Address)-[:HAS_RISK_SCORE]->(r:RiskScore) RETURN a.address AS address, r.risk_score AS risk_score, r.risk_level AS risk_level, r.model_version AS model_version LIMIT 25'
```

Only use richer fact labels or relationships after a fresh schema probe proves
the current network exposes them.

## Fixed-Hop Traversal Fallback

Memgraph deep traversal docs cover BFS, weighted shortest path, all shortest
paths, and K shortest paths. Through the current Chain Insights Graph path, those
native operators were rejected on staging. Use explicit fixed-hop batches for
Chain Insights traversal instead.

One-hop path:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"hop_1","query":"USE topology MATCH (src:Address {address: \"FULL_SOURCE_ADDRESS\"})-[r1:FLOWS_TO]->(dst:Address {address: \"FULL_TARGET_ADDRESS\"}) RETURN src.address AS from_address, dst.address AS to_address, 1 AS hops, r1.amount_usd_sum AS amount_usd_sum, r1.tx_count AS tx_count LIMIT 25"}]'
```

Two-hop expansion with exchange-stopped intermediate nodes:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"hop_2","query":"USE topology MATCH (src:Address {address: \"FULL_SOURCE_ADDRESS\"})-[r1:FLOWS_TO]->(mid:Address)-[r2:FLOWS_TO]->(dst:Address) WHERE mid.is_exchange IS NULL RETURN src.address AS from_address, mid.address AS mid_address, dst.address AS to_address, 2 AS hops, r1.amount_usd_sum AS first_amount_usd, r2.amount_usd_sum AS second_amount_usd LIMIT 25"}]'
```

Generate one query per depth when investigating a path. Keep each query
directed, stop expansion at exchange nodes, and use a small `LIMIT` while
exploring.

## Direct Memgraph Reference Syntax

Use this syntax only in a direct Memgraph console or after the Chain Insights Graph
endpoint accepts the same pattern.

Native BFS:

```cypher
MATCH path=(src:Address {address: "FULL_SOURCE_ADDRESS"})-[:FLOWS_TO *BFS]->(dst:Address {address: "FULL_TARGET_ADDRESS"})
RETURN path
LIMIT 5;
```

Weighted shortest path:

```cypher
MATCH path=(src:Address {address: "FULL_SOURCE_ADDRESS"})-[:FLOWS_TO *WSHORTEST (r, n | coalesce(r.amount_usd_sum, 1)) total_weight]->(dst:Address {address: "FULL_TARGET_ADDRESS"})
RETURN path, total_weight
LIMIT 5;
```

K shortest alternatives:

```cypher
MATCH (src:Address {address: "FULL_SOURCE_ADDRESS"}), (dst:Address {address: "FULL_TARGET_ADDRESS"})
WITH src, dst
MATCH path=(src)-[:FLOWS_TO *KSHORTEST|3]->(dst)
RETURN path
LIMIT 3;
```
