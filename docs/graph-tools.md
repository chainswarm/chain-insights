# Chain Insights Graph Tools

This document covers the graph-facing tools and the result contracts that
agents should rely on during investigations.

The first release exposes graph analysis through the hosted MCP endpoint and
the `cia mcp` commands. Results are returned as text and structured facts.

## Chain Insights Graph Surface

The Chain Insights Graph surface is intentionally small:

| Tool                   | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `network_capabilities` | Return supported networks and graph layers when the backend exposes capability metadata |
| `graph_query`          | Run one read-only GQL/Cypher query through the universal graph endpoint                 |
| `graph_query_batch`    | Run related read-only graph-language queries as one MCP call                            |

`aml_address_risk` is hidden until its verdict is fixed. The MCP proxy does
not list it and refuses a call to it as an unknown tool.

`cia mcp tools` lists the remote GraphRAG surface only. Use `cia networks` for
the short network overview, `cia network <name>` for one network's details and
remote tools, and `cia mcp networks` for the full network capability matrix.
Use `cia mcp call` for low-level GraphRAG calls and custom read-only queries.

The Chain Insights MCP proxy adds product-facing local metadata tools such as
`meta_network_capabilities`, `meta_schema`, `meta_usage_status`, and `meta_help`. On hosted
backends, `meta_usage_status` can reflect remote quota telemetry. On
backends without a quota tool, Chain Insights returns a local unmetered
primitive-backend status instead.

## Pick the layer first

A graph query goes to one of three layers. Name the layer at the start of the
query: `USE topology`, `USE facts` or `USE chain`.

Route by what the question names: an address, a pair with a day, a transaction or a block. Topology searches outward from an address, while facts and chain look up one known thing.

1. I know an address and want its links, senders, receivers, hops or a route: `USE topology`, anchored on that address.
2. I know both addresses of a pair and one day, and want the rows of that day: `USE facts`.
3. I want the chain's own record of a transaction by its `tx_id`, a block by its `block_height` or `block_hash`, an address at one block (`Address`), or the head: `USE chain`.

`USE chain` with `Address` reads the balance, the nonce or the kind of one address, now or at a past block with `at_block`. A past block must be at least `chain_admission.at_block_min_depth` blocks below the tip. To find the counterparties of an address, search `USE topology`, then read the pair and one day on `USE facts`.

A transaction is a chain question: read it on `USE chain` by its `tx_id`. Chain gives its `block_date`; the transfers between a pair on that day are a `USE facts` read.

The layers hand each other keys, and each key keeps its name. Topology gives the pair and the first and last seen time. Facts gives the `tx_id` and the `block_height`. Chain takes an `address`, a `tx_id`, a `block_height` or a `block_hash`, and gives the `block_date` of a transaction or a block.

A question about the whole chain (recent activity, the biggest senders, a top list) is a `USE topology` search: bound it by time with `f.last_seen_timestamp >= <epoch ms>` on the `FLOWS_TO` link, then sort and `LIMIT`. A search has 10 s. If the server refuses it with `anchor_missing`, it does not serve searches yet: say so in one line and ask for an address.

| The question                                               | Layer      | First query                                                                 |
| ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| Recent activity or newest links of one address?            | `topology` | `FLOWS_TO` out of the address, `ORDER BY last_seen_timestamp`.              |
| Who sent money to an address? Who received from it?        | `topology` | `FLOWS_TO` into or out of the address, with a `LIMIT`.                      |
| Where did the money go, or come from, in N hops?           | `topology` | A guarded quantified walk, at most 4 hops, with a `LIMIT`.                  |
| Is there a route between A and B?                          | `topology` | `SHORTEST 1` with both addresses.                                           |
| How many, how much, first or last active, for one address? | `topology` | The address node: `degree_in`, `tx_total_count`, `last_activity_timestamp`. |
| What moved between A and B on one day?                     | `facts`    | `TRANSFER` with both addresses and `block_date`.                            |
| Which days did A and B trade?                              | `topology` | The link's `first_seen_timestamp` and `last_seen_timestamp`.                |
| Did transaction `0x…` succeed? Which block, which day?     | `chain`    | `Transaction {tx_id}`.                                                      |
| Which day is block N?                                      | `chain`    | `Block {block_height}`, and return `block_date`.                            |
| Does this address hold a balance? Is it a contract?        | `chain`    | `Address {address}`, with `at_block` for a past block.                      |
| How far behind are the graph and the warehouse?            | `chain`    | `Head`.                                                                     |
| Recent addresses, biggest senders, a top list of the chain | topology   | A search bounded by `f.last_seen_timestamp`, then sort and LIMIT.           |

