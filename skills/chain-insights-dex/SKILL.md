---
name: chain-insights-dex
description: Use when a question names a decentralized exchange by name with no address — Aero, Aerodrome, Velodrome, up., Raphael, Topaz, Uniswap, Balancer, PancakeSwap, Trader Joe, Curve, Metric, Penguin — or asks who trades on, sold into, bought from or provides liquidity on an exchange or a DEX, which pools an exchange has, or how to trace money through a swap.
---

# Chain Insights: exchanges by name

Load `chain-insights-cypher` first. Its answer rules hold here, and these
four hold even when it cannot load:

- Write every address in full, 42 characters, every time. Never shorten
  one with `…` or `...`, not even for a repeat mention.
- A transfer moves tokens: "tokens worth about N USD", never "sent N USD".
  Write USD after the number, never a dollar sign.
- Never print the query, its `USE` line or its `LIMIT` in the answer. Write
  a time from its `_utc` twin.
- No drawn graph in text.

This skill turns an exchange's name into the addresses a query needs, finds
the exchange's pools, and follows the plain trail. Three trail-type skills
add the step past the contract a swap names:

| Trail | The contract past the swap | Load |
|---|---|---|
| plain | none: the swap's recipient is the buyer | this skill |
| gauge | a router | `chain-insights-dex-gauge` |
| vault | one pool manager that holds every pool | `chain-insights-dex-vault` |
| launchpad | a bonding curve, then its first pool | `chain-insights-dex-launchpad`, or `chain-insights-virtuals` for Virtuals |

The queries are in [reference.md](reference.md).

## The memo

The memo below is rendered from the brand registry. Every address in it is
in full. Never edit it by hand.

<!-- brands:start -->
Memo of the brand registry, version 0, robinhood, recorded 2026-10-23.

