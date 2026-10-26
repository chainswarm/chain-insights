---
name: chain-insights-dex-launchpad
door: meta_dex_lookup
description: Use for the dex-launchpad trail - token launchpads with a bonding curve on robinhood other than Virtuals, such as Penguin, the SPCX launchpad and the unnamed bonding-curve launchpad, and the unnamed v4 launch factories that create a token and open its Uniswap v4 pool in one transaction - when a question asks who launched a token there or through a factory address, who bought or sold on its curve, whether and when it graduated, or which pool it moved to. Loaded by chain-insights-dex for a launchpad row of its memo. Virtuals questions belong to chain-insights-virtuals.
---

# Chain Insights: the launchpad trail (Penguin, SPCX, bonding curves)

Load `chain-insights-cypher` first. The first step for a launchpad named
with no address is `meta_dex_lookup` (Penguin, SPCX, pons, Flap): it returns the
launchpad's factory and its first reads. With no such tool, the memo of
`chain-insights-dex` names the factory. A contract address that no row
holds may be a v4 launch factory: see "A v4 launch factory" below. Their
answer rules hold here:
every address in full, tokens worth an amount in USD, no query text in the
answer, times from the `_utc` twins.

**Virtuals is not this skill.** A question that names Virtuals, VIRTUAL or a
Virtuals agent loads `chain-insights-virtuals`, which holds its own model.
Use nothing from here for it.

A launchpad token lives in two stages:

```
 creator ── one transaction ──▶ factory ──DEPLOYED_CONTRACT──▶ launched token
                                                               │ curve stage:
                                         buyers ◀──────────────┤ bought and sold
                                                               │ against the curve
                                                               ▼ graduation
                                                         first pool on an exchange
```

| Launchpad | Factory | What the factory deploys |
|---|---|---|
| Penguin | `0x09f1b640d53c9c4c1807bf5aa306745128ee4375` | the launched token, which is also its own curve |
| SPCX launchpad | `0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091` | the launched token and its curve, a contract of its own, quoted in SPCX or another stock token |
| unnamed launchpad | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | a launch contract; its name is not proven yet |

Call the second one "an unnamed bonding-curve launchpad". Never give it a
name you have not read.

## Who launched it

1. **The launches** (L1): the factory's `DEPLOYED_CONTRACT` links, newest
   first. The creator is `tx_origin` on the link, the sender of the creation
   transaction. `deployer_address` is the factory: never call it the
   creator.
2. A Penguin token carries `penguin-launchpad` in its `labels`, and
   `CurveLaunch` while it trades on the curve.

## The curve stage

3. **Who bought and sold on the curve** (L2): the launched contract's own
   `FLOWED_TO` links, both directions, ranked by transactions. Money in is a
   buy, money out is a payout. On Penguin the token contract is the curve,
   so these are its traders. On the SPCX launchpad the curve is a contract
   of its own and a `:Pool`: its traders are the `SWAPPED` links into the
   curve, and the token's own links are not the curve stage.
4. A fresh token has no price: its `amount_usd` can be empty. Value a buy by
   what was paid for it, and say when no price exists.

## Graduation and the first pool

5. **The first pool** (L3): the launched contract's `ADDED_LIQUIDITY` links
   into a `:Pool`, oldest first. The first one is the graduation: the curve's
   money moved into an exchange pool.
6. When L3 is empty, say the graduation is not in the graph yet. Never guess
   a pool from the token's name.
7. After graduation the token trades on that pool. Load `chain-insights-dex`
   for the pool's exchange and its trail.

## A v4 launch factory

Some launchpads have no name and no registry row, on purpose. The DEX
indexer finds them by their shape, with one rule for every operator:
`v4-launch-factory-v1`.

```
 creator ── one transaction ──▶ factory F ──DEPLOYED_CONTRACT──▶ token
                                    │
                                    └──▶ Uniswap v4 pool manager opens a pool
                                         of that token: its first pool, a pool id
```

- **The shape.** In one transaction a contract F creates a token, and the
  Uniswap v4 pool manager `0x8366a39cc670b4001a1121b8f6a443a643e40951`
  opens a pool holding that token. F is a launch factory.
