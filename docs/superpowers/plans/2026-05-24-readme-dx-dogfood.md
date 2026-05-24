# Chain Insights README DX Dogfood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Chain Insights docs around the product experience, add a shipped developer-experience skill, and verify the beginner path with a clean `cia` dogfood investigation.

**Architecture:** Keep README as a product-first entry point. Move debug and contribution workflows into focused docs, keep graph contracts in graph-tool docs, and add a shipped skill that teaches future agents how to maintain this shape. Run a clean dogfood workspace before final README copy so the quick start reflects real command behavior.

**Tech Stack:** Markdown docs, Chain Insights CLI (`cia`), Vitest contract tests, npm build/release gate, shipped skills under `skills/`.

---

## File Structure

- Create `skills/chain-insights-developer-experience/SKILL.md`
  - Shipped agent guidance for product-first Chain Insights docs and AML tool development.
- Create `docs/contributing.md`
  - Human contributor workflow: setup, where AML tools live, docs/skills/tests/release expectations.
- Create `docs/debugging.md`
  - Debug-token, local GraphRAG MCP, Inspector, and UAT details moved out of README.
- Create `docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md`
  - Short dogfood report from a clean `/home/aphex5/work/chain-insights-dx-dogfood` workspace.
- Modify `README.md`
  - Product-first overview, quick start, demo, AML tools, topology model, docs map.
- Modify `docs/graph-tools.md`
  - Replace "Go Graph MCP" product framing with GraphRAG MCP and clarify live/archive/facts.
- Modify `docs/mcp-proxy.md`
  - Remove README-level Claude Desktop framing from product copy; leave client setup as deep docs if needed.
- Modify `docs/development.md`
  - Keep concise build/test commands and link to `docs/contributing.md` and `docs/debugging.md`.
- Modify `tests/skills-contract.test.ts`
  - Contract tests for the new README shape and shipped developer-experience skill.
- Modify `CHANGELOG.md`, `package.json`, and `package-lock.json`
  - Version bump and release notes.
- Rebuild `dist/`
  - Required because `bin/cli.js` loads built `dist/cli.mjs`.

---

### Task 1: Add Failing Product Docs Contract Tests

**Files:**
- Modify: `tests/skills-contract.test.ts`
- Test: `tests/skills-contract.test.ts`

- [ ] **Step 1: Add README product-positioning test**

Append this test inside the existing `describe('shipped Chain Insights skills contract', () => { ... })` block:

```ts
  it('keeps README product-first and moves debug/client detail to focused docs', () => {
    const readme = read('README.md')

    expect(readme).toContain('AML investigation framework')
    expect(readme).toContain('GraphRAG MCP')
    expect(readme).toContain('address_risk')
    expect(readme).toContain('track_funds')
    expect(readme).toContain('scam_topology')
    expect(readme).toContain('graph_query')
    expect(readme).toContain('graph_query_batch')
    expect(readme).toContain('live_topology')
    expect(readme).toContain('archive_topology')
    expect(readme).toContain('facts')
    expect(readme).toContain('cia mcp networks')
    expect(readme).toContain('cia mcp tools --refresh')
    expect(readme).toContain('docs/contributing.md')
    expect(readme).toContain('docs/debugging.md')

    expect(readme).not.toContain('Claude Desktop')
    expect(readme).not.toContain('Go Graph MCP')
    expect(readme).not.toContain('chain-insights debug on')
    expect(readme).not.toContain('GRAPH_MCP_GO_DEBUG_BYPASS')
    expect(readme).not.toContain('Release rules:')
  })
```

- [ ] **Step 2: Add developer-experience skill contract test**

Append this test inside the same `describe` block:

```ts
  it('ships Chain Insights developer experience guidance for AML tool contributors', () => {
    const skill = read('skills/chain-insights-developer-experience/SKILL.md')
    const contributing = read('docs/contributing.md')
    const debugging = read('docs/debugging.md')
    const development = read('docs/development.md')

    expect(skill).toContain('Chain Insights Developer Experience')
    expect(skill).toContain('GraphRAG MCP')
    expect(skill).toContain('AML tool framework')
    expect(skill).toContain('address_risk')
    expect(skill).toContain('track_funds')
    expect(skill).toContain('scam_topology')
    expect(skill).toContain('live_topology')
    expect(skill).toContain('archive_topology')
    expect(skill).toContain('facts')
    expect(skill).toContain('Dogfood from a clean workspace')

    expect(contributing).toContain('Adding AML Tools')
    expect(contributing).toContain('npm run release:check')
    expect(debugging).toContain('GraphRAG MCP')
    expect(debugging).toContain('Inspector')
    expect(development).toContain('docs/contributing.md')
    expect(development).toContain('docs/debugging.md')
  })
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/skills-contract.test.ts
```

