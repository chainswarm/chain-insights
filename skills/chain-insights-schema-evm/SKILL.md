---
name: chain-insights-schema-evm
description: Use when reading the EVM / Robinhood GraphRAG map — node labels, relationships, and properties for graph_query and graph_query_batch.
---

# Chain Insights schema: EVM / Robinhood

This is the GraphRAG map for EVM addresses. When GraphRAG advertises
`robinhood`, pass `network=robinhood`.

Robinhood is EVM-only. Addresses are H160 `0x...`. The node property
`:Address.network` is `robinhood`.

Load `chain-insights-cypher` for Memgraph dialect rules.

## Topology labels

| Label | What it is |
| --- | --- |
| `Address` | One chain address. Keyed by raw `address`. |

## Topology relationships

| Relationship | Shape | Meaning |
| --- | --- | --- |
| `FLOWS_TO` | `(:Address)-[:FLOWS_TO]->(:Address)` | Lifetime money flow. Directed. |
| `LINKED` | `(:Address)-[:LINKED]-(:Address)` | Same-actor overlay. Undirected. Topology only. |
| `RISK_PROXIMITY` | address-to-address | Nearby risk. Do not treat as money flow. |

`LINKED` is topology-only. Do not query it on facts.

## Address properties

| Property | Notes |
| --- | --- |
| `address` | Raw H160. Public results keep this form. |
| `network` | Address space. `robinhood` here. |
| `labels` | Label names on the node. |
| `label_risk` | Per-label risk maps: `{label, risk_level, updated_timestamp}`. |
| `is_exchange` | Exchange hot wallet when set. |
| `risk_score` / `risk_level` | Node verdict. Always present. |
| `tx_in_count` / `tx_out_count` / `tx_total_count` | Lifetime counts. |
| `degree_in` / `degree_out` / `degree_total` | Neighbor counts. |
| `total_in_usd` / `total_out_usd` / `total_volume_usd` / `net_flow_usd` | Lifetime USD. |
| `first_activity_timestamp` / `last_activity_timestamp` / `activity_span_days` | Activity window. |

There is no `AddressLabel` node and no `HAS_LABEL` or `HAS_RISK_SCORE` edge.

## FLOWS_TO properties

Lifetime aggregates. USD only. Do not use native `amount_sum`.

| Property | Notes |
| --- | --- |
| `tx_count` | Transfer count on the pair. |
| `amount_usd_sum` | Lifetime USD. |
| `avg_tx_size_usd` | Average USD size. |
| `first_seen_timestamp` / `last_seen_timestamp` | First and last flow time. |
| `first_tx_id` / `last_tx_id` | Endpoint transactions. |
| `price_coverage_ratio` | How much of the flow has a price. |

## LINKED properties

| Property | Notes |
| --- | --- |
| `basis` | `derived` or `associated`. |
| `confidence` | Overlay confidence. |
| `source_event` | Why the link exists. |
| `declared_owner` | Declared controller when present. |

Use one visible `LINKED` hop, then `FLOWS_TO`. Do not collapse linked
addresses into one node.

Probe:

```cypher
USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)
RETURN a.address AS address, b.address AS linked_address,
       b.network AS linked_network, l.basis AS basis,
       l.confidence AS confidence
LIMIT 10
```

Call that probe `linked_sample` in `graph_query_batch`.

## Facts labels and relationships

| Label / relationship | Notes |
| --- | --- |
| `Address` | Transfer endpoint only. No `network` property. |
| `Asset` | Token or native asset. |
| `TRANSFER` | One transfer row. Needs an indexed predicate. |

`TRANSFER` properties include `tx_id`, `block_height`, `block_timestamp`,
`event_index`, `edge_index`, `amount`, `amount_usd`, `asset_symbol`,
`asset_contract`, `price_usd`, `price_missing`.

A single-node `MATCH (a:Address)` on facts is refused. Lifetime metrics
live on topology, not facts.

## Exchange terminals

Treat `is_exchange IS NOT NULL` nodes as terminals. Do not walk through
them as intermediate hops.