The server publishes the limits of a layer in `meta_network_capabilities`
(`cia network robinhood --json` prints the same reply): the `chain_admission`
block today, and `topology_admission` and `facts_admission` when the server
sends them. Read a limit there. Do not write one down.

## One name on every layer

A thing has one name on topology, facts and chain. Copy a value from one layer
into the next as it is. The layers differ by properties only.

| Thing      | `USE topology`                                | `USE facts`                   | `USE chain`                                         |
| ---------- | --------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| An address | `:Address {address}`, and a kind label        | `:Address {address}`, no kind | `Address {address}`, optional `at_block`            |
| A kind     | `:Account` or `:Contract`, `is_contract` kept | none: refused with a hint     | `is_contract`, `nonce` and `delegated_to`, no label |
| A tx       | `tx_id` on `DEPLOYED_CONTRACT` only           | `tx_id` on every row          | `Transaction {tx_id}`                               |
| A block    | `block_height` on `DEPLOYED_CONTRACT` only    | `block_height` on every row   | `Block {block_height}` or `Block {block_hash}`      |
| Time       | epoch milliseconds                            | epoch milliseconds            | epoch milliseconds                                  |
| `network`  | the query's `network`                         | the query's `network`         | the query's `network`                               |

`network` is a property of every node and every relationship, and its value is
the query's `network`. It is never stored, except on a `:Chain` node, where it
names the remote chain. A filter on another value gives no rows. A kind is a
second label that topology takes from chain facts: `:Account` for a key holder,
`:Contract` for a contract. An address that only received has none. Facts
serves no kind.

## When a query is refused

A refusal is an answer, not an outage: the endpoint is up.

A refused, killed, busy or failed query comes back with `error_detail`: `code`, `rule`, `class`, `fix` and `example`. The `class` decides your next move.

- Class `refused`: read `fix`, rewrite the query from `example`, and send it once.
- Class `killed`: narrow the query (fewer properties, rows or hops) and send it once.
- Class `capacity`: wait at least 5 seconds, then send the same query once.
- Class `failed`: tell the user what is down. Do not retry.

A `fix` that names another layer means move to that layer.

One rewrite or one retry for each query. When it is refused or busy again, stop and tell the user. Quote the `fix` text and send nothing more for that question.

Never send the same text again after `refused` or `killed`.

In a batch, send again only the members that came back `capacity`.

