# Chain Insights MCP and Framework Split Design

## Context

Chain Insights now has two distinct jobs that should not be collapsed into one product surface.

The first job is an MCP connector: connect the paid GraphRAG `graph_query` primitive to clients, pay with x402, hold an encrypted local wallet, expose a working balance widget, and keep Chain Insights tool schemas/prompts stable across Claude Desktop, Claude Code, Codex, and generic MCP clients.

The second job is an investigation framework: create visible case workspaces, store claims/evidence/dossiers/sessions/reports as files, generate local graph HTML/JSON, serve the workspace from localhost, and let Codex, Claude Code, Hermes, or another agent operate over those files.

Claude Desktop remains supported for the MCP connector. It is not the primary target for the investigation framework. Memgraph Lab is a developer debugging aid, not an operator workflow dependency.

## Goals

- Split Chain Insights into an `mcp` layer and a richer case/framework layer.
- Keep GraphRAG `graph_query` proxied into multiple clients: Claude Desktop, Claude Code, Codex, and other MCP clients.
- Keep x402 payment and the local encrypted wallet in the `mcp` layer.
- Keep the working `balance` widget/tool.
- Stop advertising `topup` as a happy-path tool because it is not a reliable working flow.
- Keep basic graph MCP app compatibility for clients that support `_meta` and HTML app resources.
- Build the framework around visible editor/terminal workspaces, not Claude Desktop.
- Store durable investigation state as Markdown/JSON files.
- Support lightweight claims/theories without rigid categorization.
- Generate local HTML/JSON graph visualizations for framework workspaces.
- Use Superpowers/GSD-style skills and workspace instructions as agent workflow guidance.

## Non-Goals

- Do not make a local LangChain, AutoGen, or custom LLM runtime that needs an API key inside Chain Insights.
- Do not make Claude Desktop the primary framework UX.
- Do not make Memgraph Lab part of normal operator usage.
- Do not create a rigid claim taxonomy before real investigations need it.
- Do not install a full framework copy into every case folder.
- Do not hide case state in a database-only UI.
- Do not keep advertising `topup` until it is redesigned and verified.

## Product Surfaces

### `chain-insights mcp`

The `mcp` surface is the universal connector and payment layer.

Responsibilities:

- GraphRAG `graph_query` proxy.
- x402 payment fetch.
- encrypted local wallet.
- `balance` widget/tool.
- public tool schemas and descriptions.
- public prompts for Chain Insights investigation tools built on `graph_query`.
- basic graph MCP app compatibility through `_meta`.
- setup docs for Claude Desktop, Claude Code, Codex, and other MCP clients.

Advertised MCP tools:

```text
help
balance
address_risk
track_funds
money_flows_between_exchanges
address_connection_risk
graph_query
```

`topup` is not part of the advertised happy path. Funding should be handled through the wallet address / QR / balance surface until a separate top-up flow is implemented and verified.

The `mcp` surface does not own claims, dossiers, hardening workflows, reports, or case workspace UX.

## GraphRAG Public Boundary

GraphRAG MCP is the paid graph primitive. It should expose `graph_query` only on both public and private MCP surfaces.

GraphRAG owns:

- StarRocks-to-Memgraph sync.
- Memgraph schema and graph model.
- read-only Cypher execution.
- x402 price enforcement for `graph_query`.
- debug bearer bypass for local testing.
- network routing and graph health.

GraphRAG does not own:

- `address_risk`.
- `track_funds`.
- `money_flows_between_exchanges`.
- `address_connection_risk`.
- private probe workflows.
- investigation narratives.
- case workspaces.
- claims, dossiers, sessions, or reports.
- graph visualization artifacts for high-level investigations.

The high-level Python tool code can remain in GraphRAG as reference code while Chain Insights ports the behavior. It must not be registered as active GraphRAG MCP tools.

## High-Level Tool Migration

Chain Insights should re-implement high-level AML tools as local recipes over `graph_query`.

Migration target:

```text
address_risk                      -> Chain Insights recipe over graph_query
track_funds                       -> Chain Insights recipe over graph_query
money_flows_between_exchanges     -> Chain Insights recipe over graph_query
address_connection_risk           -> Chain Insights recipe over graph_query
private probes                    -> Chain Insights recipes or framework workflows
```

Definition of done for each ported tool:

- Uses one or more bounded `graph_query` calls.
- Produces the Chain Insights MCP result envelope.
- Writes framework evidence and visualization artifacts when a case is active.
- Does not depend on raw `core_transfers` rows that may expire by TTL.
- Uses aggregated flow edges and durable first/last transaction anchors.
- Has parity tests against the old GraphRAG reference implementation before the reference is deleted.

This creates a hard product line: GraphRAG charges for graph access; Chain Insights is the open investigation intelligence layer that the community can extend.

### `chain-insights case` / Framework

The framework surface is the investigation workspace layer. The user-facing CLI namespace should be `case`; "framework" describes the architecture, not necessarily a command group.

Responsibilities:

- visible case workspace creation and resume.
- Markdown/JSON source-of-truth files.
- evidence capture.
- lightweight claim ledger.
- claim resolution.
- entity dossiers.
- sessions.
- reports.
- local HTML/JSON graph visualizations.
- localhost case browser.
- workspace-local instructions for Codex, Claude Code, Hermes, and similar agents.
- hardening passes that re-read claims, evidence, dossiers, and sessions.

Framework MCP tools:

```text
case_resume
case_add_evidence
case_add_claim
case_list_claims
case_resolve_claim
case_update_dossier
case_harden_research
```

Framework CLI commands:

```bash
chain-insights case init "Bittensor stolen funds" --network bittensor
chain-insights case open
chain-insights case serve
chain-insights case status
chain-insights case claims
chain-insights case harden
```

The framework uses the `mcp` layer for GraphRAG access, x402 payment, and wallet status.

## Installation Model

Chain Insights is installed once per user.

```text
~/.local/bin/chain-insights
~/.local/bin/chain-insights-mcp-proxy
~/.chain-insights/
  config.json
  wallet.json
  schema-cache.json
  runtime/
  templates/
  skills/
```

Global per-user state remains under `~/.chain-insights`: wallet, endpoint configuration, auth token, schema cache, global templates, and runtime cache.

Case workspaces are normal visible folders:

```text
~/work/chain-insights-cases/<case-id>/
```

The framework writes durable investigation state into the workspace so editors, terminals, Codex, Claude Code, Hermes, and normal file tools all see the same state.

## Case Workspace Layout

New case workspaces should be generated with this shape:

```text
<case-id>/
  README.md
  case.md
  claims/
    CL-001.md
  evidence/
    001_track_funds_20260513T120000.md
  dossiers/
    5FqBL928choLPmeFz5UVAvonBD5k7K2mZSXVC9RkFzLxoy2s.md
  sessions/
    session_001.md
  visualizations/
    001_track_funds_graph.html
    001_track_funds_graph.json
  reports/
  .chain-insights/
    workspace.json
  .vscode/
    settings.json
  AGENTS.md
  CLAUDE.md
```

`README.md` is the operator entrypoint for the case. It explains the case objective, common commands, current status, and links to active claims, evidence, dossiers, visualizations, and reports.

`case.md` is the stable case brief: background, scope, known addresses, network, and investigation assumptions.

`AGENTS.md` and `CLAUDE.md` are lightweight workspace-local instructions. They teach agents how to operate the case using Chain Insights tools, claims, evidence, dossiers, sessions, and localhost visualizations.

`.chain-insights/workspace.json` binds the folder to global Chain Insights configuration without duplicating secrets.

## Claim Ledger

Claims are lightweight Markdown files. They represent theories, allegations, assertions, exclusions, or conclusions that need to be validated or carried forward.

Example:

