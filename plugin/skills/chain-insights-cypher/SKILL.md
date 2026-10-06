---
name: chain-insights-cypher
description: Use when answering any question about addresses, money flows, transfers, transactions or blocks with Chain Insights, when tracing where money went or came from, when writing or reviewing graph_query or graph_query_batch ISO GQL, when choosing between USE topology, USE facts and USE chain, or when a graph query is refused. Address, unit, layer, graph search and refusal rules, with one query for each kind of search.
---

# Chain Insights Cypher

Standard ISO GQL for `graph_query` and `graph_query_batch`. Read-only. No
`CALL`, no procedures, no vendor syntax.

Run a query with `cia mcp call graph_query network=robinhood "query=<query>"`.
Send related reads in one call with `cia mcp call graph_query_batch network=robinhood 'queries=[{"id":"a","query":"<query>"}]'`.
Always pass `network` and your own `LIMIT`. These two commands, and
`cia network robinhood --schema` for field names, are all you need. Do not run
`cia --help` to look for others.

## Rules that stop most failures

1. Write every address in full, in lowercase: `0x` plus 40 hex characters, 42
   in all. Never shorten one with `...` or `…`, in a query or in an answer.
   Copy addresses from results exactly.
2. Timestamps on topology and facts are integer milliseconds since the epoch,
   UTC. Compute them from the current date: a day is 86,400,000 ms. Never
   compare one with an ISO string. `block_date` is the string `"YYYY-MM-DD"`.
   `USE chain` returns `block_timestamp` as an ISO string: read it, never
   filter on it. Every `*_usd` field is US dollars. `*_raw` is the token's
   smallest unit, not dollars.
3. A shortened address, a mixed-case address, or an ISO string against a
   millisecond column gives zero rows with no error. Check these first. Zero
   rows is not proof of safety.
4. Do not run a risk screen or read risk fields unless the user asks about
   risk. The graph serves no risk verdict today.
5. Never write files, reports or notes unless the user asks. Answer in the chat.
6. After a refusal, fix the query once from `fix` and `example`. A second
   refusal ends it: tell the user plainly what cannot be asked and what can.
   Never send variations in a loop.

## Pick the layer first

Route by what you know: topology searches, while facts and chain look up one known thing.

1. I do not know the thing yet: `USE topology`.
2. I know the pair and the day, or the transaction hash, and want the indexed rows: `USE facts`.
3. I want the chain's own record of a transaction by its hash, a block by its number or hash, or the head: `USE chain`.

`USE chain` has no address lookup. Find the address on `USE topology`, then read the pair and one day on `USE facts`.
When two fit, as with a hash: ask `USE chain` first for the record and the result, then `USE facts` for the transfers it caused.
The layers hand each other keys. Topology gives the pair and the first and last seen time. Chain gives the `block_date` of a hash or a height. Facts gives the `tx_id`.
A list, a range or a whole-chain question is served on no layer. Say so, and go back to an anchored `USE topology` search.

A top list, a count, a scan of a label or the recent active addresses of the
whole chain are such questions. Do not search for a workaround. Say: "The graph
cannot list those. Name an address, a pair with a day, or a transaction hash."

## Topology

`USE topology` is the address graph: `FLOWS_TO` money flow, swaps, liquidity,
bridges and the `LINKED` overlay. The server checks these before it runs:

- Anchor every pattern on a full address: `{address: "<address>"}` in the node, or `WHERE a.address = "<address>"`. A list of at most 25 addresses is an anchor. An address in `RETURN`, in an `OR` or in a `$parameter` is no anchor.
- The one read with no anchor is a probe: one node or one hop, no `WHERE`, no `ORDER BY`, no aggregate, and a small `LIMIT`. Its rows are arbitrary.
- A sort, an aggregate, `DISTINCT`, `collect()` or a filter on a link property needs an anchor on every pattern.
- End every read with a literal `LIMIT`: at most 5,000 rows, 100 for a probe. A path has at most 5 hops and a query at most 8. The live numbers are in `topology_admission` (`cia network robinhood --json`).
- Paths use bounded quantifiers such as `-[:FLOWS_TO]-{1,5}`. A `*` range, the legacy path functions, `PROFILE`, writes and `CALL` are refused.
- Role flags `is_exchange`, `is_scam`, `is_victim` and `is_sanctioned` are absent unless true: use `IS NULL` or `IS NOT NULL`, never `= false`.

