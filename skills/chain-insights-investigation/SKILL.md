---
name: chain-insights-investigation
description: Use when operating in a Chain Insights investigation workspace or when the user asks to investigate blockchain activity, trace funds, analyze AML risk, use the cia/chain-insights CLI, work with cases, sessions, evidence, dossiers, graph_query, graph_query_batch, Bittensor, Ethereum, or Base investigation data. This skill is mandatory for Codex-led Chain Insights investigations.
---

# Chain Insights Investigation

Use the Chain Insights framework. Do not improvise an investigation workflow in chat.

## Debug Mode

For local development and UAT, enable Graph MCP debug mode before graph calls:

```bash
cia debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
cia debug status
```

Debug mode disables x402 payments for Graph MCP calls and requires a configured debug token.

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
   No investigation output belongs under ~/.chain-insights.
2. Inspect live network support before choosing tools:
   ```bash
   cia mcp networks
   ```
   Use the advertised `Topology`, `Risk`, `Dataset`, and `Available tools`
   columns as the source of truth for the current GraphRAG endpoint. The
   `Dataset` column is the graph coverage range, usually
   `<first_height>..<last_height> / <first_date>..<last_date>`. If an incident,
   address activity, or requested chain falls outside that range, state that
   limitation before querying. Do not call `address_risk` unless the selected
   network advertises risk support and `address_risk` is available. If only
   topology is available, use `stake_insights`, `trace_victim_funds`,
   `trace_suspect_funds`, `trace_deposit_sources`, or `graph_query_batch`
   with `USE live_topology` as appropriate. Use
   `graph_query_batch` with `USE archive_topology`
   for historical money-flow topology, and `USE facts`
   for graph-language facts and enrichment.
3. Read workspace runtime schema notes:
   ```bash
   test -f .chain-insights/runtime-skill/SKILL.md && sed -n '1,220p' .chain-insights/runtime-skill/SKILL.md
   ```
4. If `.chain-insights/schema/<network>.graph-schema.json` does not exist, capture schema before case queries:
   ```bash
   mkdir -p .chain-insights/schema
   cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"USE live_topology MATCH (n:Address) RETURN \"Address\" AS node_label, count(n) AS sample_count LIMIT 1"},{"id":"relationship_types","query":"USE live_topology MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN \"FLOWS_TO\" AS rel_name, count(r) AS sample_count LIMIT 1"},{"id":"address_sample","query":"USE live_topology MATCH (n:Address) RETURN n.address AS address, n.labels AS labels LIMIT 20"},{"id":"flow_sample","query":"USE live_topology MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.amount_sum AS amount_sum, r.amount_usd_sum AS amount_usd_sum LIMIT 20"},{"id":"archive_flow_sample","query":"USE archive_topology MATCH (:Address)-[f:FLOWS_TO]->(:Address) RETURN f.period_granularity AS granularity, f.amount_sum AS amount_sum LIMIT 20"}]' > .chain-insights/schema/<network>.graph-schema.raw.json
   ```
   Reduce the raw schema into `.chain-insights/schema/<network>.graph-schema.json` and update `.chain-insights/runtime-skill/SKILL.md` with the observed fields.
5. List cases:
   ```bash
   cia case list
   ```
6. If a case exists and the user did not choose one, ask which numbered case to use.
7. If no case exists but the user gave an address/topic, create one with a descriptive name:
   ```bash
   cia case open "Tracking stolen funds from <full-address>" --tags <network-or-domain>
   ```
8. Show selected case before investigating:
   ```bash
   cia case show <case-number>
   ```
9. Start or reuse the active session:
   ```bash
   cia case session start <case-number> "short session title"
   ```

`cia case show` displays context. It does not start work.

## Hard Rules

- Always preserve full blockchain addresses exactly.
- Bittensor contains both native Substrate/SS58 addresses such as `5...` and
  EVM-pallet `0x...` addresses in the same investigation network. Use
  `network=bittensor` for both; do not switch networks based only on address
  format. Preserve the exact address and any returned `address_type` evidence.
- Python GraphRAG MCP is the golden behavior for `address_risk` and the
  original victim/source tracing semantics. Chain Insights MCP may expose its
  own high-level tools, but their graph semantics must be a faithful port of
  the Python tools.
- When the upstream server is Go Graph MCP, high-level Chain Insights tools
  must implement Python-compatible orchestration by calling `graph_query` or
  `graph_query_batch`. Prefer `USE live_topology` for recent topology,
  `USE archive_topology` for historical topology, and `USE facts`
  for facts and enrichment. Do not replace Python probe semantics with
  simplified local recipes.
