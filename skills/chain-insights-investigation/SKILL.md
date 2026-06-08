---
name: chain-insights-investigation
description: Use when operating in a Chain Insights workspace or when the user asks to investigate blockchain activity, trace funds, analyze AML risk, use the cia/chain-insights CLI, work with workspace reports and artifacts, use graph_query, graph_query_batch, Bittensor, Ethereum, or Base investigation data. This skill is mandatory for Codex-led Chain Insights investigations.
---

# Chain Insights Investigation

Use the Chain Insights workspace workflow. Do not improvise an investigation workflow in chat.

## Debug Mode

For local development and UAT, enable Graph MCP debug mode before graph calls:

```bash
cia debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
cia debug status
```

Turn it off before paid-path testing:

```bash
cia debug off
```

## First Moves

1. Confirm the current directory is an initialized Chain Insights workspace:
   ```bash
   test -f .chain-insights/workspace.json && cat .chain-insights/workspace.json
   ```
   If this fails, stop and tell the user to run:
   ```bash
   cia init .
   ```
   No investigation output belongs under `~/.chain-insights`.
   No investigation output belongs under ~/.chain-insights.
2. Inspect live network support before choosing tools:
   ```bash
   cia mcp networks
   ```
   Use the advertised `Topology`, `Risk`, `Dataset`, and `Available tools`
   columns as the source of truth for the current GraphRAG endpoint. The
   `Dataset` column is the graph coverage range, usually
   `<first_height>..<last_height> / <first_date>..<last_date>`.
3. Read workspace runtime schema notes:
   ```bash
   test -f .chain-insights/runtime-skill/SKILL.md && sed -n '1,220p' .chain-insights/runtime-skill/SKILL.md
   ```
4. If `.chain-insights/schema/<network>.graph-schema.json` does not exist, capture schema before the first graph workflow:
   ```bash
   mkdir -p .chain-insights/schema
   cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"USE live_topology MATCH (n:Address) RETURN \"Address\" AS node_label, count(n) AS sample_count LIMIT 1"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (:Address)-[f:FLOWS_TO]->(:Address) RETURN f.period_granularity AS granularity, f.amount_sum AS amount_sum LIMIT 20"}]' > .chain-insights/schema/<network>.graph-schema.raw.json
   ```
5. Make sure the canonical workspace output roots exist:
   ```bash
   mkdir -p reports reports/graphs reports/tables artifacts entities sessions
   ```

## Hard Rules

- Always preserve full blockchain addresses exactly.
- Bittensor contains both native Substrate/SS58 addresses such as `5...` and EVM-pallet `0x...` addresses in the same investigation network. Use `network=bittensor` for both; do not switch networks based only on address format.
- Preserve any returned `address_type` evidence exactly.
- Python GraphRAG MCP is the golden behavior for `aml_address_risk` and the original victim/source tracing semantics.
- `GraphRAGQueryEngine.check_aml_address_risk` is the golden single-address reference behavior.
- Never call graph tools without an explicit `network`.
- Never assume network support. Run `cia mcp networks` first.
- Never treat user claims as facts until tool output supports them.
- Never leave material tool output only in chat. Save it into the initialized workspace under `reports/`, `reports/tables/`, `reports/graphs/`, `artifacts/`, `entities/`, or `sessions/` as appropriate.
- Keep evidence compact and use original graph field names.
- Store visualization data in `reports/graphs/` and analyst tables in `reports/tables/`.
- Prefer `cia` commands over direct file edits when a command exists.
- Use `graph_query_batch` for related graph reads.
- Use read-only Cypher only: no `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `DROP`, or `DETACH`.
- Bound graph reads with `LIMIT`.

## Tool Selection

Use `aml_address_risk` first for ordinary single-address screening.

Use `aml_trace_victim_funds` when the user has victim/source addresses.
The victim/source traversal is outward from victim/source funds.
Use exchange terminal safety and treat the penultimate non-exchange address as the deposit candidate.
Required input field: `victim_addresses`.

Use `aml_trace_deposit_sources` when the user has suspected deposit/cashout addresses and wants to find direct funders, upstream funders, and shared-source convergence.
Candidate labels are reviewable, not automatic writes.

Use `aml_trace_suspect_funds` when the user has suspected scammer, mule, operator, or laundering-ring addresses.
`incident_timestamp_ms` is optional.
Some Graph MCP deployments do not parse backend-specific BFS or variable-length relationship syntax, so they reproduce this with generated fixed-depth `FLOWS_TO` query batches.

```bash
cia mcp trace-victim-funds --network bittensor --victim-addresses 5... --max-hops 3
cia mcp trace-deposit-sources --network bittensor --deposit-addresses 5... --max-hops 2
cia mcp trace-suspect-funds --network bittensor --suspect-addresses 5... --max-hops 16
```

All three tools return `chain-insights.trace.v1`, including `candidate_labels` and `continuation`. Candidate labels are reviewable, not automatic writes.

Use manual `graph_query_batch` for custom topology or fact questions. Use `USE live_topology` for recent topology, `USE archive_topology` for historical topology, and `USE facts` for facts and enrichment.
When writing custom Cypher, use the shipped `chain-insights-cypher` skill; for Bittensor, also use `chain-insights-bittensor-cypher`.
Treat exchange hot wallets as terminal endpoints only.
exchange hot wallets are terminal endpoints only
Use `chain-insights.evidence_pointer.v1` style compact provenance when a workflow points to saved workspace files.
LLM Wiki is a downstream view over exported workspace evidence, not the source of truth.

## Query And Persistence Loop

Default to compact evidence. Preserve source schema field names and avoid adding derived aliases or unit labels unless the schema or query result explicitly supports them.

For every material graph/tool query:

1. Write output to a workspace-local file with narrow Cypher projections:
   ```bash
   cia mcp call graph_query_batch \
     network=<network> \
     'queries=[{"id":"<stable_id>","query":"USE live_topology MATCH ... RETURN ... LIMIT 50"}]' \
     > reports/tables/<stable_id>.raw.json
   ```
2. Reduce the output if the tool returned extra fields:
   ```bash
   jq '{schema:"chain-insights.compact_evidence.v1", facts:<selected-fields>}' \
     reports/tables/<stable_id>.raw.json > reports/tables/<stable_id>.compact.json
   ```
3. Write a short analyst report that points to the compact JSON or graph files:
   ```bash
   cat > reports/<stable_id>.md <<'EOF'
   # <Title>

   - Network: <network>
   - Source: graph_query_batch
   - Compact facts: reports/tables/<stable_id>.compact.json
   - Status: evidence-backed summary here
   EOF
   ```
4. If the query supports a durable entity finding, add a short note under `entities/`:
   ```bash
   cat > entities/<safe-address>.md <<'EOF'
   # Entity Note

   See reports/<stable_id>.md and reports/tables/<stable_id>.compact.json.
   EOF
   ```
5. If the query produced graph-ready topology data, save `chain-insights.graph.v1` JSON to `reports/graphs/`.

## Fresh Workspace UAT

When validating the skill or Chain Insights investigation flow, run the bundled script from the Chain Insights repo:

```bash
skills/chain-insights-investigation/scripts/run-target-uat.sh
```

The script creates a fresh workspace, enables debug mode, captures runtime graph schema, runs `graph_query_batch`, saves compact JSON to `reports/tables/`, writes a short report under `reports/`, writes an entity note under `entities/`, and verifies the resulting workspace state.
