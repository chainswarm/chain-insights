---
name: chain-insights-bittensor-cypher
description: Use when writing Chain Insights graph_query or graph_query_batch reads for network=bittensor, Bittensor SS58 and EVM-pallet addresses, TAO FLOWS_TO, hotkey/coldkey/neuron facts, or Bittensor-specific schema checks.
---

# Chain Insights Bittensor Cypher

Load `chain-insights-cypher` first for generic layer rules. This skill adds the
Bittensor identity schema and examples.

## Network Rule

Bittensor contains both native Substrate/SS58 addresses such as `5...` and
EVM-pallet `0x...` addresses in one semantic investigation network:

- Use `network=bittensor` for both address families.
- Do not switch networks just because an address is `0x...`.
- `meta_network_capabilities` should advertise Bittensor as one public semantic
  domain; Bittensor EVM is not a separate public network.
- Preserve exact returned `identity_id`, member `address`, and member `network`
  fields.

## Current Schema Notes

Observed against the identity-serving contract on 2026-06-13:

- `meta_network_capabilities` advertises Bittensor as default with topology, facts,
  risk, `graph_query`, and `graph_query_batch` available.
- `live_topology` uses `Identity` nodes and `FLOWS_TO` relationships. Identity
  keys use the public form `bittensor:<canonical_evm_address>`.
- Member address forms live on `(:Address {address, network})` satellite nodes
  reached from `(:Identity)-[:HAS_ADDRESS]->(:Address)`.
- `FLOWS_TO` is USD-only for AML value. Use `amount_usd_sum`, not native
  `amount_sum`.
- `archive_topology` uses the same `Identity` node surface with historical
  `FLOWS_TO` relationships and compatible `HAS_ADDRESS` member-address
  lookup.
- `facts` contains identity-keyed enrichment through `HAS_LABEL`,
  `HAS_FEATURE`, and `HAS_RISK_SCORE`. Bittensor neuron facts may include
  `REGISTERED_NEURON` and `SERVED_FROM` paths when the endpoint exposes them.
- Use the generic skill reference `references/memgraph-examples.md` for tested
  examples and fixed-hop traversal fallbacks. Native Memgraph deep traversal
  operators such as `*BFS`, `*WSHORTEST`, `*ALLSHORTEST`, and `*KSHORTEST` may
  not be portable across the Chain Insights Graph federation path.

## Bittensor Shapes

Live topology identity grain:

```cypher
USE live_topology
MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity)
RETURN src.identity_id AS from_identity,
       dst.identity_id AS to_identity,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count,
       flow.first_seen_timestamp AS first_seen_timestamp,
       flow.last_seen_timestamp AS last_seen_timestamp
LIMIT 25
```

Member-address lookup:

```cypher
USE live_topology
MATCH (i:Identity {identity_id: "bittensor:0x..."})-[:HAS_ADDRESS]->(m:Address)
RETURN i.identity_id AS identity_id,
       m.address AS member_address,
       m.network AS member_network
LIMIT 25
```

Archive topology:

```cypher
USE archive_topology
MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity)
RETURN src.identity_id AS from_identity,
       dst.identity_id AS to_identity,
       flow.period_granularity AS period_granularity,
       flow.period_start_date AS period_start_date,
       flow.period_end_date AS period_end_date,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count
LIMIT 25
```

Facts, when the endpoint proves the mapping:

```cypher
USE facts
MATCH (identity:Identity)-[:HAS_FEATURE]->(feature:AddressFeature)
RETURN identity.identity_id AS identity_id,
       feature.tx_out_count AS tx_out_count,
       feature.tx_in_count AS tx_in_count
LIMIT 25
```

## Schema Probe

Use this before a custom Bittensor query session:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"live_identity_projection","query":"USE live_topology MATCH (i:Identity) RETURN i.identity_id AS identity_id, i.labels AS labels, i.risk_score AS risk_score, i.risk_level AS risk_level, i.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity) RETURN src.identity_id AS from_identity, dst.identity_id AS to_identity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"member_address_sample","query":"USE live_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Identity)-[flow:FLOWS_TO]->(dst:Identity) RETURN src.identity_id AS from_identity, dst.identity_id AS to_identity, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"archive_member_address_sample","query":"USE archive_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 10"},{"id":"facts_feature_sample","query":"USE facts MATCH (i:Identity)-[:HAS_FEATURE]->(f:AddressFeature) RETURN i.identity_id AS identity_id, f.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Avoid `keys()`, `labels()`, `type()`, native BFS syntax, and variable-length
paths in schema probes. They may be valid in a direct Memgraph console but are
not portable across the Chain Insights Graph federation path.

## Investigation Patterns

Outflows from a Bittensor identity:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (src:Identity {identity_id: "bittensor:0x..."})-[flow:FLOWS_TO]->(dst:Identity) RETURN dst.identity_id AS to_identity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Resolve a SS58 or `0x...` member address to its identity:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (m:Address {address: "FULL_BITTENSOR_ADDRESS"})<-[:HAS_ADDRESS]-(i:Identity) RETURN i.identity_id AS identity_id LIMIT 1'
```

Find likely member-address completions from a prefix:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (m:Address) WHERE m.address STARTS WITH "5Ggf" RETURN m.address AS address, m.network AS member_network LIMIT 10'
```

Address-family census:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN m.network AS member_network, count(m) AS addresses ORDER BY addresses DESC LIMIT 10'
```

When comparing amounts, remember that archive StarRocks-backed numeric fields
may arrive as strings while live Memgraph fields may arrive as numbers.
