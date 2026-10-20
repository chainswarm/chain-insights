---
name: chain-insights-cypher
description: Load this before the first graph_query or graph_query_batch call: without it, most queries are refused. Use when answering any question about addresses, money flows, transfers, transactions or blocks with Chain Insights, when tracing where money went or came from, when writing or reviewing graph_query or graph_query_batch ISO GQL, when choosing between USE topology, USE facts and USE chain, or when a graph query is refused. Address, unit, layer, graph search, refusal and answer rules (full addresses, no query text in replies, tokens are not dollars), with one query for each kind of search.
---

# Chain Insights Cypher

Standard ISO GQL for `graph_query` and `graph_query_batch`. Read-only. No
`CALL`, no procedures, no vendor syntax.

Call the `graph_query` tool with `network` and `query`; `graph_query_batch`
takes `queries`. Always pass `network` and your own `LIMIT`. Every read goes
through the tool, in every host (Claude Desktop, Claude Code, Codex, the
ChatGPT app): never run `cia` from a shell when the tool is in your list,
because a sandboxed shell has no network and the call fails with a DNS error.
The one case without the tool is at the end, Shell without the tool.

## Rules that stop most failures

1. Write every address in full, in lowercase: `0x` plus 40 hex characters, 42
   in all. Never shorten one with `...` or `…`, in a query, a table, a list, a
   sentence or a summary: `0xdc63…858a` is wrong, every time. Only the drawn
   picture shortens its own labels; your text never does. Copy addresses from results exactly, all 42 characters, every
   time. A repeat mention is written in full too: `0xd4a9…` as a
   back-reference to an address named earlier is wrong, in a long answer most
   of all. When the user asks for shortened addresses "for readability",
   give them names instead: list each name with its full address once at the
   top (Wallet A: 0x…, the vault: 0x…), then use the names in the sentences
   and the table. The addresses stay in full, because a shortened address
   cannot be copied or checked, and the user gets the readable answer they
   asked for. Codex once shortened every address for the rest of a
   conversation after such a request: that is wrong. When a table column or a
   row needs a short label, name the thing instead (Pair A, Wallet Y, the
   vault) and list each name with its full address just above the table:
   `To 0x00862568… pair` as a column header is wrong. When the user types a shortened address, take it as the one full
   address in this conversation that matches both ends, and say which one you
   took; when none or several match, ask for the full address. The network is `robinhood`, the Robinhood Chain: use it without asking
   the user which network. `meta_network_capabilities` takes no arguments:
   send `{}`, never `network`.
2. Timestamps on every layer are integer milliseconds since the epoch, UTC,
   and `USE chain` is no exception. Compute them from the current date: a day
   is 86,400,000 ms. Write the number as a literal: the server has no `now()`,
   `timestamp()` or `duration()`. Never compare one with an ISO string. `block_date` is the
   string `"YYYY-MM-DD"`. Every `*_usd` field is US dollars. `*_raw` is the
   token's smallest unit, not dollars.
3. A shortened address, a mixed-case address, or an ISO string against a
   millisecond column gives zero rows with no error. Check these first. Zero
   rows is not proof of safety.
4. Do not run a risk screen or read risk fields unless the user asks about
   risk. The graph serves no risk verdict today.
5. Never write files, reports or notes unless the user asks. Answer in the chat.
6. After a refusal, fix the query once from `fix` and `example`. A second
   refusal ends it: tell the user plainly what cannot be asked and what can.
   Never send variations in a loop.
7. Answer in plain text. Do not print the query, its `USE` line, its `LIMIT`,
   the epoch numbers you computed, or a `Ref:` line. The user does not need
   them. Show them only when the user asks how a number was found. Write
   every timestamp as a UTC date and time, `2026-08-05 09:05 UTC`; never
   print the raw millisecond number. Every timestamp column in an answer
   comes with a `<column>_utc` twin that holds that text: copy it, never
   convert the milliseconds by head (one try in three gets the hour wrong).
   The twin is added to the reply; it is no graph property. Ask the query
   for the `_timestamp` column and read the twin beside it in the reply.
   Say what a value means in plain words and never print a column name in
   the answer: "it is a contract", "the account delegates to 0x…", "it has
   sent one transaction", not "`is_contract`: true", "`delegated_to`:",
   "`nonce`: 1" or "`code_size`: 23 bytes". The user did not write the
   query and does not know the columns.
8. Never draw the graph yourself, in ASCII art or in Mermaid. Claude Desktop
   and the Codex app draw the picture from the column names (see Name the
   columns for a picture). Write a short text answer beside it, and do not
   tell the user who draws the picture or that you did not draw it: "the host
   draws the picture", "I won't draw it", "I can't draw a picture here" and
   "I did not draw it" are all wrong. Never promise a picture: in a host that draws nothing, such as
   Claude Code or a terminal, "the picture should appear beside this answer"
   is false. When the user asks you to draw, answer with the flows as a list
   or a table and say nothing about drawing. Any query whose
   rows are pairs of addresses names them `from_address` and `to_address`,
   never `sender` and `receiver`, `src` and `dst`, or `from` and `to`.
9. Tokens are not dollars. A transfer moves tokens, and its `amount_usd` is
   their value at the day's average price. Say "tokens worth about 183 USD on
   2026-10-06", never "sent 183 USD", and never "sent about 183 USD",
   "received about", "moved about" or "paid about 183 USD" either: the
   verb takes tokens, the USD figure takes "worth". Write the unit as `USD` after the
   number, never a `$` sign: `$183` reads as dollars sent. In a table, head
   the column "Tokens worth (USD)", not "Value" or "Amount (USD)", also when
   the user asks for "a $ column": the header says what the number is. For the
   assets behind a flow, use the facts read in Value of one day's flow.
