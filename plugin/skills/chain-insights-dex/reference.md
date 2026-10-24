# Exchange queries (Robinhood Chain)

The first step for a named exchange is the `meta_dex_lookup` tool: it
returns the exchange's addresses and fills these reads in. Change only the
values: an address from the tool, from the memo in [SKILL.md](SKILL.md) or
from a row you read, a day, a block. Every address stays in full. Send related reads in one `graph_query_batch`.

## R3. Pools of an exchange, by one factory

One batch member per factory of the row, each with its own `id`. Merge the
members into one ranking by `total_volume_usd`.

```cypher
USE topology
MATCH (f:Address {address: "0xc63d7338c178e805c544b8f897066bd3bbcbe136"})-[:DEPLOYED_CONTRACT]->(p:Pool) WHERE p.total_volume_usd IS NOT NULL
RETURN f.address AS from_address, p.address AS to_address, p.labels AS to_labels, p.total_volume_usd AS total_volume_usd, p.tx_total_count AS tx_total_count ORDER BY p.total_volume_usd DESC LIMIT 10
```

up. has two factories: two members of one batch.

```json
{"network": "robinhood", "queries": [
  {"id": "up-1", "query": "<R3 with 0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3>"},
  {"id": "up-2", "query": "<R3 with 0xfa5429aeba338bea2bfcc1b9a889862ee395bc28>"}
]}
```

## R4. Sellers into one pool

The senders of the pool, ranked by lifetime volume. A pool never sends on
this read: the pool trace rule leaves a pool only on `REMOVED_LIQUIDITY`.

```cypher
USE topology
MATCH (s:Address)-[f:FLOWS_TO]->(p:Address {address: "0x7615926023bb149f36095645c2a81dc367d39750"}) WHERE NOT s:Pool
RETURN s.address AS from_address, p.address AS to_address, labels(s) AS from_node_labels, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, s.labels AS from_labels, p.labels AS to_labels, s.is_exchange AS from_is_exchange, p.is_exchange AS to_is_exchange ORDER BY f.amount_usd_sum DESC LIMIT 25
```

## R5. Who a seller's swaps paid

Anchored on the seller. Keep the rows whose `pools` hold the pool you
started from: filter them yourself, never in the query.

```cypher
USE topology
MATCH (s:Address {address: "0x4b9364c8553c519a419b259f022865071fd7bfdf"})-[sw:SWAPPED]->(r:Address)
RETURN s.address AS from_address, r.address AS to_address, labels(r) AS to_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ORDER BY sw.swap_count DESC LIMIT 25
```

## R6. The swaps of a seller and a recipient on one day

```cypher
USE facts
MATCH (s:Address {address: "0x4b9364c8553c519a419b259f022865071fd7bfdf"})-[x:SWAP]->(r:Address {address: "0x72e46c9edf828002fdbfdd0952419790576c0f18"}) WHERE x.block_date = "2026-10-22"
RETURN x.tx_id AS tx_id, x.block_timestamp AS block_timestamp, x.payer AS payer, x.recipient AS recipient, x.sold_asset_symbol AS sold_asset_symbol, x.sold_usd AS sold_usd, x.bought_asset_symbol AS bought_asset_symbol, x.bought_usd AS bought_usd LIMIT 50
```

## R7. The day of a block

A `SWAPPED` link carries heights, not times. Read the block of
`last_seen_height` for its day.

```cypher
USE chain
MATCH (b:Block {block_height: 95254047}) RETURN b.block_date, b.block_timestamp
```
