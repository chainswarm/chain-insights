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

| Label     | What it is                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Address` | One chain address. Keyed by raw `address`.                                                                                                                                |
| `Pool`    | A second label on an `Address`: the pool of a swap route or a liquidity event. The node keeps `:Address` and its properties. See the [pool trace rule](#pool-trace-rule). |
| `Chain`   | The far side of a bridge: a remote chain and the endpoint used on it. Never an `Address`, so no `FLOWS_TO` walk passes through it.                                        |

## Topology relationships

| Relationship        | Shape                                                                       | Meaning                                                          |
| ------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `FLOWS_TO`          | `(:Address)-[:FLOWS_TO]->(:Address)`                                        | Lifetime money flow. Directed.                                   |
| `SWAPPED`           | `(:Address)-[:SWAPPED]->(:Address)`                                         | Swap payer to swap recipient, two different addresses. Directed. |
| `ADDED_LIQUIDITY`   | `(:Address)-[:ADDED_LIQUIDITY]->(:Pool)`                                    | Provider to pool. Directed.                                      |
| `REMOVED_LIQUIDITY` | `(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)`                                  | Pool to the address the liquidity was paid to. Directed.         |
| `BRIDGED`           | `(:Address)-[:BRIDGED]->(:Chain)` out, `(:Chain)-[:BRIDGED]->(:Address)` in | Bridge use, per address and remote endpoint. Directed.           |
| `OPERATED_BY`       | `(:Address)-[:OPERATED_BY]->(:Address)`                                     | Owner to approved operator. Directed. Topology only.             |
| `LINKED`            | `(:Address)-[:LINKED]-(:Address)`                                           | Same-actor overlay. Undirected. Topology only.                   |
| `RISK_PROXIMITY`    | address-to-address                                                          | Nearby risk. Do not treat as money flow.                         |

`LINKED`, `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED` are
topology-only. Do not query them on facts. Facts serves their rows under
other names: see [Facts labels and relationships](#facts-labels-and-relationships).

One edge holds the lifetime totals of one pair. Single events are facts rows.

## Address properties

| Property                                                                      | Notes                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `address`                                                                     | Raw H160. Public results keep this form.                       |
| `network`                                                                     | Address space. `robinhood` here.                               |
| `labels`                                                                      | Label names on the node.                                       |
| `label_risk`                                                                  | Per-label risk maps: `{label, risk_level, updated_timestamp}`. |
| `is_exchange`                                                                 | Exchange hot wallet when set.                                  |
| `risk_score` / `risk_level`                                                   | Node verdict. Always present.                                  |
| `tx_in_count` / `tx_out_count` / `tx_total_count`                             | Lifetime counts.                                               |
| `degree_in` / `degree_out` / `degree_total`                                   | Neighbor counts.                                               |
| `total_in_usd` / `total_out_usd` / `total_volume_usd` / `net_flow_usd`        | Lifetime USD.                                                  |
| `first_activity_timestamp` / `last_activity_timestamp` / `activity_span_days` | Activity window.                                               |

There is no `AddressLabel` node and no `HAS_LABEL` or `HAS_RISK_SCORE` edge.

## FLOWS_TO properties

Lifetime aggregates. USD only. Do not use native `amount_sum`.

| Property                                       | Notes                             |
| ---------------------------------------------- | --------------------------------- |
| `tx_count`                                     | Transfer count on the pair.       |
| `amount_usd_sum`                               | Lifetime USD.                     |
| `avg_tx_size_usd`                              | Average USD size.                 |
| `first_seen_timestamp` / `last_seen_timestamp` | First and last flow time.         |
| `first_tx_id` / `last_tx_id`                   | Endpoint transactions.            |
| `price_coverage_ratio`                         | How much of the flow has a price. |

`FLOWS_TO` into and out of pools stays as it is. A pool is a real
counterparty. Follow the [pool trace rule](#pool-trace-rule) when a trace
reaches one.

## Pool trace rule

A pool holds many people's money. A trace that walks out of a pool on
`FLOWS_TO` lands on every trader who used the pool. Every trace follows
this rule:

1. Enter a `:Pool` on any edge.
2. Leave a `:Pool` only on `REMOVED_LIQUIDITY`, to the address the liquidity
   was paid to.
3. Never leave a `:Pool` on `FLOWS_TO`.
4. Across a swap, follow `SWAPPED` from payer to recipient, between two
   different addresses. Do not walk through the pool.

This section is the rule's one home. The dialect skill, the graph tools
guide and the documented recipes point here. The MCP server's graph hints
carry these four steps word for word, for clients that load no skill, and a
test keeps the two the same.

A walk keeps step 3 with the pool guard: a `FLOWS_TO` walk never starts at a
`:Pool` and never passes through one. It may end at one. A fixed-hop walk
writes `WHERE NOT src:Pool AND NOT mid:Pool`. A quantified or shortest-path
walk puts `WHERE NOT a:Pool` on its start and `WHERE NOT via:Pool` inside the
path pattern. A walk keeps step 4 by following `FLOWS_TO|SWAPPED`, so it
crosses a swap from payer to recipient. `chain-insights-cypher` shows both
forms.

Two-hop trace under the rule. The first branch walks `FLOWS_TO` and `SWAPPED`
through ordinary addresses and never starts at or passes a pool. The second
passes a pool only on a removal. Neither reaches the traders a pool paid on
their swaps:

```cypher
USE topology
MATCH (src:Address {address: "0x…"})-[r1:FLOWS_TO|SWAPPED]->(mid:Address)-[r2:FLOWS_TO|SWAPPED]->(dst:Address)
WHERE NOT src:Pool AND NOT mid:Pool AND mid.is_exchange IS NULL AND dst.address <> src.address
RETURN mid.address AS via_address, type(r2) AS exit_edge, dst.address AS to_address,
       coalesce(r2.amount_usd_sum, r2.bought_usd) AS exit_usd
