# Chain Insights Graph Tools

This document covers the graph-facing tools and the result contracts that
agents should rely on during investigations.

The first release exposes graph analysis through the hosted MCP endpoint and
the `cia mcp` commands. High-level CIA workflows are listed by `cia workflows`
and run with `cia workflow`. Results are returned as text and structured facts.

## Chain Insights Graph Surface

The Chain Insights Graph surface is intentionally small:

| Tool                   | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `network_capabilities` | Return supported networks and graph layers when the backend exposes capability metadata |
| `graph_query`          | Run one read-only GQL/Cypher query through the universal graph endpoint                 |
| `graph_query_batch`    | Run related read-only graph-language queries as one MCP call                            |

Chain Insights tools such as `aml_address_risk` are recipes built over
`graph_query_batch`. They are not assumed to exist on the
Chain Insights Graph endpoint.

`cia workflows` lists local, high-level CIA workflow tools. Use
`cia workflow aml-address-risk` for the address-risk workflow.

`cia mcp tools` lists the remote GraphRAG surface only. Use `cia networks` for
the short network overview, `cia network <name>` for one network's details and
remote tools, and `cia mcp networks` for the full network capability matrix.
Use `cia mcp call` for low-level GraphRAG calls and custom read-only queries.

The Chain Insights MCP proxy adds product-facing local metadata tools such as
`meta_network_capabilities`, `meta_usage_status`, and `meta_help`. On hosted
backends, `meta_usage_status` can reflect remote quota telemetry. On
backends without a quota tool, Chain Insights returns a local unmetered
primitive-backend status instead.

## Swaps, liquidity pools and bridges

The topology graph holds lifetime totals per pair. The facts layer holds the
single events behind them. Both read the warehouse, which stays the source
of truth.

| Topology edge       | Shape                                                                | One edge per                                      |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `SWAPPED`           | `(:Address)-[:SWAPPED]->(:Address)`                                  | payer, recipient, sold asset and bought asset     |
| `ADDED_LIQUIDITY`   | `(:Address)-[:ADDED_LIQUIDITY]->(:Pool)`                             | named provider and pool                           |
| `REMOVED_LIQUIDITY` | `(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)`                           | pool and named receiver                           |
| `BRIDGED`           | `(:Address)-[:BRIDGED]->(:Chain)`, `(:Chain)-[:BRIDGED]->(:Address)` | address and remote bridge endpoint, per direction |

| Facts relationship | Shape                                                      | One row per       |
| ------------------ | ---------------------------------------------------------- | ----------------- |
| `SWAP`             | `(payer:Address)-[:SWAP]->(recipient:Address)`             | swap route        |
| `LIQUIDITY_ADD`    | `(provider:Address)-[:LIQUIDITY_ADD]->(pool:Address)`      | liquidity add     |
| `LIQUIDITY_REMOVE` | `(pool:Address)-[:LIQUIDITY_REMOVE]->(receiver:Address)`   | liquidity removal |
| `BRIDGE_CROSSING`  | `(sender:Address)-[:BRIDGE_CROSSING]->(recipient:Address)` | bridge event      |

- `:Pool` is a second label on an `Address`: the pool of a swap route or a
  liquidity event. It carries the pool's liquidity totals.
- `SWAPPED` joins two different addresses. A self swap is a `SWAP` row only.
  `strength` is `swap` (the whole route is proven) or `swap_like` (the shape
  is a swap, the protocol is unidentified).
- `REMOVED_LIQUIDITY` carries `receiver_added_usd` and `receiver_provided`.
  A receiver's profit from a pool is `usd` minus `receiver_added_usd`.
- `SWAP` and `LIQUIDITY_*` rows need an address on either endpoint or a
  `tx_id` equality. `BRIDGE_CROSSING` rows need a bare `block_date` bound or
  a `tx_id` equality.
- `block_timestamp` on `SWAP` and `LIQUIDITY_*` rows is epoch milliseconds,
  in filters and in results, as on `TRANSFER`.
- USD comes from the daily price services, never from a swap. With no price,
  USD is empty and the matching `…price_missing` property is true.
- Swap attribution is read from `SWAPPED`, the aggregate (`strength`, pools,
  families), or from the facts `SWAP` row, one route. `FLOWS_TO` carries value
  only.
