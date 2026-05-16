# Chain Insights Workspace Output Repair Design

Date: 2026-05-16

## Purpose

Chain Insights is an AML framework for agents. Investigation state must be
portable, reviewable, and tied to the directory the analyst or agent opened.
The current implementation can split one investigation across the opened
workspace and `~/.chain-insights`, which breaks evidence handling, agent
handoff, and report discovery.

This design repairs the product contract before implementation.

## Core Contract

`cia init .` is mandatory before any command or MCP tool creates investigation
state.

An initialized workspace is a directory containing:

```text
.chain-insights/workspace.json
```

Investigation-producing commands must fail before remote graph calls or file
writes when no initialized workspace is found:

```text
No Chain Insights workspace found. Run: cia init .
```

`~/.chain-insights` is not an investigation store. It may contain global config,
wallet state, installed skills metadata, and non-evidence cache only.

## Root Resolution

For terminal use, the active workspace is the current directory or nearest
parent containing `.chain-insights/workspace.json`.

For Codex, Claude, or MCP usage, the active workspace is the opened project
folder or nearest initialized parent. `CHAIN_INSIGHTS_WORKSPACE` may override
the detected workspace only when explicitly set.

No investigation writer may fall back from a missing workspace to
`~/.chain-insights`.

## Workspace-Owned Outputs

All investigation output belongs under the initialized workspace:

```text
cases/
cases/<case-id>/case.md
cases/<case-id>/manifest.json
cases/<case-id>/evidence/
cases/<case-id>/dossiers/
reports/
reports/*.graph.html
reports/*.table.html
reports/*.trace-report.md
reports/graphs/*.graph.json
reports/tables/*.compact-evidence.json
reports/tables/*.flows.csv
artifacts/<artifact-id>/graph.json
logs/
.chain-insights/schema/
.chain-insights/runtime/
templates/
```

Evidence files should stay compact and point to durable report, graph, table,
and artifact files. The larger JSON, CSV, and HTML files carry the investigation
structure.

## Global-Owned Outputs

These may remain under `~/.chain-insights`:

```text
config.json
wallet.json
cache/
non-evidence package or MCP cache
```

Installed Codex skills live under `~/.codex/skills`. Installed Claude skills
live under the corresponding Claude skills directory. These global skill
locations do not replace workspace initialization.

## Fund Flow API

There is one public fund-flow API:

```text
track_funds
```

`track_funds` supports one or many addresses:

```text
track_funds trusted_addresses=5GT... network=bittensor
track_funds trusted_addresses=5Victim1,5Victim2 untrusted_addresses=5Scammer network=bittensor
```

The public CLI, MCP tools, playbooks, prompts, and shipped skills must teach
`track_funds` as the fund-flow workflow.

`trace_funds` is removed entirely as a product concept:

- no MCP tool named `trace_funds`;
- no CLI command named `trace-funds`;
- no playbook step using `trace_funds`;
- no shipped skill guidance recommending `trace_funds`;
- no public tests that expect `trace_funds`.

Implementation may keep a private helper for a single-address probe, but it
must be renamed to an internal name such as `runFundFlowProbe` or
`traceAddressFlow` and must not be exposed as a public tool.

## Workspace Preview Server

Static HTML reports remain durable investigation artifacts. In addition,
`cia serve` must be kept or restored as a workspace-local preview server.

`cia serve` must require an initialized workspace and serve only that workspace.
It must never serve `~/.chain-insights` investigation artifacts.

The browser view should provide:

- a left tree for `cases/`, `reports/`, `reports/graphs/`,
  `reports/tables/`, `artifacts/`, and `.chain-insights/schema/`;
- a right preview pane for HTML, JSON, Markdown, CSV, and table files;
- path confinement so requests cannot escape the workspace root.

Server lifecycle state belongs under:

```text
.chain-insights/runtime/server.json
```

Agent skills should include before-work and after-work server lifecycle steps:

- check whether a workspace preview server is already running for this
  workspace;
