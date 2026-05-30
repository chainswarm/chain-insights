---
name: chain-insights-trace-funds
description: Use when chaining Chain Insights trace_victim_funds, trace_deposit_sources, and trace_suspect_funds. Explains role-specific tracing, chain-insights.trace.v1 output, compact evidence pointers, and graph/report artifacts.
---

# Chain Insights Trace Tools

Use the role-specific public trace tools. Do not guess address roles from
format alone, and never replace full addresses with aliases in
machine-readable output.

Before running investigation-producing commands, confirm the current directory
is an initialized Chain Insights workspace:

```bash
test -f .chain-insights/workspace.json && cat .chain-insights/workspace.json
```

If that file is missing, stop and tell the user to run:

```bash
cia init .
```

No investigation output belongs under `~/.chain-insights`; that global location
is for config, cache, wallet, and installed skills only.

Before selecting a trace method, inspect the live GraphRAG network matrix:

```bash
cia mcp networks
```

Use the output as the source of truth:

- `Topology: yes` is required for fund-flow tracing.
- `Available tools` must include the role-specific trace tool, otherwise use
  `graph_query` or `graph_query_batch` with `USE live_topology` for manual
  topology diagnostics.
- `Dataset` gives the graph coverage range as
  `<first_height>..<last_height> / <first_date>..<last_date>`. State this range
  in the investigation scope, and do not claim tracing coverage outside it.
- `Risk: yes` determines whether downstream `address_risk` enrichment is
  available on the same network.

## Tool Selection

Use `trace_victim_funds` when the user gives victim/source addresses and asks
where funds went. Required inputs are `victim_addresses` and `network`.
Optional `known_suspect_addresses` are context only; this tool must not trace
backward from deposit candidates.

Use `trace_deposit_sources` when the user gives suspected deposit/cashout
addresses and asks who funded them. Required inputs are `deposit_addresses` and
`network`. This tool traces backward over `FLOWS_TO` and can reveal shared
upstream sources or candidate suspects when multiple deposits converge.

Use `trace_suspect_funds` when the user gives suspected scammer, mule,
operator, or laundering-ring addresses and asks where suspect-controlled funds
went. Required inputs are `suspect_addresses` and `network`.
`incident_timestamp_ms` is optional; absence of a timestamp is valid.

Use `address_risk` for single-address screening and enrichment. Use
`graph_query_batch` only when the high-level tools do not answer the exact
question.

Default chain:

1. Run `trace_victim_funds` for victim/source evidence.
2. Pass `continuation.candidate_deposit_addresses` into
   `trace_deposit_sources`.
3. Pass high-confidence `continuation.candidate_suspect_addresses` from deposit
   traceback into `trace_suspect_funds`.
4. Enrich individual addresses with `address_risk`.

Example:

```bash
cia mcp trace-victim-funds --network bittensor --victim-addresses 5... --max-hops 3 --case 1
cia mcp trace-deposit-sources --network bittensor --deposit-addresses 5... --max-hops 2 --case 1
cia mcp trace-suspect-funds --network bittensor --suspect-addresses 5... --max-hops 16 --case 1
```

All three tools return `chain-insights.trace.v1` with:

- `addresses`, `edges`, `paths`, `convergence`, `exchange_exposure`,
  `candidate_labels`, `artifacts`, `evidence`, `continuation`, and `warnings`.
- `label_candidates` / `candidate_labels` as review hypotheses only.
- `promote_to_core_label: false` until a separate reviewed label-promotion
  workflow curates the address.
- Full addresses in every machine-readable field.

Victim/source addresses are not risky labels. Deposit seeds are not scammers by
default. Candidate suspect or deposit roles are hypotheses until reviewed. For
single address risk screening, use `address_risk` instead of trace tools.

## Artifacts

Trace tools store durable workspace-local outputs and return pointers:

- `reports/graphs/*.graph.json`
- served by the local Hono server at `/graph-reports/<filename>.graph.json`
- `reports/*.graph.html`
- `reports/tables/*.compact-evidence.json`
- `reports/tables/*.flows.csv`
- `reports/*.table.html`
- `reports/*.trace-report.md`

Case evidence should stay compact. It should point to report files and include
hashable provenance/facts, not paste the full graph/table JSON into Markdown.
The JSON/CSV/Markdown reports carry the investigation structure.

## Graph Semantics

Python GraphRAG MCP is the golden implementation for address screening and the
original StolenFundsProbe behavior. Do not degrade tracing into a simple top-K
neighbor recipe. Chain Insights tools may call Go GraphRAG MCP primitives, but
they must preserve the workflow semantics through read-only `graph_query_batch`
calls.

Some Graph MCP deployments do not parse backend-specific BFS or
variable-length relationship syntax. In those cases, use generated fixed-depth `FLOWS_TO` query batches with `USE live_topology`. Exchange terminal safety
applies to all traversal algorithms: exchange hot wallets are terminal
endpoints only. Do not expand from, through, or classify exchange nodes as
deposit, suspect, or intermediate candidates. Forward victim/suspect tracing
stops at exchange nodes and treats `path[-2]` as the penultimate non-exchange
deposit candidate. Deposit-source tracing is a separate reverse workflow and
must keep source, intermediate, and deposit seed nodes non-exchange.

Evidence and generated data files must use original graph field names. Do not
rename, reinterpret, or add unit labels unless the schema or query result
explicitly supports that interpretation.
