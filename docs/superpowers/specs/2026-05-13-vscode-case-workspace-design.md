# VS Code Case Workspace Design

## Context

Chain Insights started by optimizing the Claude Desktop MCP Apps path: tools returned MCP app metadata, Claude rendered iframes, and the graph app fetched local Hono artifacts. That path works but creates friction for real investigations:

- Claude Desktop hides too much operational state behind the chat UI.
- MCP Apps iframe behavior adds CSP and lifecycle issues that are not central to investigation work.
- Operators already prefer VS Code for reading and editing Markdown artifacts.
- Codex and Claude Code can act as the orchestration agent without Chain Insights running a local LangChain-style agent or storing third-party API keys.
- Local graph visualization is more reliable when saved as case-local HTML/JSON and served from localhost.

The product pivot is to make Chain Insights a local investigation framework for VS Code, Codex, and Claude Code. Claude Desktop is no longer a primary target. Memgraph Lab remains useful for developer debugging but is not part of the product workflow.

## Goals

- Make VS Code the source-of-truth workspace for investigations.
- Keep Chain Insights installed globally per user while storing each case in a normal visible folder.
- Let Codex or Claude Code act as the reasoning loop through MCP tools and workspace-local instructions.
- Store case state as readable Markdown and small JSON files.
- Treat theories and claims as first-class investigation state without heavy categorization.
- Save graph visualizations as case-local HTML/JSON files and serve them from localhost.
- Keep GraphRAG MCP as the graph/risk analysis engine.
- Keep Hono as the local case browser and artifact server.
- Use Superpowers/GSD-style skills as workflow guidance for agents, not as hidden state.

## Non-Goals

- Do not optimize new work around Claude Desktop MCP Apps iframe rendering.
- Do not add a local LangChain, AutoGen, or custom LLM runtime that needs an API key inside Chain Insights.
- Do not make Memgraph Lab part of the operator workflow.
- Do not create a rigid claim taxonomy before the investigation needs it.
- Do not install a full framework copy into every case folder.
- Do not hide case state in a database-only UI.

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

Case workspaces are normal folders.

```text
~/work/chain-insights-cases/<case-id>/
```

Global per-user state remains under `~/.chain-insights`: wallet, endpoint configuration, auth token, schema cache, global templates, and runtime cache. Durable investigation work lives inside the case workspace so VS Code, Codex, Claude Code, and normal file tools all see the same state.

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

`AGENTS.md` and `CLAUDE.md` are lightweight workspace-local instructions. They teach Codex and Claude Code how to operate the case using Chain Insights tools, claims, evidence, dossiers, sessions, and localhost visualizations.

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

Required claim statuses:

```text
open
supported
refuted
inconclusive
excluded
superseded
```

No mandatory category enum is required. The statement and notes carry investigator intent. Agents may infer useful labels during reasoning, but storage should stay flexible.

Claims can start from:

- a user theory: "I think this is a mixer."
- a user allegation: "Address X is a known scammer."
- a trace result: "This intermediary might be actor-controlled."
- a correction: "This address is Binance; exclude it from actor infrastructure."
- a hardening pass: "This previous conclusion needs more evidence."

## Evidence, Dossiers, and Sessions

Evidence remains raw captured material: tool reports, graph query outputs, analyst notes, and imported documents. Evidence files should be append-only in normal use and covered by the manifest hash.

Dossiers remain durable entity notes. They should receive hardened findings, not every temporary theory.

Sessions remain chronological investigation logs and next-step planning.

The intended relationship is:

```text
evidence proves or refutes claims
claims promote hardened conclusions into dossiers
sessions narrate what happened and what comes next
```

## Agent Operating Workflow

Codex and Claude Code should operate the same workspace through natural language or explicit tool instructions.

Natural user request:

```text
My money was stolen from 5GT... on Bittensor. Trace it.
```

Expected agent behavior:

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

Expected agent behavior:

1. Run the requested tool.
2. Save the output as evidence if a case is active.
3. Link the evidence to an existing claim or create a new claim if the query validates a theory.
4. Update a dossier only after the conclusion is supported, refuted, or excluded.