Expected: FAIL because `skills/chain-insights-developer-experience/SKILL.md`, `docs/contributing.md`, and `docs/debugging.md` do not exist yet, and README still contains `Claude Desktop`, `Go Graph MCP`, and debug material.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/skills-contract.test.ts
git commit -m "test readme dx contract"
```

---

### Task 2: Dogfood The Fresh Developer Experience

**Files:**
- Create: `docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md`
- No source code changes in this task unless a command is blocked by a small, obvious CLI/help bug.

- [ ] **Step 1: Create a clean dogfood workspace**

Run:

```bash
rm -rf /home/aphex5/work/chain-insights-dx-dogfood
mkdir -p /home/aphex5/work/chain-insights-dx-dogfood
cd /home/aphex5/work/chain-insights-dx-dogfood
```

Expected: a clean directory outside `/home/aphex5/work/chain-insights`.

- [ ] **Step 2: Discover the installed CLI and available command shape**

Run:

```bash
cia --version
cia --help
cia mcp --help
```

Expected: `cia --version` prints the currently installed package version. Help output shows `mcp`, `init`, `case`, and the currently supported graph/investigation subcommands.

- [ ] **Step 3: Initialize the workspace**

Run:

```bash
cia init .
find . -maxdepth 3 -type f | sort
```

Expected:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `imports/README.md`
- `templates/README.md`
- `templates/case-brief.md`
- `.chain-insights/workspace.json`
- `.chain-insights/runtime-skill/SKILL.md`
- `.chain-insights/schema/README.md`

- [ ] **Step 4: Discover networks and tools**

Run:

```bash
cia mcp networks | tee networks.txt
cia mcp tools --refresh | tee tools.txt
```

Expected:

- Networks output includes Bittensor if the configured endpoint is reachable.
- Tools output includes `graph_query`, `graph_query_batch`, `address_risk`, `track_funds`, and `scam_topology` through the Chain Insights layer.

If the endpoint is unavailable or auth is missing, record the exact error in the dogfood report and continue with docs/help improvements that do not require network access.

- [ ] **Step 5: Open a dogfood case**

Run:

```bash
cia case open "README DX dogfood victim address" \
  --tags dogfood,bittensor,readme \
  --description "Fresh developer experience check for Chain Insights README and AML tool workflow"
cia case list
```

Expected: case `1` or a displayed case ID exists in the dogfood workspace.

- [ ] **Step 6: Run a small victim/source investigation**

Use the known Bittensor victim/source address from the current project context:

```bash
VICTIM_ADDRESS=5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5
cia mcp track-funds \
  --network bittensor \
  --trusted-addresses "${VICTIM_ADDRESS}" \
  --case 1 \
  --max-hops 4 | tee track-funds.txt
```

Expected when the backend is reachable: command returns a Chain Insights result and writes case evidence/report artifacts into the workspace.

If `--max-hops` is not accepted by the installed CLI, run:

```bash
cia mcp track-funds \
  --network bittensor \
  --trusted-addresses "${VICTIM_ADDRESS}" \
  --case 1 | tee track-funds.txt
```

Record the accepted command in the report.

- [ ] **Step 7: Inspect generated outputs**

Run:

```bash
find cases reports reports/graphs reports/tables -maxdepth 3 -type f | sort | tee generated-files.txt
cia case resume 1 | tee case-resume.txt
```

Expected: generated files show what a fresh user should inspect next. If no files were generated, capture the exact reason from `track-funds.txt`.

- [ ] **Step 8: Write the dogfood report**

Create `docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md` with this structure. Every bullet must contain actual observations from Steps 1-7; do not leave marker text in the report:

```markdown
# Chain Insights README DX Dogfood Report

## Context

- Workspace: `/home/aphex5/work/chain-insights-dx-dogfood`
- CLI version: record the exact `cia --version` output from this dogfood run.
- Date: 2026-05-24
- Test address: `5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5`

## Commands Run

```bash
List the commands run in this dogfood workspace. Keep this to command lines,
not large command output.
```

## What Worked

- Record the successful setup, discovery, case, investigation, and output
  inspection behavior observed in this run.

