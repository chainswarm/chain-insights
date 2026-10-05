# Chain Insights Graph Query Compatibility Matrix

Chain Insights Graph accepts ISO GQL through `graph_query` and
`graph_query_batch`. A query is routed by its leading `USE <graph>` clause to
one of two backends, each with its own accepted surface:

| Graph      | Backend                     | Query surface                              |
| ---------- | --------------------------- | ------------------------------------------ |
| `topology` | DozerDB, directly over Bolt | **ISO GQL**, bounded (see topology bounds) |
| `facts`    | StarRocks warehouse         | Corpus-scoped GQL subset, compiled to SQL  |

Two consequences drive everything below:

1. **`topology` is ISO GQL.** It is one disk-backed graph that
   serves ALL topology — both recent and full historical activity — in one place;
   there is no separate "live" vs "archive" split and it never compiles to SQL.
   Quantified paths and `SHORTEST`, `ANY SHORTEST`, and `ALL SHORTEST`
   selectors are first-class — subject to bounds enforced before execution.
2. **`facts` is a compiled Cypher _subset_.** A corpus-scoped translator
   (`internal/cyphersql`) compiles a defined shape of `MATCH` / `WHERE` /
   projection / aggregate / `ORDER BY` / `LIMIT` to StarRocks SQL. Shapes outside
   that grammar are rejected with a typed contract error _before_ any SQL runs —
   they do not reach the warehouse.

> **History.** The former shard/federation path and Memgraph stores were
> removed in the 2026-09 Robinhood Dozer cutover. Docs and skills that teach
> those path operators or client merge are historical.

## The shared-graph model — what `network` actually selects

Read this before writing any query that matches `:Address` without an exact
address.

Robinhood is the single public query network: one EVM H160 (`0x…`) address
space over ONE address-grain topology graph. There is no SS58/H160 split and
no second query network — `network=robinhood` selects the one public graph and
there is no `network=robinhood_evm` argument to pass.

The consequence is exact and easy to get wrong:

> **The `network` argument selects the GRAPH, not the subset of addresses
> inside it.**

A `USE topology` query that matches `:Address` without a network predicate
scans the whole public H160 space; scope by the node property when you want an
explicit subset:

```cypher
-- WRONG: unbounded sweep — returns every H160 address in the public space
USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 100

-- RIGHT: scope by the node property
USE topology MATCH (a:Address) WHERE a.network = "robinhood"
RETURN a.address AS address LIMIT 100
```

Exact-address lookups (`MATCH (a:Address {address: "0x…"})`) need no predicate:
the address is already a unique key, and adding a network predicate there fails
closed on an H160 address screened under the chain's primary network name.

### `USE facts` is the opposite case

`facts` is the one place each network _does_ get its own backing database —
the routing metadata on a result reports it as
`facts.routing.starrocks_database`. Because the database already scopes the
network, the facts `Address` label has **no mapped `network` property at all**:

```text
USE facts MATCH (a:Address {address:"0x…"})-[t:TRANSFER]->(b:Address {address:"0x…"})
          WHERE t.block_date = "2026-07-11"
          RETURN a.network AS from_network
→ unknown graph identifier: property "network" is not mapped on label "Address"
```

`Address` on facts is served only as a `TRANSFER` relationship endpoint, so a
single-node `MATCH (a:Address)` is refused there as well. Read address-grain
node properties — including `network` — on `USE topology`.

Getting these two rules backwards is not a stylistic problem. An unscoped
topology sweep publishes wrong-network results at double the metered cost, and
a facts query projecting `network` hard-fails rather than degrading.

## `topology` — ISO GQL