`cia mcp call` prints the server's own text for a refusal, then one line:
`code <code> · class <class> · <fix>`. It exits with a non-zero status. It never
reports a refusal as an unreachable endpoint: only a dropped connection reads
"Could not reach the Chain Insights Graph endpoint". The
[`chain-insights-cypher` skill](../skills/chain-insights-cypher/SKILL.md#when-a-query-is-refused)
lists every code with its layer, its class and the next move.

## Chain lookups

`USE chain` asks the chain node for one known thing by its key. It serves the
lookups that `chain_admission.lookups` lists: `Transaction` by `tx_id`, `Block`
by `block_height` or `block_hash` (exactly one), `Address` by `address` (with an
optional `at_block`), and `Head`, which takes no key. A lookup is one node with
literal keys in braces and a `RETURN` of `var.property` items. It takes no
`WHERE`, no relationship and no range. The names `hash` and `height` are no key
and no property of any label: they are refused like any name a label lacks. The
properties of each lookup are named in the refusal of an unknown property, and
`meta_schema` lists the lookups the network serves.

A transaction, with its result and the day it was mined:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE chain MATCH (t:Transaction {tx_id: "0x..."}) RETURN t.status, t.block_height, t.block_date'
```

An address at the newest block, and at a past block:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE chain MATCH (a:Address {address: "0x..."}) RETURN a.balance, a.nonce, a.is_contract'
cia mcp call graph_query \
  network=robinhood \
  'query=USE chain MATCH (a:Address {address: "0x...", at_block: 79000000}) RETURN a.balance, a.nonce, a.is_contract'
```

The head of the chain, and how far the graph and the warehouse are behind it:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE chain MATCH (h:Head) RETURN h.block_height, h.age_seconds, h.warehouse_blocks_behind, h.graph_blocks_behind'
```

`block_timestamp` is an integer number of epoch milliseconds on every layer,
chain included. `network` is served on every label, from the query's `network`.
An `Address` lookup reads the kind from `is_contract`, `nonce` and
`delegated_to`, and a past block must be at least
`chain_admission.at_block_min_depth` blocks below the tip. A chain lookup that
comes back `chain_unavailable` means the chain layer is off or behind: read
`chain_admission.status`. Topology and facts still work.

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
  is a swap, the pool's code is not proven).
- Today no route is `swap`. The swap reader reads transaction receipts only,
  with no execution trace, and the proof needs the trace. Every served route
  is `swap_like`, with `reason` `unknown_pool_code` and `families` `unknown`.
  A Uniswap V2 or V3 swap reads this way. `unknown` does not mean the
  protocol is unsupported. A filter on `strength = 'swap'` or on a known
  family matches nothing.
- A route that could not be paired (`swap_unsplit`) is never served. It has
  no payer, recipient or pool. It makes no `SWAPPED` edge and no `SWAP` row,
  and it exists in the warehouse only. Every Uniswap v4 swap reads this way
  today, by design, so v4 swaps are hidden. The share of `swap_unsplit` rises
  with v4 use.
- `REMOVED_LIQUIDITY` carries `receiver_added_usd` and `receiver_provided`.
  A receiver's profit from a pool is `usd` minus `receiver_added_usd`.
- `SWAP`, `LIQUIDITY_*` and `BRIDGE_CROSSING` rows follow the rule of
  `TRANSFER` rows: a facts read names an address pair with one day, or one
  `tx_id`.
- A `USE facts` `SWAP` row carries no route: it has no `pools` and no
  `families` column. A read that names one of them, to return it, to filter on
  it or to order by it, is refused. The route of a swap stays a topology
  question.
  - For the pools of the swaps of an address, read `SWAPPED.pools` and
    `SWAPPED.families` on `USE topology`, anchored on the payer or the
    recipient. `SWAPPED` has one link per payer, recipient, sold asset and
    bought asset, so its `pools` cover every route on the link, not one route.
  - Read `SWAP` rows by `tx_id`, or by the payer, the recipient and one day.
    `route_id` stays on the row. It ties every leg of one route together and
    names no pool.
- `block_timestamp` on `SWAP` and `LIQUIDITY_*` rows is epoch milliseconds,
  in filters and in results, as on `TRANSFER`.
- On a facts row, USD comes from the daily price services, never from a swap.
  With no price, USD is empty and the matching `…price_missing` property is
  true.
- `SWAPPED` sums its routes, and a route side with no price adds 0 to
  `sold_usd` or `bought_usd`. So 0 can mean no price. Do not read 0 as worth
  nothing. The facts `SWAP` row says which side had no price:
  `sold_price_missing` and `bought_price_missing`.
- Swap attribution is read from `SWAPPED`, the aggregate (`strength`, pools,
  families), or from the facts `SWAP` row, one route. `FLOWS_TO` carries value
  only.
- A missing `SWAPPED` edge or `SWAP` row is not proof that no swap happened.

`FLOWS_TO` into and out of pools stays as it is. A trace that reaches a
`:Pool` follows the pool trace rule:

- The rule is stated once, in the
  [`chain-insights-cypher` skill](../skills/chain-insights-cypher/SKILL.md#pool-trace-rule).
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
pools. `ANY SHORTEST` takes the same pattern in place of `SHORTEST 1`. Ask for
one path only:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE topology MATCH p = SHORTEST 1 (a:Address {address: "0x..."} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x..."}) RETURN [n IN nodes(p) | n.address] AS route LIMIT 5'
```

The `chain-insights-cypher` skill shows how to read the properties of a link
from a sample.

Rug-pull check from a victim, under the rule:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE topology MATCH (victim:Address {address: "0x..."})-[paid:FLOWS_TO]->(pool:Pool)-[removal:REMOVED_LIQUIDITY]->(receiver:Address) WHERE NOT victim:Pool AND receiver.address <> victim.address RETURN pool.address AS pool_address, receiver.address AS receiver_address, paid.amount_usd_sum AS paid_in_usd, removal.usd AS removed_usd, removal.receiver_added_usd AS receiver_added_usd, removal.usd - removal.receiver_added_usd AS receiver_profit_usd, removal.receiver_provided AS receiver_provided ORDER BY removed_usd DESC LIMIT 25'
```

One transaction's swap routes, with their strength and the two sides:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (payer:Address)-[s:SWAP]->(recipient:Address) WHERE s.tx_id = "0x..." RETURN payer.address AS payer, recipient.address AS recipient, s.strength AS strength, s.reason AS reason, s.route_id AS route_id, s.sold_asset_symbol AS sold, s.sold_usd AS sold_usd, s.bought_asset_symbol AS bought, s.bought_usd AS bought_usd LIMIT 10'
```

The pools of the swaps from one payer, from `USE topology`. `SWAPPED` carries
the route, so this is the read for pools:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE topology MATCH (payer:Address {address: "0x..."})-[s:SWAPPED]->(recipient:Address) RETURN recipient.address AS recipient, s.sold_asset AS sold_asset, s.bought_asset AS bought_asset, s.pools AS pools, s.swap_count AS swap_count LIMIT 25'
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
- The `chain-insights-cypher` skill shows how to read every property from a
  sample.

## Query Rules

- `network` is required. Do not guess it in agent workflows.
- GQL/Cypher must be read-only.
- Use `USE topology` for topology (the address / FLOWS_TO / OPERATED_BY / LINKED graph,
  covering unified recent and full historical activity in one graph, plus the
  the `SWAPPED`,
  `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` and `BRIDGED` totals, and the
  `:Pool` label).
- Use `USE facts` for bounded individual `TRANSFER` rows and their amount,
  `amount_usd`, asset, transaction, and block facts, and for single `SWAP`,
  `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows. Address
  labels, risk, lifetime metrics, and `FLOWS_TO`/`LINKED` relationships
  belong to `USE topology`.
- Use `USE chain` for the chain node's own record of one known transaction,
  block, address or the head. It looks up one key and never searches.
- A facts read names an address pair with one day. A transaction is read on
  `USE chain` by its `tx_id`, not on facts. The pair is both endpoint addresses, from
  then to, and the day is a `block_date` equality. `block_timestamp` bounds in
  epoch milliseconds may narrow the day to a time window. One address, a day
  alone, a window of days, a block range and a bare `LIMIT` are not enough. A
  reply holds at most 200 rows. A facts read has one relationship and no hop,
  and takes no `ORDER BY`: sort the page yourself.
- A link covers all time and a facts read covers one day: read the transfers
  of a pair one day at a time.
- Every `TRANSFER` row has a `kind`: `token`, `native` or `internal`. An
  `internal` row is ETH a contract sends while it runs a call, such as the ETH
  leg of a wrap. `FLOWS_TO` `tx_count` counts all three, so the rows of a pair
  are the transfers its link counts, up to the height the link was built to.
  `kind` is a column and a filter. Add `t.kind = "internal"` to the pair and the
  day to read only the internal rows.
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
- `per_query_timeout_seconds` is optional and capped at `60` by default (`30` for
  `USE facts`). It can lower a limit. It cannot raise one.
- Returned rows live in `structuredContent.facts`.

Agent installers ship one skill:

- `chain-insights-cypher`: ISO GQL dialect, layer routing, one query for each
  kind of graph search (routes, walks, shared counterparties, ownership
  clusters, operators, swaps, pools and bridges), how to find the fields of
  the graph, and the move for every refusal, for `graph_query` and
  `graph_query_batch`.

Check public-free usage:

```bash
cia mcp call meta_usage_status
```

Example single query:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels LIMIT 10"
```

Example facts queries, one transaction and one time window of a pair:

```bash
cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (from:Address)-[t:TRANSFER]->(to:Address) WHERE t.tx_id = "0x350065e1a55d7272de562706fdea5f48ae83cf10e468e56b2209f8cfbaaf1901" RETURN from.address AS from_address, to.address AS to_address, t.amount AS amount, t.asset_symbol AS asset_symbol LIMIT 10'

cia mcp call graph_query \
  network=robinhood \
  'query=USE facts MATCH (from:Address {address: "0x..."})-[t:TRANSFER]->(to:Address {address: "0x..."}) WHERE t.block_date = "2026-07-11" AND t.block_timestamp >= 1783738500000 AND t.block_timestamp < 1783738560000 RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, from.address AS from_address, to.address AS to_address, t.amount AS amount LIMIT 10'
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
    "live_tier_timeout_seconds": 60,
    "starrocks_tier_timeout_seconds": 30,
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
  (60 seconds by default, or your lower `per_query_timeout_seconds`).
- **Concurrency:** topology queries share the slots of the hosted endpoint, so
  a query waits for a free slot inside its own time budget, and a busy endpoint
  answers `topology_busy`. The number of slots is the server's to publish, not
  this guide's: read `topology_admission` in `meta_network_capabilities`
  (`cia network robinhood --json` prints the same reply), and when the server
  sends no `topology_admission` block, the `fix` of the refusal names the
  limit.
- **Memory:** a query that grows past the per-query memory limit is stopped.
- **Batch:** the queries of one batch run one after another and share a
  100-second budget. A query that would start with less than 1 second left
  does not run. A topology query then fails with `query_timeout`. The results
  of earlier queries still come back. `USE facts` queries stop at 30 seconds.
  A client that sets its own request timeout needs at least 100 seconds for a
  batch and 65 seconds for one query. `cia` waits 5 minutes.

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

A topology read that filters on a link property needs an address anchor. With
no address in its pattern, the read starts from every link of the type it
names. Do not count on the filter to narrow that. `WHERE x.strength = 'swap'`
on `SWAPPED` checks every `SWAPPED` link. `LIMIT` stops the read only after it
has found enough rows, so a filter that matches few or none can run to the
60-second limit and fail with `query_timeout`. A discovery probe with no
filter, such as
`MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.tx_count LIMIT 20`, finds
its rows at once and stays valid.

Put an address in the pattern, and pick one with few links. Read `degree_out`
and `degree_in` on the node first. They are a rough guide, not a guarantee:
they count neighbours, not links, and one pair of addresses can hold many
`SWAPPED` links. An address with hundreds of thousands of neighbours can fail
the same way. The queries of one batch share a 100-second budget.

Anchored on one address:

```cypher
USE topology
MATCH (a:Address {address: "0x…"})-[x:SWAPPED]->(b:Address)
WHERE x.swap_count >= 2
RETURN b.address AS recipient, x.swap_count AS swap_count
ORDER BY x.swap_count DESC
LIMIT 25
```

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
  are valid but heavy; at millions of edges they can exceed the 60-second
  per-query limit. See `docs/graph-query-compatibility.md` for the
  time-bounded sweep shape.
- Confirm any lead with `FLOWS_TO` money-flow context and address labels
  before drawing conclusions.

## Full addresses and units

Write every address in full, 42 characters with the `0x` prefix, in every
query and every answer. Never shorten one with dots or an ellipsis: a shortened
address is not an address, and no read can use it. The graph is address-grain,
so there is no identity-resolution step.

Timestamps are integer milliseconds since the Unix epoch, UTC. `block_date` is
the string `"YYYY-MM-DD"`. Compare a timestamp with a number, never with an ISO
string.

CLI output is human-readable by default. Add `--json` to print indented JSON:

```bash
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
[pool trace rule](../skills/chain-insights-cypher/SKILL.md#pool-trace-rule),
so a trace does not fan out to every trader who used the pool. The start and
every address in the middle of a manual `FLOWS_TO` walk must satisfy
`NOT src:Pool` and `NOT mid:Pool`, and the walk follows `SWAPPED` beside
`FLOWS_TO` to cross a swap.

These two rules are the only trace norms; role labels such as victim,
suspect, or deposit are hypotheses for review, not automatic writes.

## Runtime Schema Capture

Before the first graph query against a network, read the live graph schema and
use the observed labels, relationship types, and property names in subsequent
queries. The `meta_schema` tool does it in one call, and
`cia network robinhood --schema` prints the same schema. It reads the catalog
statements of the graph (`CALL db.labels()`, `CALL db.relationshipTypes()`,
`CALL db.propertyKeys()` and `SHOW INDEXES`) and a sample of an address and of
each main link, through one session, and keeps the answer for 24 hours. Fields
come from a sample, so a rare field may be missing. The probes below are the
fallback. The current public Chain Insights Graph network is
the single robinhood network; the network argument selects the graph.
`network` is the query's network on every node and relationship, never stored,
except on `:Chain`. Do not infer support for unadvertised networks from
internal database names or historical examples.

Useful schema probes:

```bash
cia mcp call graph_query_batch \
  network=robinhood \
  per_query_timeout_seconds=5 \
  'queries=[{"id":"address_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels, a.is_exchange AS is_exchange LIMIT 10"},{"id":"flow_sample","query":"USE topology MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN src.address AS from_address, dst.address AS to_address, flow.amount_usd_sum AS amount_usd_sum, flow.tx_count AS tx_count LIMIT 10"},{"id":"linked_sample","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, b.network AS linked_network, l.basis AS basis, l.confidence AS confidence LIMIT 10"},{"id":"operated_by_sample","query":"USE topology MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: \"0x...\"}) RETURN owner.address AS owner_address, operation.tx_count AS tx_count, operation.amount_usd_sum AS amount_usd_sum LIMIT 10"},{"id":"node_metric_sample","query":"USE topology MATCH (a:Address) RETURN a.address AS address, a.tx_out_count AS tx_out_count LIMIT 10"}]'
```

Use endpoint-safe property projections like `a.address` and `flow.tx_count`
in probes. Metadata
functions such as `keys()`, `labels()`, and `type()` are not portable across
every Chain Insights Graph layer.
