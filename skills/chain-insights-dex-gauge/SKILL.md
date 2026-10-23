---
name: chain-insights-dex-gauge
description: Use for the dex-gauge trail - exchanges whose swaps go through a router and whose liquidity is staked in gauges, such as Aero (Aerodrome, Velodrome), up., Raphael and Topaz on robinhood - when a question asks who sold into a pool of one of them, who bought, who provides liquidity or took the most out, or who to trace next past the router. Loaded by chain-insights-dex for a gauge row of its memo.
---

# Chain Insights: the gauge trail (Aero, up., Raphael, Topaz)

Load `chain-insights-cypher` first, then `chain-insights-dex` for the memo:
the brand's factories, its router and its pools come from there. Their answer
rules hold here: every address in full, tokens worth an amount in USD, no
query text in the answer, times from the `_utc` twins.

On a gauge exchange a swap usually goes through the exchange's **router**.
The pool pays the router, and the router pays on in the same transaction:

```
 seller ──FLOWS_TO──▶ pool ──▶ router ──▶ buyer
                       │
                       └── SWAPPED from the seller names the router
```

So the `SWAPPED` recipient of a seller is often the router. **The router is
not the buyer.** Name it "the Aero router", in full, and read the buyer from
the router's own transfer in the seller's transaction.

## Sellers and the buyer, in order

1. **The pool.** Take it from `chain-insights-dex` (pools by brand, then by
   memo factory). The busiest Aero pool is
   `0x7615926023bb149f36095645c2a81dc367d39750`.
2. **Sellers into the pool** (G1): its senders on `FLOWS_TO`, ranked by
   lifetime volume. Most of the biggest are contracts: aggregators,
   routers and liquidity managers. Say "a contract", never "a trader". A
   sender that also adds liquidity to the pool (G6) pays its deposits on
   this link: it is a liquidity provider, not a seller. On the busiest Aero
   pool the two biggest senders,
   `0x2192bc3b4028acc1113f2cd9ac2cba70c36520db` and
   `0xc2eedf3bc7f93366c00c6074df0e6f122fa2445c`, are liquidity managers.
3. **The seller's swaps** (G2): its `SWAPPED` links. Keep the rows whose
   `pools` hold the pool; filter them yourself. Note the recipient and the
   `last_seen_height`.
4. **The recipient is an account** that is not the seller: that is the buyer.
   Stop here. **The recipient is the memo's router**: go on.
5. **The day** (G3): the block of `last_seen_height` on `USE chain` gives its
   `block_date`.
6. **The seller's swap on that day** (G4): the facts `SWAP` rows of the
   seller and the router on that day give each swap's `tx_id` and its sold
   and bought assets.
7. **The buyer** (G5): the router's facts `TRANSFER` rows of that day with
   that `tx_id`. The receiver of the bought asset is the buyer. A receiver
   that is a pool or a pool manager, of another asset, is the next leg of the
   route, not the buyer. When no row carries the bought asset, say the
   router's payout is not in the transfers read, name the router as router,
   and stop: never guess the buyer.

## Liquidity providers, and the gauge

- **Who provided** (G6): the `ADDED_LIQUIDITY` links into the pool, one per
  party and asset. Sum `usd` per party yourself.
- **Who took the most out** (G7): the `REMOVED_LIQUIDITY` links out of the
  pool, summed per receiver, with what the same receiver added.
- **The gauge.** On these exchanges a provider can stake its position in the
  exchange's gauge to earn rewards. The party on a link can then be a
  contract (the position manager or the gauge), not the person. Say so, name
  the contract in full, and never call it the provider. The person is the
  sender of that transaction, read on `USE chain` by its `tx_id`.

## The next lead

End every answer with who to trace next, in one short paragraph:

- the buyer's biggest receivers, the newest-links read of
  `chain-insights-cypher` anchored on the buyer, sorted by `amount_usd_sum`;
- for a seller that is a contract, the accounts that paid it: the same read
  with the arrow flipped.

Never walk out of the router or the pool on `FLOWS_TO`: the router has
thousands of receivers, and the buyer is noise there.

## Queries

### G1. Sellers into the pool

```cypher
USE topology
MATCH (s:Address)-[f:FLOWS_TO]->(p:Address {address: "0x7615926023bb149f36095645c2a81dc367d39750"}) WHERE NOT s:Pool
RETURN s.address AS from_address, p.address AS to_address, labels(s) AS from_node_labels, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp, s.labels AS from_labels, p.labels AS to_labels, s.is_exchange AS from_is_exchange, p.is_exchange AS to_is_exchange ORDER BY f.amount_usd_sum DESC LIMIT 25
```

### G2. One seller's swaps

```cypher
USE topology
MATCH (s:Address {address: "0x4b9364c8553c519a419b259f022865071fd7bfdf"})-[sw:SWAPPED]->(r:Address)
RETURN s.address AS from_address, r.address AS to_address, labels(r) AS to_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ORDER BY sw.swap_count DESC LIMIT 25
```

### G3. The day of the swap

```cypher
USE chain
MATCH (b:Block {block_height: 95254047}) RETURN b.block_date, b.block_timestamp
```

### G4. The seller's swaps through the router on that day

```cypher
USE facts
MATCH (s:Address {address: "0x4b9364c8553c519a419b259f022865071fd7bfdf"})-[x:SWAP]->(r:Address {address: "0x72e46c9edf828002fdbfdd0952419790576c0f18"}) WHERE x.block_date = "2026-10-22"
RETURN x.tx_id AS tx_id, x.block_timestamp AS block_timestamp, x.sold_asset_symbol AS sold_asset_symbol, x.sold_usd AS sold_usd, x.bought_asset_symbol AS bought_asset_symbol, x.bought_usd AS bought_usd LIMIT 50
```

### G5. The router's transfers in that transaction

```cypher
USE facts
MATCH (r:Address {address: "0x72e46c9edf828002fdbfdd0952419790576c0f18"})-[t:TRANSFER]->(b:Address)
WHERE t.block_date = "2026-10-22" AND t.tx_id = "0xe8757773043832b6602baf86a42e14577205a25ac1fe1a07c48c717f2ff15d56"
RETURN r.address AS from_address, b.address AS to_address, t.amount_usd AS amount_usd, t.asset_symbol AS asset_symbol, t.kind AS kind, t.tx_id AS tx_id LIMIT 10
```

### G6. Who added liquidity to the pool

```cypher
USE topology
MATCH (a:Address)-[l:ADDED_LIQUIDITY]->(p:Address {address: "0x7615926023bb149f36095645c2a81dc367d39750"})
RETURN a.address AS from_address, p.address AS to_address, labels(a) AS from_node_labels, l.asset AS asset, l.usd AS usd, l.event_count AS event_count, l.first_seen_height AS first_seen_height, l.last_seen_height AS last_seen_height ORDER BY l.usd DESC LIMIT 25
```

### G7. Who took the most out of the pool

```cypher
USE topology
MATCH (p:Address {address: "0x7615926023bb149f36095645c2a81dc367d39750"})-[r:REMOVED_LIQUIDITY]->(b:Address)
RETURN p.address AS from_address, b.address AS to_address, sum(r.usd) AS removed_usd, max(r.receiver_added_usd) AS receiver_added_usd ORDER BY removed_usd DESC LIMIT 25
```