## Friction

- Record each confusing command, missing pointer, missing help detail, auth or
  endpoint issue, or write `No blocking CLI friction observed` if the run was
  straightforward.

## Files Created

```text
Paste the concise `generated-files.txt` file list from this dogfood workspace.
```

## README Improvements Derived From This Run

- List concrete README changes derived from this run.

## CLI Or Docs Follow-Ups

- List concrete follow-ups, or write `No code changes required from dogfood run`
  if the run only affected docs.
```

Do not paste large JSON result bodies into this report.

- [ ] **Step 9: Commit the dogfood report**

```bash
git add docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md
git commit -m "docs dogfood chain insights dx"
```

---

### Task 3: Add Shipped Developer Experience Skill

**Files:**
- Create: `skills/chain-insights-developer-experience/SKILL.md`
- Test: `tests/skills-contract.test.ts`

- [ ] **Step 1: Create the skill file**

Create `skills/chain-insights-developer-experience/SKILL.md`:

```markdown
---
name: chain-insights-developer-experience
description: Use when changing Chain Insights README, docs, skills, CLI UX, AML tool contracts, or developer-facing workflows. Keeps Chain Insights product-first while preserving accurate GraphRAG MCP and investigation details.
---

# Chain Insights Developer Experience

Use this skill when improving Chain Insights as a product or developer-facing
framework.

## Product Frame

Chain Insights is an AML tool framework layered on top of GraphRAG MCP.
GraphRAG MCP provides generic graph-language access. Chain Insights provides
investigation workflows, AML recipes, local cases, evidence, dossiers, reports,
and graph visualizations.

Use "GraphRAG MCP" in product-facing docs. Only use lower-level implementation
names in debugging or contributor docs when the detail is necessary.

## Current AML Tools

- `address_risk`: screen one address for risk, behavior, neighborhood context,
  and exchange exposure.
- `track_funds`: trace victim/source funds through intermediaries to exchange
  deposit candidates.
- `scam_topology`: expand known victim incident topology into reviewable scam
  infrastructure and label candidates.

## GraphRAG MCP Layer

GraphRAG MCP exposes generic tools such as:

- `graph_query`
- `graph_query_batch`

Chain Insights tools should be implemented as local AML workflows over these
generic graph primitives unless there is a product reason to add a new
primitive.

## Topology Language

Use these names consistently:

- `live_topology`: fast, cheaper, recent/hot topology.
- `archive_topology`: wider historical topology; slower and potentially more
  costly.
- `facts`: labels, features, risk scores, assets, and enrichment.

Tell users to discover current network capabilities before assuming data is
available:

```bash
cia mcp networks
cia mcp tools --refresh
```

## README Rules

README starts from the product experience:

1. What Chain Insights is.
2. What users can do today.
3. Fast setup and one working demo.
4. AML tools.
5. GraphRAG MCP and topology model.
6. Links to deeper docs.

Do not put debug-token setup, local bypasses, release gates, full test
matrices, or client-specific desktop setup in README. Link to focused docs.

## Adding AML Tools

Every new AML tool needs:

- User problem and intended analyst workflow.
- Required inputs and optional inputs.
- GraphRAG MCP primitives used.
- Topology/facts scope.
- Result contract.
- Case evidence behavior.
- Graph report behavior.
- Tests.
- Dogfood or UAT path.

## Dogfood From A Clean Workspace

Before claiming the developer experience is good, run from a clean directory
outside this repository:

```bash
mkdir -p /home/aphex5/work/chain-insights-dx-dogfood
cd /home/aphex5/work/chain-insights-dx-dogfood
cia --version
cia init .
cia mcp networks
cia mcp tools --refresh
```

Run at least one small investigation command, inspect generated files, and feed
the friction back into README, docs, CLI help, or follow-up issues.
```

- [ ] **Step 2: Run focused skill test**

Run:

```bash
npm test -- tests/skills-contract.test.ts
```

Expected: Still FAIL until `docs/contributing.md`, `docs/debugging.md`, README, and `docs/development.md` are updated.

- [ ] **Step 3: Commit the skill**

```bash
git add skills/chain-insights-developer-experience/SKILL.md
git commit -m "docs add chain insights dx skill"
```

---

### Task 4: Add Contributing And Debugging Docs

**Files:**
- Create: `docs/contributing.md`
- Create: `docs/debugging.md`
- Modify: `docs/development.md`
- Test: `tests/skills-contract.test.ts`

- [ ] **Step 1: Create contributing doc**

Create `docs/contributing.md`:

```markdown
# Contributing To Chain Insights