```yaml
---
id: CL-001
status: open
confidence: low
subjects: 5FqBL928choLPmeFz5UVAvonBD5k7K2mZSXVC9RkFzLxoy2s
created: 2026-05-13T12:00:00.000Z
updated: 2026-05-13T12:00:00.000Z
evidence: 001_track_funds_20260513T120000.md
---
# Claim CL-001

5FqBL928choLPmeFz5UVAvonBD5k7K2mZSXVC9RkFzLxoy2s is actor-controlled laundering infrastructure.

## Notes

Created from a trace result. Validate whether this address is exchange custody infrastructure before using it as an actor-controlled hub.

## Resolution

Unresolved.
```

Required statuses:

```text
open
supported
refuted
inconclusive
excluded
superseded
```

No mandatory claim category enum is required. The statement and notes carry investigator intent.

Claims can start from:

- a user theory: "I think this is a mixer."
- a user allegation: "Address X is a known scammer."
- a trace result: "This intermediary might be actor-controlled."
- a correction: "This address is Binance; exclude it from actor infrastructure."
- a hardening pass: "This previous conclusion needs more evidence."

## Evidence, Dossiers, and Sessions

Evidence is raw captured material: tool reports, graph query outputs, analyst notes, imported documents, and generated summaries that should remain attached to the case.

Dossiers are durable entity notes. They should receive hardened findings, not every temporary theory.

Sessions are chronological investigation logs and next-step planning.

The relationship is:

```text
evidence proves or refutes claims
claims promote hardened conclusions into dossiers
sessions narrate what happened and what comes next
```

## Agent Operating Workflow

Agents should operate through natural language or explicit tool instructions.

Natural user request:

```text
My money was stolen from 5GT... on Bittensor. Trace it.
```

Expected behavior in a framework workspace:

1. Read `.chain-insights/workspace.json`, `README.md`, `case.md`, active claims, and latest session.
2. Create or update an initial claim from the user assertion.
3. Call the correct Chain Insights tool, usually `track_funds` or `address_risk`.
4. Save the result under `evidence/`.
5. Save graph HTML/JSON under `visualizations/` when graph data is available.
6. Create follow-up claims for uncertain trace findings.
7. Resolve claims only when evidence supports the resolution.
8. Promote hardened conclusions into dossiers.
9. End or update the session with findings and next steps.

Explicit user request:

```text
Use graph_query to check whether 5FqBL928... BELONGS_TO an exchange entity.
```

Expected behavior:

1. Run the requested tool.
2. Save the output as evidence if a case is active.
3. Link the evidence to an existing claim or create a new claim if the query validates a theory.
4. Update a dossier only after the conclusion is supported, refuted, or excluded.

## Prompt and Skill Model

MCP prompts and Superpowers/GSD-style skills act as workflow routers. They guide Codex, Claude Code, and other agents; they do not store durable state.

Recommended workflows:

- start investigation.
- trace and triage funds.
- validate claim.
- harden research.
- prepare exchange report.

Good prompt behavior:

```text
Open/resume the case, create claims for assertions, choose the right analysis tool, save evidence, resolve claims only when supported, and update dossiers only with hardened facts.
```

Bad prompt behavior:

```text
Hardcode a large opaque playbook with fixed claim categories, magic scoring, and unverifiable conclusions.
```

The agent loop lives in Codex, Claude Code, Hermes, or another client:

```text
observe user intent
plan next action
call Chain Insights tool
observe result
write case files
reason over updated case state
repeat
```

Chain Insights does not need a local API-key-backed LLM runtime for the interactive analyst workflow.

## Visualization Model

There are two visualization paths.

### MCP Compatibility Path

This path keeps GraphRAG/Chain Insights compatible with Claude Desktop, Inspector, and FastMCP-style clients.

GraphRAG returns graph payloads in:

```text
_meta.chainInsights.graph.data
```

The Chain Insights MCP proxy writes the graph payload locally and returns:

```text
_meta.chainInsights.graph.url
```

The MCP app resource remains:

```text
ui://chain-insights/graph
```

The HTML app fetches the local artifact URL from `_meta`. This path should keep working, but it is not the primary framework UX.

### Framework Workspace Path