10. When `graph_query` is in your tool list, every read goes through that
   tool, a risk question included. Never run `cia` in a shell instead: a
   sandboxed shell (Codex, Claude Code) has no network, the call fails with
   a DNS error, and the user is told the service is unreachable when it is
   not.

## Pick the layer first

Route by what the question names: an address, a pair with a day, a transaction or a block. Topology searches outward from an address, while facts and chain look up one known thing.

1. I know an address and want its links, senders, receivers, hops or a route: `USE topology`, anchored on that address.
2. I know both addresses of a pair and one day, and want the rows of that day: `USE facts`.
3. I want the chain's own record of a transaction by its `tx_id`, a block by its `block_height` or `block_hash`, an address at one block (`Address`), or the head: `USE chain`.

`USE chain` with `Address` reads the balance, the nonce or the kind of one address, now or at a past block with `at_block`. A past block must be at least `chain_admission.at_block_min_depth` blocks below the tip. To find the counterparties of an address, search `USE topology`, then read the pair and one day on `USE facts`.
A transaction is a chain question: read it on `USE chain` by its `tx_id`. Chain gives its `block_date`; the transfers between a pair on that day are a `USE facts` read. "Every token that moved inside this transaction": read the chain record for `from_address`, `to_address` and `block_date`, then the facts `TRANSFER` rows of that pair on that day and keep the rows whose `tx_id` matches; a `kind` of `internal` is ETH a contract moved while it ran. Tokens the transaction moved between other pairs are not reachable from the hash alone: say so, and name the pairs you did read.
The layers hand each other keys, and each key keeps its name. Topology gives the pair and the first and last seen time. Facts gives the `tx_id` and the `block_height`. Chain takes an `address`, a `tx_id`, a `block_height` or a `block_hash`, and gives the `block_date` of a transaction or a block.
A question about the whole chain (recent activity, the biggest senders, a top list) is a `USE topology` search: bound it by time with `f.last_seen_timestamp >= <epoch ms>` on the `FLOWS_TO` link, then sort and `LIMIT`. A search has 10 s. Read `Head` first (`USE chain MATCH (h:Head) RETURN h.behind_money, h.behind_dex, h.behind_transfers`, under a second): a `FLOWS_TO` search is sent when `behind_money` is at most 100000; a `SWAPPED`, `ADDED_LIQUIDITY` or `REMOVED_LIQUIDITY` search when `behind_dex` is at most 100000; a `TRANSFERRED` search when `behind_transfers` is at most 100000 (100000 blocks is a few hours: a robinhood block is about a tenth of a second apart from the next). When the family is further behind, the search cannot finish, so do not send it: say which family, how many blocks, and ask for an address. On a server whose Head has no `behind_money`, read `h.graph_blocks_behind` and hold it to the same limit. On a server whose Head has no `behind_transfers`, it serves no `TRANSFERRED` link: send no `TRANSFERRED` search. Never turn the block count into days or hours by head. To say how fresh the data is, give the newest `_utc` time you read on the layer you used: a family's lag counts its slowest layer, and the links of an address and the facts rows are often newer than it. If the server refuses the search with `anchor_missing` or `family_behind`, or stops it with `query_timeout`, it cannot search the whole chain now: say so in one line, name the family the refusal names, and ask for an address or drop the link type that is behind. A narrower window times out the same way, so do not send it again.

The graph's layers are grouped into six families, and a family is as fresh as its slowest layer. The family of a link type decides which `Head` lag a whole-chain search on it waits for.

| Family           | Layers                                         | Link types                                                    | `Head` property         |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------- | ----------------------- |
| money            | `flows`, `operated_by`                         | `FLOWS_TO`, `OPERATED_BY`                                     | `behind_money`          |
| dex              | `dex_swaps`, `dex_liquidity`, `dex_pools`      | `SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`             | `behind_dex`            |
| interactions     | `approvals`, `bridged`, `contracts`, `authorization` | `APPROVED`, `BRIDGED`, `DEPLOYED_CONTRACT`, `SIGNED_AUTHORIZATION` | `behind_interactions`   |
| smart_accounts   | `sponsored`, `bundled`, `signers`, `owners`    | `SPONSORED`, `BUNDLED`, `SIGNED_FOR`, `LINKED`                | `behind_smart_accounts` |
| annotations      | `labels`, `ml`, `inferred`, `kinds`, `assets`  | none                                                          | `annotations_fresh`     |
| transfers        | `transfers_by_asset`                           | `TRANSFERRED`                                                 | `behind_transfers`      |

`transfers` is its own family: a `FLOWS_TO` search never waits for it, and a `TRANSFERRED` search never waits for `money`.

Find the question in this table. Send its first query, once, with the addresses the user gave.

| The user asks                                                | Layer      | First query                                                            |
| ------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| Recent activity or newest links of one address               | `topology` | Newest links of one address (see Graph searches)                       |
| Who sent money to an address? Who received from it?          | `topology` | Newest links of one address, the arrow flipped for senders             |
| Where did the money go, or come from, in N hops?             | `topology` | Where the money went, or came from (`{0,N-1}`, N up to 5)              |
| Is there a route between two addresses?                      | `topology` | Route between two addresses, `SHORTEST 1`                              |
| What do two addresses have in common?                        | `topology` | Counterparties that two addresses share                                |
| Biggest senders or receivers of one address                  | `topology` | Newest links of one address, `ORDER BY f.amount_usd_sum DESC LIMIT 10` |
| How many, how much, first or last active, for one address    | `topology` | Profile of one address                                                 |
| The transfers of a pair on one day                           | `facts`    | `TRANSFER` of the pair and the day, see Facts                          |
| What one address did in a month, since a date, in the last N days | topology, then facts | Links bounded by first and last seen, day reads only for the links that straddle an edge, see A window of days for one address |
| What happened in this transaction hash?                      | `chain`    | `Transaction {tx_id}`, see Chain                                       |
| The latest block, block N, how far behind the graph is       | `chain`    | `Head`, or `Block {block_height}`                                      |
| The balance of one address over time, its balance changes   | `chain`    | `Head`, one `Block`, then one batch of `Address` reads, see Balance over time of one address |
| Who transacted in block N, what happened in block N           | `chain`, then say the limit | `Block {block_height}` gives the hash, the time and the count; no layer lists a block's transactions or searches by block. Say so and offer the pair's day on facts. |
| Which tokens moved between two addresses?                    | `topology` | `TRANSFERRED` of the pair, one link per token (see Tokens)             |
| Where did one token go, or come from, in N hops?             | `topology` | The guarded walk on `TRANSFERRED` with one `asset` (see Tokens)        |
| The biggest receivers of one token in a window               | `topology` | `TRANSFERRED` with one `asset` and `last_seen_timestamp` (see Tokens)  |
| What fields does an Address have?                            | none       | Call `meta_schema {network}`. Send no query.                           |
| Recent addresses, biggest senders, any top list of the chain | topology   | A search bounded by `f.last_seen_timestamp`, then sort and LIMIT (below). |

