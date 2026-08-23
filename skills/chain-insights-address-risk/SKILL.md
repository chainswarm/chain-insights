---
name: chain-insights-address-risk
description: Use when screening one address with aml_address_risk, or comparing two addresses.
---

# Chain Insights address risk

Use `aml_address_risk` for a single-address AML screen. Do not replace it
with a hand-written `graph_query` when the question is one address.

The public hosted network is `network=robinhood`. Pass a full `0x...`
address.

## Inputs

Required:

- `network=robinhood`
- `address`

Optional:

- `compare_address` — second address for a pairwise compare
- `include_attachments` — graph report metadata

The tool returns raw addresses. There is no identity-resolution step.

The screen covers risk, behavior, neighborhood context, and exchange
exposure. Treat exchange hot wallets as terminals, not as intermediate
hops.

After the screen, load `chain-insights-schema-evm` for the Robinhood
graph map. Use `chain-insights-cypher` only for extra graph reads.