This path is the preferred investigation artifact.

Case visualizations should be saved as local files:

```text
visualizations/001_track_funds_graph.html
visualizations/001_track_funds_graph.json
```

The evidence file should link them:

```md
Visualization: ../visualizations/001_track_funds_graph.html
Graph JSON: ../visualizations/001_track_funds_graph.json
```

Hono should serve the active case workspace with stable localhost URLs:

```text
http://127.0.0.1:4321/cases/<case-id>/
http://127.0.0.1:4321/cases/<case-id>/visualizations/001_track_funds_graph.html
http://127.0.0.1:4321/cases/<case-id>/evidence/001_track_funds_20260513T120000.md
```

The graph HTML may load adjacent JSON with a relative URL. The default should keep JSON separate so agents and operators can inspect it. Inline-data HTML can be added as an export mode later.

## CLI Shape

MCP and wallet commands:

```bash
chain-insights mcp tools
chain-insights mcp call address_risk network=bittensor address=...
chain-insights mcp call graph_query network=bittensor query='MATCH (n) RETURN labels(n), n.address LIMIT 10'
chain-insights mcp setup claude-desktop
chain-insights mcp setup codex
chain-insights wallet balance
```

Framework commands:

```bash
chain-insights case init "Bittensor stolen funds" --network bittensor
cd ~/work/chain-insights-cases/20260513_001_bittensor-stolen-funds
code .
codex
```

Useful follow-up commands:

```bash
chain-insights case serve
chain-insights case open
chain-insights case status
chain-insights case claims
chain-insights case harden
```

`case serve` starts or reuses the local Hono server and serves the current case workspace. `case open` can open the editor and localhost case browser. `case harden` should generate a review from claims, evidence, dossiers, and sessions; the actual reasoning can be agent-driven through Codex, Claude Code, or another client.

## Migration From Current State

The existing `~/.chain-insights/cases/<case-id>/` layout can be supported during migration. New framework work should create visible workspaces under:

```text
~/work/chain-insights-cases/
```

Migration command:

```bash
chain-insights case export-workspace <case-id> --to ~/work/chain-insights-cases/
```

The exported workspace should preserve evidence hashes, dossiers, sessions, case metadata, and visualization links.

## Testing and UAT

Required verification for `mcp`:

- MCP client tests for `help`, `balance`, Chain Insights investigation tools, and GraphRAG `graph_query`.
- x402 payment path test with debug bearer token support.
- Claude Desktop smoke test for tool listing and text tool calls.
- MCP graph app compatibility test for `_meta.chainInsights.graph.url`.
- Parity tests proving each ported Chain Insights tool matches the old GraphRAG reference behavior before deleting reference code.
- Documentation confirms `topup` is not advertised as a working happy-path tool.

Required verification for framework:

- Unit tests for claim file create/list/resolve behavior.
- Unit tests for workspace discovery from `.chain-insights/workspace.json`.
- Unit tests for Hono serving case-local Markdown, JSON, and HTML files.
- MCP tests for framework claim/evidence/dossier tools.
- CLI tests for `case init`, `case serve`, and workspace status.
- UAT with Codex in an editor-opened case workspace:
  - start from a theft allegation,
  - run trace,
  - save evidence,
  - create follow-up claims,
  - validate an exchange-exclusion claim,
  - generate local graph HTML,
  - harden research into dossier findings.

## Success Criteria

- Any MCP client can use Chain Insights MCP for paid GraphRAG access and wallet balance without adopting the framework.
- Claude Desktop remains usable for basic MCP tool calls and graph app compatibility.
- The framework can be used from VS Code, terminal, Codex, Claude Code, Hermes, or another editor/agent.
- A user can open a case folder and understand investigation state from Markdown files.
- Graph visualizations are available as local HTML files and localhost URLs in framework workspaces.
- Claims make uncertain reasoning explicit and auditable.
- Dossiers contain hardened conclusions rather than raw speculation.
- Chain Insights stays local-first and does not require a local API-key-backed LLM runtime.