For a question of the last row, compute the time bound first as a literal number (epoch milliseconds of now minus 24 hours: take today's date, not a remembered year), then search. Never sort the whole graph without the time bound: it is stopped at 10 s.

A link's `amount_usd_sum` and `tx_count` are the pair's lifetime totals. The time bound only picks links active in the window; it does not cut their totals to the window. Say "lifetime total of pairs active in the last day", never "volume in the last day". For the money of one day, read the pair's transfers on `USE facts` for that day.

Recent activity, newest first:

```cypher
USE topology MATCH (a:Address)-[f:FLOWS_TO]->(b:Address) WHERE f.last_seen_timestamp >= 1791244800000 RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, a.labels AS from_labels, b.labels AS to_labels, a.is_exchange AS from_is_exchange, b.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC LIMIT 25
```

The biggest senders of the period:

```cypher
USE topology MATCH (a:Address)-[f:FLOWS_TO]->(b:Address) WHERE f.last_seen_timestamp >= 1791244800000 RETURN a.address AS sender, sum(f.amount_usd_sum) AS sent_usd, count(*) AS links ORDER BY sent_usd DESC LIMIT 10
```

If the server answers `anchor_missing`, or `query_timeout` on a search bounded only by time, it cannot search the whole chain now. Say: "This server cannot search the whole chain right now. Give me an address, a pair with a day, or a transaction hash." Send no narrower window: it times out the same way, and each try costs the user 10 seconds. If it answers `family_behind`, the refusal names the family that is behind and its link types: drop the link type the server names, or give an address.

## One name on every layer

A thing has one name on topology, facts and chain. Copy a value from one layer into the next as it is. The layers differ by properties only.

| Thing      | `USE topology`                                | `USE facts`                   | `USE chain`                                    |
| ---------- | --------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| An address | `:Address {address}`, and a kind label        | `:Address {address}`, no kind | `Address {address}`, optional `at_block`       |
| A kind     | `:Account` or `:Contract`, `is_contract` kept | none: refused with a hint     | `is_contract`, `nonce` and `delegated_to`      |
| A tx       | `tx_id` on `DEPLOYED_CONTRACT` only           | `tx_id` on every row          | `Transaction {tx_id}`, see Chain               |
| A block    | `block_height` on `DEPLOYED_CONTRACT` only    | `block_height` on every row   | `Block {block_height}` or `Block {block_hash}` |
| Time       | epoch milliseconds                            | epoch milliseconds            | epoch milliseconds                             |
| `network`  | the query's `network`                         | the query's `network`         | the query's `network`                          |

`block_timestamp` is an integer number of epoch milliseconds on every layer, chain included. `block_date` is a UTC day, `YYYY-MM-DD`. The old chain names `hash` and `height` are gone: they are refused like any name a label lacks.

`network` is a property of every node and every relationship, and its value is the query's `network`. It is never stored, except on a `:Chain` node, where it names the remote chain. A filter `x.network = "robinhood"` keeps every row, and a filter on another value gives no rows. It never narrows a scan: anchor on an address instead.

A kind is a second label that topology takes from a chain fact: `:Account` for a key holder, `:Contract` for a contract (`:Contract:SmartAccount` for a contract wallet). Never both on one address. An address that only received has none, and so does a Nitro precompile on topology (chain reads it as a contract). A role label such as `:Pool` or `:Token` stays beside the kind. `is_contract` stays beside `:Contract`. Facts serves no kind: a facts read that names `:Account` or `:Contract` is refused, so ask `USE topology`, or `USE chain` for `is_contract` and `nonce`.

Three marks say what a contract is. They sit beside the kind and are never an anchor:

- `:Token` is a token contract: every ERC20, ERC721, ERC1155 and ERC6909 contract the chain's asset scan knows. `token_standard` on the node says which one (`ERC20`, `ERC721`, `ERC1155` or `ERC6909`). A token with no standard yet has no mark.
- `:NFT` is a token contract whose `token_standard` is `ERC721` or `ERC1155`. An `ERC20` is `:Token` only.
- `:Pool` is a pool contract the DEX indexer knows, traded or not. A bonding curve, a Virtuals starting pool and a pair that nobody has swapped in are `:Pool` from the day the pool is discovered. A singleton pool manager, such as the PoolManager, is never `:Pool`.

A token name from an explorer gives `:Token`, not `:Protocol`. `:Token` is a mark, not a stop: the walk guard below does not name it. One contract can carry both marks: a Uniswap v2 pair is itself an ERC20 token of its liquidity providers, so it is `:Pool` and, when the asset scan lists it, `:Token` too. Ask which tokens or pools an address touched with the mark: `WHERE t:Token` or `WHERE p:Pool`.

A topology link is a lifetime summary of a pair, and a facts row is one event. They are two things, so they keep two names: `SWAPPED`, `ADDED_LIQUIDITY` and `REMOVED_LIQUIDITY` on topology, `SWAP`, `LIQUIDITY_ADD` and `LIQUIDITY_REMOVE` on facts. Read the summary on topology, anchored on an address, then the events behind it on facts, by the pair and one day.

## Topology

`USE topology` is the address graph: `FLOWS_TO` money flow, swaps, liquidity,
bridges and the `LINKED` overlay. The server checks these before it runs:

- Anchor every pattern on a full address: `{address: "<address>"}` in the node, or `WHERE a.address = "<address>"`. A list of at most 25 addresses is an anchor. An address in `RETURN`, in an `OR` or in a `$parameter` is no anchor.
- The one read with no anchor is a probe: one node or one hop, no `WHERE`, no `ORDER BY`, no aggregate, and a small `LIMIT`. Its rows are arbitrary: never call them recent, top or biggest.
- A sort, an aggregate, `DISTINCT`, `collect()` or a filter on a link property needs an anchor on every pattern.
- End every read with a literal `LIMIT`: at most 5,000 rows, 100 for a probe. A path has at most 5 hops and a query at most 8. The live numbers are in `topology_admission` (`cia network robinhood --json`).
- Paths use bounded quantifiers such as `-[:FLOWS_TO]-{1,5}`. A `*` range, the legacy path functions, `PROFILE`, writes and `CALL` are refused.
- Role flags `is_exchange`, `is_scam`, `is_victim` and `is_sanctioned` are absent unless true: use `IS NULL` or `IS NOT NULL`, never `= false`.
- A kind label sits beside `:Address`: `WHERE a:Contract` or `WHERE a:Account` tests it, as `:Pool` is tested. It is no anchor.
- A `FLOWS_TO` read written without an arrow, `-[f:FLOWS_TO]-`, matches both directions and tells you nothing about which end sent. Return `startNode(f).address AS from_address, endNode(f).address AS to_address`, or send two directed reads, before you call either address the sender: one answer named the receiver as the sender and had to take it back.

## Graph searches

Each query below is admitted by the live server. Change only the addresses and the `RETURN`. Keep the guards inside the pattern: they apply the [pool trace rule](#pool-trace-rule) and the system guard below it, and a `WHERE` after a `SHORTEST` pattern runs too late. A walk of two or more hops carries the long guard on its start and on every address in its middle. A walk follows links, not coins: confirm a hop with a pair and a day on `USE facts`.

Newest links of one address, its receivers. Its newest senders are the same read with the arrow flipped:

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool
RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, a.labels AS from_labels, b.labels AS to_labels, a.is_exchange AS from_is_exchange, b.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC LIMIT 25
```

```cypher
USE topology
MATCH (b:Address)-[f:FLOWS_TO]->(a:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"}) WHERE NOT a:Pool
RETURN b.address AS from_address, a.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, b.labels AS from_labels, a.labels AS to_labels, b.is_exchange AS from_is_exchange, a.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC LIMIT 25
```

Both directions of one address in one picture: one read, the two directed
patterns joined with `UNION ALL`, each branch with its own `LIMIT`. The host
draws one graph from it, senders and receivers around the address. Two
separate reads give two pictures, which is not what "show me X on the graph"
asks for.

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool
RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, a.labels AS from_labels, b.labels AS to_labels, a.is_exchange AS from_is_exchange, b.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC LIMIT 25
UNION ALL
MATCH (c:Address)-[g:FLOWS_TO]->(d:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"}) WHERE NOT d:Pool
RETURN c.address AS from_address, d.address AS to_address, g.amount_usd_sum AS amount_usd_sum, g.tx_count AS tx_count, g.first_seen_timestamp AS first_seen_timestamp, g.last_seen_timestamp AS last_seen_timestamp, c.labels AS from_labels, d.labels AS to_labels, c.is_exchange AS from_is_exchange, d.is_exchange AS to_is_exchange ORDER BY g.last_seen_timestamp DESC LIMIT 25
```

Profile of one address: counterparties, transactions, volume and the active window, all from the node. Timestamps are milliseconds.

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})
RETURN a.degree_in AS senders, a.degree_out AS receivers, a.tx_total_count AS tx_count, a.total_volume_usd AS volume_usd, a.first_activity_timestamp AS first_active, a.last_activity_timestamp AS last_active LIMIT 1
```

Which exchange an address cashed out to: its receivers that carry the exchange flag, one hop. Ask this first; it answers in under a second.

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool AND b.is_exchange IS NOT NULL
RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, a.labels AS from_labels, b.labels AS to_labels, a.is_exchange AS from_is_exchange, b.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC ORDER BY f.amount_usd_sum DESC LIMIT 25
```

When that is empty, one two-hop walk to an exchange at most (`{0,1}` in the route shape below, with `b.is_exchange IS NOT NULL` on the end and no address literal there). It can take the whole 60 s budget and end in `query_timeout` on a busy address: after one timeout, say no exchange was found within two hops and stop. Never widen to three or four hops, and never send the walk twice.

Route between two addresses, one path. Only `MATCH SHORTEST 1` and `MATCH ANY SHORTEST` are served: a count above 1 is `route_search_refused`.

```cypher
USE topology
MATCH p = SHORTEST 1 (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"} WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN [n IN nodes(p) | n.address] AS route
LIMIT 5
```

Several routes, up to 3 hops, in no set order. Add no `ORDER BY`: it can end in `query_timeout`.

```cypher
USE topology
MATCH p = (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"} WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]){0,2} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN [n IN nodes(p) | n.address] AS route, length(p) AS hops LIMIT 5
```

Where the money went, up to 3 hops out:

```cypher
USE topology
MATCH p = (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"} WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]) (()-[:FLOWS_TO|SWAPPED]->(via:Address) WHERE NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]){0,2} ()-[:FLOWS_TO|SWAPPED]->(b:Address)
RETURN b.address AS to_address, length(p) AS hops LIMIT 25
```

Where the money came from, up to 3 hops in:

```cypher
USE topology
MATCH p = (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"} WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]) (()<-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]){0,2} ()<-[:FLOWS_TO|SWAPPED]-(b:Address)
RETURN b.address AS from_address, length(p) AS hops LIMIT 25
```

Counterparties that two addresses share:

```cypher
USE topology
MATCH (a:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})-[:FLOWS_TO|SWAPPED]-(c:Address)-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"}) WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"] AND NOT c:Pool AND NOT c:Protocol AND NOT c:System AND NOT c.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]
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

What a pool is, and who trades through it. A pool is the `:Pool` node label,
read with `labels(p)`; the `labels` property is a different thing (named
labels such as a vault), and a pool usually has none. The traders are the
senders into the pool on `FLOWS_TO`, ranked by `tx_count`: one read, and that
is the answer. Add no swap check: `SWAPPED` filtered on `s.pools`, on a list
of traders or on the pool times out, and a busy trader's swap links time out
even anchored on that one trader (two answers lost 86 seconds that way).

```cypher
USE topology
MATCH (b:Address)-[f:FLOWS_TO]->(p:Address {address: "0xd42a491087a15e5afd51feb3606066cc152d2b09"}) WHERE NOT b:Pool
RETURN b.address AS from_address, p.address AS to_address, labels(p) AS to_node_labels, f.tx_count AS tx_count, f.amount_usd_sum AS amount_usd_sum, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, b.labels AS from_labels, p.labels AS to_labels, b.is_exchange AS from_is_exchange, p.is_exchange AS to_is_exchange ORDER BY f.tx_count DESC LIMIT 25
```

Pool trace: who took liquidity out of the pools an address paid into.

```cypher
USE topology
MATCH (a:Address {address: "0x7a31dd32a880827477ab2bbeff47db188c896815"})-[:FLOWS_TO]->(p:Pool)-[r:REMOVED_LIQUIDITY]->(b:Address) WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"] AND b.address <> a.address
RETURN p.address AS pool, b.address AS receiver, r.usd AS removed_usd, r.receiver_provided AS receiver_provided LIMIT 25
```

Bridges: the remote chains an address used. A `:Chain` is no `Address`: two users of one bridge are not connected through it.

```cypher
USE topology
MATCH (a:Address {address: "0x9a8f92a830a5cb89a3816e3d267cb7791c16b04d"})-[x:BRIDGED]->(c:Chain)
RETURN c.network AS remote_network, c.address AS endpoint, x.events AS events LIMIT 25
```

### Tokens: one link per sender, receiver and token

`FLOWS_TO` is the pair's total over every token. `TRANSFERRED` splits that total by token: one link for each sender, receiver and token. `FLOWS_TO` stays the pair total, and the `TRANSFERRED` links of a pair add up to it. A link carries these properties:

- `asset`: the token's contract, in lowercase and in full (42 characters), or `native` for the chain's own coin.
- `token_standard`: the standard of the token.
- `tx_count`: the number of transfers of that token between the pair.
- `amount_raw_sum`: the exact total in base units, as text. It is not dollars and not a number of whole tokens.
- `amount_usd_sum`: the value at the day prices, in USD. A transfer with no price adds 0, so it is a floor.
- `unpriced_count`: how many of those transfers had no price. A link with an `unpriced_count` above 0 is worth more than `amount_usd_sum` says.
- `first_seen_timestamp` and `last_seen_timestamp`: milliseconds since the epoch.

Tokens between a pair, one row for each token. This read is anchored on both addresses, so it needs no asset and no time bound:

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[t:TRANSFERRED]->(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN t.asset AS asset, t.tx_count AS tx_count, t.amount_raw_sum AS amount_raw_sum, t.amount_usd_sum AS amount_usd_sum, t.first_seen_timestamp AS first_seen_timestamp, t.last_seen_timestamp AS last_seen_timestamp ORDER BY t.amount_usd_sum DESC LIMIT 50
```

Where one token went, up to 3 hops out. Every hop carries the same `asset`, so the route follows one token and not the money in general. Keep the guards of the walk and change only the address and the token:

```cypher
USE topology
MATCH p = (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"} WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System) (()-[t:TRANSFERRED WHERE t.asset = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"]->(via:Address) WHERE NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]){0,2} ()-[:TRANSFERRED {asset: "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}]->(b:Address)
RETURN b.address AS to_address, length(p) AS hops LIMIT 25
```

The short form of a route in one token is `-[:TRANSFERRED {asset: "<contract>"}]-{1,4}`, at most 4 hops: use it only inside the guarded walk above, never alone. Where one token came from is the same walk with the arrows flipped.

The biggest receivers of one token among the pairs active since a time. The sums are lifetime totals of those pairs, not the money of the window:

```cypher
USE topology
MATCH (a:Address)-[t:TRANSFERRED]->(b:Address)
WHERE t.asset = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" AND t.last_seen_timestamp >= 1792368000000
RETURN b.address AS receiver, sum(t.amount_usd_sum) AS received_usd, count(*) AS links
ORDER BY received_usd DESC LIMIT 10
```

A `TRANSFERRED` search over the whole chain, with no address anchor, must name one `asset` literal and a lower bound `t.last_seen_timestamp >=` joined by `AND`. Without both, the server refuses it with `transfer_search_unbounded` before it runs. An `OR` of two assets is refused the same way: send one search per asset, in one `graph_query_batch` when there are several. Read `behind_transfers` on `Head` first, as for any whole-chain search. A read anchored on a full address needs neither bound.

How to answer from these rows:

- Tokens are not dollars. Say "tokens worth about 183 USD", never "sent 183 USD". Head the column "Tokens worth (USD)".
- Name the token by its full contract, all 42 characters. Never write a symbol you have not read, and never shorten the contract. For `native`, say "the chain's own coin".
- Never add `amount_raw_sum` of two different tokens: base units of different tokens do not add up. Add a token's own units only, and say the token.
- Say when `unpriced_count` is above 0: the dollar figure is a floor for that token.

## Pool trace rule

`:Pool` is a second label on an `Address`: a pool contract the DEX indexer
knows, traded or not. A pool with no swap yet is `:Pool` too. A trace that walks out of a pool on `FLOWS_TO` lands on every
trader who used it. Every trace follows this rule:

1. Enter a `:Pool` on any edge.
2. Leave a `:Pool` only on `REMOVED_LIQUIDITY`, to the address the liquidity
   was paid to.
3. Never leave a `:Pool` on `FLOWS_TO`.
4. Across a swap, follow `SWAPPED` from payer to recipient, between two
   different addresses. Do not walk through the pool.

So a walk never starts at a pool and never passes through one. It may end at one. Guard the start with `WHERE NOT a:Pool` and each address in the middle with `WHERE NOT via:Pool`, and follow `FLOWS_TO|SWAPPED`, as above. Exchange hot wallets end a trace: pass through an address only when `is_exchange IS NULL`.

### System guard

A walk of two or more hops also never starts at, and never passes through,
a `:Protocol` or a `:System` address.

- System is the kind of the mint and burn addresses
  0x0000000000000000000000000000000000000000 and
  0x000000000000000000000000000000000000dead.
- Protocol is shared infrastructure such as a PoolManager, a router or a
  bridge. The PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951` is
  one. It settles the swaps of every pool, and it is no `:Pool`.

Each one links hundreds of thousands to millions of wallets that never dealt
with each other. A route through one connects nothing. "Wallet A, then the
zero address, then wallet B" only says that both held a minted token.

Guard the start and every address in the middle with these tests, each its
own `AND` term:

```text
NOT via:Pool AND NOT via:Protocol AND NOT via:System AND NOT via.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]
```

The graph does not write the `:System` kind yet, so the address test keeps
the two system addresses out until it does. Keep both tests. The address
test becomes redundant once every graph writes `:System`.

A one-hop read of such an address needs no guard: its own links are facts.
It may also end a walk, as a pool may. When the shortest route comes back
empty with the guard, say that no route avoids these addresses within the
hops. Never send the walk again without the guard.

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

Name another link type to read its keys: `SWAPPED`, `LINKED`, `OPERATED_BY`, `BRIDGED`, `ADDED_LIQUIDITY` or `REMOVED_LIQUIDITY`. The keys of an address and of a link include `network`: it is the query's `network`, computed on every node and link. `synced_through_height` and `pair_key` are bookkeeping: never filter or sort on them.

The server serves five read-only catalog calls: `CALL db.labels()`, `CALL db.relationshipTypes()`, `CALL db.propertyKeys()`, `CALL db.schema.visualization()` and `SHOW INDEXES`. `meta_schema` sends four of them for you through one session and keeps the answer, so do not send them yourself.

## Facts: an address pair with one day

`USE facts` looks up rows you already know. A facts read names an address pair with one day. A transaction is read on `USE chain`, not here. A pair is both addresses, from then to, each as `{address: "<address>"}`, and the day is `t.block_date = "YYYY-MM-DD"`. One address, a day alone, a window of days, a block range and a bare `LIMIT` are not enough. It serves `TRANSFER`, `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows.

