---
name: chain-insights-virtuals
description: Use when investigating Virtuals Protocol agents with Chain Insights - who created an agent or thousands of agents, who is behind a creator wallet, whether a creator earned on its agents, whether an agent was rugged or dumped, whether agents are run by a cartel of linked wallets or snipers, who holds or bought an agent token, whether a buyer or receiver of an agent pool with Scam or Victim labels is really a scammer, why an agent token shows no USD value, what happened after an agent graduated, whether Virtuals contract addresses or queries carry over to another network such as Base, or when a question names Virtuals, an agent token, VIRTUAL, a bonding curve, a launchpad or a creator wallet.
---

# Chain Insights: Virtuals Protocol investigations

Load `chain-insights-cypher` first. Its answer rules hold here, and these
three hold even when it cannot load:

- Write every address in full, 42 characters, every time. Never shorten
  one with `…` or `...`, not even for a repeat mention or a caveat line.
  To refer back, use a name with no hex at all ("the shared funder"), or
  the full address again.
- A transfer moves tokens: "tokens worth about N USD", never "sent N USD".
- No drawn graph in text.

This skill adds what Virtuals needs on top: how an agent is built on
chain, where its creator is recorded, and one tested query per
investigation. The queries are in [reference.md](reference.md).

## How an agent is built

One creation transaction makes **three contracts**. They share its
`tx_id`.

```
 creator wallet ── signs one transaction ──▶ launch contract
                                               │
          ┌────────────────────────────────────┼─────────────────────────────┐
          ▼                                    ▼                             ▼
   agent token                        starting pool (bonding)         Uniswap v2 pair
   1,000,000,000 minted               token / VIRTUAL                 empty until graduation
   token factory                      starting-pool factory           pair factory
```

- **Bonding stage.** Buyers pay VIRTUAL into the starting pool and get
  the agent token back. A new agent shows a market value of 8,500
  VIRTUAL: that is the curve's built-in start, not money anyone paid.
- **Graduation.** The starting pool's VIRTUAL moves to the launch
  contract. The agent token contract itself seeds the Uniswap pair once.
- **After graduation** the agent trades on the Uniswap pair. On the
  three graduated agents checked (VEX, GTR, TRSA) no liquidity was ever
  removed. So a Virtuals rug is an insider **dump**, not a pool drain.
- **Fees.** A creation costs 10 VIRTUAL. A launch
  service can collect 300 VIRTUAL per user and forward it in batches.

## Robinhood Chain contracts

These addresses are for `network=robinhood` only. Chain Insights serves
only robinhood today, so it holds no Base data: a Virtuals question about
Base cannot be answered from it. On any other network the contracts
differ: find them first, never reuse these.

