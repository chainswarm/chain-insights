---
name: chain-insights-address-risk
door: aml_address_risk
description: Use for the risk of one address (address-risk) — a question that asks whether a wallet or an address is risky, who it is, what labels or risk score it carries, or whom it exchanged money with.
---

# Chain Insights: the risk of one address

Load `chain-insights-cypher` first. Its answer rules hold here, and these
hold even when it cannot load:

- Write every address in full, 42 characters, every time. Never shorten
  one with `…` or `...`.
- A transfer moves tokens: "tokens worth about N USD", never "sent N USD".

## The one call

Call `aml_address_risk` with `network` and the full `address`. Add
`surroundings: true` only when the host draws a picture. A token contract
or a pool goes to `aml_token_risk`; a ticker or a name goes to
`meta_token_lookup` or `meta_exchange_lookup` first.

The tool's first read, shown so a host without the tool can send the same
one through `graph_query`:

```cypher
USE topology MATCH (a:Address {address: "0x766bd6598182586beda76414dc5f8deb1530a213"}) RETURN labels(a) AS node_labels, a.card_version AS card_version, a.identity AS identity, a.identity_name AS identity_name, a.identities AS identities, a.address_roles AS address_roles, a.behaviour AS behaviour, a.evidence AS evidence, a.judgements AS judgements, a.exposed AS exposed, a.sources AS sources, a.risk_level AS risk_level, a.risk_score AS risk_score, coalesce(a.exchange_role, a.cex_role) AS exchange_role, a.degree_total AS degree_total, a.degree_out AS degree_out LIMIT 1
```

## How to read `risk`

- `risk.word` is `critical`, `high`, `medium`, `low` or `unscored`. It is the
  higher of `rules_word`, what the labels prove, and `model_word`, what the
  risk model predicts. Only a label gives `critical`.
- `set_by` says who set it: `rules`, `model`, `both` or `none`. A word set by
  the model alone is a prediction: say so.
- `risk.score` is the model's number from 0 to 1, or null. A label never
  makes a number.
- `unscored` means neither the labels nor the model speak about the
  address. It is not `low`, and it is not safe.
- Each reason carries its fixed `plain` sentence. A reason with the word
  `pattern` is a pattern fact: it accuses nobody and sets no word.
- A partner in `exposure.with_risk` is listed beside the word and never
  changes it. Receiving money from a risky address is a fact, not guilt.

## Exposed, a grade below proof

When the answer holds `exposed`, the address sits in the blast radius of a
scam kind: one block per kind, with its `band` (`top`, `high` or `raised`),
the payments away (`steps`) and the `way` of addresses, nearest the address
first. Read each block's `text` as written.

- Exposed is a grade below proof. It is never evidence against the address,
  and it never changes `risk.word`. An address with a label of its own is
  answered by the label first.
- A block with `paid_once` true says the address paid once and may be a
  victim: say so.
- There is no number. Never make one up from the band.
- No `exposed` in the answer means there is nothing to show. Say nothing
  about it.

## A hub

The zero address and the dead address are hubs, whatever their link count.
So is an address with more than 50,000 money links, such as a pool manager.
For a hub, `exposure.hub` is `true`, its counterparties are not
ranked, and `not_read` names `counterparties` with code `hub`. Its word still
comes from its card and the model. Say that its counterparties were not
ranked, and ask about one counterparty, or one token, instead.

## The judgement is yours

The tool states facts and measures. You write the judgement:

1. Say which reasons you rely on, in their plain words.
2. Say when the word comes from the model alone that it is a prediction.
3. Never call an address safe.
4. Name a part listed in `not_read` as not read, never as "none found".