The admitted GQL read surface runs on a read-only session, within the
admission + bounds gate below. This includes clause- and pattern-level `WHERE`,
`WITH` pipelines, `CASE`, `collect()`, temporal functions, `UNWIND`, map
projections, `UNION`, and the full traversal surface. The topology graph serves
`Address` nodes (with the role labels and flags, and a `risk_score` and
`risk_level` verdict, where `UNSCORED` means the model gave no verdict),
`FLOWS_TO` lifetime money-flow edges, `OPERATED_BY` operator-mediated topology
edges (the next section), the `LINKED` ownership overlay, the links from
approvals, contract creations and smart accounts (`APPROVED`,
`DEPLOYED_CONTRACT`, `SPONSORED`, `BUNDLED`, `SIGNED_FOR` and
`SIGNED_AUTHORIZATION`), the ten ML pattern link types, and the swap, liquidity
and bridge totals (`SWAPPED`, `ADDED_LIQUIDITY` and `REMOVED_LIQUIDITY` around
`:Pool` nodes, `BRIDGED` to `:Chain` nodes). Both DEX layers set `:Pool`, so a
pool with liquidity and no swap carries it. A trace through a pool follows the
pool trace rule in the `chain-insights-schema-evm` skill.

### `OPERATED_BY` — operator-mediated topology (topology only)

`OPERATED_BY` is a directed topology relationship between two `Address` nodes:

```text
(:Address)-[:OPERATED_BY]->(:Address)
    owner                         operator
```

The source is the transfer owner (`from_address`). The destination is the
transaction sender that moved the owner's tokens (ERC-20/721), or the event
operator (ERC-1155); not the approved spender (`operator_address`). It is the
one link that points at the actor instead of away from it. It meets an
`APPROVED` spender only when that spender sent the transaction itself. One
edge aggregates one owner/operator pair.

Rules that follow from the grain:

- Direct transfers with an empty `operator_address` create no edge.
- A transfer whose owner is also its operator creates no edge.
- ERC-20, ERC-721, and ERC-1155 transfers share the one relationship type.
- `to_address` never participates in edge identity.
- The relation is topology only. It is not available through `USE facts`.
- It is a topology fact, not a risk verdict — see the caveat below.

Edge aggregate properties (as the live backend provides them):

| Property                                         | Meaning                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx_count`                                       | Operator-mediated transfers in the aggregate.                                                                                                        |
| `amount_usd_sum`                                 | Sum of priced transfer value in USD.                                                                                                                 |
| `first_seen_timestamp` / `last_seen_timestamp`   | First and last transfer time (Unix milliseconds).                                                                                                    |
| `token_standard`                                 | `ERC20`, `ERC721`, or `ERC1155` when the pair's transfers share one unambiguous standard. Absent when mixed. Optional — do not assume it is present. |
| `owner_address` / `operator_address` / `pair_id` | Endpoint identity copied onto the edge.                                                                                                              |
| `valuation_tracked_count`                        | Transfers on the pair that are checked for a USD value. It can be lower than `tx_count`.                                                             |
| `valued_count`                                   | Of those, transfers that got a USD value.                                                                                                            |
| `missing_valuation_price_count`                  | Of those, transfers with no price for their day.                                                                                                     |
| `unknown_quantity_count`                         | Of those, transfers whose token decimals are unknown, so the amount is unknown.                                                                      |
| `unrepresentable_quantity_count`                 | Of those, transfers whose amount does not fit the warehouse number format.                                                                           |
| `usd_range_count`                                | Of those, transfers whose USD value is 10^20 or more. No USD value is stored.                                                                        |
| `valuation_complete`                             | `true` when `valued_count` equals `valuation_tracked_count`.                                                                                         |
| `valuation_coverage_ratio`                       | `valued_count` divided by `valuation_tracked_count`. 0 when none is tracked.                                                                         |

`amount_usd_sum` counts a transfer with no USD value as 0, so it is a floor
unless `valuation_complete` is true. The valuation counters do not add up to
`valuation_tracked_count`: a transfer that fails a basic check is tracked, is
not valued, and sits in none of the four reason counters.

The canonical probe is point-anchored and sub-second on the hosted endpoint:
given one operator address, its top owners. Scope comes from the tool's
`network=robinhood` argument (it selects the graph — see the shared-graph
model above), so no in-query network predicate is needed:

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

The reverse direction — who moved an owner's tokens — swaps the anchor onto
the owner node. A high owner count or transfer count on the probe result is an
investigation lead, not a drainer accusation. Legitimate callers (relayers,
keeper bots, sweepers) produce the same shape. `OPERATED_BY` carries no scam,
victim, or risk label. Confirm with money-flow and label context before
acting.

The whole-graph high-fan-in sweep — every operator grouped by distinct owner
count — is a valid shape but a heavy one: at millions of edges it can exceed
the per-query limit (60 seconds by default), and a sweep that times out can
still consume the metered seconds. Scope both endpoints by the network
property (this match has no exact-address key, so the shared-graph rule
applies), bound it by a recent `last_seen_timestamp` window — recompute the
cutoff rather than copying a literal, for example now minus 7 days in Unix
milliseconds — and prefer the point-anchored probe on metered endpoints:

```cypher
USE topology
MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address)
WHERE owner.network = "robinhood"
  AND operator.network = "robinhood"
  AND operation.last_seen_timestamp >= 1787631843154  -- now minus 7 days, ms