Chain Insights is an AML investigation framework layered on top of GraphRAG
MCP. Contributions should keep the product easy to try while preserving precise
tool contracts for agents and analysts.

## Local Setup

```bash
npm install
npm run build
node bin/cli.js --help
```

## Adding AML Tools

Current AML tools live in the Chain Insights layer:

- `address_risk`
- `track_funds`
- `scam_topology`

When adding a tool, document:

- User problem.
- Required and optional inputs.
- GraphRAG MCP primitive calls.
- Use of `live_topology`, `archive_topology`, and `facts`.
- Result contract.
- Case evidence behavior.
- Graph report behavior.
- Tests and dogfood path.

## Documentation Updates

- README stays product-first.
- Detailed graph contracts belong in `docs/graph-tools.md`.
- Workspace behavior belongs in `docs/investigation-workspaces.md`.
- MCP proxy/client setup belongs in `docs/mcp-proxy.md`.
- Debug and UAT details belong in `docs/debugging.md`.
- Agent-facing contributor guidance belongs in shipped skills under `skills/`.

## Tests

Run focused tests while developing:

```bash
npm test -- tests/skills-contract.test.ts
npm test -- tests/cli.test.ts
```

Run the full local gate before a PR:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
git diff --check
```

## Release Discipline

Every PR to `main` must:

- Bump `package.json` and `package-lock.json`.
- Add a matching `CHANGELOG.md` entry.
- Pass the GitHub verification checks.
```

- [ ] **Step 2: Create debugging doc**

Create `docs/debugging.md`:

```markdown
# Debugging Chain Insights

This document covers local GraphRAG MCP debugging, auth bypasses, Inspector
checks, and UAT. Product quick starts belong in README; debugging details live
here.

## Local GraphRAG MCP Debug

Start GraphRAG MCP with debug bypass from the RBMK ML repo:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose -f compose/shared.yml build graphrag-mcp-go
GRAPH_MCP_GO_DEBUG_BYPASS_ENABLED=true \
GRAPH_MCP_GO_DEBUG_BYPASS_TOKEN=chain-insights-dev-debug \
docker compose -f compose/shared.yml up -d graphrag-mcp-go
```

Point Chain Insights at the local endpoint:

```bash
cd /home/aphex5/work/chain-insights
node bin/cli.js debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
node bin/cli.js mcp tools --refresh
```

## Inspector

Inspect the GraphRAG MCP endpoint directly:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"
```

Inspect the Chain Insights proxy:

```bash
npx @modelcontextprotocol/inspector \
  --cli chain-insights-mcp-proxy \
  --method tools/list
```

## Smoke Checks

```bash
node bin/cli.js mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"}]'
node bin/cli.js wallet address
node bin/cli.js wallet balance
```

## UAT Script

```bash
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

The UAT script uses a temporary initialized workspace, calls the real GraphRAG
MCP endpoint, verifies proxy tools, and checks graph report serving.
```

- [ ] **Step 3: Slim development doc**

Replace `docs/development.md` with a concise version:

```markdown
# Development

This document is for engineers changing Chain Insights.

## Install And Build

```bash
npm install
npm run build
node bin/cli.js --help
```

## Tests

Run the full local gate:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
git diff --check
```

Focused docs and workspace tests:

```bash
npm test -- tests/skills-contract.test.ts tests/cli.test.ts
```

## Global Install From Checkout

```bash
npm run build
npm install -g .
cia --version
```

## More Developer Docs

- Contributor workflow: `docs/contributing.md`
- Debugging and UAT: `docs/debugging.md`
- Graph tool contracts: `docs/graph-tools.md`
- Investigation workspace layout: `docs/investigation-workspaces.md`
```

- [ ] **Step 4: Run focused test**

Run:

```bash
npm test -- tests/skills-contract.test.ts
```

Expected: Still FAIL until README product contract is updated.

- [ ] **Step 5: Commit supporting docs**

```bash
git add docs/contributing.md docs/debugging.md docs/development.md
git commit -m "docs split contributing and debugging"
```

---

### Task 5: Rewrite README Product Experience

**Files:**
- Modify: `README.md`
- Modify: `docs/graph-tools.md`
- Modify: `docs/mcp-proxy.md`
- Test: `tests/skills-contract.test.ts`