LIMIT 25
UNION
MATCH (src:Address {address: "0x…"})-[r1:FLOWS_TO|ADDED_LIQUIDITY]->(mid:Pool)-[r2:REMOVED_LIQUIDITY]->(dst:Address)
WHERE NOT src:Pool AND dst.address <> src.address
RETURN mid.address AS via_address, type(r2) AS exit_edge, dst.address AS to_address,
       r2.usd AS exit_usd
LIMIT 25
```

## Pool properties

A `:Pool` node carries the `Address` properties plus its lifetime liquidity
totals.

| Property                | Notes                                      |
| ----------------------- | ------------------------------------------ |
| `liquidity_added_usd`   | USD all providers added.                   |
| `liquidity_removed_usd` | USD all receivers removed.                 |
| `liquidity_net_usd`     | Added minus removed. Near 0 means emptied. |
| `provider_count`        | Distinct named providers.                  |
| `receiver_count`        | Distinct named receivers.                  |

## SWAPPED properties

One edge per payer, recipient, sold asset and bought asset. It sums the swap
routes whose payer differs from the recipient. A self swap, where the payer
gets the output back, makes no edge. It is still a facts `SWAP` row.

| Property                                 | Notes                                                          |
| ---------------------------------------- | -------------------------------------------------------------- |
| `sold_asset` / `bought_asset`            | Asset contract. `native` is the chain's native asset.          |
| `swap_count`                             | Routes summed on the edge.                                     |
| `sold_amount_raw` / `bought_amount_raw`  | Exact raw token quantities, not USD.                           |
| `sold_usd` / `bought_usd`                | USD at the daily price. Empty when no price service covers it. |
| `pools`                                  | Pool addresses the routes used.                                |
| `families`                               | Protocol families, for example `uniswap-v2`, or `unknown`.     |
| `strength`                               | The weakest route counted: `swap` or `swap_like`.              |
| `first_seen_height` / `last_seen_height` | First and last block height.                                   |

- `swap`: the complete route is proven. Payer, recipient, assets, exact raw
  amounts and conservation all check out.
- `swap_like`: the shape is a swap, but the pool matches no reviewed family.
  The money moved. The protocol is unidentified.

A route whose legs could not be paired makes no edge and no facts row. A
missing `SWAPPED` edge is not proof that no swap happened.

## ADDED_LIQUIDITY and REMOVED_LIQUIDITY properties

One edge per named provider and pool, and one per pool and named receiver.
An event whose provider or receiver cannot be named makes no edge. Its facts
row says `party_state` `unnamed`.

| Property                                 | Notes                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `event_count`                            | Liquidity events summed on the edge.                                            |
| `totals_raw`                             | Raw amount per asset.                                                           |
| `usd`                                    | USD over the priced sides.                                                      |
| `unpriced_count`                         | Events with a side no price service covers.                                     |
| `first_seen_height` / `last_seen_height` | First and last block height.                                                    |
| `fees_raw`                               | `REMOVED_LIQUIDITY` only. Fees per asset, paid on top of the principal.         |
| `receiver_added_usd`                     | `REMOVED_LIQUIDITY` only. USD the receiver itself added to the same pool, or 0. |
| `receiver_provided`                      | `REMOVED_LIQUIDITY` only. True when the receiver also added to the pool.        |

A receiver's profit from a pool is `usd` minus `receiver_added_usd`.

- A drain by a stranger: `receiver_provided` is false and
  `receiver_added_usd` is 0.
- A rug pull by the pool's creator: `receiver_provided` is true and `usd` is
  far above `receiver_added_usd`.

Rug-pull probe. It follows the pool trace rule: in on `FLOWS_TO`, out on
`REMOVED_LIQUIDITY`:

```cypher
USE topology
MATCH (victim:Address {address: "0x…"})-[paid:FLOWS_TO]->(pool:Pool)-[removal:REMOVED_LIQUIDITY]->(receiver:Address)
WHERE NOT victim:Pool AND receiver.address <> victim.address
RETURN pool.address AS pool_address, receiver.address AS receiver_address,
       paid.amount_usd_sum AS paid_in_usd, removal.usd AS removed_usd,
       removal.receiver_added_usd AS receiver_added_usd,
       removal.usd - removal.receiver_added_usd AS receiver_profit_usd,
       removal.receiver_provided AS receiver_provided
