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

| Label                                      | What it is                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Address`                                  | One chain address. Keyed by raw `address`.                                                                                                                                                                                                         |
| `Pool`                                     | A second label on an `Address`: the pool of a swap route or a liquidity event. Both DEX layers set it, so a pool with liquidity and no swap carries it. The node keeps `:Address` and its properties. See the [pool trace rule](#pool-trace-rule). |
| `Chain`                                    | The far side of a bridge: a remote chain and the endpoint used on it. Never an `Address`, so no `FLOWS_TO` walk passes through it.                                                                                                                 |
| `EvmAuthorizationRequest`                  | One EIP-7702 authorization, keyed by `request_id`. Never an `Address`, so no `FLOWS_TO` walk passes through it.                                                                                                                                    |
| `Exchange`, `Scam`, `Victim`, `Sanctioned` | Role labels, a second label on an `Address`. See [Role labels and flags](#role-labels-and-flags).                                                                                                                                                  |

## Topology relationships

| Relationship           | Shape                                                                       | Meaning                                                                                          |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `FLOWS_TO`             | `(:Address)-[:FLOWS_TO]->(:Address)`                                        | Lifetime money flow. Directed.                                                                   |
| `SWAPPED`              | `(:Address)-[:SWAPPED]->(:Address)`                                         | Swap payer to swap recipient, two different addresses. Directed.                                 |
| `ADDED_LIQUIDITY`      | `(:Address)-[:ADDED_LIQUIDITY]->(:Pool)`                                    | Provider to pool. Directed.                                                                      |
| `REMOVED_LIQUIDITY`    | `(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)`                                  | Pool to the address the liquidity was paid to. Directed.                                         |
| `BRIDGED`              | `(:Address)-[:BRIDGED]->(:Chain)` out, `(:Chain)-[:BRIDGED]->(:Address)` in | Bridge use, per address and remote endpoint. Directed.                                           |
| `OPERATED_BY`          | `(:Address)-[:OPERATED_BY]->(:Address)`                                     | Owner to the transaction sender or event operator. Directed. Topology only.                      |
| `LINKED`               | `(:Address)-[:LINKED]-(:Address)`                                           | Same-actor overlay. Undirected. Topology only.                                                   |
| `APPROVED`             | `(:Address)-[:APPROVED]->(:Address)`                                        | Token owner to spender. One link per pair. Directed.                                             |
| `DEPLOYED_CONTRACT`    | `(:Address)-[:DEPLOYED_CONTRACT]->(:Address)`                               | Deployer to the contract it created. One link per creation. Directed.                            |
| `SPONSORED`            | `(:Address)-[:SPONSORED]->(:Address)`                                       | Paymaster to the smart account it paid for. Directed.                                            |
| `BUNDLED`              | `(:Address)-[:BUNDLED]->(:Address)`                                         | Bundler to the smart account it submitted for. Directed.                                         |
| `SIGNED_FOR`           | `(:Address)-[:SIGNED_FOR]->(:Address)`                                      | Signing key to the smart account it signs for. Directed.                                         |
| `SIGNED_AUTHORIZATION` | `(:Address)-[:SIGNED_AUTHORIZATION]->(:EvmAuthorizationRequest)`            | EIP-7702: a wallet to the authorization it signed. Directed.                                     |
| ML pattern links       | address-to-address, ten types                                               | Pattern the ML run found. Do not treat as money flow. See [ML pattern links](#ml-pattern-links). |

`LINKED`, `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED` are
topology-only. Do not query them on facts. Facts serves their rows under
other names: see [Facts labels and relationships](#facts-labels-and-relationships).

One edge holds the lifetime totals of one pair. Single events are facts rows.

## Bookkeeping fields on links

These fields show up in `keys()`. They are not part of the contract. Do not
filter, sort or group on them.

| Field                   | On                                                                                                                                        | Meaning                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synced_through_height` | `FLOWS_TO`, `SWAPPED`, `OPERATED_BY`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`, `BRIDGED`, `APPROVED`, `SPONSORED`, `BUNDLED`, `SIGNED_FOR` | End block of the last sync range added into the link. The link holds every event up to this block. `graph_progress` in `meta_network_capabilities` says how far each kind of link has been synced. |
| `pair_key`              | `FLOWS_TO`, `SWAPPED`                                                                                                                     | Lookup key the sync builds from the ids of the two nodes. It can change when the graph is rebuilt.                                                                                                 |

`LINKED`, `DEPLOYED_CONTRACT` and `SIGNED_AUTHORIZATION` carry neither field.

## Address properties

| Property                                                                      | Notes                                                                        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `address`                                                                     | Raw H160. Public results keep this form.                                     |
| `network`                                                                     | Address space. `robinhood` here.                                             |
| `labels`                                                                      | Role words on the node.                                                      |
| `is_exchange` / `is_scam` / `is_victim` / `is_sanctioned`                     | Role flags. Each is absent unless true.                                      |
| `label_risk_labels` / `label_risk_levels` / `label_risk_updated_timestamps`   | Per-label risk, three parallel lists. Entry i of each list is one label row. |
| `risk_score` / `risk_level`                                                   | ML verdict. No `risk_score` means `UNSCORED`, not low risk.                  |
| `tx_in_count` / `tx_out_count` / `tx_total_count`                             | Lifetime counts.                                                             |
| `degree_in` / `degree_out` / `degree_total`                                   | Neighbor counts.                                                             |
| `total_in_usd` / `total_out_usd` / `total_volume_usd` / `net_flow_usd`        | Lifetime USD.                                                                |
| `first_activity_timestamp` / `last_activity_timestamp` / `activity_span_days` | Activity window.                                                             |

There is no `AddressLabel` node and no `HAS_LABEL` or `HAS_RISK_SCORE` edge.

A contract address also carries `is_contract` and the creation fields
`contract_creation_tx_id`, `contract_creation_type`,
`contract_creation_confidence`, `contract_creation_block_height` and
`contract_creation_timestamp`. They come from its newest creation.
`is_contract` is `true` or absent.

`UNSCORED` means the model gave the address no verdict: it has no
`risk_score`, and a run that dropped it writes `risk_level` `UNSCORED`. Read
it as no signal. Never read it as low risk.

## Role labels and flags

The graph says what an address is, not why a detector said so. The reason
stays in the evidence pipeline. `labels` holds role words, never detector
names.

| Label kind   | Node label    | Flag            | Role word in `labels`              |
| ------------ | ------------- | --------------- | ---------------------------------- |
| `exchange`   | `:Exchange`   | `is_exchange`   | `Exchange`, plus the exchange name |
| `risk`       | `:Scam`       | `is_scam`       | `Scam`                             |
| `protection` | `:Victim`     | `is_victim`     | `Victim`                           |
| `sanctioned` | `:Sanctioned` | `is_sanctioned` | `Sanctioned`, plus the entity name |

- `:Exchange` is a node label now. It is a second label on an `Address`, like
  `:Scam`, `:Victim` and `:Sanctioned`. `:SmartAccount`, `:Bundler`,
  `:Paymaster` and `:EntryPoint` follow the same way, and `:Protocol` marks a
  token, contract, DEX or DeFi address, with the contract name in `labels`.
- The four role flags `is_exchange`, `is_scam`, `is_victim` and
  `is_sanctioned` are markers. Each is absent unless true: an address carries
  `is_scam` only while it has a live `risk` label. No flag is ever `false`.
  Test one with `IS NOT NULL` or `IS NULL`. Do not test `= false`.
- A withdrawn label removes its node label and its flag.
- Only `is_exchange` marks a terminal in a trace. See
  [Exchange terminals](#exchange-terminals).

Read the flags of one address. A flag the address does not have reads as
null:

```cypher
USE topology
MATCH (a:Address {address: "0x…"})
RETURN a.labels AS labels, a.is_exchange AS is_exchange, a.is_scam AS is_scam,
       a.is_victim AS is_victim, a.is_sanctioned AS is_sanctioned
