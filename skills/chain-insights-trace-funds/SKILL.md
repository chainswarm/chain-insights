---
name: chain-insights-trace-funds
description: Use when chaining Chain Insights aml_trace_victim_funds, aml_trace_deposit_sources, and aml_trace_suspect_funds. Explains role-specific tracing, chain-insights.trace.v1 output, compact evidence pointers, and graph/report artifacts.
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

Before selecting a trace method, inspect the live Chain Insights Graph network matrix:

```bash
cia mcp networks
```

Use the output as the source of truth:

- `Topology: yes` is required for fund-flow tracing.
- `Available tools` must include the role-specific trace tool, otherwise use
  `graph_query` or `graph_query_batch` with `USE topology` for manual
  topology diagnostics.
- Do not infer dataset coverage ranges from the public support matrix. State
  coverage only when a tool result or query result explicitly returns it.
- `Risk: yes` determines whether downstream `aml_address_risk` enrichment is
  available on the same network.

## Tool Selection

Use `aml_trace_victim_funds` when the user gives victim/source addresses and asks
where funds went. Required inputs are `victim_addresses` and `network`.
Optional `known_suspect_addresses` are context only; this tool must not trace
backward from deposit candidates.

Use `aml_trace_deposit_sources` when the user gives suspected deposit/cashout
addresses and asks who funded them. Required inputs are `deposit_addresses` and
`network`. This tool traces backward over `FLOWS_TO` and can reveal shared
upstream sources or candidate suspects when multiple deposits converge.

Use `aml_trace_suspect_funds` when the user gives suspected scammer, mule,
operator, or laundering-ring addresses and asks where suspect-controlled funds
went. Required inputs are `suspect_addresses` and `network`.
`incident_timestamp_ms` is optional; absence of a timestamp is valid.

Use `aml_address_risk` for single-address screening and enrichment. Use
`graph_query_batch` only when the high-level tools do not answer the exact
question.

Default chain:

1. Run `aml_trace_victim_funds` for victim/source evidence.
2. Pass `continuation.candidate_deposit_addresses` into
   `aml_trace_deposit_sources`.
3. Pass high-confidence `continuation.candidate_suspect_addresses` from deposit
   traceback into `aml_trace_suspect_funds`.
4. Enrich individual addresses with `aml_address_risk`.

Example:

```bash
cia mcp trace-victim-funds --network bittensor --victim-addresses 5... --max-hops 3
cia mcp trace-deposit-sources --network bittensor --deposit-addresses 5... --max-hops 2
cia mcp trace-suspect-funds --network bittensor --suspect-addresses 5... --max-hops 3
```

## Search Limits

Every trace is bounded. When a trace comes back empty or shallow, check
whether a bound was the constraint before concluding the funds went nowhere.

Read `input.search_limits` in the result. It reports, per knob, what was
requested, what was used, the unconfigured default, and the hard ceiling:

```json
"search_limits": {
  "deposit_sources_row_limit": { "used": 500, "default": 500, "ceiling": 20000 }
}
```

Also read `warnings`. A cap that was actually hit reports what was lost, for
example the weakest retained path value on a truncated reverse trace — anything
dropped carries no more than that.

Raising a bound, per call:

| Tool | Argument | Default | Ceiling |
| --- | --- | --- | --- |
| `aml_trace_victim_funds` / `aml_trace_suspect_funds` | `max_hops` | 3 | 5 |
| `aml_trace_victim_funds` / `aml_trace_suspect_funds` | `per_address_limit` | 5 | 50 |
| `aml_trace_deposit_sources` | `max_hops` | 2 | 5 |
| `aml_trace_deposit_sources` | `row_limit` | 500 | 20000 |

Reach for `row_limit` before `max_hops`. Row-limit cost is close to linear;
hop cost grows exponentially, and on a high-fan-in deposit the row cap is
usually the binding constraint, not the depth. Raising `row_limit` from 500 to
5000 on a real case made an origin reachable that four hops alone could not
find, in about six seconds.

Asking for more than a ceiling returns an error naming the knob and its limit.
It is never silently reduced — a clamped search would look exhaustive when it
is not.

For persistent values across runs, set `limits` / `networkLimits` in
`~/.chain-insights/config.json`. Per-call arguments always win over config.

All three tools return `chain-insights.trace.v1` with:

- `addresses`, `edges`, `paths`, `convergence`, `exchange_exposure`,
  `candidate_labels`, `artifacts`, `evidence`, `continuation`, and `warnings`.
- `label_candidates` / `candidate_labels` as review hypotheses only.
- `promote_to_core_label: false` until a separate reviewed label-promotion
  workflow curates the address.
- Full addresses in every machine-readable field.

Victim/source addresses are not risky labels. Deposit seeds are not scammers by
default. Candidate suspect or deposit roles are hypotheses until reviewed. For
single address risk screening, use `aml_address_risk` instead of trace tools.

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

Current Chain Insights AML tools define the behavior contract. Keep tracing
implementation-neutral: Chain Insights Graph may serve Memgraph `topology` directly or
proxy StarRocks-backed `facts`, but high-level AML workflows
must preserve role-specific semantics and return member addresses at the public
boundary.

Do not degrade tracing into a simple top-K neighbor recipe. Chain Insights tools
may use Chain Insights Graph primitives, but they must preserve the workflow semantics
through read-only `graph_query_batch` calls.

Some Chain Insights Graph deployments do not parse backend-specific BFS or
variable-length relationship syntax. In those cases, use generated fixed-depth `FLOWS_TO` query batches with `USE topology`. Exchange terminal safety
applies to all traversal algorithms: exchange hot wallets are terminal
endpoints only. Do not expand from, through, or classify exchange nodes as
deposit, suspect, or intermediate candidates. Forward victim/suspect tracing
stops at exchange nodes and treats `path[-2]` as the penultimate non-exchange
deposit candidate. Deposit-source tracing is a separate reverse workflow and
must keep source, intermediate, and deposit seed nodes non-exchange.

Evidence and generated data files must use original graph field names. Do not
rename, reinterpret, or add unit labels unless the schema or query result
explicitly supports that interpretation.