| Role | Address |
|---|---|
| VIRTUAL token | `0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31` |
| Launch contract | `0xd4ccbfa37e2f35611b3042e4096ad7a3459bd007` |
| Token factory | `0x43e4c17b15365596caae8e7d00e42bc8e988c2d4` |
| Starting-pool factory | `0xfc2e4da3edb2e18100473339c763705d263d20a9` |
| Uniswap v2 pair factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` |

**Hubs.** These carry millions of transactions. Keep them out of buyer,
funder and shared-wallet lists **by address**: the graph does not mark
them as Protocol, so the usual guard lets them through.

| Hub | Address |
|---|---|
| Trading router | `0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc` |
| Launch contract | `0xd4ccbfa37e2f35611b3042e4096ad7a3459bd007` |
| Unnamed hub contract | `0xca6395246b4382ba70f886526dd9a9de984f6081` |
| Unnamed hub contract | `0x6d80b81d9fc56a7a839b1af9006eb49151961ce7` |

**A Scam or Victim label on a hub is noise.** The router carries Scam,
Targeted and Victim labels only because millions of transactions touch
it. When a pool's only receiver is the router, the router is not the
buyer: the buyer is the sender of the buy transaction (reference B4).
Read an address's transaction count before you trust any label on it.

## Who the creator is

- The creator is the **sender of the creation transaction**: `tx_origin`
  on the factory's `DEPLOYED_CONTRACT` link. `deployer_address` is always
  the factory: never call it the creator.
- Count agents from the **starting-pool factory**. The pair factory also
  makes non-Virtuals pairs (120,066 of them), so its count is wrong.
- Call that wallet the **creator wallet**. A creator wallet with
  thousands of agents is a mass creator. The Virtuals API lists it as the
  agent's `walletAddress`.
- The creator wallet signs and pays gas. That is not proof it paid a
  fee, made money or is a person.
- **"It earned on its agents"** is tested first with A5: money in, out
  and kept. A wallet that forwards nearly all it receives is a launch
  service. Then B2 for sales of agent tokens, then a sample of its agents
  through A2 and B3: an agent nobody bought earned nothing.
- A creator funded across a bridge has a `BRIDGED` link to a `:Chain`
  node on **its own address**. The bridge contract node carries none.

## Investigations

Run them in this order. Each step names its query in reference.md.

**Who is behind**
1. Rank creators (A1). Pick the creator wallet.
2. List its agents, or sample them by `tx_id` order (A2).
3. Its first funding (A3) and chain of origin (A4).
4. Money in, out and kept (A5). A wallet that forwards everything it
   receives is a launch service, not a profiteer.
5. Two hops back: repeat A3 on the funders. Stop at a hub, a bridge or
   an exchange.

**Who rugs**
1. The agent's three contracts from its creation `tx_id` (A6).
2. The starting pool's life: traders, volume, last activity (B3). An
   agent nobody bought cannot be rugged.
3. On a graduated agent: liquidity seeded and removed (B1).
4. Did the creator or an early buyer sell the agent token (B2)? Sold
   asset = agent token is a dump. Bought asset = agent token is a pump.
5. Holders at birth and the real buyers behind the router (B4).

**Cartel**
1. Early receivers of a starting pool: the snipers (C1).
2. The real sender of each buy transaction (B4, chain read).
3. Buyers bought within the same second for the same amount are twins.
4. Funders shared by those buyers (C3), or by two creators (C4).
5. Wallets that bought into two agents of one creator (C2).
6. Ownership links the graph already holds (C5).

## Traps

- A creation transfer of 0 VIRTUAL is normal. Most creations by a mass
  creator carry no fee.
- A fresh agent token has no price: its `amount_usd` is empty. Value a
  buy by the VIRTUAL paid for it.
- The token and its starting pool carry the same named label,
  `virtuals:<NAME>:<stage>`. `AgentTokenV4` is missing on some tokens.
  Tell them apart by the factory that made them (A6).
- The starting pool is `:Pool` from the day it is discovered, and the
  agent token is `:Token`. Both carry `:Launchpad` beside it, so
  `MATCH (p:Pool:Launchpad)` lists every starting pool (see Marks in
  reference.md). The Uniswap pair of the agent is `:Pool`, graduated
  or not. The pre-made Uniswap pair of an agent that never graduated has
  no Virtuals label at all.
- Holder counts on an explorer can run ahead of the graph. The graph
  lags the chain head: read `Head` before you say "no holders".
- The Virtuals API: look an agent up by `filters[preTokenPair]=<starting
  pool>`. `filters[walletAddress]` covers every chain, not only Robinhood
  Chain. `filters[status]` is ignored: never count by status through it.
  Fetch with `curl`; a Python urllib client gets a Cloudflare 403.
- "Relay" is not a role here. Say creator wallet, launch contract,
  collector contract or router.

## Open questions

Mark these as unproven when an answer leans on them.

- What the 1-unit `FT-<NAME>` tokens minted to a creator wallet mean.
- Why a collector's 28,744 VIRTUAL batch is not a multiple of 300.
- Who controls the hub contracts above.