- [ ] **Step 1: Replace README with product-first entry point**

Rewrite `README.md` with these sections and required content. Incorporate specific improvements from the dogfood report where they make the quick start clearer.

```markdown
# Chain Insights

Chain Insights is an AML investigation framework on top of GraphRAG MCP. It
turns graph access into analyst-ready workflows: address screening, fund-flow
tracing, scam topology discovery, case files, evidence, dossiers, reports, and
graph visualizations.

GraphRAG MCP exposes generic graph tools. Chain Insights adds AML tools and
investigation workflow around them.

## What You Can Do Today

| Tool | Use it for |
| --- | --- |
| `address_risk` | Screen one address for risk, behavior, neighborhood context, and exchange exposure |
| `track_funds` | Trace victim/source funds through intermediaries to exchange deposit candidates |
| `scam_topology` | Expand a known victim incident into reviewable scam infrastructure and label candidates |

## Quick Start

Install or use the local checkout, then create an investigation workspace:

```bash
cia --version
mkdir -p /home/aphex5/work/chain-insights-investigations
cd /home/aphex5/work/chain-insights-investigations
cia init .
```

Check what the current GraphRAG MCP endpoint supports:

```bash
cia mcp networks
cia mcp tools --refresh
```

Open a case and run a small investigation:

```bash
cia case open "First Chain Insights investigation" \
  --tags aml,bittensor \
  --description "Screen and trace a known source address"

cia mcp track-funds \
  --network bittensor \
  --trusted-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --case 1
```

Then inspect:

```bash
cia case resume 1
find reports cases -maxdepth 3 -type f | sort
```

## How It Fits Together

GraphRAG MCP provides generic graph access:

| Tool | Purpose |
| --- | --- |
| `graph_query` | Run one read-only graph query |
| `graph_query_batch` | Run related read-only graph queries as one call |

Chain Insights builds AML workflows over those primitives. This keeps the graph
backend generic while making investigation tools easier for agents and analysts
to use.

## Topologies And Facts

Use network discovery before assuming data is available:

```bash
cia mcp networks
```

The graph model has three common query scopes:

| Scope | Use it when |
| --- | --- |
| `live_topology` | You need fast, cheaper access to recent/hot topology |
| `archive_topology` | You need wider historical topology and can accept slower, potentially costlier queries |
| `facts` | You need labels, features, risk scores, assets, or enrichment |

## AML Tools

### Address Risk

```bash
cia mcp address-risk \
  --network bittensor \
  --address 5...
```

### Track Funds

```bash
cia mcp track-funds \
  --network bittensor \
  --trusted-addresses 5... \
  --case 1
```

### Scam Topology

```bash
cia mcp scam-topology \
  --network bittensor \
  --victim-address 5... \
  --incident-timestamp-ms 1715532228001 \
  --max-hops 16 \
  --case 1
```

## Documentation

| Doc | Use it for |
| --- | --- |
| [Graph tools](docs/graph-tools.md) | AML tools, GraphRAG MCP primitives, topology scopes, result contracts |
| [Investigation workspaces](docs/investigation-workspaces.md) | Workspace layout, cases, evidence, imports, templates, reports |
| [MCP proxy](docs/mcp-proxy.md) | Using Chain Insights as an MCP server from agent clients |
| [Architecture](docs/architecture.md) | Product layers, data flow, local storage, security model |
| [Development](docs/development.md) | Build, test, and local install commands |
| [Contributing](docs/contributing.md) | Adding AML tools and updating shipped skills/docs |
| [Debugging](docs/debugging.md) | Local GraphRAG MCP, debug auth, Inspector, UAT |

## What Chain Insights Is Not

Chain Insights is not a hosted SaaS app, wallet custodian, chain indexer, or
replacement for GraphRAG sync. It is the local AML investigation and tool
framework layered on top of GraphRAG MCP.
```

- [ ] **Step 2: Update graph tools doc product framing**

In `docs/graph-tools.md`, replace product-facing mentions of `Go Graph MCP` with `GraphRAG MCP`. Keep technical backend details only where necessary.

Required phrases after edit:

```text
GraphRAG MCP public graph surface
Chain Insights AML tools
live_topology
archive_topology
facts
```

- [ ] **Step 3: Update MCP proxy doc product framing**

In `docs/mcp-proxy.md`, ensure the opening says:

```markdown
The Chain Insights stdio proxy lets AI agents consume Chain Insights tools as
an MCP server. It connects to the configured GraphRAG MCP endpoint and adds
local wallet, case, evidence, and graph-report behavior.
```

