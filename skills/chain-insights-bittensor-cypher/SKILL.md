---
name: chain-insights-bittensor-cypher
description: Use when writing Chain Insights graph_query or graph_query_batch reads for network=bittensor, Bittensor SS58 and EVM-pallet addresses, TAO FLOWS_TO, hotkey/coldkey/neuron facts, or Bittensor-specific schema checks.
---

# Chain Insights Bittensor Cypher

Load `chain-insights-cypher` first for generic layer rules. This skill adds the
Bittensor schema and examples.

## Network Rule

Bittensor contains both native Substrate/SS58 addresses such as `5...` and
EVM-pallet `0x...` addresses in one investigation network:

- Use `network=bittensor` for both address families.
- Do not switch networks just because an address is `0x...`.
- Preserve the exact returned `address`, `address_type`, and `network` fields.
- If an endpoint advertises legacy `bittensor_evm`, treat it as compatibility
  evidence, not a reason to split the investigation unless the user asks.

## Current Schema Notes

Observed against staging on 2026-05-29:

- `network_capabilities` advertises Bittensor as default with topology, facts,
  risk, `graph_query`, and `graph_query_batch` available; dataset coverage was
  `unknown`.
- `live_topology` accepted `Address` and `FLOWS_TO` projection queries. Sample
  `Address` rows included `address`, `network`, and `address_type`; `labels`,
  `is_exchange`, degree, and tx-count fields were sparse in the sample.
- `archive_topology` accepted `Address` to `FLOWS_TO` historical queries and
  returned SS58 addresses with `edge_id`, `period_granularity`, amount fields,
  tx count, and first/last timestamps.
- `archive_topology` exposed `TopologySnapshot` in the staging sample.
- On 2026-05-29, staging accepted practical Memgraph-style reads such as
  `WHERE STARTS WITH`, `WITH` aggregations, `CASE`, address-family counts, and
  fixed-hop `FLOWS_TO` patterns. It rejected native Memgraph deep traversal
  operators through the hosted GraphRAG MCP path, including `*BFS`,
  `*WSHORTEST`, `*ALLSHORTEST`, `*KSHORTEST`, and variable-length relationship
  syntax. Use the generic skill reference
  `references/memgraph-examples.md` for tested examples and fixed-hop
  fallbacks.

## Bittensor Shapes

Live topology:

```cypher
USE live_topology
MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address)
RETURN src.address AS from_address,
       dst.address AS to_address,
       flow.amount_sum AS amount_sum,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count,
       flow.first_seen_timestamp AS first_seen_timestamp,
       flow.last_seen_timestamp AS last_seen_timestamp
LIMIT 25
```

Archive topology:

```cypher
USE archive_topology
MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address)
RETURN src.address AS from_address,
       dst.address AS to_address,
       flow.edge_id AS edge_id,
       flow.period_granularity AS period_granularity,
       flow.amount_sum AS amount_sum,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count,
       flow.first_seen_timestamp AS first_seen_timestamp,
       flow.last_seen_timestamp AS last_seen_timestamp
LIMIT 25
```

Facts, when the endpoint proves the mapping:

```cypher
USE facts
MATCH (coldkey:Address)-[:REGISTERED_NEURON]->(hotkey:Hotkey)-[:SERVED_FROM]->(ip:IPAddress)
RETURN coldkey.address AS coldkey,
       hotkey.address AS hotkey,
       ip.ip_address AS ip_address
LIMIT 25
```

## Schema Probe

Use this before a custom Bittensor query session:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"live_address_projection","query":"USE live_topology MATCH (n:Address) RETURN n.address AS address, n.labels AS labels, n.is_exchange AS is_exchange, n.address_type AS address_type, n.network AS network LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.edge_id AS edge_id, flow.period_granularity AS period_granularity, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_snapshot","query":"USE archive_topology MATCH (s:TopologySnapshot) RETURN s.graph_name AS graph_name, s.default_period_granularity AS default_period_granularity, s.available_granularities AS available_granularities LIMIT 5"},{"id":"facts_address_sample","query":"USE facts MATCH (a:Address) RETURN a.address AS address, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 10"}]'
```

Avoid `keys()`, `labels()`, `type()`, native BFS syntax, and variable-length
paths in schema probes. They may be valid in a direct Memgraph console but are
not portable across the GraphRAG MCP federation path.

## Investigation Patterns

Outflows from a SS58 or `0x...` Bittensor address:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (src:Address {address: "FULL_BITTENSOR_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Find likely address completions from a prefix:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (a:Address) WHERE a.address STARTS WITH "5Ggf" RETURN a.address AS address, a.address_type AS address_type, a.network AS network LIMIT 10'
```

Show how the combined Bittensor network currently splits address families:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (a:Address) RETURN a.address_type AS address_type, a.network AS source_network, count(a) AS addresses ORDER BY addresses DESC LIMIT 10'
```

Historical archive read for the same address:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE archive_topology MATCH (src:Address {address: "FULL_BITTENSOR_ADDRESS"})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_sum AS amount_sum, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.first_seen_timestamp AS first_seen_timestamp, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.last_seen_timestamp DESC LIMIT 50'
```

When comparing amounts, remember that archive StarRocks-backed numeric fields
may arrive as strings while live Memgraph fields may arrive as numbers.
