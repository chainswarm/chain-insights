---
name: chain-insights-dex
door: meta_dex_lookup
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
the exchange's pools, and follows the plain trail. The first step is always
the `meta_dex_lookup` tool. Three trail-type skills
add the step past the contract a swap names:

| Trail | The contract past the swap | Load |
|---|---|---|
| plain | none: the swap's recipient is the buyer | this skill |
| gauge | a router | `chain-insights-dex-gauge` |
| vault | one pool manager that holds every pool | `chain-insights-dex-vault` |
| launchpad | a bonding curve, then its first pool | `chain-insights-dex-launchpad`, or `chain-insights-virtuals` for Virtuals |

The queries are in [reference.md](reference.md).

## Name the exchange: the tool, then the memo, never the user

The user names an exchange and no address. Every address the question needs
comes from `meta_dex_lookup` or from the memo below. **Never ask the user
for a pool, factory or router address.**

1. **`meta_dex_lookup`.** Call it first, with the network and the name as
   the user wrote it: `{"network": "robinhood", "name": "Aerodrome"}`. It
   reads the served exchange registry, takes a typo within two letters, and
   returns the exchange's key, its trail type, its factories, routers or
   pool manager, each confirmed on the graph, its biggest pools, the lag of
   each family and the first reads of its trail, every address in full.
   - `took_for` set: say which you took in one line, "I took Aero for
     areo." Then go on; ask nothing.
   - `candidates` set and `matched` null: the name fits several exchanges.
     "Balancer" is the Balancer v2 vault (Swaap v2) and the Balancer v3
     vault. Call the tool once for each key in the same turn, read both,
     and say so.
2. **The memo**, only when the host offers no `meta_dex_lookup` tool.
   Compare the name with the key and the "Also written" column after
   dropping case, spaces, dots, hyphens and underscores: "alan dale" is
   Alandale, "up." is up, "uni v4" is Uniswap v4. Take a typo that is one or
   two letters away from one entry ("areo", "Aerodome", "pancakswap"), and
   say which you took in one line.
3. **Not covered.** When the tool returns `matched` null with no
   candidates, or the memo has no match, say so in one line and list the
   covered exchanges by name: "Kyber is not covered yet. Covered: Aero, up.,
   Uniswap v4, …". **Send no query for the name.** The graph has no name
   search: a `p.name CONTAINS`, a `labels CONTAINS`, a scan of
   `:Launchpad`, `:Protocol` or `:Pool` by a word, and a count of `SWAPPED`
   families all walk the whole chain and are stopped at 10 s or refused.
   Twenty such reads cost the user four minutes and answer nothing.

Rules for the match:

- "Uniswap" is the Uniswap v4 row; say that Uniswap v3 and v2 are separate
  rows.
- Never guess an exchange from a token name, a pool name or a symbol.
- An adapter mark in a pool's `labels`, such as `cl-gauge-v1`, is the
  indexer's reading of a pool family, never an exchange: two exchanges can
  share one. Never find an exchange's pools by searching the whole chain for
  a mark.
- Virtuals is a launchpad row. A question that names Virtuals, VIRTUAL or a
  Virtuals agent loads `chain-insights-virtuals`, and this skill adds
  nothing.

## The memo

The memo below is rendered from the exchange registry, the same file
`meta_dex_lookup` reads. Every address in it is in full. Never edit it by
hand. When the tool and the memo differ, follow the tool: it reads the
newest file.

<!-- dex-registry:start -->
Memo of the exchange registry, version 3, robinhood, recorded 2026-10-25.