Do not mention `Claude Desktop` in README. It may remain in this deep proxy doc if it is clearly client-specific setup, not product positioning.

- [ ] **Step 4: Run focused docs contract test**

Run:

```bash
npm test -- tests/skills-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit README and graph docs**

```bash
git add README.md docs/graph-tools.md docs/mcp-proxy.md tests/skills-contract.test.ts
git commit -m "docs make readme product first"
```

---

### Task 6: Version, Build, And Release Gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `dist/**`

- [ ] **Step 1: Bump version**

Run:

```bash
npm version --no-git-tag-version 0.2.14
```

Expected: `package.json` and `package-lock.json` move from `0.2.13` to `0.2.14`.

- [ ] **Step 2: Update changelog**

Add this entry to the top of `CHANGELOG.md` below the intro:

```markdown
## [0.2.14] - 2026-05-24

- Reworked README into a product-first Chain Insights overview with a cleaner quick start, AML tool showcase, GraphRAG MCP layering, and live/archive/facts topology guidance.
- Added Chain Insights developer-experience guidance plus focused contributing and debugging docs.
- Dogfooded the installed `cia` workflow from a clean workspace and documented the resulting README/CLI feedback.
```

- [ ] **Step 3: Build dist**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` reflects the new package version.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/skills-contract.test.ts tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full local gate**

Run:

```bash
npm run typecheck
npm test
npm run release:check
git diff --check
npm pack --dry-run
```

Expected:

- Typecheck exits `0`.
- Vitest reports all test files passing.
- Release gate reports `0.2.13 -> 0.2.14`.
- `git diff --check` prints nothing.
- `npm pack --dry-run` includes `README.md`, `docs/*.md`, `docs/images`, and `skills`.

- [ ] **Step 6: Commit release update**

```bash
git add -A
git commit -m "docs polish chain insights dx"
```

---

### Task 7: Final Dogfood Smoke With Updated Docs

**Files:**
- Modify if needed: `docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md`

- [ ] **Step 1: Install updated package globally from checkout**

Run:

```bash
npm run build
npm install -g .
cia --version
```

Expected: `cia --version` prints `0.2.14`.

- [ ] **Step 2: Re-run minimal clean workspace smoke**

Run:

```bash
rm -rf /home/aphex5/work/chain-insights-dx-dogfood-final
mkdir -p /home/aphex5/work/chain-insights-dx-dogfood-final
cd /home/aphex5/work/chain-insights-dx-dogfood-final
cia init .
cia mcp networks
cia mcp tools --refresh
```

Expected: workspace initializes and discovery commands behave as documented.

- [ ] **Step 3: Update dogfood report if the final smoke changes findings**

If the final smoke reveals new friction, append a section:

```markdown
## Final Smoke Notes

- Record the final smoke observation from the updated globally installed CLI.
```

If no new friction appears, append:

```markdown
## Final Smoke Notes

- Updated docs matched the final clean workspace smoke path.
```

- [ ] **Step 4: Commit final report update if changed**

```bash
git add docs/superpowers/reports/2026-05-24-chain-insights-dx-dogfood.md
git commit -m "docs update dx dogfood report"
```

Skip this commit if the report did not change.

---

## Plan Self-Review

Spec coverage:

- Product-first README: Task 5.
- Remove Claude Desktop from README: Task 1 and Task 5.
- Replace Go framing with GraphRAG MCP: Task 1 and Task 5.
- Move debug/contributor details: Task 4 and Task 5.
- Document AML tools and generic GraphRAG tools: Task 1, Task 3, Task 5.
- Document live/archive/facts: Task 1, Task 3, Task 5.
- Show network/tool discovery: Task 1, Task 2, Task 5, Task 7.
- Create Developer Experience skill: Task 3.
- Run clean dogfood investigation: Task 2 and Task 7.
- Release/version/build/test: Task 6.

Placeholder scan: no `TBD`, `TODO`, or unresolved decisions are intentionally left in this plan. Dynamic dogfood observations are gathered from actual command output and written into the report during Task 2.

Type/name consistency:

- Tool names use `address_risk`, `track_funds`, `scam_topology` for MCP/tool contract language.
- CLI examples use dashed commands where the CLI exposes dashed subcommands: `address-risk`, `track-funds`, `scam-topology`.
- Topology names are `live_topology`, `archive_topology`, and `facts`.
