---
name: chain-insights-bittensor-cypher
description: Use when writing Chain Insights graph_query or graph_query_batch reads for network=bittensor, Bittensor SS58 and EVM-pallet addresses, TAO FLOWS_TO, hotkey/coldkey/neuron facts, or Bittensor-specific schema checks.
---

# Chain Insights Bittensor Cypher

Load `chain-insights-cypher` first for generic layer rules. This skill adds the
Bittensor address-grain schema and examples.

## Network Rule

All Bittensor investigation runs on ONE public network: `network=bittensor`.
Native Substrate/SS58 addresses such as `5...` and EVM-pallet `0x...` (H160)
addresses live in the same graph:

- Always pass `network=bittensor` — for SS58 and `0x...` inputs alike. There
  is no separate public query network for the EVM-pallet space.
- The SS58/H160 split is the `:Address.network` node PROPERTY
  (`bittensor` for SS58, `bittensor_evm` for H160) — a per-node value, not a
  `network` argument.
- `FLOWS_TO` stays within one address space; a single `network=bittensor`
  query spans both spaces by walking `FLOWS_TO` within a space and hopping
  the bridge (money) or `LINKED` (ownership) edge across the boundary —
  SS58 → (bridge or LINKED) → H160 and back, with no network switch.
- `LINKED` (undirected, `basis`/`confidence`/`source_event`/`declared_owner`)
  is the ownership edge across the space boundary — use it for cross-space
  resolution, never assume the two spaces share a `FLOWS_TO`-reachable graph.
- Preserve exact returned `address` and `network` fields.

## Current Schema Notes

Observed against the address-serving contract on 2026-07-07:

- `meta_network_capabilities` advertises `bittensor` as the single public
  investigation network with topology, facts, risk, `graph_query`, and
  `graph_query_batch` available.
- `live_topology` uses `Address` nodes and `FLOWS_TO` relationships, keyed by
  the raw chain-native `address` (SS58 or `0x...`), plus a `network` property
  (`bittensor` / `bittensor_evm`) marking the address space.
- `FLOWS_TO` is USD-only for AML value. Use `amount_usd_sum`, not native
  `amount_sum`.
- `archive_topology` uses the same `Address` node surface with historical
  `FLOWS_TO` relationships — money-only; the `LINKED` ownership overlay is
  served on the live and facts tiers, not archive.
- `facts` contains address-keyed enrichment through `HAS_LABEL`,
  `HAS_FEATURE`, and `HAS_RISK_SCORE`, plus the `LINKED` ownership-overlay
  pairs. Bittensor neuron facts may include `REGISTERED_NEURON` and
  `SERVED_FROM` paths when the endpoint exposes them.
- Use the generic skill reference `references/memgraph-examples.md` for tested
  examples and fixed-hop traversal fallbacks. Native Memgraph deep traversal
  operators such as `*BFS`, `*WSHORTEST`, `*ALLSHORTEST`, and `*KSHORTEST` may
  not be portable across the Chain Insights Graph federation path.

## Bittensor Shapes

Live topology address grain:

```cypher
USE live_topology
MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address)
RETURN src.address AS from_address,
       dst.address AS to_address,
       flow.amount_usd_sum AS amount_usd_sum,
       flow.tx_count AS tx_count,
       flow.first_seen_timestamp AS first_seen_timestamp,
       flow.last_seen_timestamp AS last_seen_timestamp
LIMIT 25
```

`LINKED` ownership-overlay lookup (cross-space, `bittensor` <-> `bittensor_evm`):

```cypher
USE live_topology
MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(b:Address)
RETURN a.address AS address,
       b.address AS linked_address,
       b.network AS linked_network,
       l.basis AS basis,
       l.confidence AS confidence,
       l.source_event AS source_event,
       l.declared_owner AS declared_owner
LIMIT 25
```

Archive topology:

```cypher
USE archive_topology
MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address)
RETURN src.address AS from_address,
       dst.address AS to_address,
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
MATCH (address:Address)-[:HAS_FEATURE]->(feature:AddressFeature)
RETURN address.address AS address,
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
  'queries=[{"id":"live_address_projection","query":"USE live_topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_score AS risk_score, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"live_flow_sample","query":"USE live_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"linked_sample","query":"USE live_topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.period_granularity AS period_granularity, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"facts_linked_sample","query":"USE facts MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"facts_feature_sample","query":"USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN a.address AS address, f.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Avoid `keys()`, `labels()`, `type()`, native BFS syntax, and variable-length
paths in schema probes. They may be valid in a direct Memgraph console but are
not portable across the Chain Insights Graph federation path.

## Investigation Patterns

Outflows from a Bittensor address:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (src:Address {address: "5Ggf..."})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count, flow.last_seen_timestamp AS last_seen_timestamp ORDER BY flow.amount_usd_sum DESC LIMIT 50'
```

Find likely address completions from a prefix:

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (a:Address) WHERE a.address STARTS WITH "5Ggf" RETURN a.address AS address, a.network AS network LIMIT 10'
```

Actor-level exposure via one visible `LINKED` hop (AC11):

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN owned.address AS linked_via_address, b.address AS counterparty_address, r.amount_usd_sum AS amount_usd_sum LIMIT 50'
```

Resolve the `bittensor_evm` counterpart of a `bittensor` address (AC5, the only
cross-space edge):

```bash
cia mcp call graph_query \
  network=bittensor \
  'query=USE live_topology MATCH (a:Address {address: "5Ggf..."})-[l:LINKED]-(b:Address) WHERE a.network <> b.network RETURN b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 5'
```

When comparing amounts, remember that archive StarRocks-backed numeric fields
may arrive as strings while live Memgraph fields may arrive as numbers.