- For victim/source and suspect exchange-deposit discovery, preserve Python
  `BFSOps`/`StolenFundsProbe` forward semantics: search to `Address` nodes
  where `is_exchange IS NOT NULL`, stop at exchange nodes, and treat `path[-2]`
  as the deposit candidate. Do not run deposit traceback inside
  `trace_victim_funds`; use `trace_deposit_sources` for backward/source
  discovery. Some Graph MCP deployments do not parse backend-specific BFS or
  variable-length relationship syntax, so they reproduce this with generated fixed-depth `FLOWS_TO` query batches.
- When using BFS, fixed-depth traversal fallbacks, or any manual `FLOWS_TO`
  traversal, exchange hot wallets are terminal endpoints only. Do not expand
  from, through, or classify exchange nodes as deposit, suspect, or
  intermediate candidates. In Cypher, require every non-terminal traversal node
  to satisfy `is_exchange IS NULL`; only the final exchange endpoint should
  satisfy `is_exchange IS NOT NULL`.
- For `address_risk`, Python `GraphRAGQueryEngine.check_address_risk` is the
  golden behavior: bounded neighborhood expansion with exchange-stopped waves,
  risk/scoring fields, lookalikes, forward exchange
  discovery, and backward `BFSOps.bfs_backward` source-exchange discovery.
  Chain Insights may call Go MCP primitives, but it must not reduce
  `address_risk` to only a profile lookup.
- Never call graph tools without an explicit `network`.
- Never assume network support. Run `cia mcp networks` first and respect the
  advertised `Available tools` plus the `Dataset` height/date range.
- Never treat user claims as facts until tool output supports them.
- Never leave material tool output only in chat. Save it as evidence.
- Keep evidence compact and use original graph field names. Evidence Markdown should summarize and point to files; large JSON belongs in `reports/tables/`.
- Store visualization data in `reports/graphs/` and analyst tables in `reports/tables/` under the initialized workspace.
- Prefer Mermaid/table reports over long prose dossiers.
- Prefer `cia` commands over direct file edits.
- Do not use `cia case resume`; use `cia case show`.
- Use numbered case selectors from `cia case list`.
- Use `graph_query_batch` for related graph reads.
- Use read-only Cypher only: no `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `DROP`, or `DETACH`.
- Bound graph reads with `LIMIT`.

## Tool Selection

Tool selection is network-dependent:

- `Topology: yes` means graph topology tools can run for that network.
- `Risk: yes` means risk-aware tools such as `address_risk` can be used.
- `Dataset` defines the graph coverage window. Use it to qualify conclusions;
  do not imply coverage before the first advertised height/date or after the
  last advertised height/date.
- `Available tools` is authoritative. If a tool is not listed as available,
  fall back to the available lower-level graph tools or tell the user the
  network is not supported for that workflow yet.

Use `address_risk` first for ordinary single-address screening. It measures
risk, neighborhood context, and exchange behavior together, including exchange
inflow and outflow paths. Do not use retired separate exchange-flow tools as a
primary workflow; that behavior belongs in `address_risk`.

Use `address_risk` with `compare_address` when the user asks whether two
addresses are connected or whether a relationship is risky. Use compare mode
as the unified connection-risk path.

Use `trace_victim_funds` when the user has victim/source addresses. It accepts
up to five `victim_addresses` plus optional `known_suspect_addresses` as
context only. The victim/source traversal is outward from victim/source funds;
do not query or promote victim inbound transfers as scam infrastructure. This
uses exchange terminal safety: stop at exchange endpoints and treat the
penultimate non-exchange address as the deposit candidate.

Use `trace_deposit_sources` when the user has suspected deposit/cashout
addresses and wants to find direct funders, upstream funders, and shared-source
convergence. Deposit seeds must be non-exchange addresses; if the supplied
seed is an exchange hot wallet, use `address_risk` or a narrow manual
`graph_query_batch` for exchange exposure instead of traceback. Candidate
suspects are reviewable, not automatic writes to `core_address_labels`.

Use `trace_suspect_funds` when the user has suspected scammer, mule, operator,
or laundering-ring addresses. It traces suspect-controlled funds forward to
cashout topology. `incident_timestamp_ms` is optional; lack of a timestamp is
valid.

```bash
cia mcp trace-victim-funds --network bittensor --victim-addresses 5... --max-hops 3 --case 1
cia mcp trace-deposit-sources --network bittensor --deposit-addresses 5... --max-hops 2 --case 1
cia mcp trace-suspect-funds --network bittensor --suspect-addresses 5... --max-hops 16
```

All three tools return `chain-insights.trace.v1`, including `candidate_labels`
and `continuation`. Candidate labels are reviewable, not automatic writes. If
`case_id` or CLI `--case` is provided, trace tools write compact
`chain-insights.evidence_pointer.v1` entries that reference workspace-local
compact evidence JSON, graph JSON, graph HTML, CSV, and Markdown report files
under `reports/`.

Use manual `graph_query_batch` for custom topology or fact questions. Use
`USE live_topology` for recent topology, `USE archive_topology` for historical
topology, and `USE facts` for facts and enrichment.
Use `graph_query` or `graph_query_batch` for all graph-language reads.
When writing custom Cypher, use the shipped `chain-insights-cypher` skill; for
Bittensor, also use `chain-insights-bittensor-cypher`.

## Query And Evidence Loop

Default to compact evidence. Preserve source schema field names and avoid adding
derived aliases or unit labels unless the schema or query result explicitly
supports them. Select only fields needed to support the claim, such as source,
destination, relationship type, amount fields, tx counts, tx ids, labels, and
degrees. Avoid storing whole node or relationship property blobs in evidence
unless the query is explicitly for schema discovery or debugging.

For every material graph/tool query:

1. Write output to a temp file with narrow Cypher projections:
   ```bash
   cia mcp call graph_query_batch \
     network=<network> \
     'queries=[{"id":"<stable_id>","query":"USE live_topology MATCH ... RETURN ... LIMIT 50"}]' \
     > /tmp/<stable_id>.json
   ```
2. Inspect the output and reduce it if the tool returned extra fields:
   ```bash
   jq '{schema:"chain-insights.compact_evidence.v1", facts:<selected-fields>}' \
     /tmp/<stable_id>.json > /tmp/<stable_id>.compact.json
   ```
3. Save the compact output as evidence. If the JSON is large, Chain Insights stores it under `reports/tables/` and keeps the evidence Markdown as a summary plus pointer:
   ```bash
   cia case evidence add <case-number> \
     --source graph_query_batch_compact \
     --query-params "network=<network> id=<stable_id> ..." \
     --content "$(cat /tmp/<stable_id>.compact.json)"
   ```
4. Only after evidence is saved, summarize what the output supports and what remains unknown.
5. Write graph/table/report outputs when the query describes fund movement:
   ```bash
   mkdir -p reports/graphs reports/tables
   ```
   Save `chain-insights.graph.v1` JSON to `reports/graphs/` for visualization, tabular extracts to `reports/tables/`, and Mermaid/table analyst reports to `reports/`.
6. If an address/entity finding becomes durable, update the dossier with one short pointer, not a full report:
   ```bash
   cia case dossier update <case-number> <full-address> \
     --type unknown \
     --finding "See reports/<report>.md and evidence <filename>."
   ```

## Quoting Pattern

Keep MCP JSON arguments on one shell line. Raw newlines inside JSON strings break parsing.

Good:
```bash
cia mcp call graph_query_batch network=bittensor 'queries=[{"id":"address_exists","query":"USE live_topology MATCH (n:Address {address: \"5...\"}) RETURN n.address AS address, n.labels AS labels LIMIT 1"},{"id":"address_feature","query":"USE facts MATCH (:Address {address: \"5...\"})-[:HAS_FEATURE]->(feature:AddressFeature) RETURN feature.degree_in AS degree_in, feature.degree_out AS degree_out, feature.tx_total_count AS tx_total_count LIMIT 1"}]'
```

Bad:
```bash
'queries=[{"id":"address_exists","query":"MATCH (n {address:
\"5...\"}) RETURN ..."}]'
```

## Session Closeout

At the end of a work pass:

```bash
cia case session end <case-number> \
  --findings "Evidence-backed findings from this session." \
  --next-steps "Concrete next graph queries or checks."