- A reply holds at most 200 rows, whatever the `LIMIT`. When `count()` says the day holds more, give the count and one page, and say that the rest takes one read per 200 rows (a `t.block_timestamp >=` bound after the last row of the page). Read on only when the user asks for every row, and never beyond 5 pages in one turn: a loop of 61 reads once cost a user 131 seconds for one answer.
- A facts read has one relationship and no hop. For a walk, go to topology.
- A facts read takes no `ORDER BY`. Rows come in the server's own order. Sort the page yourself.
- "The largest transfer" of an address or a pair has no read: facts serves no `max()` and no sort, and the lifetime link totals hold no single transfer. Ask for the day, then read that day's rows and pick the largest yourself; or give the biggest counterparty link instead and say that is a lifetime total, not one transfer. Never read every day of a pair to find it: one answer took 190 seconds that way.
- A facts read aggregates with `count()` and `sum()` only, over the whole page: no grouping key, no `min()`, `max()` or `avg()` (`unsupported facts query shape`). Read the rows and compute the rest yourself.
- Every row and both endpoints carry `network`, the query's `network`. A filter on it is no anchor: it never replaces the pair and the day.
- Facts serves no kind. A read that names `:Account` or `:Contract` is refused with `facts_no_anchor`: ask `USE topology` for the kind, or `USE chain` for `is_contract` and `nonce`.
- A facts read covers one day. For more days, send one read for each day, and for a window of days around one address pick the pairs first (A window of days for one address, below): never every pair on every day.
- Amounts and USD values come back as text, such as `"5.23661492"`. Convert them before you add them.
- `TRANSFER` columns: `tx_id`, `block_date`, `block_height`, `block_timestamp`, `event_index`, `edge_index`, `kind`, `asset_contract`, `asset_symbol`, `amount`, `amount_usd`, `price_usd`, `price_missing`, `token_id`, `token_standard`, `operator_address`, `raw_amount` and `decimals`. `kind` is `token`, `native` or `internal`: an `internal` row is ETH a contract sends while it runs a call.