ORDER BY removed_usd DESC
LIMIT 25
```

## BRIDGED properties

One edge per address and remote endpoint, in each direction. `(:Address)-[:BRIDGED]->(:Chain)`
is outbound. `(:Chain)-[:BRIDGED]->(:Address)` is inbound. The `:Chain` node
carries `network` (the remote chain) and `address` (the endpoint on it).

| Property                       | Notes                              |
| ------------------------------ | ---------------------------------- |
| `kinds`                        | Bridge event kinds on the pair.    |
| `events`                       | Bridge events summed on the edge.  |
| `totals_raw`                   | Raw totals per kind, as JSON text. |
| `first_height` / `last_height` | First and last block height.       |
| `last_bridge_event_id`         | The latest event on the pair.      |

A `:Chain` is not an `Address`. Two users of the same bridge are not
connected through it.

## OPERATED_BY properties

One edge aggregates one directed owner/operator pair. The source is the
owner (`from_address`). The destination is the approved operator that
executed the transfer. Direct transfers with an empty operator create no
edge. ERC-20, ERC-721, and ERC-1155 share this relationship type.

Topology only. Do not query `OPERATED_BY` on facts.

| Property                                          | Notes                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tx_count`                                        | Operator-mediated transfers in the aggregate.                                         |
| `amount_usd_sum`                                  | Lifetime USD through the operator.                                                    |
| `first_seen_timestamp` / `last_seen_timestamp`    | First and last mediated transfer.                                                     |
| `bucket_start_timestamp` / `bucket_end_timestamp` | Graph-shard window bounds, milliseconds.                                              |
| `token_standard`                                  | `ERC20`/`ERC721`/`ERC1155` when unambiguous. Optional — mixed-standard pairs omit it. |
| `owner_address` / `operator_address` / `pair_id`  | Endpoint identity on the edge.                                                        |

`OPERATED_BY` is a topology fact. It is not proof of malicious intent and
carries no risk label. Routers, aggregators, and sweepers look like drainers
on owner count alone. Confirm with `FLOWS_TO` and label context.

Point-anchored probe (sub-second on the hosted endpoint). It needs no
network predicate for the same reason any exact-address lookup does not: the
address is already a unique key, so the match cannot leave the selected
address space:

```cypher
USE topology
MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: "0x…"})
RETURN owner.address AS owner_address,
       operation.tx_count AS tx_count,
       operation.amount_usd_sum AS amount_usd_sum,
       coalesce(operation.token_standard, "mixed") AS token_standard,
       operation.last_seen_timestamp AS last_seen_timestamp
ORDER BY operation.tx_count DESC
LIMIT 10
```

Call that probe `operated_by_sample` in `graph_query_batch`. Zero rows is a
healthy result. Whole-graph high-fan-in sweeps (every operator grouped by distinct owner
count) are valid but heavy: at millions of edges they exceed the hosted
10-second per-query budget and can burn metered seconds. Scope both endpoints
by `network`, bound by a recent `last_seen_timestamp` window (recompute the
cutoff), and prefer the point-anchored probe on metered endpoints.

## LINKED properties

| Property         | Notes                             |
| ---------------- | --------------------------------- |
| `basis`          | `derived` or `associated`.        |
| `confidence`     | Overlay confidence.               |
| `source_event`   | Why the link exists.              |
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

