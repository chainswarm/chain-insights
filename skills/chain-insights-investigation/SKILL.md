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
   topology is available, use `track_funds`, `scam_topology`, or
   `graph_query_batch` with `USE live_topology` as appropriate. Use
   `graph_query_batch` with `USE archive_topology`
   for historical money-flow topology, and `USE facts`
   for graph-language StarRocks facts exposed through `facts_*_view`.
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
- Python GraphRAG MCP is the golden behavior for `address_risk` and
  `track_funds`. Chain Insights MCP may expose its own high-level tools, but
  their graph semantics must be a faithful port of the Python tools.
- When the upstream server is Go Graph MCP, high-level Chain Insights tools
  must implement Python-compatible orchestration by calling `graph_query` or
  `graph_query_batch`. Prefer `USE live_topology` for Memgraph RAM topology,
  `USE archive_topology` for StarRocks historical topology, and `USE facts`
  for StarRocks facts. Do not replace Python probe semantics with
  simplified local recipes.
- For exchange-deposit discovery, preserve Python `BFSOps`/`StolenFundsProbe`
  semantics: forward search to `Address` nodes where `is_exchange IS NOT NULL`,
  stop at exchange nodes, treat `path[-2]` as the deposit candidate, then run
  backward/source and reverse-lead stages. Current MemGQL does not parse
  Memgraph `*BFS` or variable-length relationship syntax, so Go Graph MCP
  deployments reproduce this with generated fixed-depth `FLOWS_TO` query batches.
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

Use `address_risk` first for ordinary address screening. It measures risk,
neighborhood context, and exchange behavior together, including exchange inflow
and outflow paths. Do not use retired separate exchange-flow tools as a primary
workflow; that behavior belongs in `address_risk`.

Use `address_risk` with `compare_address` when the user asks whether two
addresses are connected or whether a relationship is risky. Use compare mode
as the unified connection-risk path.

Use `track_funds` when the user has victim/source addresses and may also have
known scammer addresses. It accepts up to five `trusted_addresses` and up to
five `untrusted_addresses`, preserves those roles, and traces each through the
local tracing engine.

Use `track_funds` for stolen-fund and fund-flow work, including single-address
fund-flow tracing by passing one address as the only `trusted_addresses` value.

Use `scam_topology` when known scam ground truth should become laundering-role
evidence and reviewable label candidates. The victim-only traversal is outward
from victim/source funds, so do not query or promote victim inbound transfers as
scam infrastructure. Use `scope=history|incident|compare`: history reads
`USE archive_topology`, incident reads `USE live_topology` with optional
`since_timestamp_ms`, and compare marks history-only, incident-only, or overlap
membership. Exchange terminal safety is the only hard-coded terminal behavior;
other labels are generic context hints. Victim/source addresses are not risky
labels; known scammer seeds can become confirmed-risk candidates, while
laundering intermediates and exchange deposit candidates are reviewable, not
automatic writes to `core_address_labels`.

```bash
cia mcp scam-topology --network bittensor --victim-addresses 5... --scope history --max-hops 5
cia mcp scam-topology --network bittensor --victim-addresses 5... --scope incident --since-timestamp-ms 1715532228001 --max-hops 5
```

Use manual `graph_query_batch` for custom topology or fact questions. Use
`USE live_topology` for Memgraph RAM topology, `USE archive_topology` for
StarRocks historical topology, and `USE facts` for StarRocks facts.
Use `graph_query` or `graph_query_batch` for all graph-language reads.

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
