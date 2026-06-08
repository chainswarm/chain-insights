---
name: chain-insights-exposure-analysis
description: Use when analyzing exposure with exposure_profile, exposure_quality, exposure_carry, exposure_crowding, exposure_exit_pressure, exposure_correlation, or exposure_explain, and when validating the exposure persistence contract.
---

# Chain Insights Exposure Analysis

Use the `exposure_*` tool family for exposure research. Exposure is a
structured analysis domain, not an AML graph-trace workflow.

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

## Tool Selection

Use:

- `exposure_profile` for one account/owner/counterparty summary
- `exposure_quality` for disciplined/fragile/lucky/noisy scoring
- `exposure_carry` for funding, fees, emissions, dividends, or validator take
- `exposure_crowding` for market or instrument crowding
- `exposure_exit_pressure` for exit or unwind pressure
- `exposure_correlation` for overlap or copy-pattern comparison
- `exposure_explain` for one lifecycle/position/trade/stake narrative

Always pass an explicit `network`. Use venue, instrument, instrument type, and
time bounds only when the question requires them.

Example:

```bash
cia mcp exposure-profile \
  --network bittensor \
  --owner 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --instrument "Subnet 19"
```

## Result Contract

Exposure public responses contain only:

- `summaryText`
- `structuredContent`

Do not rely on public `graphData`, graph HTML, graph JSON bundles, or AML-style
evidence pointer artifacts in exposure responses.

## Persistence Contract

When exposure tools run inside an initialized workspace, they persist readable
analysis outputs only:

- one Markdown report under `reports/`
- one compact JSON facts file under `reports/tables/`
- optional table-style file under `reports/tables/` when the result is naturally tabular

Exposure tools do not persist:

- graph HTML
- graph JSON visualization bundles
- AML-style evidence pointer artifacts

## Working Style

- Treat exposure as filtering, ranking, aggregation, overlap, scoring, and
  rollup analysis.
- Keep persisted files compact and factual.
- Preserve source schema field names in structured outputs unless the source
  explicitly proves a renamed field.
- If the user actually needs graph-native fund-flow behavior, switch to the
  `aml_*` tool family instead of bending exposure tools into trace workflows.