```cypher
USE facts
MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"})-[t:TRANSFER]->(b:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"}) WHERE t.block_date = "2026-07-10"
RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.asset_symbol AS asset_symbol, t.amount AS amount, t.amount_usd AS amount_usd, t.kind AS kind LIMIT 50
```

### Value of one day's flow

A topology link gives the pair's lifetime total, not the day's. To say what a
pair moved on one day, read its `TRANSFER` rows for that day, then:

1. List each row's `asset_symbol` and `amount`. Show the assets, not only a total. When `asset_symbol` is a 42-character address, the token has no known symbol: call it "the token at <address>", in full, and never invent a ticker.
2. Add the `amount_usd` values for the USD figure, after you convert the text to numbers. `amount_usd` is each row's value at the day's average price.
3. If a row's `price_missing` is true, show its amount and say no price exists for that asset. Never guess a USD value.
4. Say "tokens worth about X USD on DAY", because the row moved tokens.

### A window of days for one address

"What did this address do in September", "everything it received since
August 1", "only the last 7 days": never read every pair on every day. One
answer once took 72 reads and 189 seconds. Three steps, in this order:

1. One topology read, both directions, bounded by the window: a link is in
   the window when `f.first_seen_timestamp <= <window end ms>` and
   `f.last_seen_timestamp >= <window start ms>`. Return `from_address`,
   `to_address`, `tx_count`, `amount_usd_sum`, `first_seen_timestamp` and
   `last_seen_timestamp`. This is the list of counterparties active in the
   window.
