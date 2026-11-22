---
name: chain-insights-token-risk
door: aml_token_risk
description: Use for the risk of one token or one pool (token-risk) — a question that asks whether a token, a pool or a coin launched on Virtuals is risky, who founded or deployed it, who funded the founder, or who adds and removes its liquidity.
---

# Chain Insights: the risk of one token or pool

Load `chain-insights-cypher` first. Its answer rules hold here, and these
hold even when it cannot load:

- Write every address in full, 42 characters, every time. Never shorten
  one with `…` or `...`.
- USD figures are tokens worth at day prices: "tokens worth about N USD".
  A null figure is unpriced, never 0.

## The one call

Call `aml_token_risk` with `network` and the full address of the token
contract or the pool. A ticker is no address: call `meta_token_lookup`
first, because tickers collide. A wallet goes to `aml_address_risk`. Add
`surroundings: true` only when the host draws a picture.

Two of the tool's reads, shown so a host without the tool can send the same
ones through `graph_query`. The deployment, whose `tx_origin` is the
founder:

```cypher
USE topology MATCH (d:Address)-[r:DEPLOYED_CONTRACT]->(t:Address {address: "0x766bd6598182586beda76414dc5f8deb1530a213"}) RETURN d.address AS deployer, r.tx_origin AS tx_origin, r.factory_address AS factory_address, r.kind AS kind, r.tx_id AS tx_id, r.block_timestamp AS block_timestamp LIMIT 1
```

The providers of the token, one row per pool address and provider: one read
gives the pools, their providers and their biggest adders at once:

```cypher
USE topology MATCH (a:Address)-[r:ADDED_LIQUIDITY {asset: "0x766bd6598182586beda76414dc5f8deb1530a213"}]->(p:Address) RETURN p.address AS pool, a.address AS address, sum(r.usd) AS tokens_worth_usd, count(r.usd) AS priced, sum(r.event_count) AS events, min(r.first_seen_height) AS first_seen_height, max(r.last_seen_height) AS last_seen_height, labels(a) AS node_labels, a.identity AS identity, a.identity_name AS identity_name, a.identities AS identities, a.evidence AS evidence, a.judgements AS judgements, a.risk_level AS risk_level, a.risk_score AS risk_score ORDER BY tokens_worth_usd DESC LIMIT 200
```

## How to read `risk`

- `risk.word` is the highest of the token's own word, its founder's word
  and each detailed pool's own word. `raised_by` says whose (`token`,
  `founder` or `pool`) and `raised_by_address` names it. `risk.own` is the
  token's own block.
- The founder is the wallet that sent the deployment. `factory.name` comes
  from the exchange registry, or from the token's launchpad identity;
  `named_by` says which. A factory or
  launchpad (such as Virtuals), a first funder in `gas_wallets` and a
  liquidity provider never raise the word: each carries its own beside it.
- Every word is the higher of what labels prove (`rules_word`) and what the
  risk model predicts (`model_word`); `set_by` says which. A word set by the
  model alone is a prediction: say so.
- `unscored` means neither the labels nor the model speak. It is not `low`,
  and it is not safe.
- A pool row is one address. The pools inside one pool manager (such as
  Uniswap v4) are answered as one row for the manager (`is_manager: true`),
  with its providers and this token's side (`token_side`), not pool by pool.
  A manager row has no word and never raises the token's. A manager asked
  about itself lists no adders, removers or tokens (`pool_tokens: []`): its
  parties and its tokens are answered per token, so ask the token.
- `pools_found` counts every pool address of the token, exact up to 500,
  and each pool's `providers` counts every provider. Only the 10 biggest
  are detailed (`detail: true`); `pools_truncated` says when more exist,
  and `parties_truncated` when a pool's 5 biggest adders or removers may
  miss a party.

## A hub

A token or a pool with more than 50,000 links is a hub: `exposure.hub` is
`true` and its own counterparties are not ranked (`not_read` names
`counterparties`). Its founder, factory and pools are still answered. To see
who traded with it, ask about one counterparty.

## The judgement is yours

The tool states facts and measures. You write the judgement:

1. Say which reasons and whose word you rely on.
2. Say when a word comes from the model alone that it is a prediction.
3. Never call a token or a pool safe.
4. Name a part listed in `not_read` as not read, never as "none found".
