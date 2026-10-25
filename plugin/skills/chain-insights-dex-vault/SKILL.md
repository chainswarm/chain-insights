---
name: chain-insights-dex-vault
door: meta_dex_lookup
description: Use for the dex-vault trail - exchanges where one pool manager contract holds every pool, such as Uniswap v4, Balancer v2, Balancer v3, PancakeSwap Infinity and Ekubo on robinhood - when a seller's swap names the pool manager or vault, when a question asks who bought past the manager, or which pools such an exchange has. Loaded by chain-insights-dex for a vault row of its memo.
---

# Chain Insights: the vault trail (Uniswap v4, Balancer, PancakeSwap Infinity, Ekubo)

Load `chain-insights-cypher` first, then `chain-insights-dex`: the
exchange's manager comes from `meta_dex_lookup`, or from the memo there when
the host offers no such tool. Their answer rules hold here: every
address in full, tokens worth an amount in USD, no query text in the answer,
times from the `_utc` twins.

On a vault exchange one contract, the **pool manager** (Balancer calls it
the vault, Ekubo the core), holds the tokens of every pool. A swap pays the
manager and the manager pays out:

```
 seller ──SWAPPED──▶ pool manager ──▶ buyer
                     settles every pool
```

So a seller's `SWAPPED` recipient is the manager. **The manager is not the
buyer.** Name it for what it is, in full: "the Uniswap v4 pool manager
`0x8366a39cc670b4001a1121b8f6a443a643e40951`", "the Balancer v2 vault
`0xd315a9c38ec871068fec378e4ce78af528c76293`".

| Exchange | Manager |
|---|---|
| Uniswap v4 | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Balancer v2 | `0xd315a9c38ec871068fec378e4ce78af528c76293` |
| Balancer v3 | `0x28082618ba2073e602230188e4f4c46e9b2169eb` |
| PancakeSwap Infinity | `0xd01c774d4a66408326bc65728ac5ae5aaf004032` |
| Ekubo | `0x00000000000014aa86c5d3c41765bb24e11bd701` |

## The buyer past the manager

1. **The seller's swaps** (V1): its `SWAPPED` links. A row whose recipient is
   the manager is a vault swap. Note its `last_seen_height`.
2. **The day** (V2): the block of that height on `USE chain`.
3. **The facts `SWAP` row** (V3) of the seller and the manager on that day.
   Its `recipient` names who received the bought asset:
   - a `recipient` that is not the manager is the buyer;
   - a `recipient` equal to the manager means the manager paid the seller
     back: the seller is the buyer of its own swap. Say "the seller swapped
     for itself".
4. Name the sold and bought assets by their contracts in full, with "tokens
   worth about N USD on DAY".

**Never take a topology hop out of the manager.** The Uniswap v4 pool
manager links to about 480,000 receivers. A read of its receivers, a walk
through it, or a ranking of where its money went times out or names noise.
The walk guard of `chain-insights-cypher` keeps `:Protocol` contracts out of
every walk for this reason.

## The pools of a vault exchange

A manager deploys no pool, so there is no factory to anchor on. Its pools are
the `pools` of the swaps it settles:

1. **The swaps into the manager** (V4): one hop in, anchored on the manager,
   ranked by what was sold. Collect the `pools` of the rows: those are the
   exchange's busiest pools among these swaps.
2. **The events of one pool**: take one seller from V4 and read its facts
   `SWAP` rows with the manager on one day (V3).
3. A pool id here may name the pool, not a contract of its own. Say "a pool
   of the Uniswap v4 pool manager", never "a pool contract". Ekubo keeps
   every pool by a 32-byte pool id the same way.
4. On Ekubo, every position is opened through the positions NFT
   `0xda38ac72ce7220c4dd7719d114ef94edadb8f068` (Ekubo Ve33 Positions). It is
   shared infrastructure, never a liquidity provider: the provider is the
   holder of the position's NFT.

## The next lead

End with who to trace next: the buyer's biggest receivers, the newest-links
read of `chain-insights-cypher` anchored on the buyer. When the buyer is the
seller itself, trace the seller's onward flows instead.

## Queries

### V1. One seller's swaps

```cypher
USE topology
MATCH (s:Address {address: "0x705da6eb557a987960294597954d75e9be2a1983"})-[sw:SWAPPED]->(r:Address)
RETURN s.address AS from_address, r.address AS to_address, labels(r) AS to_node_labels, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ORDER BY sw.swap_count DESC LIMIT 25
```

### V2. The day of the swap

```cypher
USE chain
MATCH (b:Block {block_height: 95508039}) RETURN b.block_date, b.block_timestamp
```

### V3. The facts SWAP row past the manager

```cypher
USE facts
MATCH (s:Address {address: "0x705da6eb557a987960294597954d75e9be2a1983"})-[x:SWAP]->(m:Address {address: "0x8366a39cc670b4001a1121b8f6a443a643e40951"}) WHERE x.block_date = "2026-10-22"
RETURN s.address AS from_address, m.address AS to_address, x.payer AS payer, x.recipient AS recipient, x.sold_asset AS sold_asset, x.sold_usd AS sold_usd, x.bought_asset AS bought_asset, x.bought_usd AS bought_usd, x.tx_id AS tx_id, x.block_timestamp AS block_timestamp LIMIT 50
```

### V4. The swaps the manager settles, and their pools

```cypher
USE topology
MATCH (s:Address)-[sw:SWAPPED]->(m:Address {address: "0x8366a39cc670b4001a1121b8f6a443a643e40951"})
RETURN s.address AS from_address, m.address AS to_address, sw.sold_usd AS sold_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ORDER BY sw.sold_usd DESC LIMIT 25
```
