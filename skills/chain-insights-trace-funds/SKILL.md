---
name: chain-insights-trace-funds
description: Use when tracing stolen funds to exchange deposit candidates in Chain Insights. Explains the public track_funds workflow, traceback/source discovery, address aliases, compact evidence pointers, and graph/report outputs.
---

# Chain Insights Fund Flow Tracking

This compatibility skill file documents the public Chain Insights fund-flow
workflow. Use the `track_funds` MCP tool for stolen-fund tracing, victim/source
fund-flow analysis, and exchange-deposit candidate discovery.

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

Before selecting a tracing method, inspect the live GraphRAG network matrix:

```bash
cia mcp networks
```

Use the output as the source of truth:

- `Topology: yes` is required for fund-flow tracing.
- `Available tools` must include `track_funds`; otherwise use `graph_query` or
  `graph_query_batch` with `USE live_topology` for manual topology diagnostics.
- `Dataset` gives the graph coverage range as
  `<first_height>..<last_height> / <first_date>..<last_date>`. State this range
  in the investigation scope, and do not claim tracing coverage outside it.
- `Risk: yes` is not required for `track_funds`, but it determines whether
  downstream `address_risk` enrichment is available on the same network.

Use `track_funds` when the investigation has victim/source addresses and may
also include known scammer addresses. It accepts up to five
`trusted_addresses` and up to five `untrusted_addresses`, preserves those
roles, and runs the local tracing engine per address.

Use `scam_topology` when the user has known victim incident ground truth and
wants to derive ML-ready `scam_labels` plus reviewable laundering context.
`track_funds` answers where funds went; `scam_topology` answers which outward
victim incident topology, laundering intermediates, exchange deposit
candidates, exchange endpoints, and generic context boundaries were observed.
The victim-only traversal is outward from victim/source funds; it does not
query or promote victim inbound transfers as scam infrastructure.
`incident_timestamp_ms` anchors only the first victim outflow; downstream
traversal can enter older scam infrastructure. Exchange terminal safety is the
only hard-coded terminal behavior; non-exchange labels are context hints.
Victim/source addresses are not risky labels. The tool returns `label_candidates`
for analyst review; candidates are reviewable, not automatic writes to
`core_address_labels`.

```bash
cia mcp scam-topology --network bittensor --victim-address 5... --incident-timestamp-ms 1715532228001 --max-hops 16
```

Use `track_funds` for a single address by passing that address as the only
`trusted_addresses` value. The workflow is a TypeScript port of the probe
workflow, not a simple top-K hop walker. The goal is to find all reachable
exchange-deposit paths the graph can return within query limits, then traceback
those deposits toward source exchanges and enrich the result with reverse 1-hop
leads.

Python GraphRAG MCP is the golden implementation. Do not degrade this workflow
into a simple top-K neighbor recipe. When Chain Insights runs against the Go
Graph MCP, it should still reproduce Python `BFSOps` and `StolenFundsProbe`
semantics by issuing read-only `graph_query_batch` calls with `USE live_topology`.

Current MemGQL does not parse Memgraph `*BFS` or variable-length relationship
syntax. Against Go Graph MCP, exchange-deposit discovery therefore uses
generated fixed-depth `FLOWS_TO` query batches up to the requested hop limit,
requires `t.is_exchange IS NOT NULL`, prevents intermediate exchange hops, and
treats the penultimate address as the deposit candidate.

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
- `case_id`: when present, per-address evidence stores compact pointers to reports.
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

- `case_id`: when present, evidence stores a compact pointer to report/table/graph files.
- `max_hops`: legacy compatibility knob; probe-style exchange search is bounded primarily by query timeout and result limits.
- `per_address_limit`: controls the forward exchange path result budget.
- `min_amount_sum`: optional minimum original graph `r.amount_sum`.

## Behind The Scenes

The tool:

1. Captures runtime graph schema if missing:
   - `.chain-insights/schema/<network>.graph-schema.json`
2. Runs Python-probe-style forward exchange path query batches:
   - generated fixed-depth `MATCH (s)-[r1:FLOWS_TO]->...->(t)` queries
     because current MemGQL rejects `*BFS` and `*1..N` syntax,
   - excludes paths that traverse through an intermediate exchange,
   - records node and relationship projections,
   - treats `path[-2]` as the exchange deposit candidate.
3. Runs traceback/source discovery:
   - generated fixed-depth backward reads from each deposit toward source exchanges,
   - reverse 1-hop from deposits to surface leads,
   - lead reasons include labeled entity, fan-in hub, or high-volume sender.
4. Assigns aliases:
   - `V*` seed/victim/source address,
   - `D*` deposit candidates,
   - `E*` forward exchange endpoints,
   - `X*` traceback source exchanges,
   - `L*` reverse 1-hop leads,
   - `I*` intermediaries.
5. Writes workspace-local reports:
   - `reports/graphs/*.graph.json`
   - served by the local Hono server at `/graph-reports/<filename>.graph.json`
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

Case evidence should stay compact. It should point to report files and include
hashable provenance/facts, not paste the full graph/table JSON into markdown.
The JSON/CSV/Markdown reports carry the investigation structure.

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

## Manual Topology Query

Only hand-write `graph_query_batch` when the tool is unavailable or a custom
question is outside simple outbound fund tracing. Prefix topology queries with
`USE live_topology`.

Manual forward exchange path pattern:

```cypher
MATCH (s:Address {address: "<full-address>"})
  -[r1:FLOWS_TO]->(n1:Address)
  -[r2:FLOWS_TO]->(t:Address)
WHERE t.is_exchange IS NOT NULL
  AND s <> t
  AND n1.is_exchange IS NULL
  AND r1.amount_sum IS NOT NULL
  AND r2.amount_sum IS NOT NULL
RETURN
  [s.address, n1.address, t.address] AS addresses,
  [s.labels, n1.labels, t.labels] AS node_labels,
  [
    {amount_sum: r1.amount_sum, amount_usd_sum: r1.amount_usd_sum, tx_count: r1.tx_count},
    {amount_sum: r2.amount_sum, amount_usd_sum: r2.amount_usd_sum, tx_count: r2.tx_count}
  ] AS edge_props,
  t.address AS exchange_address,
  t.labels AS exchange_labels,
  2 AS hops
ORDER BY hops ASC
LIMIT 200
```