2. A link whose first and last seen both fall inside the window needs no
   facts read: its lifetime `tx_count` and `amount_usd_sum` are the window
   totals. Only a link that straddles a window edge needs the per-day
   totals: for that pair, one `graph_query_batch` of one `count()` and
   `sum()` query per day, up to 20 days per call, over the days between the
   later of its first seen and the window start, and the earlier of its last
   seen and the window end.
3. Answer with the totals per counterparty, and say which are exact and
   which came from the day reads. Read rows only for the days the user asks
   about. When more than ten links straddle an edge, give the window picture
   from the link totals, name the straddling pairs as estimates, and offer
   the exact read for one of them.

The outgoing side, for September 2026; the incoming side is the same read
with the arrow reversed, and both go in one `graph_query_batch`:

```cypher
USE topology
MATCH (a:Address {address: "0x9f73873740c799d74741ad2d15cee7fb33572e4a"})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool AND f.first_seen_timestamp <= 1790812799000 AND f.last_seen_timestamp >= 1788220800000
RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, a.labels AS from_labels, b.labels AS to_labels, a.is_exchange AS from_is_exchange, b.is_exchange AS to_is_exchange ORDER BY f.last_seen_timestamp DESC LIMIT 50
```

## Chain: one key, one node

`USE chain` asks the chain node for one known thing: `Transaction` by `tx_id`, `Block` by `block_height` or `block_hash` (exactly one), `Address` by `address` (with an optional `at_block`), or `Head`. One node, literal keys in braces, a `RETURN` of `var.property` items, no `WHERE`, no range. `RETURN t` of the whole node is refused (`chain_not_a_lookup`), and a property outside the node's list is refused (`chain_not_served`): a `Transaction` has `tx_id`, `status`, `block_height`, `block_hash`, `tx_index`, `block_timestamp`, `block_date`, `from_address`, `to_address`, `created_contract`, `value`, `nonce`, `gas_used`, `effective_gas_price`, `log_count` and `tx_type`, and no `type`. Read its limits in `chain_admission` (`cia network robinhood --json`).