| Brand | Key | Also written | Trail | Factories, or the manager | Router | Note |
|---|---|---|---|---|---|---|
| Aero | `aero` | Aero, Aerodrome, Velodrome, Aerodrome Finance | gauge | `0xc63d7338c178e805c544b8f897066bd3bbcbe136` | `0x72e46c9edf828002fdbfdd0952419790576c0f18` |  |
| up. | `up` | up., up, up finance | gauge | `0xfa5429aeba338bea2bfcc1b9a889862ee395bc28` | none proven yet | no router proven yet: the SWAPPED recipient decides the step |
| Uniswap v4 | `uniswap-v4` | Uniswap, Uniswap v4, Uni v4 | vault | manager `0x8366a39cc670b4001a1121b8f6a443a643e40951` | the manager |  |
| Balancer v2 | `balancer-v2` | Balancer v2 | vault | manager `0xd315a9c38ec871068fec378e4ce78af528c76293` | the manager |  |
| Balancer v3 | `balancer-v3` | Balancer v3 | vault | manager `0x28082618ba2073e602230188e4f4c46e9b2169eb` | the manager |  |
| PancakeSwap | `pancakeswap` | PancakeSwap, Pancake, PancakeSwap Infinity | vault | manager `0xd01c774d4a66408326bc65728ac5ae5aaf004032` | the manager |  |
| Metric | `metric` | Metric | plain | `0x2e0a99a2e352043d1ca489cf45bf7b511bccc738` | none |  |
| Curve | `curve` | Curve, Curve Finance | plain | `0x8271e06e5887fe5ba05234f5315c19f3ec90e8ad` | none |  |
| Trader Joe | `trader-joe` | Trader Joe, Joe, LFJ | plain | `0xdcd5f77697914e27f56fd263ef82923c8524abac`, `0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d`, `0x22602d966defd638ee94e97a92e2eb0934c3fe1b` | none |  |
| Penguin | `penguin` | Penguin, Penguin launchpad | launchpad | `0x09f1b640d53c9c4c1807bf5aa306745128ee4375` | none |  |
| unnamed launchpad | `bonding-curve` | bonding curve launchpad | launchpad | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | none |  |
| Virtuals Protocol | `virtuals` | Virtuals, VIRTUAL, Virtuals Protocol | launchpad | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`, `0xfc2e4da3edb2e18100473339c763705d263d20a9` | none |  |
| Uniswap v3 | `uniswap-v3` | Uniswap v3, Uni v3 | plain | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865`, `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | none |  |
| Uniswap v2 | `uniswap-v2` | Uniswap v2, Uni v2 | plain | none proven yet | none | no non-Virtuals v2 factory proven yet |
<!-- brands:end -->

## Name the exchange: memo, then the graph, never the user

The user names an exchange and no address. Every address the question needs
is in the memo or in the graph. **Never ask the user for a pool, factory or
router address.**

1. **The memo.** Match the name against the key and the "Also written"
   column, ignoring case, spaces and a trailing dot. Take a typo or a short
   form that is one or two letters away from one entry ("areo",
   "Aerodome", "uni v4", "pancake"), and say which you took in one line:
   "I took Aero for areo." Then go on; ask nothing.
2. **The graph's brand list**, when the memo has no match, or when the memo's
   read gives zero rows. Read the brands the graph serves (reference R2) and
   match the name against that list the same way. Say which brand you took.
   When the memo's factory gave zero pools and the graph's brand gave pools,
   answer from the graph and say the memo was behind.
3. **Not covered.** When neither holds the name, say so in one line and list
   the covered brands by name: "Kyber is not covered yet. Covered: Aero, up.,
   Uniswap v4, …". Send no whole-chain search for it.

Rules for the match:

- A name with no version takes every row it fits. "Balancer" is Balancer v2
  and Balancer v3: read both in one batch and say so. "Uniswap" is the
  Uniswap v4 row; say that Uniswap v3 and v2 are separate rows.
- Never guess a brand from a token name, a pool name or a symbol.
- An adapter mark in a pool's `labels`, such as `cl-gauge-v1`, is the
  indexer's reading of a pool family, never a brand: two brands can share
  one. Never find a brand's pools by searching the whole chain for a mark.
- Virtuals is a launchpad row of the memo. A question that names Virtuals,
  VIRTUAL or a Virtuals agent loads `chain-insights-virtuals`, and this skill
  adds nothing.

## Find the pools of a brand

Send one `graph_query_batch`, in this order of trust:

1. **By brand** (reference R1): the `:Pool` nodes that carry the brand,
   ranked by lifetime volume. A lane that serves `brand` answers this in
   under a second.
2. **By memo factory** (reference R3), when the brand read gives zero rows:
   one batch member per factory of the row, each anchored on its factory.
   Merge the members into one ranking by volume. A brand with three
   factories is three members of one batch, never three turns.
3. **By manager** for a vault row: a pool manager deploys nothing. Load
   `chain-insights-dex-vault`, which reads the pools from the swaps the
   manager settles.

A pool with no volume yet has no `total_volume_usd` and is left out of the
ranking. Name each pool in full with its lifetime volume: "tokens worth about
228,559,848 USD over its life". A pool's `labels` carry the adapter mark; say
"an Aero pool", never the mark.

## The plain trail

For a `plain` row (Metric, Curve, Trader Joe, Uniswap v3), a swap pays the
pool and the pool pays the buyer:

```
 seller ──FLOWS_TO──▶ pool        seller ──SWAPPED──▶ buyer
```

1. **Sellers into the pool** (reference R4): the senders of the pool on
   `FLOWS_TO`, ranked by lifetime volume. A seller that is a contract is
   often an aggregator or a router: say "a contract", never "a trader". A
   sender that also adds liquidity to the pool pays its deposits on this
   link: it is a liquidity provider, not a seller.
2. **Who bought** (reference R5): the seller's `SWAPPED` links. Keep the
   links whose `pools` hold the pool. The recipient is the buyer: an account
   that is not the seller is someone the seller paid through the swap. When
   it is an account, send no second read.
3. **When the recipient is a contract**, look it up in the memo. A router of
   a gauge row loads `chain-insights-dex-gauge`. A pool manager of a vault
   row loads `chain-insights-dex-vault`. Never call that contract the buyer.
4. **The events** behind a link (reference R6): the facts `SWAP` rows of the
   seller and the recipient on one day. The day comes from the link's
   `last_seen_height`, read as a block on `USE chain` (reference R7).

## How to answer

- Lead with the brand you took and its pools, then the sellers, the swap's
  recipient named for what it is (the buyer, the router, the pool manager),
  and the next lead.
- **The next lead.** End with who to trace next: the buyer's biggest
  receivers, or the seller's first funders. Both are the newest-links read of
  `chain-insights-cypher`, anchored on that one address.
- A pool's volume and a link's totals are lifetime totals. The money of one
  day is a facts read of a pair and that day.
- Zero rows on the memo path is not "no pools": go to the graph's brand list
  before you say anything is missing.
