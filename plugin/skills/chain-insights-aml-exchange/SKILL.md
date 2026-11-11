---
name: chain-insights-aml-exchange
door: meta_exchange_lookup, aml_exchange_deposit_check
description: Use for AML exchange checks (aml-exchange) — a question that names a centralized exchange such as Binance, Bitget, Bybit, Coinbase, Gate, KuCoin, MEXC or OKX, asks where money entered an exchange, whether an address is an exchange deposit address, which hot wallet a deposit was swept into, or which exchange a wallet belongs to.
---

# Chain Insights: where money entered an exchange

Load `chain-insights-cypher` first. Its answer rules hold here, and these
hold even when it cannot load:

- Write every address in full, 42 characters, every time. Never shorten
  one with `…` or `...`, not even for a repeat mention.
- A transfer moves tokens: "tokens worth about N USD", never "sent N USD".
  Write USD after the number, never a dollar sign.
- Never print the query, its `USE` line or its `LIMIT` in the answer. Write
  a time from its `_utc` twin.

**The rule this skill opens with.** Money that reaches an exchange deposit
with a `SWEPT` link entered that exchange there: the trail ends at the
deposit, and never walks on past a hot wallet. Take an exchange's wallets
from `meta_exchange_lookup`, never from a guess or a graph search by name.

## How an exchange takes money in

A customer of a centralized exchange gets a deposit address of their own.
The exchange later moves what arrives there into one of its hot wallets: a
sweep. The graph draws that move as `SWEPT`, from the deposit to the hot
wallet, and marks each exchange wallet with `cex_role`.

| `cex_role` | The wallet |
|---|---|
| `deposit` | one customer's deposit address; the exchange knows who owns it |
| `hot_wallet` | receives the sweeps of many deposits, and pays withdrawals |
| `cold_wallet` | holds the exchange's reserve |
| `withdrawal` | pays customers out |

`SWEPT` is drawn only from an address the deposit rule judged a deposit: it
sends everything to the hot wallets of one exchange, was paid by few
outside addresses and never traded on a DEX. A customer who pays a hot
wallet directly has no `SWEPT` link: that payment stays `FLOWED_TO`. A
deposit and a hot wallet are both `:Exchange` addresses: their `labels`
carry `Exchange` and the exchange id (`gate`, `bitget`), and `is_exchange`
is set on both.

## Step 1: the doors

1. **A named exchange: `meta_exchange_lookup`.** Call it first with the
   network and the name as the user wrote it:
   `{"network": "robinhood", "name": "Bitget"}`. It answers from the
   exchange lookup, at no cost: the exchange's hot wallets and gas wallets
   proven on that chain's own data, each with its payer proof in `evidence`
   and the block it was proven at in `proven_at_block`. The file lists every
   exchange, and only the wallets proven on that chain: an exchange may list
   none. Its deposits and hot wallets are still marked in the graph, and
   `aml_exchange_deposit_check` reads them there. It takes a typo within two letters and
   names it in `took_for`; say which you took in one line, and ask
   nothing. Send `address` instead of `name` to learn whose wallet an
   address is. An address the file does not list may still be an exchange
   wallet: check it with `aml_exchange_deposit_check` before you answer.
2. **One address: `aml_exchange_deposit_check`.** Call it with the network
   and the address in full:
   `{"network": "robinhood", "address": "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"}`.
   It reads the address's `cex_role` and its `SWEPT` links
   and answers `is_deposit`, the exchange, and each hot wallet it swept
   into with the sweep count, the USD sum, the paths and the first and
   last sweep.
3. **No match.** When `meta_exchange_lookup` returns `matched` null, say
   which exchanges it lists for the network, and ask the user for one
   address of the exchange they mean: a deposit address of theirs, or a
   wallet the exchange paid them from. Check that address with
   `aml_exchange_deposit_check`. **Send no graph search by name**: the graph
   has no name search, and a scan of `labels` walks the whole chain.

## Two questions, answered

- **"Is 0xed9ab5bc05a0152b9dc2f7902e8369af7bc18771 an exchange?"** Call
  `meta_exchange_lookup` with the `address`. It answers "a hot wallet of
  Bitget on robinhood": say yes, a hot wallet of Bitget, with the address in
  full. When the file lists no wallet of that address, call
  `aml_exchange_deposit_check`: its `cex_role` and the exchange it names
  answer the question from the graph.
- **"Where did the money from 0x64ba5fafa7a6e1991f7f60c9b594a7131a784540
  go?"** Call `aml_exchange_deposit_check` first. When the address is a
  deposit, the answer is its `SWEPT` link: the money entered Gate at that
  deposit and was swept into the Gate hot wallet
  0x0d0707963952f2fba59dd06f2b425ace40b492fe. The trail ends there. Send no
  walk past the hot wallet: what leaves it is the exchange paying other
  customers.

## A trail that reaches an exchange

Every walk in `chain-insights-cypher` stops at an `:Exchange` address: each
address in its middle carries `NOT via:Exchange`, so a deposit and a hot
wallet can only end it. This skill names what the end is: a trail ends at
the first `:Exchange` address, and a deposit names its hot wallet through
its `SWEPT` link.

Did the money pass from this address straight into an exchange deposit?
Anchor on the address the trail reached, with the guard of
`chain-insights-cypher` on the address and on the deposit:

```cypher
USE topology
MATCH (a:Address {address: "0x7e3702e9dfaa847f9829a258f1e26fa431160662"})-[f:FLOWED_TO]->(d:Address)-[s:SWEPT]->(h:Address) WHERE NOT a:Pool AND NOT a:Protocol AND NOT a:System AND NOT a.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"] AND NOT d:Pool AND NOT d:Protocol AND NOT d:System AND NOT d.address IN ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"] RETURN a.address AS from_address, d.address AS to_address, d.labels AS deposit_labels, h.address AS hot_wallet, h.labels AS hot_wallet_labels, f.amount_usd_sum AS amount_usd_sum, s.sweep_count AS sweep_count LIMIT 25
```

The sweeps of one deposit, the read `aml_exchange_deposit_check` sends:

```cypher
USE topology
MATCH (a:Address {address: "0x31a817802ee183eb8b13167ffe24bd28dcc6f30c"})-[s:SWEPT]->(h:Address) RETURN h.address AS hot_wallet, h.labels AS hot_wallet_labels, h.cex_role AS hot_wallet_role, s.sweep_count AS sweep_count, s.amount_usd_sum AS amount_usd_sum, s.paths AS paths LIMIT 20
```

- **Never anchor on a hot wallet** to list its deposits: one hot wallet
  links to many thousands of deposits, and the read runs out of time.
  Anchor on the deposit or on the address the trail reached.
- **Answer the investigator's question.** "The money entered Bitget at
  deposit D on robinhood, which was swept 3 times into hot wallet H." The
  exchange can name the customer behind D: that is the lead to hand over.
- **Name the exchange** from the deposit's `labels`, or from the hot wallet
  through `meta_exchange_lookup` with its `address`.
- **A payment straight into a hot wallet** ends the trail too: the money
  entered the exchange, but there is no deposit to name. Say so.

## Words

- Say "deposit address", "hot wallet", "swept into". Never "the exchange
  received it from the user" when the trail shows only a deposit: the
  owner of a deposit is known to the exchange, not to the graph.
- `paths` names how a sweep was paid: `plain` (the deposit paid its own
  fee), `gas_topped` (the exchange sent the fee first), `approval_pull`,
  `forwarder_flush` and `forwarder_batch` (a contract moved it). Name it
  only when the user asks how the money moved.
