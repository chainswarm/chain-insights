---
name: chain-insights-address-risk
description: Use when screening one address with aml_address_risk, or comparing two addresses.
---

# Chain Insights address risk

Use `aml_address_risk` for a single-address AML screen. Do not replace it
with a hand-written `graph_query` when the question is one address.

Call `meta_network_capabilities` first. Pass `network=` as GraphRAG
advertised it. CIA does not pick a default network.

Robinhood example: `network=robinhood` with a full `0x...` address.

## Inputs

Required:

- `network` — a name from `meta_network_capabilities`
- `address`

Optional:

- `compare_address` — second address for a pairwise compare
- `version` — omit to use the latest AML contract, or set `v1` to pin the
  current contract

The tool returns raw addresses. There is no identity-resolution step.

The screen covers risk, behavior, neighborhood context, and exchange
exposure. Treat exchange hot wallets as terminals, not as intermediate
hops.

## The risk verdict

`facts.risk.level` is one of `unscored`, `low`, `medium`, `high`, or
`critical`, and it says only what the evidence supports:

- the model's own band (`LOW`, `MEDIUM`, `HIGH`), or a label at risk level
  `medium` or above, sets the level; the more severe of the two wins;
- found exchange exposure sets `low` or `medium` when nothing above exists;
- otherwise the level is `unscored`, `facts.risk.score` is `null`, and the
  summary reads `Risk: unscored (no score)`.

`unscored` is **not** a clean result. It means no model verdict, no risk
label, and no found exchange exposure — gather more context before clearing.
A label at risk level `low` (a role such as `smart_account`) is context only:
it appears under drivers and never sets the level.

`facts.risk.signals` says which signals were present:

- `ml_verdict`: `present`, `abstained` (the model returned `UNSCORED`), or
  `absent`;
- `labels`: `risk`, `context_only`, or `absent`;
- `exchange_exposure`: `found`, `none_found`, `incomplete`, or `unavailable`.

For the CLI, discover this workflow with `cia workflows` and run
`cia workflow aml-address-risk` for the readable summary. Add `--json` for
indented structured output. Omit the version to use the latest contract, or
pass `--version v1` to pin the current contract.

`cia mcp tools` is the remote GraphRAG catalog only. Use `cia mcp call
graph_query` or `cia mcp call graph_query_batch` for custom low-level reads.
The MCP proxy exposes `aml_address_risk` directly to AI agents as a
Chain Insights workflow tool.

After the screen, load the schema skill for that network:
`chain-insights-schema-evm` or `chain-insights-schema-bittensor`.
Use `chain-insights-cypher` only for extra graph reads.
