---
name: chain-insights-dex-launchpad
description: Use for the dex-launchpad trail - token launchpads with a bonding curve on robinhood other than Virtuals, such as Penguin and the unnamed bonding-curve launchpad - when a question asks who launched a token there, who bought or sold on its curve, whether and when it graduated, or which pool it moved to. Loaded by chain-insights-dex for a launchpad row of its memo. Virtuals questions belong to chain-insights-virtuals.
---

# Chain Insights: the launchpad trail (Penguin, bonding curves)

Load `chain-insights-cypher` first, then `chain-insights-dex` for the memo:
the launchpad's factory comes from there. Their answer rules hold here:
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
   `FLOWS_TO` links, both directions, ranked by transactions. Money in is a
   buy, money out is a payout. On Penguin the token contract is the curve,
   so these are its traders.
4. A fresh token has no price: its `amount_usd` can be empty. Value a buy by
   what was paid for it, and say when no price exists.

## Graduation and the first pool

5. **The first pool** (L3): the launched contract's `ADDED_LIQUIDITY` links
   into a `:Pool`, oldest first. The first one is the graduation: the curve's
   money moved into an exchange pool.
6. When L3 is empty, say the graduation is not in the graph yet. Never guess
   a pool from the token's name.
7. After graduation the token trades on that pool. Load `chain-insights-dex`
   for the pool's brand and its trail.

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
MATCH (t:Address {address: "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac"})-[f:FLOWS_TO]-(b:Address) WHERE NOT t:Pool
RETURN startNode(f).address AS from_address, endNode(f).address AS to_address, labels(b) AS node_labels, f.tx_count AS tx_count, f.amount_usd_sum AS amount_usd_sum, f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp ORDER BY f.tx_count DESC LIMIT 25
```

### L3. The first pool of one launched token

```cypher
USE topology
MATCH (t:Address {address: "0xf3b01a81dc8a4216d92e74b40113e9e1b10a4dac"})-[l:ADDED_LIQUIDITY]->(p:Pool)
RETURN t.address AS from_address, p.address AS to_address, p.labels AS to_labels, l.asset AS asset, l.usd AS usd, l.first_seen_height AS first_seen_height ORDER BY l.first_seen_height ASC LIMIT 5
```
