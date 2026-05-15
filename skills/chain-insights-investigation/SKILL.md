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

1. Confirm workspace:
   ```bash
   test -f .chain-insights/workspace.json && cat .chain-insights/workspace.json
   ```
2. Read workspace runtime schema notes:
   ```bash
   test -f .chain-insights/runtime-skill/SKILL.md && sed -n '1,220p' .chain-insights/runtime-skill/SKILL.md
   ```
3. If `.chain-insights/schema/<network>.graph-schema.json` does not exist, capture schema before case queries:
   ```bash
   mkdir -p .chain-insights/schema
   cia mcp call graph_query_batch network=<network> 'queries=[{"id":"node_labels","query":"MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY count DESC LIMIT 100"},{"id":"relationship_types","query":"MATCH ()-[r]->() RETURN type(r) AS relationship_type, count(*) AS count ORDER BY count DESC LIMIT 100"},{"id":"address_property_keys","query":"MATCH (n:Address) WITH keys(n) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"},{"id":"flows_to_property_keys","query":"MATCH ()-[r:FLOWS_TO]->() WITH keys(r) AS keys LIMIT 1000 UNWIND keys AS property_key RETURN property_key, count(*) AS sample_count ORDER BY sample_count DESC, property_key LIMIT 200"}]' > .chain-insights/schema/<network>.graph-schema.raw.json
   ```
   Reduce the raw schema into `.chain-insights/schema/<network>.graph-schema.json` and update `.chain-insights/runtime-skill/SKILL.md` with the observed fields.
4. List cases:
   ```bash
   cia case list
   ```
5. If a case exists and the user did not choose one, ask which numbered case to use.
6. If no case exists but the user gave an address/topic, create one with a descriptive name:
   ```bash
   cia case open "Tracking stolen funds from <full-address>" --tags <network-or-domain>
   ```
7. Show selected case before investigating:
   ```bash
   cia case show <case-number>
   ```
8. Start or reuse the active session:
   ```bash
   cia case session start <case-number> "short session title"
   ```

`cia case show` displays context. It does not start work.

## Hard Rules

- Always preserve full blockchain addresses exactly.
- Never call graph tools without an explicit `network`.
- Never treat user claims as facts until tool output supports them.
- Never leave material tool output only in chat. Save it as evidence.
- Keep evidence compact and use original graph field names.
- Store visualization data in `reports/graphs/` and analyst tables in `reports/tables/`.
- Prefer Mermaid/table reports over long prose dossiers.
- Prefer `cia` commands over direct file edits.
- Do not use `cia case resume`; use `cia case show`.
- Use numbered case selectors from `cia case list`.
- Use `graph_query_batch` for related graph reads.
- Use read-only Cypher only: no `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `DROP`, or `DETACH`.
- Bound graph reads with `LIMIT`.

## Query And Evidence Loop

For stolen-funds tracing or ordinary outbound money movement, prefer the
`trace_funds` tool from the `chain-insights-trace-funds` skill. It
captures schema, follows bounded `FLOWS_TO` hops, writes graph/table/report
files, saves compact evidence when given a case, and returns continuation
addresses. Use manual `graph_query_batch` only for custom questions or fallback.

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
     'queries=[{"id":"<stable_id>","query":"<read-only Cypher with LIMIT>"}]' \
     > /tmp/<stable_id>.json
   ```
2. Inspect the output and reduce it if the tool returned extra fields:
   ```bash
   jq '{schema:"chain-insights.compact_evidence.v1", facts:<selected-fields>}' \
     /tmp/<stable_id>.json > /tmp/<stable_id>.compact.json
   ```
3. Save the compact output as evidence:
   ```bash
   cia case evidence add <case-number> \
     --source graph_query_batch_compact \
     --query-params "network=<network> id=<stable_id> ..." \
     --content "$(cat /tmp/<stable_id>.compact.json)"
   ```
4. Only after evidence is saved, summarize what the output supports and what remains unknown.
5. Write graph/table/report artifacts when the query describes fund movement:
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
cia mcp call graph_query_batch network=bittensor 'queries=[{"id":"address_exists","query":"MATCH (n:Address {address: \"5...\"}) RETURN n.address AS address, labels(n) AS labels, n.degree_in AS degree_in, n.degree_out AS degree_out, n.tx_total_count AS tx_total_count LIMIT 1"}]'
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

Give one concrete next command, not a broad menu. Prefer the next graph query or the next evidence-save step.

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