```

Then show the case:

```bash
cia case show <case-number>
```

## Case Export

When a case reaches a useful checkpoint, run `cia case evidence verify <case>`
before export. Then run:

```bash
cia case export <case> --target obsidian-llmwiki --mode private
```

Treat `manifest.chain-insights.json`, case evidence, and report artifacts as
canonical. Treat Obsidian, LLMWiki, Codex, Claude Code, and ChatGPT notes as
views over that evidence.

## When Asked "What Next?"

Give one concrete next command, not a broad menu. Prefer the next topology or fact query, or the next evidence-save step.

## Fresh Workspace UAT

When validating the skill or Chain Insights investigation flow, run the bundled script from the Chain Insights repo:

```bash
skills/chain-insights-investigation/scripts/run-target-uat.sh
```

The script creates a fresh investigation workspace, enables debug mode, captures runtime graph schema, opens a case for `5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5`, starts a session, runs `graph_query_batch`, saves compact evidence with original field names, updates a lightweight dossier pointer, ends the session, and verifies the resulting case state.

Environment overrides:

```bash
TARGET_ADDRESS=5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
NETWORK=bittensor \
GRAPH_MCP_ENDPOINT=http://localhost:8012/mcp \
GRAPH_MCP_DEBUG_TOKEN=chain-insights-dev-debug \
WORKSPACE_ROOT=/tmp/ci-investigation-uat \
skills/chain-insights-investigation/scripts/run-target-uat.sh
```