- start it only when useful;
- record PID and port in workspace runtime state;
- stop only the server started for this workspace/session;
- never kill unrelated Hono, GraphRAG, or other project processes by broad
  process name.

## Shipped Skills

Repo-shipped skills are part of the product surface and must be updated with
the code behavior.

Current shipped skills:

```text
skills/chain-insights-investigation/
skills/chain-insights-trace-funds/
skills/test-chain-insights-graphrag-mcp/
skills/ci-case/
skills/ci-status/
```

Required alignment:

- `chain-insights-investigation` becomes the canonical agent workflow. It must
  require initialized workspace context, teach the workspace output layout,
  distinguish global config from investigation state, and teach `track_funds`
  as the public fund-flow tool.
- `chain-insights-trace-funds` must be rewritten or renamed conceptually so it
  teaches fund-flow tracking through `track_funds`. It must not recommend
  `trace_funds`.
- `test-chain-insights-graphrag-mcp` must initialize and use a workspace during
  UAT and assert that investigation artifacts do not land under
  `~/.chain-insights`.
- `ci-case` and `ci-status` are stale placeholders and must be updated, not
  removed. `ci-case` should call the current `cia case` commands and require an
  initialized workspace. `ci-status` should report workspace status separately
  from global config and must not describe `~/.chain-insights` as the
  investigation root.
- Skill scripts and `agents/openai.yaml` files must reflect the same workspace
  contract.

## Error Handling

Investigation-producing tools fail loudly when no workspace is active. This
includes case creation, evidence writes, session writes, dossier writes,
fund-flow tracking, graph/report/table generation, schema capture, artifact
writing, and preview serving.

Read-only tools that do not create investigation state may run without a
workspace only if they do not create graph artifacts, evidence, logs, reports,
or schema files.

## Misplaced Artifact Recovery

Existing artifacts from bad runs should be recovered separately from the code
repair.

Known misplaced examples include:

```text
~/.chain-insights/reports/graphs/*5gtjfjalpbnrgybh*.graph.json
~/.chain-insights/reports/tables/*5gtjfjalpbnrgybh*.compact-evidence.json
~/.chain-insights/reports/*5gtjfjalpbnrgybh*.graph.html
~/.chain-insights/reports/*5gtjfjalpbnrgybh*.table.html
~/.chain-insights/artifacts/*/graph.json
```

Recovery process:

1. Copy matching files into the initialized investigation workspace under the
   correct `reports/` and `artifacts/` layout.
2. Update case evidence pointers or manifests if they reference global paths.
3. Verify workspace copies and links.
4. Leave global originals in place until verification passes.

## Tests

Regression tests must prove:

- `track_funds` before `cia init` fails and writes no files.
- `track_funds` after `cia init` writes reports, graphs, tables, artifacts,
  schema, and case evidence only under the workspace.
- MCP proxy tools resolve the opened/configured workspace and do not write
  investigation output under `~/.chain-insights`.
- `~/.chain-insights/reports`, `~/.chain-insights/artifacts`, and
  `~/.chain-insights/cases` are not created or modified by
  investigation-producing commands.
- CLI help, MCP tool list, prompts, playbooks, and shipped skills expose
  `track_funds` as the public fund-flow surface.
- `trace_funds` is absent from public CLI help, MCP tool registration, primary
  prompts, playbooks, and shipped skill guidance.
- `cia serve` requires an initialized workspace and serves files only within
  that workspace.

## Verification

Implementation is complete only after:

```bash
npm run typecheck
npm test
```

and a real smoke test:

```bash
mkdir ~/stolen
cd ~/stolen
cia mcp track-funds --trusted-addresses 5GT... --network bittensor
# must fail before init

cia init .
cia mcp track-funds --trusted-addresses 5GT... --network bittensor
# must write only under ~/stolen
```

The final check must confirm no new investigation output under:

```text
~/.chain-insights/reports
~/.chain-insights/artifacts
~/.chain-insights/cases
```

The process sweep must stop only workspace-owned preview/proxy processes and
must not kill unrelated GraphRAG, Hono, editor, or project processes by broad
name.