| Exchange | Key | Also written | Trail | Factories, or the manager | Router |
|---|---|---|---|---|---|
| Aero (Aerodrome and Velodrome, merged) | `aero` | Aero, Aerodrome, Velodrome, AERO, Aero Slipstream | gauge | `0xc63d7338c178e805c544b8f897066bd3bbcbe136` | `0x72e46c9edf828002fdbfdd0952419790576c0f18`, `0x0fef9e88a7b76bcdbf451780c6774fe32965ee98`, `0x9ee35bf1bd69a03c6f0393582030fce8bb93d418` |
| up. | `up` | up., up, UP, up33, UP33, up.finance | gauge | `0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3`, `0xfa5429aeba338bea2bfcc1b9a889862ee395bc28` | `0xc062b870e813fca720f1e002c234369ab3ab9415`, `0xf5198743240fac98db71868f34c70139b1eb0474` |
| Alandale | `alandale` | Alandale, LUTE, alandale.xyz | gauge | `0x2fadf533d9a098310007978730554f842547fc5f` | `0x8971d5a8f950f021e97583855925b021bfae2b35` |
| Raphael Exchange | `raphael` | Raphael, RAPH, Raphael Exchange, Raphael Finance | gauge | `0x5481864ddd46a2d798df0925c23b7846e776e5e3`, `0x1a6745f84099fa7e84d1f3b34c23482865194bd1` | `0x2f0e010edc989bb4dc3bfaf07750480bc16285d4` |
| Sheriff | `sheriff` | Sheriff, Sheriff Exchange, sheriff.exchange | gauge | `0x9ac30d72168a4498ae5c80226f4d3c86278e8f80` | `0xcb0615a1478838dea20e57447309be97f45dca0f` |
| Topaz DEX | `topaz` | Topaz, TOPAZ, Topaz DEX, topazdex.com | gauge | `0xaa5865dc3a60b25d305226d66fd573021f0d8ffb` | `0x2e7395a6e0de6ee1f390bece891069cd18ff8572` |
| Kittenswap | `kittenswap` | Kittenswap, KITTEN, KittenSwap | gauge | `0x45362763166cfed6174d312fa1449ea1fc37988a` | `0x7064c7bb85979f008212877c4ce41285ddf5374c` |
| Morpheus | `morpheus` | Morpheus, Morpheus Farm | gauge | `0xd7cb0e0692f2d55a17ba81c1fe5501d66774fc4a` | none proven yet |
| SwapHood | `swaphood` | SwapHood, SwapHood Finance, SWT, swaphood.finance | gauge | `0xe7206ecac3a51afe7e6179182ad4130a26068dd1` | `0x8f8056fec03159ebcc4aee1b8ea5a61d8fe405fc` |
| Uniswap v2 | `uniswap-v2` | Uniswap v2, Uni v2 | plain | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` | none |
| Uniswap v3 | `uniswap-v3` | Uniswap v3, Uni v3 | plain | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | none |
| Uniswap v4 | `uniswap-v4` | Uniswap, UNI, Uniswap v4, Uni v4, PoolManager | vault | manager `0x8366a39cc670b4001a1121b8f6a443a643e40951` | the manager |
| PancakeSwap Infinity | `pancakeswap` | PancakeSwap, Pancake, CAKE, PancakeSwap Infinity | vault | manager `0xee04c68742e6bf434be8039580d2e89bbe55bc6f` | the manager |
| PancakeSwap v2 | `pancakeswap-v2` | PancakeSwap v2, Pancake v2 | plain | `0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e` | none |
| PancakeSwap v3 | `pancakeswap-v3` | PancakeSwap v3, Pancake v3 | plain | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` | none |
| SushiSwap V4 | `sushiswap` | Sushi, SushiSwap, SUSHI, Sushi V4 | vault | manager `0x81d732702f87d2d652ae79e9f52bf44928eca210` | the manager |
| Orvex | `orvex` | Orvex, Orvex MetaDEX, orvex.fi, ORVX | vault | manager `0xd01c774d4a66408326bc65728ac5ae5aaf004032` | the manager |
| Swaap v2 | `swaap` | Swaap, Swaap Finance, swaap.xyz, Balancer, Balancer v2, Balancer v2 vault | vault | manager `0xd315a9c38ec871068fec378e4ce78af528c76293` | the manager |
| unnamed Balancer v3 vault | `balancer-v3` | Balancer, Balancer v3, Balancer v3 vault | vault | manager `0x28082618ba2073e602230188e4f4c46e9b2169eb` | the manager |
| Ekubo | `ekubo` | Ekubo, Ekubo Protocol, ekubo.org | vault | manager `0x00000000000014aa86c5d3c41765bb24e11bd701` | the manager |
| Ramses | `ramses` | Ramses, Ramses Exchange, RAM, ramses.xyz, Ramses DLMM | plain | `0xdcd5f77697914e27f56fd263ef82923c8524abac`, `0x43b2bf9f33036a02fc7a00935571c2a6b0108e66` | `0xd0019e86edb35e1fedaab03aed5c3c60f115d28b` |
| SectorOne | `sectorone` | SectorOne, SectorOne DLMM | plain | `0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d` | none |
| Hoodit | `hoodit` | Hoodit, hoodit.xyz | plain | `0x22602d966defd638ee94e97a92e2eb0934c3fe1b` | none |
| GIGA | `giga` | GIGA, GIGA DEX, GigaDEX, gigadex.fi | plain | `0x6fdf38f92ead1adfc04b73aaa947ab254f6c0916` | none |
| Flap | `flap` | Flap, Flap launchpad, flap.sh | launchpad | `0x0d1ebb179cdbca88d74c923c4255cb2b17474afd` | none |
| Curve | `curve` | Curve, Curve Finance, CRV, curve.finance | plain | `0x8271e06e5887fe5ba05234f5315c19f3ec90e8ad` | none |
| Metric | `metric` | Metric, Metric OMM, metric.xyz | plain | `0x2e0a99a2e352043d1ca489cf45bf7b511bccc738` | none |
| Penguin | `penguin` | Penguin, Penguin launchpad | launchpad | `0x09f1b640d53c9c4c1807bf5aa306745128ee4375` | none |
| SPCX launchpad | `spcx` | SPCX, SPCX launchpad, spcx launchpad | launchpad | `0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091` | `0x190b452d16e12e3beedd76a030ea991fe3856c33` |
| pons | `pons` | pons, pons launchpad | launchpad | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | none |
| Virtuals Protocol | `virtuals` | Virtuals, VIRTUAL, Virtuals Protocol | launchpad | `0xfc2e4da3edb2e18100473339c763705d263d20a9` | none |
<!-- dex-registry:end -->