A chain read costs several node calls, and the server caps node calls per caller per second: a batch of several chain reads can answer some and refuse the rest with `chain_busy`. The proxy waits and resends the refused members for you, so a `chain_busy` that still reaches you means the node is busy: wait a few seconds and send that member alone. Never send the whole batch again.

```cypher
USE chain
MATCH (t:Transaction {tx_id: "0x044587122970de1e3c377a8ed7ab56a49c777a2b7441a2f5d9ca32dbab9fbe71"}) RETURN t.status, t.block_height, t.block_date
```

```cypher
USE chain
MATCH (b:Block {block_height: 79841521}) RETURN b.block_hash, b.block_date
```

An address at the newest block, and at a past block:

```cypher
USE chain
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"}) RETURN a.balance, a.nonce, a.is_contract
```

```cypher
USE chain
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550", at_block: 79000000}) RETURN a.balance, a.nonce, a.is_contract
```

```cypher
USE chain
MATCH (h:Head) RETURN h.block_height, h.age_seconds, h.warehouse_blocks_behind, h.graph_blocks_behind, h.behind_money, h.behind_dex, h.behind_interactions, h.behind_smart_accounts, h.behind_transfers, h.annotations_fresh
```

An `Address` lookup always answers one row, because every address has a state. `a.balance` is decimal text. Read the kind from `a.is_contract`, `a.nonce` and `a.delegated_to`: `a.is_contract` is `true` for a contract and null for any other address, a `nonce` above 0 with `a.is_contract` null is an account, and `a.delegated_to` names the target of an EIP-7702 delegation, which is an account. `a.code_size` is the size of the code, and the code itself is never returned. `:Account` and `:Contract` are never a chain lookup label.

`at_block` must be at least `chain_admission.at_block_min_depth` blocks below the tip. A nearer block is refused with `chain_block_out_of_range` and the rule `at_block_near_tip`: leave `at_block` out to read the newest block. The names `hash` and `height` are no key and no property of any label.

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

Claude Desktop and the Codex app draw a `graph_query` answer from its column
names. Choose the picture by the question, then alias the `RETURN` columns.

| The question                                         | Picture     | The columns                                                     |
| ---------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| Who sent to whom, money flows, routes, counterparties | Graph       | `from_address` and `to_address` in every row                     |
| How something changed over time                      | Time series | a `day`, `date`, `hour`, `week`, `month` or `*_timestamp` column, number columns, no address in any value, 3 or more times |
| A list, a lookup, the details of one thing           | Table       | anything else                                                   |