LIMIT 1
```

## FLOWS_TO properties

Lifetime aggregates. USD only. Do not use native `amount_sum`.

| Property                                       | Notes                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx_count`                                     | Count on the pair: token and native transfers plus internal native transfers (a contract sending ETH during a call, such as the ETH leg of a wrap). |
| `amount_usd_sum`                               | Lifetime USD, internal native transfers included.                                                                                                   |
| `first_seen_timestamp` / `last_seen_timestamp` | First and last flow time.                                                                                                                           |

`FLOWS_TO` carries value only. Its `pair_key` and `synced_through_height` are
[bookkeeping](#bookkeeping-fields-on-links). Compute an average inline:
`amount_usd_sum / toFloat(tx_count)`.

`tx_count` counts token and native transfers and also internal native
transfers. `USE facts` `TRANSFER` lists the first group only. No MCP read
lists an internal native transfer yet, so a pair can have a `tx_count` above
0 and no `TRANSFER` row. A link covers all time, and a `USE facts` read
covers one day: read a pair's transfers one day at a time. See
[Facts labels and relationships](#facts-labels-and-relationships).

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

Swap attribution is read from `SWAPPED`, the aggregate (`strength`, `pools`,
`families`), or from the facts `SWAP` row, one route. `FLOWS_TO` carries value
only, so it holds no swap stamp.

| Property                                 | Notes                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sold_asset` / `bought_asset`            | Asset contract. `native` is the chain's native asset.                                                                                                |
| `swap_count`                             | Routes summed on the edge.                                                                                                                           |
| `sold_amount_raw` / `bought_amount_raw`  | Exact raw token quantities, not USD.                                                                                                                 |
| `sold_usd` / `bought_usd`                | USD at the day price, summed over the routes on the edge. A route side with no price adds 0, so 0 can mean no price. Do not read 0 as worth nothing. |
| `pools`                                  | Pool addresses the routes used.                                                                                                                      |
| `families`                               | Protocol families. Today every route reads `unknown`.                                                                                                |
| `strength`                               | The weakest route counted: `swap` or `swap_like`. Today always `swap_like`.                                                                          |
| `first_seen_height` / `last_seen_height` | First and last block height.                                                                                                                         |

- `swap`: the complete route is proven. Payer, recipient, assets, exact raw
  amounts and conservation all check out. The proof needs an execution trace
  (the record of the calls inside a transaction).
- `swap_like`: the shape is a swap and the money moved. The pool's code is
  not proven, so no protocol is named.

Today no route is `swap`. The swap reader reads transaction receipts only,
with no execution trace. Every served route is `swap_like`, with `reason`
`unknown_pool_code` and `families` `unknown`. A Uniswap V2 or V3 swap reads
this way. `unknown` does not mean the protocol is unsupported. A filter on
`strength = 'swap'` or on a known family matches nothing.

A route whose legs could not be paired has strength `swap_unsplit`. It has no
payer, recipient or pool: without a trace the reader cannot tell who paid
whom. It exists in the warehouse only. It makes no edge and no facts row.
`strength` is `swap` or `swap_like` on `SWAPPED` and on facts `SWAP`. A
missing `SWAPPED` edge is not proof that no swap happened.

Three kinds of transaction read `swap_unsplit` today:

- A Uniswap v4 swap. Every one does, by design, so v4 swaps are hidden: they
  make no `SWAPPED` edge and no facts `SWAP` row. They were about 95% of
  `swap_unsplit` on 2026-07-26.
- An intent fill, such as a limit order that a settlement contract fills. It
  has no pool.
- A Uniswap V2 or V3 swap whose token movements do not form one input and one
  output.

The `swap_unsplit` share of a day's swap routes rises with Uniswap v4 use: 1%
on 2026-06-18, 7% on 2026-07-10, 19% on 2026-07-26 and 32% on 2026-08-10.

`sold_usd` and `bought_usd` are always numbers on a link. A route side with no
price adds 0 to the sum, and the link has no count of unpriced routes. So a
link with `bought_usd` 0 may be worth nothing, or may have no price. The
facts `SWAP` row of one route tells which. `sold_price_missing` and
`bought_price_missing` say which side had no price, and the matching
`sold_usd` or `bought_usd` is empty there. A real 0 is rare: on 2026-07-26,
47 of 100 swap routes had no price on the bought side, and fewer than 1 in
100 was a real 0 USD.

`pair_key` and `synced_through_height` on `SWAPPED` are
[bookkeeping](#bookkeeping-fields-on-links).

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

| Property                       | Notes                                              |
| ------------------------------ | -------------------------------------------------- |
| `kinds`                        | Bridge event kinds on the pair.                    |
| `events`                       | Bridge events summed on the edge.                  |
| `totals_raw`                   | Raw totals per event kind and asset, as JSON text. |
| `first_height` / `last_height` | First and last block height.                       |
| `last_bridge_event_id`         | The latest event on the pair.                      |

A `:Chain` is not an `Address`. Two users of the same bridge are not
connected through it.

## OPERATED_BY properties

One edge aggregates one directed owner/operator pair. The source is the
owner (`from_address`). The destination is the transaction sender that moved
the owner's tokens (ERC-20/721), or the event operator (ERC-1155);
not the approved spender. It is the one link that points at the actor instead
of away from it. It meets an `APPROVED` spender only when that spender sent
the transaction itself: a contract that spends an approval keeps the
`APPROVED` link, and `OPERATED_BY` points at the wallet that called it.
Direct transfers with an empty operator create no edge. ERC-20, ERC-721, and
ERC-1155 share this relationship type.

Topology only. Do not query `OPERATED_BY` on facts.

| Property                                         | Notes                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `tx_count`                                       | Operator-mediated transfers in the aggregate.                                                                              |
| `amount_usd_sum`                                 | Lifetime USD through the operator.                                                                                         |
| `first_seen_timestamp` / `last_seen_timestamp`   | First and last mediated transfer.                                                                                          |
| `token_standard`                                 | `ERC20`/`ERC721`/`ERC1155` when unambiguous. Optional — mixed-standard pairs omit it.                                      |
| `owner_address` / `operator_address` / `pair_id` | Endpoint identity on the edge.                                                                                             |
| `valuation_tracked_count`                        | Transfers on the pair that are checked for a USD value: those kept with their raw amount. It can be lower than `tx_count`. |
| `valued_count`                                   | Of those, transfers that got a USD value.                                                                                  |
| `missing_valuation_price_count`                  | Of those, transfers with no price for their day.                                                                           |
| `unknown_quantity_count`                         | Of those, transfers whose token decimals are unknown, so the amount is unknown.                                            |
| `unrepresentable_quantity_count`                 | Of those, transfers whose amount does not fit the warehouse number format.                                                 |
| `usd_range_count`                                | Of those, transfers whose USD value is 10^20 or more. No USD value is stored.                                              |
| `valuation_complete`                             | `true` when `valued_count` equals `valuation_tracked_count`.                                                               |
| `valuation_coverage_ratio`                       | `valued_count` divided by `valuation_tracked_count`. 0 when none is tracked.                                               |

`amount_usd_sum` counts a transfer with no USD value as 0. It is a floor unless
`valuation_complete` is true. The counters do not add up to
`valuation_tracked_count`: a transfer that fails a basic check is tracked, is
not valued, and sits in none of the four reason counters.

`OPERATED_BY` is a topology fact. It is not proof of malicious intent and
carries no risk label. Relayers, keeper bots, and sweepers look like drainers
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
count) are valid but heavy: at millions of edges they can exceed the
60-second per-query limit and burn metered seconds. Scope both endpoints
by `network`, bound by a recent `last_seen_timestamp` window (recompute the
cutoff), and prefer the point-anchored probe on metered endpoints.

## LINKED properties

| Property         | Notes                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `basis`          | `derived` or `associated`.                                           |
| `confidence`     | Overlay confidence.                                                  |
| `source_event`   | Why the link exists.                                                 |
| `declared_owner` | Declared controller when present.                                    |
| `last_height`    | Block height of the newest owner action.                             |
| `owner_state`    | `added` on every link served. An owner that was removed has no link. |

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

## APPROVED properties

One link per token owner and spender, from `Approval` and `ApprovalForAll`
events. An ERC-2612 permit lands here, and only here. Permit2 allowances are
not in the source.

| Property                       | Notes                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `granted_tokens`               | Tokens the owner approved for the spender. Gains a grant, loses a revoke.            |
| `infinite_tokens`              | Tokens whose allowance is unlimited now. Leaves on a revoke or a later finite grant. |
| `has_infinite_grant`           | Ever granted unlimited. Stays true after a revoke, as risk history.                  |
| `first_height` / `last_height` | First and last block height of the approval events.                                  |
| `source_event`                 | `approval`.                                                                          |

An approval is a fact, not proof of malicious intent. Routers and aggregators
hold unlimited approvals too. Confirm with `FLOWS_TO` and label context.

## DEPLOYED_CONTRACT properties

One link per contract creation, from the deployer to the contract. An address
created twice has two links.

| Property                                             | Notes                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                                               | How the contract was created.                                                                                                              |
| `tx_id` / `block_height` / `block_timestamp`         | The creation transaction.                                                                                                                  |
| `deployer_address` / `factory_address` / `tx_origin` | Who deployed it, through which factory, and who sent the transaction.                                                                      |
| `source_event`                                       | `contract_creation`.                                                                                                                       |
| `confidence_score`                                   | The indexer's confidence in how the creation was classified (`kind`). It is 1 on every creation today.                                     |
| `call_type` / `amount`                               | Only when the creation was funded: the funding call (`CREATE` or `CREATE2`) and the native amount sent, as decimal text. Absent otherwise. |

## SPONSORED properties

One link per paymaster and smart account, from the paymaster to the account
whose user operations it paid for. Lifetime totals per pair.

| Property                       | Notes                                     |
| ------------------------------ | ----------------------------------------- |
| `operations`                   | User operations summed on the link.       |
| `failed_operations`            | Operations that failed.                   |
| `entrypoints`                  | EntryPoint contracts the operations used. |
| `first_height` / `last_height` | First and last block height.              |
| `source_event`                 | `user_operation`.                         |

## BUNDLED properties

One link per bundler and smart account, from the bundler to the account whose
user operations it submitted. It has the same properties as `SPONSORED`:
`operations`, `failed_operations`, `entrypoints`, `first_height`,
`last_height` and `source_event` `user_operation`.

## SIGNED_FOR properties

One link per signing key and smart account, from the key to the account it
signs for.

| Property                       | Notes                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| `operations`                   | User operations the key signed for the account, summed on the link. |
| `failed_operations`            | Of those, operations whose user operation failed.                   |
| `first_height` / `last_height` | First and last block height.                                        |
| `source_event`                 | `account_signer`.                                                   |

## SIGNED_AUTHORIZATION properties

The EIP-7702 link. A plain wallet, the authority, signs a `SET_CODE`
authorization and acts as a smart account from then on, running a contract's
code. The link runs from the wallet to an `:EvmAuthorizationRequest`, one
node per `request_id`. A token permit lands on `APPROVED`, never here.

| Property                       | Notes                        |
| ------------------------------ | ---------------------------- |
| `source_event`                 | `authorization`.             |
| `first_height` / `last_height` | First and last block height. |

## ML pattern links

The ML run writes each pattern as its own relationship type, one per kind,
between the addresses the pattern joins. None is money flow.

| Type                   | What the pattern says                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| `CYCLE_PARTICIPANT`    | The address is in a money cycle that returns to its start.                 |
| `LAYERING_HOP`         | The address is a hop in a layering chain.                                  |
| `SMURFING_CLUSTER`     | The address is in a group splitting value into small amounts.              |
| `SYBIL_CLUSTER`        | The address is in a group that acts as one owner.                          |
| `MOTIF_PARTICIPANT`    | The address takes part in a known flow shape, such as fan-in or fan-out.   |
| `RISK_PROXIMITY`       | The address sits a few hops from a risky address.                          |
| `BURST_ACTIVITY`       | A sudden burst of activity.                                                |
| `DORMANT_REACTIVATION` | A long-idle address that woke up.                                          |
| `THRESHOLD_EVASION`    | Amounts kept just under a reporting threshold.                             |
| `FLASH_LOAN_ENVELOPE`  | The flow sits inside a flash loan: borrowed and repaid in one transaction. |

Every one carries `kind`, `source_event` `ml_pattern` and the run id in
`run_id`: the id of the ML run that wrote it. A newer run replaces them, so no
link carries an earlier run's id. A pattern is a model finding, not a verdict. Read it with
`risk_score`, `risk_level` and the labels.

## Facts labels and relationships

| Label / relationship | Shape                                                       | Notes                                                                                                        |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Address`            | —                                                           | Row endpoint only. No `network` property. No `Pool` label.                                                   |
| `TRANSFER`           | `(from:Address)-[t:TRANSFER]->(to:Address)`                 | One token or native transfer row. Lists no internal native transfer. Needs a pair and one day, or a `tx_id`. |
| `SWAP`               | `(payer:Address)-[s:SWAP]->(recipient:Address)`             | One swap route. Needs a pair and one day, or a `tx_id`.                                                      |
| `LIQUIDITY_ADD`      | `(provider:Address)-[l:LIQUIDITY_ADD]->(pool:Address)`      | One liquidity add. Needs a pair and one day, or a `tx_id`.                                                   |
| `LIQUIDITY_REMOVE`   | `(pool:Address)-[l:LIQUIDITY_REMOVE]->(receiver:Address)`   | One liquidity removal. Needs a pair and one day, or a `tx_id`.                                               |
| `BRIDGE_CROSSING`    | `(sender:Address)-[c:BRIDGE_CROSSING]->(recipient:Address)` | One bridge event. Needs a pair and one day, or a `tx_id`.                                                    |

A relationship is served only where its data exists. Check
`meta_network_capabilities` before you query one.

`TRANSFER` properties include `tx_id`, `block_height`, `block_timestamp`,
`event_index`, `edge_index`, `amount`, `amount_usd`, `asset_symbol`,
`asset_contract`, `price_usd`, `price_missing`.

`tx_id` is the `0x` transaction hash. A facts read names an address pair with
one day, or one `tx_id`. The pair is both endpoint addresses, from then to,
and the day is a `block_date` equality. A `block_timestamp` window in epoch
milliseconds narrows the day and is refused on its own. A facts read has one
relationship and takes no `ORDER BY`.

`TRANSFER` lists token and native transfers. It lists no internal native
transfer: see [`FLOWS_TO` properties](#flows_to-properties).

`SWAP` holds one row per route of a `swap` or `swap_like` reading, self swaps
included. Read it by the payer, the recipient and one day, or by a `tx_id`.
`block_timestamp` is epoch milliseconds, in filters and in results, as on
`TRANSFER`.

**Temporary, until graph server issue 1121 is fixed. Remove this note when it ships.**

- Do not return, filter or order by `pools` in a `USE facts` `SWAP` read. Every
  such read fails at the warehouse query memory limit with
  `facts query could not be completed`: by address, by day and by `tx_id`.
- Only `pools` is built by the failing part of the warehouse view. `pool_keys`
  and `families` come from the main read.
- Read `SWAP` rows by `tx_id`, or by the payer, the recipient and one day, and
  leave `pools` out.
- For the pools of a swap, read `SWAPPED.pools` on `USE topology`, anchored on
  the payer or the recipient. `SWAPPED` has one link per payer, recipient, sold
  asset and bought asset, so its `pools` cover every route on the link, not one
  route.

| Property group | Properties                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where          | `block_date`, `block_height`, `block_timestamp`, `tx_id`, `row_index`                                                                                                       |
| Claim          | `strength` (`swap` or `swap_like`), `reason` (why a claim is `swap_like`: `unknown_pool_code` today), `route_id` (ties every leg of one route together), `registry_version` |
| Parties        | `payer`, `recipient`, `pools` (in route order; do not return, filter or order by it, see the temporary note above), `pool_keys`, `families`                                 |
| Sold side      | `sold_asset`, `sold_asset_symbol`, `sold_decimals`, `sold_amount_raw`, `sold_amount`, `sold_price_usd`, `sold_usd`, `sold_price_missing`                                    |
| Bought side    | `bought_asset`, `bought_asset_symbol`, `bought_decimals`, `bought_amount_raw`, `bought_amount`, `bought_price_usd`, `bought_usd`, `bought_price_missing`                    |

`LIQUIDITY_ADD` and `LIQUIDITY_REMOVE` hold one row per liquidity event.
Read them by the two endpoints of the pattern and one day, or by a `tx_id`.
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
`family` on a liquidity row is `v2` or `v3`, read from the event shape. It is
not a swap family: swap `families` read `unknown` today.

`BRIDGE_CROSSING` holds one row per bridge event. Read it by the sender, the
recipient and one day, or by a `tx_id`. Properties: `block_date`,
`block_height`, `tx_id`, `kind`, `direction`, `lifecycle_state`,
`counterpart_status`, `counterpart_chain_id`, `sender`, `recipient`,
`asset_kind`, `amount_raw`, `source_kind`, `source_index`, `route_id`,
`protocol`. It has no `block_timestamp`.

On a facts row, USD comes from the daily price services, never from a swap.
With no price, USD is empty and the matching `…price_missing` is true. A
topology link sums its rows and counts a side with no price as 0: see
[`SWAPPED` properties](#swapped-properties).

A single-node `MATCH (a:Address)` on facts is refused. Lifetime metrics
live on topology, not facts.

## Exchange terminals

Treat `is_exchange IS NOT NULL` nodes as terminals. Do not walk through
them as intermediate hops. `is_exchange` is absent unless true, so a node
with no `is_exchange` property, labelled or not, is walked through:
`is_exchange IS NULL` lets a walk pass. `is_scam`, `is_victim` and
`is_sanctioned` do not end a walk.