| Label / relationship | Shape                                                       | Notes                                                      |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `Address`            | —                                                           | Row endpoint only. No `network` property. No `Pool` label. |
| `Asset`              | —                                                           | Token or native asset.                                     |
| `TRANSFER`           | `(from:Address)-[t:TRANSFER]->(to:Address)`                 | One transfer row. Needs an indexed predicate.              |
| `SWAP`               | `(payer:Address)-[s:SWAP]->(recipient:Address)`             | One swap route. Needs an indexed predicate.                |
| `LIQUIDITY_ADD`      | `(provider:Address)-[l:LIQUIDITY_ADD]->(pool:Address)`      | One liquidity add. Needs an indexed predicate.             |
| `LIQUIDITY_REMOVE`   | `(pool:Address)-[l:LIQUIDITY_REMOVE]->(receiver:Address)`   | One liquidity removal. Needs an indexed predicate.         |
| `BRIDGE_CROSSING`    | `(sender:Address)-[c:BRIDGE_CROSSING]->(recipient:Address)` | One bridge event. Needs an indexed predicate.              |

A relationship is served only where its data exists. Check
`meta_network_capabilities` before you query one.

`TRANSFER` properties include `tx_id`, `block_height`, `block_timestamp`,
`event_index`, `edge_index`, `amount`, `amount_usd`, `asset_symbol`,
`asset_contract`, `price_usd`, `price_missing`.

`tx_id` is the `0x` transaction hash. Filter `TRANSFER` by it, by an address
on either endpoint, or by a bare `block_date` bound. A `block_timestamp`
window in epoch milliseconds narrows a `block_date` bound and is refused on
its own.

`SWAP` holds one row per route of a `swap` or `swap_like` reading, self swaps
included. Filter it by an address on either endpoint or by a `tx_id`
equality. `block_timestamp` is epoch milliseconds, in filters and in
results, as on `TRANSFER`.

| Property group | Properties                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where          | `block_date`, `block_height`, `block_timestamp`, `tx_id`, `row_index`                                                                                    |
| Claim          | `strength`, `reason` (why a claim is `swap_like`), `route_id` (ties every leg of one route together), `registry_version`                                 |
| Parties        | `payer`, `recipient`, `pools` (in route order), `pool_keys`, `families`                                                                                  |
| Sold side      | `sold_asset`, `sold_asset_symbol`, `sold_decimals`, `sold_amount_raw`, `sold_amount`, `sold_price_usd`, `sold_usd`, `sold_price_missing`                 |
| Bought side    | `bought_asset`, `bought_asset_symbol`, `bought_decimals`, `bought_amount_raw`, `bought_amount`, `bought_price_usd`, `bought_usd`, `bought_price_missing` |

`LIQUIDITY_ADD` and `LIQUIDITY_REMOVE` hold one row per liquidity event.
Filter them by an address on either endpoint or by a `tx_id` equality.
`block_timestamp` is epoch milliseconds, in filters and in results, as on
`TRANSFER`.

| Property group          | Properties                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Where                   | `block_date`, `block_height`, `block_timestamp`, `tx_id`, `log_index`                                          |
| Parties                 | `party`, `party_state` (`named` or `unnamed`), `pool`, `family`                                                |
| First asset             | `asset0`, `asset0_symbol`, `asset0_decimals`, `amount0_raw`, `amount0`, `amount0_usd`, `amount0_price_missing` |
| Second asset            | `asset1`, `asset1_symbol`, `asset1_decimals`, `amount1_raw`, `amount1`, `amount1_usd`, `amount1_price_missing` |
| Totals                  | `usd`, `evidence_state` (`matched` or `amount_mismatch`), `registry_version`                                   |
| `LIQUIDITY_REMOVE` only | `principal0_raw`, `principal1_raw`, `fees0_raw`, `fees1_raw`, `principal_usd`, `fees_usd`                      |

`usd` sums the priced sides and is empty when neither side has a price.
`amount0_price_missing` and `amount1_price_missing` say which side had none.

`BRIDGE_CROSSING` holds one row per bridge event. Filter it by a bare
`block_date` bound or a `tx_id` equality. Properties: `block_date`,
`block_height`, `tx_id`, `kind`, `direction`, `lifecycle_state`,
`counterpart_status`, `counterpart_chain_id`, `sender`, `recipient`,
`asset_kind`, `amount_raw`, `source_kind`, `source_index`, `route_id`,
`protocol`. It has no `block_timestamp`.

USD comes from the daily price services, never from a swap. With no price,
USD is empty and the matching `…price_missing` is true.

A single-node `MATCH (a:Address)` on facts is refused. Lifetime metrics
live on topology, not facts.

## Exchange terminals

Treat `is_exchange IS NOT NULL` nodes as terminals. Do not walk through
them as intermediate hops.