- **A launchpad needs two launches.** F is a launchpad when it repeats the
  shape: two tokens or more. A contract with one launch is a one-off: say
  "a contract that launched one token", never a launchpad.
- **No name, no row.** `meta_dex_lookup` with F's address answers
  `matched: null`. For F that means "no exchange row", not "no data": read
  the graph below. Never give F a name you have not read.
- **What the graph holds today.** The launches are rows of the rule
  `v4-launch-factory-v1` in the warehouse. The graph does not mark F yet:
  no `:Launchpad`, no `:Pool`, no rule name in its `labels`. The
  `:Launchpad` mark for a factory of two launches or more is coming in the
  graph's pools layer. Until a read of F shows it, do not ask by mark for
  F: read the shape from its links.

1. **The launches**: L1, anchored on F. Each `DEPLOYED_CONTRACT` link is a
   contract F created. Count the tokens to say whether F is a launchpad.
2. **Who launched a token**: `tx_origin` on the link, the sender of the
   launch transaction. F is the factory, never the creator. A launch sent
   through a bundler of contract wallets names the bundler, not the user:
   say so when the same `tx_origin` sends many unrelated launches.
3. **The first pool** (L4): the token's Uniswap v4 pool, kept inside the
   pool manager by a 32-byte pool id. It is not a contract of its own: say
   "a pool of the Uniswap v4 pool manager". Read the id from `pools` on a
   `SWAPPED` link that sold or bought the token, anchored on the creator.
   When no such link shows, say the graph does not serve that pool id yet.
   The creator and the launch transaction still answer who launched it.
4. **The trades** are ordinary Uniswap v4 swaps on the pool manager. Load
   `chain-insights-dex-vault` and follow its trail. The pool manager is
   never the buyer, and no topology hop goes out of it.

## The next lead

End with who to trace next: the creator's first funders (the newest-links
read of `chain-insights-cypher`, arrow flipped, sorted by
`first_seen_timestamp`), or the biggest early buyer's onward flows.

## Queries

### L1. Launches of one launchpad, newest first

```cypher
USE topology
MATCH (f:Address {address: "0x09f1b640d53c9c4c1807bf5aa306745128ee4375"})-[d:DEPLOYED_CONTRACT]->(t:Address)
RETURN f.address AS from_address, t.address AS to_address, labels(t) AS to_node_labels, t.labels AS to_labels, d.tx_origin AS creator, d.tx_id AS tx_id, d.block_height AS block_height, d.block_timestamp AS created_timestamp ORDER BY d.block_height DESC LIMIT 25
```

### L2. Traders on the curve of one launched token

```cypher
USE topology
MATCH (t:Address {address: "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac"})-[f:FLOWED_TO]-(b:Address) WHERE NOT t:Pool
RETURN startNode(f).address AS from_address, endNode(f).address AS to_address, labels(b) AS node_labels, f.tx_count AS tx_count, f.amount_usd_sum AS amount_usd_sum, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp ORDER BY f.tx_count DESC LIMIT 25
```

### L3. The first pool of one launched token

```cypher
USE topology
MATCH (t:Address {address: "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac"})-[l:ADDED_LIQUIDITY]->(p:Pool)
RETURN t.address AS from_address, p.address AS to_address, p.labels AS to_labels, l.asset AS asset, l.usd AS usd, l.first_seen_height AS first_seen_height ORDER BY l.first_seen_height ASC LIMIT 5
```

### L4. The first pool of a v4 launch, from the creator's swaps

```cypher
USE topology
MATCH (c:Address {address: "0x705da6eb557a987960294597954d75e9be2a1983"})-[sw:SWAPPED]->(m:Address {address: "0x8366a39cc670b4001a1121b8f6a443a643e40951"}) WHERE sw.sold_asset = "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac" OR sw.bought_asset = "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac"
RETURN c.address AS from_address, m.address AS to_address, sw.sold_asset AS sold_asset, sw.bought_asset AS bought_asset, sw.sold_usd AS sold_usd, sw.bought_usd AS bought_usd, sw.swap_count AS swap_count, sw.pools AS pools, sw.last_seen_height AS last_seen_height ORDER BY sw.last_seen_height ASC LIMIT 25
```