A graph holds up to 5,000 addresses, and the investigator can load more by
double-clicking an address. It also reads these optional columns:
`amount_usd_sum`, `tx_count`, `first_seen_timestamp`, `last_seen_timestamp`,
`link_kind`, `from_labels`, `to_labels`, `from_is_exchange` and
`to_is_exchange`. A recipe that draws a graph returns all of them: a column
the query leaves out shows as "Unavailable" in the drawn link. A graph is the newest-links read of
one address, receivers or senders, in Graph searches. Claude Code draws
nothing and shows the rows as text.

### Time series

`USE facts` reads one pair on one day, and does not group. Three shapes are
served: two for a pair, on `USE facts`, and one for the balance of one
address, on `USE chain`.

Within one day, the transfers of a known pair, one point per transfer:

```gql
USE facts
MATCH (a:Address {address: "0xcaf681a66d020601342297493863e78c959e5cb2"})-[t:TRANSFER]->(b:Address {address: "0x97bf35f2603357d0be4dcd081ceccdbc9f9c2cc5"})
WHERE t.block_date = "2026-10-07"
RETURN t.block_timestamp AS block_timestamp, t.amount_usd AS amount_usd
LIMIT 200
```

Across days, send `graph_query_batch` with one query per day, 3 to 20 days.
Each query's `id` is its day, `"YYYY-MM-DD"`, and returns one total row. The
view joins the days into one series; a refused day is a gap.

```json
{"network": "robinhood", "queries": [
  {"id": "2026-10-05", "query": "USE facts MATCH (a:Address {address: \"<from>\"})-[t:TRANSFER]->(b:Address {address: \"<to>\"}) WHERE t.block_date = \"2026-10-05\" RETURN count(t) AS tx_count, sum(t.amount_usd) AS amount_usd_sum"},
  {"id": "2026-10-06", "query": "… the same, t.block_date = \"2026-10-06\" …"},
  {"id": "2026-10-07", "query": "… the same, t.block_date = \"2026-10-07\" …"}
]}
```

Never group by day (`RETURN t.block_date AS day, count(t)`) and never name
several days in one read (`block_date IN [...]`): both are refused. A literal
column such as `RETURN "2026-10-07" AS day` does not parse.

A row that names its ends `src`, `dst` or `address` draws no graph. Alias them `from_address` and `to_address`.

#### Balance over time of one address

"Show the balance of 0x… over time", "its balance changes": this is a
`USE chain` read. Never use topology or facts for it, and never send
`graph_query` once per day. One batch draws one chart.

What the chain gives:

- `a.balance` is the native coin, ETH, in wei: the smallest unit. One ETH is
  10^18 wei. The value is decimal text.
- No layer serves a token balance. When the user asks about tokens, say so.
- A batch holds at most `chain_admission.batch_max` chain reads. More are
  refused with `chain_batch_too_large`. So one chart holds at least 3
  points and at most `chain_admission.batch_max`.
- A second batch draws a second chart, not more points. Send one batch.

Pick the days, the newest last, as many as `chain_admission.batch_max`:

- The user names a window: spread the days across it, its last day last.
- No window: one day a week back from today, today last.

The steps:

1. Read the head. Call its height `H` and its time `T`.

```cypher
USE chain MATCH (h:Head) RETURN h.block_height, h.block_timestamp
```

2. Read one block near the oldest day. A block is about a tenth of a
   second, so guess `H - days back x 864000`. Call its height `h0` and its
   time `T0`. The block time drifts by hours over a month, so never skip
   this read.

```cypher
USE chain MATCH (b:Block {block_height: 61184414}) RETURN b.block_height, b.block_timestamp
```

3. Work out the blocks per day: `B = (H - h0) x 86400000 / (T - T0)`.
4. For each day, take the last millisecond of that UTC day: midnight plus
   86,399,999. Call it `E`. Its block is `H - (T - E) x B / 86400000`,
   rounded to a whole block.
5. For today, and for any block less than
   `chain_admission.at_block_min_depth` blocks below `H`, leave `at_block`
   out. That point reads the newest block.
6. Send one `graph_query_batch`. Each query's `id` is its day,
   `"YYYY-MM-DD"`. Each query returns `a.balance` and nothing else. An
   address or a `day` column in the row breaks the chart into tabs.

A worked batch, for one address over four weeks. Today is the last day,
so it has no `at_block`.

| `id`         | `query` |
| ------------ | ------- |
| `2026-09-13` | `USE chain MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c", at_block: 62367679}) RETURN a.balance` |
| `2026-09-20` | `USE chain MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c", at_block: 68335414}) RETURN a.balance` |
| `2026-09-27` | `USE chain MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c", at_block: 74303150}) RETURN a.balance` |
| `2026-10-04` | `USE chain MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c", at_block: 80270885}) RETURN a.balance` |
| `2026-10-11` | `USE chain MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"}) RETURN a.balance` |

Each row is one member of `queries`:

```json
{"network": "robinhood", "queries": [
  {"id": "2026-09-13", "query": "<the query of 2026-09-13>"},
  {"id": "2026-09-20", "query": "<the query of 2026-09-20>"},
  {"id": "2026-09-27", "query": "<the query of 2026-09-27>"},
  {"id": "2026-10-04", "query": "<the query of 2026-10-04>"},
  {"id": "2026-10-11", "query": "<the query of 2026-10-11>"}
]}
```

Each day answers one row, such as `{"balance": "9674936629657651"}`, in
wei. The view joins the days into one series.

Answer in ETH: divide the wei by 10^18. `9674936629657651` wei is about
0.00967 ETH. Say each point is the ETH held at the end of that UTC day, and
today's point is now. A flat line at zero is an answer: the address held no
ETH on those days. Say that only ETH is shown.

## Shell without the tool

Only in a plain shell with no `graph_query` tool, run a query with
`cia mcp call graph_query network=robinhood "query=<query>"`.
Send related reads in one call with `cia mcp call graph_query_batch network=robinhood 'queries=[{"id":"a","query":"<query>"}]'`.
These two commands, and `cia network robinhood --schema` for field names, are
all you need. Do not run `cia --help` to look for others.