## Graph searches

Each query below is admitted by the live server. Change only the addresses and the `RETURN`. Keep the guards inside the pattern: they apply the [pool trace rule](#pool-trace-rule), and a `WHERE` after a `SHORTEST` pattern runs too late. A walk follows links, not coins: confirm a hop with a pair and a day on `USE facts`.

Route between two addresses, one path. Only `MATCH SHORTEST 1` and `MATCH ANY SHORTEST` are served: a count above 1 is `route_search_refused`.

```cypher
USE topology
MATCH p = SHORTEST 1 (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN [n IN nodes(p) | n.address] AS route
LIMIT 5
```

Several routes, up to 3 hops, in no set order. Add no `ORDER BY`: it can end in `query_timeout`.

```cypher
USE topology
MATCH p = (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,2} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN [n IN nodes(p) | n.address] AS route, length(p) AS hops LIMIT 5
```

Where the money went, up to 3 hops out:

```cypher
USE topology
MATCH p = (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]->(via:Address) WHERE NOT via:Pool){0,2} ()-[:FLOWS_TO|SWAPPED]->(b:Address)
RETURN b.address AS to_address, length(p) AS hops LIMIT 25
```

Where the money came from, up to 3 hops in:

```cypher
USE topology
MATCH p = (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"} WHERE NOT a:Pool) (()<-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,2} ()<-[:FLOWS_TO|SWAPPED]-(b:Address)
RETURN b.address AS from_address, length(p) AS hops LIMIT 25
```

Counterparties that two addresses share:

```cypher
USE topology
MATCH (a:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})-[:FLOWS_TO|SWAPPED]-(c:Address)-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"}) WHERE NOT a:Pool AND NOT c:Pool
RETURN DISTINCT c.address AS shared_address LIMIT 25
```

Ownership cluster: `LINKED` says one actor stands behind both addresses. It is undirected. One hop, `-[l:LINKED]-`, gives `l.basis` and `l.confidence`.

```cypher
USE topology
MATCH p = (a:Address {address: "0x9740a8e0197689d144b19da4bdc9ef65fef11cda"})-[:LINKED]-{1,2}(b:Address)
RETURN b.address AS linked_address, length(p) AS hops LIMIT 25
```

Operator view: the owners whose tokens an operator moved. A fact, not proof of malicious intent: relayers and sweepers look alike. A transfer with no USD value counts 0, so `amount_usd_sum` is a floor.

```cypher
USE topology
MATCH (owner:Address)-[o:OPERATED_BY]->(operator:Address {address: "0xdd509c9f91f66a18802ef5b3d54c73b62ea1ca08"})
RETURN owner.address AS owner_address, o.tx_count AS tx_count, o.amount_usd_sum AS amount_usd_sum ORDER BY o.tx_count DESC LIMIT 10
```

Swaps an address paid for. A facts `SWAP` row has no route: the pools are `SWAPPED.pools`. A side with no price adds 0 to `sold_usd` and `bought_usd`: 0 can mean no price.

```cypher
USE topology
MATCH (a:Address {address: "0x0168d9f5cac7d63eb75095cef316d68b0dc42bc6"})-[s:SWAPPED]->(b:Address)
RETURN b.address AS recipient, s.sold_usd AS sold_usd, s.bought_usd AS bought_usd, s.pools AS pools ORDER BY s.swap_count DESC LIMIT 25
```

Pool trace: who took liquidity out of the pools an address paid into.

```cypher
USE topology
MATCH (a:Address {address: "0x7a31dd32a880827477ab2bbeff47db188c896815"})-[:FLOWS_TO]->(p:Pool)-[r:REMOVED_LIQUIDITY]->(b:Address) WHERE NOT a:Pool AND b.address <> a.address
RETURN p.address AS pool, b.address AS receiver, r.usd AS removed_usd, r.receiver_provided AS receiver_provided LIMIT 25
```

Bridges: the remote chains an address used. A `:Chain` is no `Address`: two users of one bridge are not connected through it.

```cypher
USE topology
MATCH (a:Address {address: "0x9a8f92a830a5cb89a3816e3d267cb7791c16b04d"})-[x:BRIDGED]->(c:Chain)
RETURN c.network AS remote_network, c.address AS endpoint, x.events AS events LIMIT 25
```

## Pool trace rule

`:Pool` is a second label on an `Address`: the pool of a swap route or a
liquidity event. A trace that walks out of a pool on `FLOWS_TO` lands on every
trader who used it. Every trace follows this rule:

1. Enter a `:Pool` on any edge.
2. Leave a `:Pool` only on `REMOVED_LIQUIDITY`, to the address the liquidity
   was paid to.
3. Never leave a `:Pool` on `FLOWS_TO`.
4. Across a swap, follow `SWAPPED` from payer to recipient, between two
   different addresses. Do not walk through the pool.

So a walk never starts at a pool and never passes through one. It may end at one. Guard the start with `WHERE NOT a:Pool` and each address in the middle with `WHERE NOT via:Pool`, and follow `FLOWS_TO|SWAPPED`, as above. Exchange hot wallets end a trace: pass through an address only when `is_exchange IS NULL`.

## Find the fields

Call `meta_schema {network}` first when you need field names; it is cached for 24 hours. From a shell, run `cia network robinhood --schema`. It adds `--json` for the structured form and `--refresh` to rebuild. It lists the labels, the link types, the fields of an address and of each main link, the indexes, the `TRANSFER` columns and the `USE chain` lookups, read from the live graph. Fields come from a sample, so a rare field may be missing.

The graph holds more fields than this skill names. When `meta_schema` is not available, or the field you need is not in it, read the keys of a sample. A contract carries more keys than a plain address. Read `degree_in` and `degree_out` of an address before you walk from it: a hub ends in `query_timeout`.

```cypher
USE topology
MATCH (a:Address) RETURN keys(a) AS keys LIMIT 20
```

```cypher
USE topology
MATCH ()-[r:FLOWS_TO]->() RETURN keys(r) AS keys LIMIT 5
```

Name another link type to read its keys: `SWAPPED`, `LINKED`, `OPERATED_BY`, `BRIDGED`, `ADDED_LIQUIDITY` or `REMOVED_LIQUIDITY`. `synced_through_height` and `pair_key` are bookkeeping: never filter or sort on them.

The server serves five read-only catalog calls: `CALL db.labels()`, `CALL db.relationshipTypes()`, `CALL db.propertyKeys()`, `CALL db.schema.visualization()` and `SHOW INDEXES`. `meta_schema` sends four of them for you through one session and keeps the answer, so do not send them yourself.

## Facts: an address pair with one day

`USE facts` looks up rows you already know. A facts read names an address pair with one day, or one `tx_id`. A pair is both addresses, from then to, each as `{address: "<address>"}`, and the day is `t.block_date = "YYYY-MM-DD"`. One address, a day alone, a window of days, a block range and a bare `LIMIT` are not enough. It serves `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows.

- A reply holds at most 200 rows, whatever the `LIMIT`.
- A facts read has one relationship and no hop. For a walk, go to topology.
- A facts read takes no `ORDER BY`. Rows come in the server's own order. Sort the page yourself.
- A facts read covers one day. For more days, send one read for each day.
- Amounts and USD values come back as text, such as `"5.23661492"`. Convert them before you add them.
- `TRANSFER` columns: `tx_id`, `block_date`, `block_height`, `block_timestamp`, `event_index`, `edge_index`, `kind`, `asset_contract`, `asset_symbol`, `amount`, `amount_usd`, `price_usd`, `price_missing`, `token_id`, `token_standard`, `operator_address`, `raw_amount` and `decimals`. `kind` is `token`, `native` or `internal`: an `internal` row is ETH a contract sends while it runs a call.

```cypher
USE facts
MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"})-[t:TRANSFER]->(b:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"}) WHERE t.block_date = "2026-07-10"
RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.asset_symbol AS asset_symbol, t.amount AS amount, t.amount_usd AS amount_usd, t.kind AS kind LIMIT 50
```

One transaction hash needs no day. The server finds it:

```cypher
USE facts
MATCH (a:Address)-[t:TRANSFER]->(b:Address) WHERE t.tx_id = "0x044587122970de1e3c377a8ed7ab56a49c777a2b7441a2f5d9ca32dbab9fbe71"
RETURN a.address AS from_address, b.address AS to_address, t.amount AS amount, t.kind AS kind LIMIT 50
```

## Chain: one key, one node

`USE chain` asks the chain node for one known thing: `Transaction` by `hash`, `Block` by `height` or `hash`, or `Head`. One node, literal keys in braces, a `RETURN` of `var.property` items, no `WHERE`, no range. Read its limits in `chain_admission` (`cia network robinhood --json`).

```cypher
USE chain
MATCH (t:Transaction {hash: "0x044587122970de1e3c377a8ed7ab56a49c777a2b7441a2f5d9ca32dbab9fbe71"}) RETURN t.status, t.block_height, t.block_date
```

```cypher
USE chain
MATCH (b:Block {height: 79841521}) RETURN b.hash, b.block_date
```

```cypher
USE chain
MATCH (h:Head) RETURN h.height, h.age_seconds, h.warehouse_blocks_behind, h.graph_blocks_behind
```

## When a query is refused

A refusal is an answer, not an outage. Act on its class.

A refused, killed, busy or failed query comes back with `error_detail`: `code`, `rule`, `class`, `fix` and `example`. The `class` decides your next move.

- Class `refused`: read `fix`, rewrite the query from `example`, and send it once.
- Class `killed`: narrow the query (fewer properties, rows or hops) and send it once.
- Class `capacity`: wait at least 5 seconds, then send the same query once.
- Class `failed`: tell the user what is down. Do not retry.

A `fix` that names another layer means move to that layer.
One rewrite or one retry for each query. When it is refused or busy again, stop and tell the user. Quote the `fix` text and send nothing more for that question.
Never send the same text again after `refused` or `killed`.
In a batch, send again only the members that came back `capacity`.

## Name the columns for a picture

Claude Desktop draws a `graph_query` answer from its column names. Alias the
`RETURN` columns to choose the picture.

| Columns in every row                                        | Claude Desktop draws                      |
| ----------------------------------------------------------- | ----------------------------------------- |
| `from_address` and `to_address`                             | A graph of at most 60 addresses.          |
| A `day`, `date` or `*_timestamp` column, and number columns | A chart, one line for each number column. |
| Anything else                                               | A table.                                  |

A graph also reads these optional columns: `amount_usd_sum`, `tx_count`, `first_seen_timestamp`, `last_seen_timestamp`, `link_kind`, `from_labels` and `to_labels`. In `graph_query_batch`, each query draws its own tab. Claude Code draws nothing and shows the rows as text.

A graph, the newest receivers of one address. Flip the arrow for its senders:

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool
RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.last_seen_timestamp AS last_seen_timestamp ORDER BY f.last_seen_timestamp DESC LIMIT 25
```

A chart is the facts read of one pair over one day above, with `block_timestamp` and `amount_usd` in the `RETURN`.
