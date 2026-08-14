---
name: chain-insights-address-risk
description: Use when screening one address with aml_address_risk, comparing two addresses, or validating the persisted AML graph/report bundle for a single-address investigation.
---

# Chain Insights Address Risk

Use `aml_address_risk` for single-address AML screening. Do not substitute a
manual graph traversal when the question is about one address or one address
versus one comparison address.

Before running persistence-producing commands, confirm the current directory is
an initialized Chain Insights workspace:

```bash
test -f .chain-insights/workspace.json && cat .chain-insights/workspace.json
```

If that file is missing, stop and tell the user to run:

```bash
cia init .
```

No investigation output belongs under `~/.chain-insights`.

## When To Use It

Use `aml_address_risk` when the user asks:

- whether one address looks risky
- whether an address behaves like an exchange deposit, hot wallet, or service
- whether two addresses should be compared for neighborhood or behavior overlap
- for a compact single-address artifact set before deciding whether manual
  fund-flow traversal is needed

Required inputs:

- `network`
- `address`

Optional inputs:

- `compare_address`
- `include_attachments`

Example:

```bash
cia mcp aml-address-risk \
  --network robinhood \
  --address 0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24
```

## Result Contract

The tool returns analyst text plus structured facts about:

- risk level and score
- exchange behavior
- neighborhood/context
- optional comparison observations
- persisted artifact pointers when workspace artifact writing is enabled

Preserve full blockchain addresses exactly. Keep returned graph field names
unchanged in any derived compact artifacts.

## Artifacts

`aml_address_risk` is in the AML family and persists the same class of outputs
as other AML workflows:

- canonical graph JSON under `reports/graphs/`
- graph HTML under `reports/`
- compact evidence JSON under `reports/tables/`
- optional table-style outputs under `reports/tables/`
- Markdown summary/report files under `reports/`
- compact evidence pointers in the returned structured content

These are AML graph/report artifacts, not exposure-style narrative reports.

## Escalation Path

If the single-address result suggests fund-flow investigation:

1. Use `graph_query` / `graph_query_batch` with `USE topology` for directed
   read-only flow reads over `FLOWS_TO`.
2. Use `aml_address_risk` on the addresses the flow reads surface.
3. Keep exchange hot wallets as terminal endpoints only — never expand from,
   through, or classify exchange nodes as candidates.

Do not guess the role from address format alone. Run `cia mcp networks` first
and verify the chosen network exposes risk and topology support.
