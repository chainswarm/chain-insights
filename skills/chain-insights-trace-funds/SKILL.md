---
name: chain-insights-trace-funds
description: Use when tracing stolen funds to exchange deposit candidates in Chain Insights. Explains the trace_funds tool, how it stops before exchanges, what files it writes, and how an LLM agent should continue the investigation.
---

# Chain Insights Trace Funds

Use `trace_funds` for stolen-funds tracing before hand-writing
`graph_query_batch` hop queries. The goal is to find deposit candidates:
addresses one hop before an `Exchange`-labeled node.

This tool exists so the agent does not lose the investigation in chat context.
It executes the repeatable tracing loop, stores machine-readable files for
visualization, writes a human report, and returns only compact facts plus the
next continuation frontier.

## Tool

Call:

```text
trace_funds
```

Required inputs:

- `seed_address`: full source address to trace from.
- `network`: required network. Do not guess.

Optional inputs:

- `case_id`: when present, compact evidence is appended to the case manifest.
- `max_hops`: outbound `FLOWS_TO` search depth, default `3`, max `5`.
- `per_address_limit`: top outgoing flows per frontier address, default `5`, max `10`.
- `min_amount_sum`: optional minimum original graph `r.amount_sum`.

## Behind The Scenes

The tool:

1. Captures runtime graph schema if missing:
   - `.chain-insights/schema/<network>.graph-schema.json`
2. Reads only schema-backed flow fields:
   - `src.address AS src`
   - `dst.address AS dst`
   - `r.amount_sum AS amount_sum`
   - `r.amount_usd_sum AS amount_usd_sum`
   - `r.tx_count AS tx_count`
   - `r.first_tx_id AS first_tx_id`
   - `r.last_tx_id AS last_tx_id`
   - destination labels/degrees
3. Performs bounded breadth-first outbound tracing over `FLOWS_TO`.
   - If a destination has the `Exchange` label, the branch terminates.
   - The source of that terminal edge is recorded as a deposit candidate.
   - Exchange nodes are never added to the next frontier.
4. Writes artifacts:
   - `reports/graphs/*.graph.json`
   - `reports/tables/*.compact-evidence.json`
   - `reports/tables/*.flows.csv`
   - `reports/*.trace-report.md`
5. Returns:
   - concise facts,
   - file paths,
   - graph app metadata,
   - next leaf addresses for continuation.

It keeps evidence compact and does not store whole node/relationship property
objects, embeddings, or full feature vectors unless a query is explicitly for
schema discovery or debugging.

## Field Discipline

Evidence and generated data files must use original graph field names. Do not
rename, reinterpret, or add unit labels unless the schema or query result
explicitly supports that interpretation.

For this tracing workflow, asset classification is not needed to identify
exchange deposit candidates. The tool focuses on path shape,
source/destination addresses, exchange labels, `amount_sum`, `amount_usd_sum`,
tx counts, and tx ids.

## Agent Continuation Logic

After `trace_funds` returns:

1. Read the summary and file paths.
2. If `continuation.depositAddresses` is non-empty, those are the current
   evidence-backed exchange deposit candidates.
3. If no deposit candidates were found, continue from
   `continuation.nextHopAddresses`.
4. Do not continue through `Exchange` nodes.
5. If the user asks "where did it go?", answer with deposit candidates first,
   then explain whether the trace needs another hop from non-exchange leaves.

Do not expand dossiers with long prose. Dossiers should contain short pointers
to the report and evidence files. The report and graph JSON carry the actual
investigation structure.

## Manual Fallback

Only hand-write `graph_query_batch` when the tool is unavailable or a custom
question is outside simple outbound fund tracing.

Manual query pattern:

```cypher
MATCH (src:Address {address: "<full-address>"})-[r:FLOWS_TO]->(dst:Address)
WHERE r.amount_sum IS NOT NULL
RETURN
  src.address AS src,
  dst.address AS dst,
  r.amount_sum AS amount_sum,
  r.amount_usd_sum AS amount_usd_sum,
  r.tx_count AS tx_count,
  r.first_tx_id AS first_tx_id,
  r.last_tx_id AS last_tx_id,
  dst.labels AS dst_labels,
  dst.degree_in AS dst_degree_in,
  dst.degree_out AS dst_degree_out
ORDER BY r.amount_usd_sum DESC, r.amount_sum DESC
LIMIT 10
```
