---
name: chain-insights-trace-funds
description: Use when tracing stolen funds to exchange deposit candidates in Chain Insights. Explains the public track_funds workflow, traceback/source discovery, address aliases, compact evidence pointers, and graph/report artifacts.
---

# Chain Insights Track Funds

Use `track_funds` when the investigation has victim/source addresses and may
also include known scammer addresses. It accepts up to five
`trusted_addresses` and up to five `untrusted_addresses`, preserves those
roles, and runs the local tracing engine per address.

Use `track_funds` for a single address by passing that address as the only
`trusted_addresses` value. Do not call `trace_funds`; that name is private
implementation detail, not a public agent tool. The workflow is a TypeScript
port of the Python probe workflow, not a simple top-K hop walker. The goal is to
find all reachable exchange-deposit paths the graph can return within query
limits, then traceback those deposits toward source exchanges and enrich the
result with reverse 1-hop leads.

This tool exists so the agent does not lose the investigation in chat context.
It executes the repeatable tracing loop, stores machine-readable files for
visualization, writes a human report, and returns compact facts plus an
`address_map` so the agent can reason with aliases instead of repeatedly
copying full blockchain addresses.

## Tool

Preferred multi-address call:

```text
track_funds
```

Required inputs:

- `trusted_addresses`: comma-separated full victim/source addresses, max 5.
- `network`: required network. Do not guess.

Optional inputs:

- `untrusted_addresses`: comma-separated full known scammer addresses, max 5.
- `case_id`: when present, per-address evidence stores compact pointers to artifacts.
- `max_hops`, `per_address_limit`, `min_amount_sum`: forwarded to the single-seed tracing engine.

Single-address call:

Call:

```text
track_funds
```

Required inputs:

- `trusted_addresses`: one full source/victim address to trace from.
- `network`: required network. Do not guess.

Optional inputs:

- `case_id`: when present, evidence stores a compact pointer to report/table/graph artifacts.
- `max_hops`: legacy compatibility knob; probe-style exchange search is bounded primarily by query timeout and result limits.
- `per_address_limit`: controls the forward exchange path result budget.
- `min_amount_sum`: optional minimum original graph `r.amount_sum`.

## Behind The Scenes

The tool:

1. Captures runtime graph schema if missing:
   - `.chain-insights/schema/<network>.graph-schema.json`
2. Runs the Python-probe-style forward exchange path query:
   - `MATCH p = (s:Address {address: ...})-[:FLOWS_TO *BFS ...]->(t:Exchange)`
   - excludes paths that traverse through an intermediate `Exchange`,
   - records `nodes(p)` and `relationships(p)` projections,
   - treats `path[-2]` as the exchange deposit candidate.
3. Runs traceback/source discovery:
   - backward BFS from each deposit toward source `Exchange` nodes,
   - reverse 1-hop from deposits to surface leads,
   - lead reasons include labeled entity, fan-in hub, or high-volume sender.
4. Assigns aliases:
   - `V*` seed/victim/source address,
   - `D*` deposit candidates,
   - `E*` forward exchange endpoints,
   - `X*` traceback source exchanges,
   - `L*` reverse 1-hop leads,
   - `I*` intermediaries.
5. Writes artifacts:
   - `reports/graphs/*.graph.json`
   - `reports/*.graph.html`
   - `reports/tables/*.compact-evidence.json`
   - `reports/tables/*.flows.csv`
   - `reports/*.table.html`
   - `reports/*.trace-report.md`
6. Returns:
   - concise facts,
   - `address_map` alias-to-address mapping,
   - file paths,
   - graph app metadata,
   - deposit, exchange, traceback, and lead summaries.

Case evidence should stay compact. It should point to artifact files and include
hashable provenance/facts, not paste the full graph/table JSON into markdown.
The JSON/CSV/report artifacts carry the investigation structure.

## Field Discipline

Evidence and generated data files must use original graph field names. Do not
rename, reinterpret, or add unit labels unless the schema or query result
explicitly supports that interpretation.

For this tracing workflow, asset classification is not needed to identify
exchange deposit candidates. The tool focuses on path shape,
source/destination addresses, exchange labels, aliases, `amount_sum`,
`amount_usd_sum`, tx counts, and tx ids.

## Agent Continuation Logic

After `track_funds` returns:

1. Read the summary and file paths.
2. Use `address_map` in reasoning and prose, but preserve full addresses when
   writing evidence, graph JSON, tables, and reports.
3. If `continuation.depositAddresses` is non-empty, those are evidence-backed
   exchange deposit candidates discovered so far.
4. Do not stop the investigation just because one exchange was found. Forward
   exchange paths, traceback source paths, and reverse leads are separate
   signals.
5. Do not continue through `Exchange` nodes. Traceback goes backward from
   deposit candidates; forward tracing terminates each exchange branch.
6. If the user asks "where did it go?", answer with deposit candidates and
   exchange endpoints first, then traceback source exchanges and leads.

Do not expand dossiers with long prose. Dossiers should contain short pointers
to the report and evidence files. The report and graph JSON carry the actual
investigation structure.

## Manual Fallback

Only hand-write `graph_query_batch` when the tool is unavailable or a custom
question is outside simple outbound fund tracing.

Manual forward exchange path pattern:

```cypher
MATCH p = (s:Address {address: "<full-address>"})
  -[:FLOWS_TO *BFS (e, v | e.amount_sum IS NOT NULL)]->
  (t:Exchange)
WHERE s <> t
  AND NOT any(n IN nodes(p)[1..-1] WHERE "Exchange" IN labels(n))
RETURN
  [n IN nodes(p) | n.address] AS addresses,
  [n IN nodes(p) | labels(n)] AS node_labels,
  [r IN relationships(p) | {
    amount_sum: r.amount_sum,
    amount_usd_sum: r.amount_usd_sum,
    tx_count: r.tx_count,
    first_tx_id: r.first_tx_id,
    last_tx_id: r.last_tx_id
  }] AS edge_props,
  t.address AS exchange_address,
  labels(t) AS exchange_labels,
  size(nodes(p)) - 1 AS hops
ORDER BY hops ASC
LIMIT 200
```