## Prompt and Skill Model

MCP prompts and Superpowers/GSD-style skills should act as workflow routers.

They should teach agents procedures such as:

- start investigation
- trace and triage funds
- validate claim
- harden research
- prepare exchange report

They should not store durable state or embed rigid investigative conclusions.

Good prompt behavior:

```text
Open/resume the case, create claims for assertions, choose the right analysis tool, save evidence, resolve claims only when supported, and update dossiers only with hardened facts.
```

Bad prompt behavior:

```text
Hardcode a large opaque playbook with fixed claim categories, magic scoring, and unverifiable conclusions.
```

The agent loop lives in Codex or Claude Code:

```text
observe user intent
plan next action
call Chain Insights tool
observe result
write case files
reason over updated case state
repeat
```

Chain Insights does not need to run a local LLM agent for the interactive analyst workflow.

## Localhost and Visualization Model

Hono remains the local server, but its primary purpose changes from "make Claude Desktop iframe work" to "serve case workspace artifacts from localhost."

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

Hono should serve the active case workspace with stable URLs:

```text
http://127.0.0.1:4321/cases/<case-id>/
http://127.0.0.1:4321/cases/<case-id>/visualizations/001_track_funds_graph.html
http://127.0.0.1:4321/cases/<case-id>/evidence/001_track_funds_20260513T120000.md
```

The graph HTML may load adjacent JSON with a relative URL. For maximum portability, Chain Insights may also support an inline-data mode, but the default should keep JSON separate so agents and operators can inspect it.

## CLI Shape

The target operator commands are:

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

`case serve` starts or reuses the local Hono server and serves the current case workspace. `case open` can open VS Code and the localhost case browser. `case harden` should generate a review from claims, evidence, dossiers, and sessions; the actual reasoning can be agent-driven through Codex or Claude Code.

## MCP Tool Shape

Existing tools stay useful:

```text
case_open
case_resume
case_add_evidence
case_update_dossier
case_start_session
case_end_session
address_risk
track_funds
money_flows_between_exchanges
address_connection_risk
graph_query
```

New workspace-aware tools should be added:

```text
case_workspace_init
case_workspace_resume
case_add_claim
case_list_claims
case_resolve_claim
case_generate_visualization
case_harden_research
```

The tools should write files in the active workspace, not hide state in a database-only record. The database can index cases for listing and fast lookup, but Markdown and JSON files are the operator-visible source of truth.

## Migration From Current State

The existing `~/.chain-insights/cases/<case-id>/` layout can be supported during migration. New work should create visible workspaces under:

```text
~/work/chain-insights-cases/
```

Migration command:

```bash
chain-insights case export-workspace <case-id> --to ~/work/chain-insights-cases/
```

The exported workspace should preserve evidence hashes, dossiers, sessions, case metadata, and visualization links.

## Testing and UAT

Required verification:

- Unit tests for claim file create/list/resolve behavior.
- Unit tests for workspace discovery from `.chain-insights/workspace.json`.
- Unit tests for Hono serving case-local Markdown, JSON, and HTML files.
- MCP tests for new claim tools.
- CLI tests for `case init`, `case serve`, and workspace status.
- UAT with Codex in a VS Code-opened case workspace:
  - start from a theft allegation,
  - run trace,
  - save evidence,
  - create follow-up claims,
  - validate an exchange-exclusion claim,
  - generate local graph HTML,
  - harden research into dossier findings.

## Success Criteria

- A user can open a case folder in VS Code and understand current investigation state from Markdown files.
- Codex or Claude Code can operate the case through local instructions and Chain Insights tools.
- Graph visualizations are available as local HTML files and localhost URLs.
- Claims make uncertain reasoning explicit and auditable.
- Dossiers contain hardened conclusions rather than raw speculation.
- Claude Desktop is not required for the primary workflow.
- Chain Insights stays local-first and does not require a local API-key-backed LLM runtime.