WITH operator,
     count(DISTINCT owner) AS owner_count,
     sum(operation.tx_count) AS transfer_count
WHERE owner_count >= 1000
RETURN operator.address AS operator_address, owner_count, transfer_count
ORDER BY owner_count DESC
LIMIT 25
```

### `APPROVED` — token approvals (topology only)

`(:Address)-[:APPROVED]->(:Address)` joins a token owner to a spender. One link
per pair, from `Approval` and `ApprovalForAll` events. An ERC-2612 permit lands
here, and only here. Permit2 allowances are not in the source.

| Property                       | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `granted_tokens`               | Tokens approved for the spender. Gains a grant, loses a revoke. |
| `infinite_tokens`              | Tokens whose allowance is unlimited now.                        |
| `has_infinite_grant`           | Ever granted unlimited. Stays true after a revoke.              |
| `first_height` / `last_height` | First and last block height of the events.                      |
| `source_event`                 | `approval`.                                                     |

An approval is a fact, not proof of malicious intent.

### `DEPLOYED_CONTRACT` — contract creations (topology only)

`(:Address)-[:DEPLOYED_CONTRACT]->(:Address)` joins a deployer to the contract
it created, one link per creation. `kind` says how it was created.
`confidence_score` is the indexer's confidence in that reading, and it is 1 on
every creation today. `call_type` and `amount` are set only when the creation
was funded: the funding call (`CREATE` or `CREATE2`) and the native amount
sent, as decimal text. `source_event` is `contract_creation`.

### `SPONSORED`, `BUNDLED`, `SIGNED_FOR` — smart accounts (topology only)

- `SPONSORED`: a paymaster to the smart account whose user operations it paid
  for. `operations`, `failed_operations`, `entrypoints`, `first_height`,
  `last_height`, `source_event` `user_operation`.
- `BUNDLED`: a bundler to the smart account whose user operations it
  submitted. The same properties as `SPONSORED`.
- `SIGNED_FOR`: a signing key to the smart account it signs for.
  `operations` (user operations the key signed for the account),
  `failed_operations` (of those, the ones that failed), `first_height`,
  `last_height`, `source_event` `account_signer`.

### `SIGNED_AUTHORIZATION` — the EIP-7702 link (topology only)

A plain wallet, the authority, signs a `SET_CODE` authorization and acts as a
smart account from then on. `(:Address)-[:SIGNED_AUTHORIZATION]->(:EvmAuthorizationRequest)`
joins the wallet to the request, one node per `request_id`. The link carries
`source_event` `authorization`, `first_height` and `last_height`. A permit
lands on `APPROVED`, never here.

### ML pattern links (topology only)

Each ML pattern is its own relationship type, between the addresses the
pattern joins: `CYCLE_PARTICIPANT`, `LAYERING_HOP`, `SMURFING_CLUSTER`,
`SYBIL_CLUSTER`, `MOTIF_PARTICIPANT`, `RISK_PROXIMITY`, `BURST_ACTIVITY`,
`DORMANT_REACTIVATION`, `THRESHOLD_EVASION` and `FLASH_LOAN_ENVELOPE`. Every
one carries `kind`, `source_event` `ml_pattern` and the run id in `run_id`. A
newer run replaces them. None is money flow.

### Swap attribution

Swap attribution is read from `SWAPPED`, the aggregate (`strength`, pools,
families), or from the facts `SWAP` row, one route. `FLOWS_TO` carries value
only.

### `LINKED` and `BRIDGED` properties

`LINKED` carries `basis`, `confidence`, `source_event` `account_owner`,
`declared_owner`, `owner_state` (`added` on every link served: a removed owner
has no link) and `last_height`, the block height of the newest owner action.
`BRIDGED.totals_raw` is keyed by event kind and asset, so one sum has one unit.

### Traversal (the expanded surface)

| Form               | Syntax                                                                                                                                                                                    | Supported          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Quantified path    | `MATCH p = (a:Address WHERE NOT a:Pool) (()-[:FLOWS_TO\|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO\|SWAPPED]-(b:Address)`                                              | ✅ upper bound ≤ 5 |
| One shortest path  | `MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO\|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO\|SWAPPED]-(b:Address {address: $to})`   | ✅ upper bound ≤ 5 |
| Any shortest path  | `MATCH p = ANY SHORTEST (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO\|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO\|SWAPPED]-(b:Address {address: $to})` | ✅ upper bound ≤ 5 |
| All shortest paths | `MATCH p = ALL SHORTEST (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO\|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO\|SWAPPED]-(b:Address {address: $to})` | ✅ upper bound ≤ 5 |
| Open target        | `MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) (()-[:FLOWS_TO\|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO\|SWAPPED]-(b:Address)`                      | ✅ upper bound ≤ 5 |

Every form above carries the pool guard and walks `SWAPPED` beside
`FLOWS_TO`. `WHERE NOT a:Pool` keeps the walk from starting at a `:Pool`, the
inner `WHERE NOT via:Pool` keeps each address in the middle of the walk off
one, and `SWAPPED` crosses a swap from payer to recipient, per the
[pool trace rule](../skills/chain-insights-schema-evm/SKILL.md#pool-trace-rule).
Only the target end may be a pool. Up to 4 guarded hops plus the last hop is
1 to 5 hops. Keep the guards inside the path pattern: a `WHERE` after a
`SHORTEST` pattern runs after the shortest route is chosen, so it drops a
route that crosses a pool instead of finding the route that avoids it. Use
the route and open-target shapes as written, changing only the addresses.

### Topology admission + bounds gate

Admission mirrors the production graph MCP exactly (read-only, byte size ≤ 32768,
single statement, must start with a read clause). On top of that, traversal is
bounded so an admitted query cannot become an unbounded graph walk:

| Bound                             | Limit     | Rejected example                                                                         |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| Traversal depth (upper hop bound) | ≤ 5       | `-[:FLOWS_TO]-{1,9}(b)` → _traversal depth 9 exceeds the maximum of 5_                   |
| Unbounded traversal               | forbidden | `(a)-[:FLOWS_TO]-(b)` with no quantifier bound → fail closed                             |
| Non-GQL path operators/functions  | forbidden | Legacy path functions and starred path algorithms return a dialect error                 |
| `UNWIND` literal list length      | ≤ 1000    | `UNWIND [ …1001 items… ] AS x` → _UNWIND list of 1001 items exceeds the maximum of 1000_ |

Always add an explicit upper hop bound and a `LIMIT`. A topology read that
filters on a link property also needs an address in its pattern: see
[Topology limits and errors](graph-tools.md#topology-limits-and-errors).
Writes/DDL (`CREATE`, `MERGE`, `SET`, `DELETE`, `DROP`, `CALL`, …) are always
rejected — the surface is read-only.

## `facts` — compiled Cypher subset

The translator compiles a defined grammar to StarRocks SQL. All literals are
bound as parameters (no SQL injection surface). Anything outside the grammar is
rejected with a typed contract error before execution.

### Supported

| Construct                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MATCH` on a mapped node / single relationship     | `(from:Address)-[t:TRANSFER]->(to:Address)` (bounded individual transfer rows from `facts_transfers_view`). Lifetime address metrics are node properties on `USE topology` (the facts `AddressFeature` surface is retired). `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` are single-event rows on the same pattern, each with its own indexed predicate (see the `chain-insights-schema-evm` skill). Never serves `FLOWS_TO`, `OPERATED_BY`, `LINKED`, `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` or `BRIDGED` — those are topology-only. Labels and per-label risk live on the topology address node, not on `facts`. |
| Chained fixed-hop patterns                         | up to 5 hops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Bare `block_date` bound                            | `t.block_date >= ?` / `<`, `<=`, `>`, `=` — the caller's own day range, passed through. `BETWEEN` and `IN` are refused (`unsupported WHERE operator`): write a range as `>=` and `<`. The bound must be bare (no function around the column) and conjunctive (not inside an `OR` arm). An explicit full-range bound (`>= '1970-01-01'`) stays lifetime.                                                                                                                                                                                                                                                                                            |
| `tx_id` equality                                   | `t.tx_id = "…"` — a point lookup on the `TRANSFER` edge's row-level key; on EVM networks the `0x` transaction hash, served from the indexed hash columns. Lifetime semantics. `IN` and `BETWEEN` are refused (`unsupported WHERE operator "IN"`): send one equality per transaction, several in one `graph_query_batch`.                                                                                                                                                                                                                                                                                                                           |
| Time window inside a bare `block_date` bound       | `t.block_date = "2026-07-11" AND t.block_timestamp >= 1783738500000 AND t.block_timestamp < 1783738560000` — the day bound with `=`, `>=`, `>`, `<` or `<=`; `block_timestamp` (epoch milliseconds) with `>=`, `>`, `<` or `<=`, not `=` (one instant is `>= x AND <= x`); `block_height` (a block number) with `=`, `>=`, `>`, `<` or `<=`. `BETWEEN` and `IN` are refused. The window compiles to the day's block key range. On their own these two columns bound nothing (see the cost-shape gate).                                                                                                                                             |
| Address equality                                   | `{address:"…"}` map or `a.address = "…"` — **a recency window is auto-applied** (bare `block_date >= now − 90 days`; the window is `FACTS_RECENCY_WINDOW_DAYS`, default 90). Address-only queries return the last 90 days. `IN` is refused: send one equality per address, several in one `graph_query_batch`.                                                                                                                                                                                                                                                                                                                                     |
| Inline property maps                               | `MATCH (a:Address {address:"…"})`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Property projections with aliases                  | `RETURN a.address AS address, t.amount_usd AS amount_usd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Aggregates **with** a partition-bounding predicate | `count`, `sum`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ORDER BY`, `LIMIT` (≤ 1000), `OFFSET`-free paging | `LIMIT` required unless a partition-bounding predicate is present — except `TRANSFER`, where a partition-bounding predicate is always required (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Cost-shape gate

`facts` rejects full-scan shapes so a mapped-graph read cannot turn into an
unbounded warehouse scan. `core_transfers` is split into one partition per
day, keyed on `block_date` — a query without a bare `block_date` bound, a
`tx_id` point lookup, or an address filter (window auto-applied) touches
every partition and is refused before any SQL runs. The refusal names the
remedy: _add a bare `block_date` bound, or query by `tx_id`, or filter by
address (a recency window is auto-applied)_.

| Rejected shape                                                                             | Contract error                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Predicate-less global aggregate                                                            | `count(i)` with no partition-bounding predicate → _StarRocks-backed aggregate graph queries require a partition-bounding predicate: add a bare `block_date` bound, or query by `tx_id`, or filter by address (a recency window is auto-applied)_                                                 |
| No `LIMIT` and no partition-bounding predicate                                             | → _StarRocks-backed graph queries require an explicit LIMIT or partition-bounding predicate: add a bare `block_date` bound, or query by `tx_id`, or filter by address (a recency window is auto-applied)_                                                                                        |
| `TRANSFER` row-select or aggregate with no partition-bounding predicate, even with `LIMIT` | `facts_transfers_view` is a full transfer-history table — a bare `LIMIT` does not bound the scan → _StarRocks-backed TRANSFER graph queries require a partition-bounding predicate: add a bare `block_date` bound, or query by `tx_id`, or filter by address (a recency window is auto-applied)_ |
| `block_height` / `block_timestamp` range only                                              | `t.block_height >= ?` bounds the sort key, not the day partitions → rejected with the remedy error                                                                                                                                                                                               |
| Wrapped `block_date`                                                                       | `DATE(t.block_date) >= ?` wraps the partition column → rejected with the remedy error                                                                                                                                                                                                            |
| `block_date` bound inside an `OR` arm                                                      | `t.block_height >= 0 OR t.block_date >= ?` — the optimizer cannot prune the unbounded arm → rejected with the remedy error                                                                                                                                                                       |
| `LIMIT` above the ceiling                                                                  | `LIMIT 5000` → _StarRocks-backed graph query LIMIT exceeds maximum 1000_                                                                                                                                                                                                                         |

### `SWAP` reads and `pools` (temporary)

**Temporary, until graph server issue 1121 is fixed. Remove this section when it
ships.**

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

### Not in the facts grammar (contract error)

These compile-reject (`ErrUnsupportedShape` / related) — they never reach
StarRocks. Use the topology graph, or restructure:

| Construct                                                                       | Instead                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `FLOWS_TO` / `OPERATED_BY` topology edges                                       | The topology graph — facts never serves either                                                                          |
| `OPERATED_BY`                                                                   | The topology graph — operator topology is topology-only                                                                 |
| `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`, `BRIDGED`, the `:Pool` label | The topology graph. Facts serves the single events as `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` |
| Quantified paths and shortest selectors                                         | The topology graph, or a single fixed-hop `LINKED` pattern                                                              |
| `WITH` pipelines                                                                | The topology graph                                                                                                      |
| `CASE … END`                                                                    | The topology graph, or post-process client-side                                                                         |
| Grouped aggregates (`GROUP BY`-shaped)                                          | The topology graph, or per-key `graph_query_batch`                                                                      |
| `collect()` and other warehouse-dialect-gap aggregates                          | The topology graph                                                                                                      |
| Self-joins / node-to-node comparison `WHERE a <> b`                             | Compare key properties: `a.address <> b.address`                                                                        |
| Untyped relationship `-[r]->`                                                   | Name the relationship type                                                                                              |
| Metadata functions `keys(n)`, `labels(n)`, `type(r)`                            | Project known properties explicitly                                                                                     |

There is no longer a local pinned conformance suite; verify supported and
rejected shapes against a live Chain Insights Graph endpoint.

## Role labels and flags (topology graph)

The graph labels an address with role words: `Exchange`, `Scam`, `Victim` and
`Sanctioned`. Each role is also a node label, so it is queryable on
`topology`. `:Exchange` is a node label now.

| Form                                                | Result                           |
| --------------------------------------------------- | -------------------------------- |
| `MATCH (n:Exchange)` — bare role label              | ✅                               |
| `MATCH (n:Address:Exchange)` — colon-stacked labels | ✅ (native Cypher)               |
| `RETURN labels(n)`                                  | project known properties instead |

The four role flags are `is_exchange`, `is_scam`, `is_victim` and
`is_sanctioned`. Each is absent unless true: an address carries the flag only
while it has a live label of that role. A flag is never `false`, so test it
with `IS NOT NULL` or `IS NULL`, not `= false`. A withdrawn label removes its
node label and its flag. Only `is_exchange` ends a walk.

Caveats: facts carries only its mapped labels, so role-label patterns are
topology-only. The property-flag form (`is_exchange`) remains the canonical
filter.

## Practical guidance

- **Prefer inline property maps for equality lookups**:
  `MATCH (a:Address {address:"X"})` over
  `MATCH (a:Address) WHERE a.address = "X"`.
- **Bound every traversal and add `LIMIT`.** The topology gate rejects
  unbounded and over-depth traversal outright; facts rejects predicate-less
  scans.
- **Shortest paths rank by hop count.** Weighted money paths are not part of
  the product. Use `SHORTEST 1` with a quantified bound instead of enumerating
  hops client-side.
- **Facts stays fixed-hop.** For bounded transfer rows and, until P3,
  address features, write one explicit pattern per shape and batch them
  with `graph_query_batch`.
- When a query is rejected, read the returned contract error — it names the exact
  violated bound or unsupported shape.

## Related documentation

- `docs/graph-tools.md` — tool tiers, timeouts, and capability transparency
- Skill `chain-insights-cypher` — ISO GQL dialect and layer rules
- Skill `chain-insights-schema-evm` — EVM / Robinhood GraphRAG map
