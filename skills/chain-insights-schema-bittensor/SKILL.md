---
name: chain-insights-schema-bittensor
description: Use when reading the Bittensor GraphRAG map — node labels, relationships, and properties for graph_query and graph_query_batch.
---

# Chain Insights schema: Bittensor

This is the GraphRAG map for Bittensor. It is a schema skill, not a hosted
network claim.

Pass `network=bittensor` when a Bittensor graph is actually reachable.
Substrate/SS58 addresses (`5...`) and EVM-pallet `0x...` (H160) addresses
live in the same graph.

The `network` argument selects the graph. The address-space split lives on
the `:Address.network` node property:

- `bittensor` — SS58
- `bittensor_evm` — H160

`FLOWS_TO` stays inside one address space. Cross-space hops use `LINKED`
or a bridge, not a second network argument.

Load `chain-insights-cypher` for Memgraph dialect rules.

## Topology labels

| Label     | What it is                                                 |
| --------- | ---------------------------------------------------------- |
| `Address` | One chain address. SS58 or H160.                           |
| `Neuron`  | Hotkey on a subnet. Also labeled `:Miner` or `:Validator`. |
| `Subnet`  | One netuid.                                                |

Validator and miner roles come from chain evidence, not registry labels.

## Topology relationships

| Relationship | Shape                                 | Meaning                            |
| ------------ | ------------------------------------- | ---------------------------------- |
| `FLOWS_TO`   | `(:Address)-[:FLOWS_TO]->(:Address)`  | Lifetime TAO / USD flow.           |
| `LINKED`     | `(:Address)-[:LINKED]-(:Address)`     | Same-actor overlay. Topology only. |
| `MINES`      | `(:Neuron)-[:MINES]->(:Subnet)`       | Miner role.                        |
| `VALIDATES`  | `(:Neuron)-[:VALIDATES]->(:Subnet)`   | Validator role.                    |
| `HOTKEY_OF`  | `(:Address)-[:HOTKEY_OF]->(:Neuron)`  | Address is the hotkey.             |
| `COLDKEY_OF` | `(:Address)-[:COLDKEY_OF]->(:Neuron)` | Address is the coldkey.            |
| `OWNS`       | `(:Address)-[:OWNS]->(:Subnet)`       | Subnet owner.                      |

`LINKED` is not a facts edge.

## Address properties

Same lifetime metrics as other address-grain graphs, plus:

| Property                                                      | Notes                                     |
| ------------------------------------------------------------- | ----------------------------------------- |
| `address`                                                     | Raw SS58 or H160. Keep the returned form. |
| `network`                                                     | `bittensor` or `bittensor_evm`.           |
| `labels` / `label_risk`                                       | Labels and per-label risk on the node.    |
| `is_exchange`                                                 | Exchange terminal when set.               |
| `risk_score` / `risk_level`                                   | Node verdict.                             |
| `chain_name` / `chain_url` / `chain_github` / `chain_discord` | On-chain name fields.                     |
| `tx_in_count` / `tx_out_count`                                | Lifetime counts.                          |

Address-to-neuron links are `HOTKEY_OF` and `COLDKEY_OF` only. Risk lives
on the address node, not on a satellite edge.

## Neuron and subnet properties

| Label    | Properties                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- |
| `Neuron` | `hotkey`, `netuid`. IP / axon-port observation lives here.                                     |
| `Subnet` | `netuid`, `name`, `github_repo`, `url`, `discord`, `contact`, `owner_coldkey`, `owner_hotkey`. |

## FLOWS_TO and LINKED properties

Same as the EVM map. AML value is USD. Use `amount_usd_sum`, not native
`amount_sum`. `LINKED` carries `basis`, `confidence`, `source_event`,
`declared_owner`.

Probe:

```cypher
USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)
RETURN a.address AS address, b.address AS linked_address,
       b.network AS linked_network, l.basis AS basis,
       l.confidence AS confidence
LIMIT 10
```

Call that probe `linked_sample` in `graph_query_batch`.

## Facts

Facts serve bounded `TRANSFER` rows between `Address` endpoints. The facts
`Address` label has no `network` property. Neuron, hotkey, coldkey, and
subnet shape live on topology, not facts.

`TRANSFER` still needs an indexed predicate: address equality on either
endpoint, or `tx_id`.