- A missing `SWAPPED` edge or `SWAP` row is not proof that no swap happened.

`FLOWS_TO` into and out of pools stays as it is. A trace that reaches a
`:Pool` follows the pool trace rule:

- The rule is stated once, in the
  [`chain-insights-schema-evm` skill](../skills/chain-insights-schema-evm/SKILL.md#pool-trace-rule).
- The MCP server instructions serve the same four steps, word for word,
  because an MCP client loads no skill. A test keeps the two equal.
- It stops a trace from fanning out to every trader who used the pool, and
  it still reaches the address that took the liquidity out.
- Every documented `FLOWS_TO` walk carries the pool guard on its start and
  on every address in its middle: a walk may end at a `:Pool`, but never
  starts at one or passes through one.
- Every documented trace walks `SWAPPED` beside `FLOWS_TO`, so it crosses a
  swap from payer to recipient without passing through the pool.

Route between two addresses under the rule. It walks `FLOWS_TO` and
`SWAPPED`. The guards sit inside the path pattern, on the start and on every
address in the middle, so the search finds the shortest route that avoids
pools. `ANY SHORTEST` and `ALL SHORTEST` take the same pattern in place of
`SHORTEST 1`:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE topology MATCH p = SHORTEST 1 (a:Address {address: "0x..."} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x..."}) RETURN [n IN nodes(p) | n.address] AS route'
```

Every property is listed in the `chain-insights-schema-evm` skill.

Rug-pull check from a victim, under the rule:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE topology MATCH (victim:Address {address: "0x..."})-[paid:FLOWS_TO]->(pool:Pool)-[removal:REMOVED_LIQUIDITY]->(receiver:Address) WHERE NOT victim:Pool AND receiver.address <> victim.address RETURN pool.address AS pool_address, receiver.address AS receiver_address, paid.amount_usd_sum AS paid_in_usd, removal.usd AS removed_usd, removal.receiver_added_usd AS receiver_added_usd, removal.usd - removal.receiver_added_usd AS receiver_profit_usd, removal.receiver_provided AS receiver_provided ORDER BY removed_usd DESC LIMIT 25'
```

One transaction's swap routes, with their strength and pools:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (payer:Address)-[s:SWAP]->(recipient:Address) WHERE s.tx_id = "0x..." RETURN payer.address AS payer, recipient.address AS recipient, s.strength AS strength, s.reason AS reason, s.route_id AS route_id, s.pools AS pools, s.sold_asset_symbol AS sold, s.sold_usd AS sold_usd, s.bought_asset_symbol AS bought, s.bought_usd AS bought_usd LIMIT 10'
```

A relationship is served only where its data exists. Check
`meta_network_capabilities` before querying one.

## Role labels and flags

The graph labels an address with role words: `Exchange`, `Scam`, `Victim` and
`Sanctioned`. `:Exchange` is a node label now, and so are `:Scam`, `:Victim`
and `:Sanctioned`. Each role also has a flag on the node.

| Role         | Node label    | Flag            |
| ------------ | ------------- | --------------- |
| `Exchange`   | `:Exchange`   | `is_exchange`   |
| `Scam`       | `:Scam`       | `is_scam`       |
| `Victim`     | `:Victim`     | `is_victim`     |
| `Sanctioned` | `:Sanctioned` | `is_sanctioned` |

- Each flag is absent unless true. An address carries the flag only while it
  has a live label of that role. A flag is never `false`.
- Test a flag with `IS NOT NULL` or `IS NULL`. Do not test `= false`.
- Only `is_exchange` ends a walk: exchange hot wallets are terminals, and a
  node with no `is_exchange` is walked through.
- Every property is listed in the `chain-insights-schema-evm` skill.

## Query Rules

- `network` is required. Do not guess it in agent workflows.
- GQL/Cypher must be read-only.
- Use `USE topology` for topology (the address / FLOWS_TO / OPERATED_BY / LINKED graph,
  covering unified recent and full historical activity in one graph, plus the
  node `risk_score`/`risk_level` verdict, the `SWAPPED`,
  `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED` totals, and the
  `:Pool` label).
- Use `USE facts` for bounded individual `TRANSFER` rows and their amount,
  `amount_usd`, asset, transaction, and block facts, and for single `SWAP`,
  `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows. Address
  labels, risk, lifetime metrics, and `FLOWS_TO`/`LINKED` relationships
  belong to `USE topology`.
- Every `TRANSFER` read carries an indexed predicate: an address on either
  endpoint, a `tx_id` (the `0x` transaction hash on EVM networks), or a bare
  `block_date` bound, which `block_timestamp` bounds in epoch milliseconds
  may narrow to a time window.
- Use `meta_usage_status` through Chain Insights before public hosted reads
  when you need the caller's remaining free-tier allowance.
- Hosted endpoints can expose a public free tier for graph_query. The default
  is 10 execution seconds per IP per UTC day.
- Prepared wallet users receive the daily free tier first; after it is used,
  x402 payment continues automatically from the configured wallet.
- Use explicit LIMIT and pagination in your query when you want bounded result
  sets.
- Chain Insights Graph does not append `LIMIT`; Chain Insights recipes own their
  own limits and pagination.
- Use single bounded `graph_query` calls for public no-wallet free-tier usage. Use
  `graph_query_batch` for related reads that should share one paid call; public
  free-tier access does not include batches.
- `per_query_timeout_seconds` is optional and capped at `10` by default.
- Returned rows live in `structuredContent.facts`.

Agent installers ship three skills:

- `chain-insights-address-risk`: one-address screen via `aml_address_risk`.
- `chain-insights-cypher`: Memgraph dialect and layer rules for
  `graph_query` and `graph_query_batch`. No query cookbook.
- `chain-insights-schema-evm`: EVM / Robinhood GraphRAG labels,
  relationships, and properties.

Check public-free usage:

```bash
cia mcp call meta_usage_status
```

Example single query:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level LIMIT 10"
```

Example facts queries, one transaction and one time window:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "0x350065e1a55d7272de562706fdea5f48ae83cf10e468e56b2209f8cfbaaf1901" RETURN from.address AS from_address, to.address AS to_address, t.amount AS amount, t.asset_symbol AS asset_symbol LIMIT 10'

cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.block_date = "2026-07-11" AND t.block_timestamp >= 1783738500000 AND t.block_timestamp < 1783738560000 RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, from.address AS from_address, to.address AS to_address, t.amount AS amount LIMIT 10'
```

Example batch query:

```bash
cia mcp call graph_query_batch \
  network=robinhood \
  'queries=[{"id":"count","query":"USE topology MATCH (a:Address) RETURN count(a) AS count LIMIT 1"},{"id":"flows","query":"USE topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN src.address AS source, dst.address AS target, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count LIMIT 3"},{"id":"linked","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 3"}]'
```

Batch calls reserve worst-case execution time from their timeout settings. On
public hosted endpoints, they can ask for paid x402 access even when a small
free-tier allowance remains.

Batch result facts include:

```json
{
  "batch": {
    "count": 2,
    "completed": 2,
    "failed": 0,
    "per_query_timeout_seconds": 10,
    "total_query_elapsed_ms": 1345,
    "billable_seconds": 2,
    "estimated_usdc": "0.02"
  }
}
```

## Topology limits and errors

Hosted `USE topology` queries share one graph database, so every query is
bounded:

- **Time:** the graph database stops a query when its time budget ends
  (10 seconds by default, or your lower `per_query_timeout_seconds`).
- **Concurrency:** at most 4 topology queries run at once on the hosted
  endpoint. A query waits for a free slot inside its own time budget.
- **Memory:** a query that grows past the per-query memory limit is stopped.

A stopped query fails with one of these codes. The code starts the error text
and is also returned as `refusal_code` in the response metadata.

| Code                 | Meaning                                                          | What to do                                                                                   |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `topology_busy`      | No slot freed before the time budget ended. The query never ran. | Retry later. The wait is not billed; the usual 1-second minimum still applies.               |
| `query_timeout`      | The query ran out of time.                                       | Anchor it on an exact address, lower the hop bound, or add a tighter `LIMIT` or time window. |
| `query_memory_limit` | The query needed more memory than one query may use.             | Return fewer rows or properties, or split the read.                                          |

These errors mean the query was stopped, not that data is missing. Path
searches that cross hub addresses, such as the zero address or large routers,
are the most common cause of `query_timeout`: one hop through a hub can touch
millions of edges. A route or an open target keeps its one guarded shape: change
only its addresses, never its `{0,4}` bound.

## Operator topology recipe

`OPERATED_BY` is the owner-to-operator topology edge. The operator is the
transaction sender that moved the owner's tokens (ERC-20/721), or the event
operator (ERC-1155); not the approved spender. Use it to see which owners an
operator moved tokens for, and how much moved — the shape behind drainer
investigations. It is topology-only and carries no risk label; a high owner
count alone is not an accusation.

The hosted-endpoint recipe is point-anchored and sub-second. Pass
`network=robinhood` explicitly — the tool argument scopes the graph — and
own the `LIMIT`:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: \"0x…\"}) RETURN owner.address AS owner_address, operation.tx_count AS tx_count, operation.amount_usd_sum AS amount_usd_sum, coalesce(operation.token_standard, \"mixed\") AS token_standard, operation.last_seen_timestamp AS last_seen_timestamp ORDER BY operation.tx_count DESC LIMIT 10"
```

Notes:

- Use `USE topology`. `OPERATED_BY` is not available on `USE facts`.
- Zero rows is a healthy result — the address simply has no mediated
  transfers.
- Whole-graph high-fan-in sweeps (every operator grouped by distinct owner)
  are valid but heavy; at millions of edges they exceed the hosted 10-second
  per-query budget. See `docs/graph-query-compatibility.md` for the
  time-bounded sweep shape.
- Confirm any lead with `FLOWS_TO` money-flow context and address labels
  before drawing conclusions.

## Address Risk

`aml_address_risk` screens one address for AML risk, behavior patterns,
neighborhood context, and exchange exposure. Use it as the first tool for a
single-address investigation.

AML tools accept full blockchain addresses directly and return blockchain
addresses as the public result surface — the graph is address-grain, so there
is no identity-resolution step.

Required input:

- `network`
- `address`

Optional input:

- `compare_address`
- `version` — omit it to use the latest contract, or set it to `v1` to pin the
  current AML contract.

CLI output is human-readable by default. Add `--json` to print indented JSON:

```bash
cia workflow aml-address-risk --json \
  --address 0xYourAddressHere --network robinhood
cia mcp call --json graph_query network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 10"
```

## Manual Fund-Flow Traversal

Fund-flow investigation now runs through `graph_query` / `graph_query_batch`
with `USE topology` (read-only). Exchange hot wallets are terminal endpoints
only: manual traversal must not expand from, through, or classify exchange
nodes as deposit, suspect, or intermediate candidates; every non-terminal
traversal node must be non-exchange.

Liquidity pools are the other trace boundary. At a `:Pool`, manual traversal
follows the
[pool trace rule](../skills/chain-insights-schema-evm/SKILL.md#pool-trace-rule),
so a trace does not fan out to every trader who used the pool. The start and
every address in the middle of a manual `FLOWS_TO` walk must satisfy
`NOT src:Pool` and `NOT mid:Pool`, and the walk follows `SWAPPED` beside
`FLOWS_TO` to cross a swap.

These two rules are the only trace norms; role labels such as victim,
suspect, or deposit are hypotheses for review, not automatic writes.

## Runtime Schema Capture

Before the first graph query against a network, inspect the live graph schema and
use the observed labels, relationship types, and property names in subsequent
queries. The current public Chain Insights Graph network is
the single robinhood network; the network argument selects the graph, and
the address-space split lives on the `:Address.network` node property. Do not
infer support for unadvertised networks from internal database names or
historical examples.

Useful schema probes:

```bash
cia mcp call graph_query_batch \
  network=robinhood \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"address_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level, a.is_exchange AS is_exchange LIMIT 10"},{"id":"flow_sample","query":"USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"operated_by_sample","query":"USE topology MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: \"0x...\"}) RETURN owner.address AS owner_address, operation.tx_count AS tx_count, operation.amount_usd_sum AS amount_usd_sum LIMIT 10"},{"id":"node_metric_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Use endpoint-safe property projections like `a.address` and `flow.tx_count`
in probes. Metadata
functions such as `keys()`, `labels()`, and `type()` are not portable across
every Chain Insights Graph layer.
