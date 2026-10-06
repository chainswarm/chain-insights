---
name: chain-insights-cypher
description: Use when answering any question about addresses, money flows, transfers, transactions or blocks with Chain Insights, when writing or reviewing graph_query or graph_query_batch ISO GQL, when choosing between USE topology, USE facts and USE chain, or when a graph query is refused. Address, timestamp, layer and refusal rules. Load the schema skill for labels and properties.
---

# Chain Insights Cypher

Standard ISO GQL for `graph_query` and `graph_query_batch`. Read-only. No
`CALL`, no procedures, no vendor syntax. Load `chain-insights-schema-evm` for
labels and properties.

Run a query with `cia mcp call graph_query network=robinhood "query=<query>"`.
Send related reads in one call with `cia mcp call graph_query_batch network=robinhood 'queries=[{"id":"a","query":"<query>"}]'`.
Always pass `network` and your own `LIMIT`. These two commands are all you
need. Do not run `cia --help` to look for others.

## Rules that stop most failures

1. Write every address in full, in lowercase: `0x` plus 40 hex characters, 42
   in all. Never shorten one with `...` or `…`, in a query or in an answer.
   Copy addresses from results exactly.
2. Timestamps on topology and facts are integer milliseconds since the epoch,
   UTC. Compute them from the current date: a day is 86,400,000 ms. Never
   compare one with an ISO string. `block_date` is the string `"YYYY-MM-DD"`.
   `USE chain` returns `block_timestamp` as an ISO string: read it, never
   filter on it.
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

Recent active addresses of the whole chain, a top list, a count or a scan of a
label are such questions. Do not search for a workaround. Say: "The graph
cannot list those. Name an address, a pair with a day, or a transaction hash."

## Topology

`USE topology` is the address graph: `FLOWS_TO` money flow, swaps, liquidity,
bridges and the `LINKED` overlay. The server checks these before it runs:

- Anchor every pattern on a full address: `{address: "<address>"}` in the
  node, or `WHERE a.address = "<address>"`. A list of at most 25 addresses is
  an anchor. An address in `RETURN`, in an `OR` or in a `$parameter` is no
  anchor.
- The one read with no anchor is a probe: one node or one hop, no `WHERE`, no
  `ORDER BY`, no aggregate, and a small `LIMIT`. Its rows are arbitrary, never
  the newest.
- A sort, an aggregate, `DISTINCT`, `collect()` or a filter on a link property
  needs an anchor on every pattern.
- End every read with a literal `LIMIT` (`topology_admission.max_limit` holds
  the top). A path has at most 5 hops and a query at most 8.
- Paths use bounded quantifiers such as `-[:FLOWS_TO]-{1,5}`. A `*` range, the
  legacy path functions, `PROFILE`, writes and `CALL` are refused.
- Role flags such as `is_exchange` are absent unless true: use `IS NULL` or
  `IS NOT NULL`, never `= false`.

A route search asks for one path: `MATCH SHORTEST 1`, or `MATCH ANY SHORTEST`
in the same pattern. Use the form below as written and change only the
addresses and the `RETURN`. The guard keeps the walk off pools and follows the
pool trace rule in `chain-insights-schema-evm`. Keep it inside the pattern: a
`WHERE` after the pattern runs too late.

```cypher
USE topology
MATCH p = SHORTEST 1 (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})
RETURN [n IN nodes(p) | n.address] AS route
LIMIT 5
```

One address, its labels, counts and activity window:

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})
RETURN a.address AS address, a.labels AS labels, a.degree_in AS degree_in,
       a.degree_out AS degree_out, a.last_activity_timestamp AS last_activity_timestamp
LIMIT 1
```

## Facts: an address pair with one day

`USE facts` looks up rows you already know. A facts read names an address pair with one day, or one `tx_id`. A pair is both addresses, from then to, each as `{address: "<address>"}`, and the day is `t.block_date = "YYYY-MM-DD"`. One address, a day alone, a window of days, a block range and a bare `LIMIT` are not enough.

- A reply holds at most 200 rows, whatever the `LIMIT`.
- A facts read has one relationship and no hop. For a walk, go to topology.
- A facts read takes no `ORDER BY`. Rows come in the server's own order. Sort the page yourself.
- A facts read covers one day. For more days, send one read for each day.
- Amounts and USD values come back as text, such as `"5.23661492"`. Convert them before you add them.

```cypher
USE facts
MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"})-[t:TRANSFER]->(b:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})
WHERE t.block_date = "2026-07-10"
RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.asset_symbol AS asset_symbol,
       t.amount AS amount, t.amount_usd AS amount_usd, t.kind AS kind
LIMIT 50
```

One transaction hash needs no day. The server finds it:

```cypher
USE facts
MATCH (a:Address)-[t:TRANSFER]->(b:Address)
WHERE t.tx_id = "0x044587122970de1e3c377a8ed7ab56a49c777a2b7441a2f5d9ca32dbab9fbe71"
RETURN a.address AS from_address, b.address AS to_address, t.amount AS amount, t.kind AS kind
LIMIT 50
```

## Chain: one key, one node

`USE chain` asks the chain node for one known thing: `Transaction` by `hash`,
`Block` by `height` or `hash`, or `Head`. One node, literal keys in braces, a
`RETURN` of `var.property` items, no `WHERE`, no range. Read its limits in
`chain_admission` (`cia network robinhood --json`).

```cypher
USE chain
MATCH (t:Transaction {hash: "0x044587122970de1e3c377a8ed7ab56a49c777a2b7441a2f5d9ca32dbab9fbe71"})
RETURN t.status, t.block_height, t.block_date
```

```cypher
USE chain
MATCH (b:Block {height: 79841521})
RETURN b.hash, b.block_date
```

```cypher
USE chain
MATCH (h:Head)
RETURN h.height, h.age_seconds, h.warehouse_blocks_behind, h.graph_blocks_behind
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

A graph also reads these optional columns: `amount_usd_sum`, `tx_count`,
`first_seen_timestamp`, `last_seen_timestamp`, `link_kind`, `from_labels` and
`to_labels`. In `graph_query_batch`, each query draws its own tab. Claude Code
draws nothing and shows the rows as text.

A graph, the newest receivers of one address. Flip the arrow for its senders:

```cypher
USE topology
MATCH (a:Address {address: "0x04911a118f11c75667e4d0dfb8e640af5a353550"})-[f:FLOWS_TO]->(b:Address)
WHERE NOT a:Pool
RETURN a.address AS from_address, b.address AS to_address,
       f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count,
       f.last_seen_timestamp AS last_seen_timestamp
ORDER BY f.last_seen_timestamp DESC
LIMIT 25
```

A chart is the facts read of one pair over one day above, with `block_timestamp`
and `amount_usd` in the `RETURN`.