## Find the pools of an exchange

`meta_dex_lookup` returns them: the pools its factories deployed, ranked by
lifetime volume. With no tool, send one `graph_query_batch`:

1. **By factory** (reference R3): one batch member per factory of the row,
   each anchored on its factory. Anchored reads are always admitted and
   answer in under 100 ms, however far behind a family is. Merge the
   members into one ranking by volume. An exchange with three factories is
   three members of one batch, never three turns.
2. **By manager** for a vault row: a pool manager deploys nothing. Load
   `chain-insights-dex-vault`, which reads the pools from the swaps the
   manager settles.

A pool with no volume yet has no `total_volume_usd` and is left out of the
ranking. Name each pool in full with its lifetime volume: "tokens worth about
228,559,848 USD over its life". A pool's `labels` carry the adapter mark; say
"an Aero pool", never the mark.

To say which exchange a pool belongs to, read its creator with one anchored
hop (`DEPLOYED_CONTRACT` into the pool) and find that factory in the list
`meta_dex_lookup` returns with no name, or in the memo.

## The plain trail

For a `plain` row (Metric, Curve, Trader Joe, Uniswap v3), a swap pays the
pool and the pool pays the buyer:

```
 seller ──FLOWS_TO──▶ pool        seller ──SWAPPED──▶ buyer
```

1. **Sellers into the pool** (reference R4): the senders of the pool on
   `FLOWS_TO`, ranked by lifetime volume. A seller that is a contract is
   often an aggregator or a router: say "a contract", never "a trader". A
   seller that carries `SelfTrader` is a self-trading contract, such as an
   arbitrage or market-making bot: say so, never "a trader". It trades for
   itself: its swaps are on its self link, and there is no buyer to name. A
   sender that also adds liquidity to the pool pays its deposits on this
   link: it is a liquidity provider, not a seller.
2. **Who bought** (reference R5): the seller's `SWAPPED` links. Keep the
   links whose `pools` hold the pool. The recipient is the buyer: an account
   that is not the seller is someone the seller paid through the swap. When
   it is an account, send no second read.
3. **When the recipient is a contract**, look it up in the
   `meta_dex_lookup` result or the memo. A router of
   a gauge row loads `chain-insights-dex-gauge`. A pool manager of a vault
   row loads `chain-insights-dex-vault`. Never call that contract the buyer.
4. **The events** behind a link (reference R6): the facts `SWAP` rows of the
   seller and the recipient on one day. The day comes from the link's
   `last_seen_height`, read as a block on `USE chain` (reference R7).

## How to answer

- Lead with the exchange you took and its pools, then the sellers, the swap's
  recipient named for what it is (the buyer, the router, the pool manager),
  and the next lead.
- **The next lead.** End with who to trace next: the buyer's biggest
  receivers, or the seller's first funders. Both are the newest-links read of
  `chain-insights-cypher`, anchored on that one address.
- A pool's volume and a link's totals are lifetime totals. The money of one
  day is a facts read of a pair and that day.
- Zero pools from a factory is not "the exchange has no pools": say the
  graph shows none yet for that factory, and name the other factories read.
- A refusal is an answer: `family_behind`, `anchor_missing` and
  `query_timeout` say the lane cannot search the whole chain now. Say that in
  one line and go on with the anchored reads. Never rephrase the same search.
