# Chain Insights README and Developer Experience Redesign

## Purpose

Rewrite the Chain Insights README so it sells and teaches the product before it
explains implementation details, and add a developer experience skill that helps
future agents extend the AML tool framework consistently.

The README should make a fresh reader understand that Chain Insights is an AML
investigation framework layered on top of GraphRAG MCP. GraphRAG MCP provides
generic graph-language primitives. Chain Insights turns those primitives into
investigation workflows, case files, evidence, reports, and higher-level AML
tools.

## Reader

Primary reader: a developer, analyst, or agent landing cold on the repository
who wants to try Chain Insights and understand what it can do.

Secondary reader: a contributor adding or improving AML tools without turning
the README into a debugging or implementation notebook.

## Success Criteria

- README opens from the product perspective, not implementation internals.
- README does not mention Claude Desktop.
- README does not use "Go Graph MCP" as the product framing. Use GraphRAG MCP
  unless a low-level contributor doc needs the implementation detail.
- README does not include debug-token, local bypass, release-gate, or UAT
  details. Those belong in deeper docs.
- README clearly states that Chain Insights is a framework for adding AML tools.
- README lists the current Chain Insights AML tools: `address_risk`,
  `track_funds`, and `scam_topology`.
- README explains that GraphRAG MCP exposes generic tools such as
  `graph_query` and `graph_query_batch`.
- README explains the topology model:
  - `live_topology` is fast, cheaper, and intended for recent/hot data.
  - `archive_topology` is wider and historical, but slower and potentially
    more costly.
  - `facts` is for labels, features, risk scores, assets, and enrichment.
- README shows how to discover currently available networks and tools with CIA
  commands before running investigations.
- README has an easy-path quick start and a small demonstration of what is
  possible before detailed tool docs.
- Debug and contributor material is discoverable from the README but lives in
  dedicated docs.
- The experience is verified by a clean dogfood run from outside the repo.

## Non-Goals

- Do not redesign the actual AML algorithms in this pass.
- Do not change GraphRAG MCP or Chain Insights runtime behavior unless the
  dogfood run exposes a small blocking CLI/documentation bug.
- Do not remove existing deep technical docs; reorganize and link them.
- Do not write labels to the warehouse from the README examples.

## Approach

Use a shipped developer experience skill plus focused contributor docs.

Add:

- `skills/chain-insights-developer-experience/SKILL.md`
- `docs/contributing.md`
- `docs/debugging.md`

Update:

- `README.md`
- `docs/graph-tools.md`
- `docs/mcp-proxy.md`
- `docs/development.md`
- `tests/skills-contract.test.ts`
- package metadata if a new shipped skill or doc needs inclusion

## README Structure

1. **Product opening**
   - Chain Insights is an AML investigation framework on top of GraphRAG MCP.
   - It helps investigators and agents turn graph access into cases, evidence,
     dossiers, reports, and reviewable labels.

2. **What you can do today**
   - Screen one address with `address_risk`.
   - Trace victim/source funds with `track_funds`.
   - Expand victim incident laundering topology with `scam_topology`.

3. **Quick start**
   - Install or run `cia`.
   - Initialize a workspace.
   - Check available networks with `cia mcp networks` or equivalent current CLI
     command.
   - Refresh/check available tools.
   - Run one small investigation command.

4. **Small demonstration**
   - A concise example showing a victim/source address flowing through the
     framework:
     - create workspace
     - open case
     - run `track-funds` or `address-risk`
     - point to reports/evidence

5. **How the layers fit**
   - GraphRAG MCP: generic graph primitives, currently `graph_query` and
     `graph_query_batch`.
   - Chain Insights: AML tools and investigation workflow on top.

6. **Topology choices**
   - `live_topology`: fast/recent/hot path.
   - `archive_topology`: broad historical path, slower and potentially more
     costly.
   - `facts`: labels/features/enrichment.

7. **AML tools**
   - Short product descriptions and example commands for:
     - `address_risk`
     - `track_funds`
     - `scam_topology`

8. **Documentation map**
   - Link to graph tools, investigation workspaces, MCP proxy, architecture,
     debugging, and contributing.

## Dogfood Experience Requirement

Before finalizing README prose, run a clean developer-experience rehearsal from
outside the repository.

Create a new test directory under `/home/aphex5/work/`, for example:

```text
/home/aphex5/work/chain-insights-dx-dogfood
```

Act as a fresh developer:

1. Start outside the Chain Insights repo.
2. Use the globally installed `cia` binary, not `node bin/cli.js`.
3. Initialize an investigation workspace.
4. Discover networks and available tools using CIA commands.
5. Open a small case.
6. Run an investigation for a victim/source address.
7. Inspect what files were created.
8. Capture friction, confusing command names, missing help, missing output
   pointers, or unclear docs.
9. Convert the findings into README improvements and, if small enough, CLI/doc
   improvements in the same implementation pass.

The dogfood run should produce a short report under `docs/superpowers/reports/`
or another repo-local report path chosen during implementation. The report must
not include secrets or large raw JSON payloads.

## Developer Experience Skill

Create a shipped skill for agents changing Chain Insights:

```text
skills/chain-insights-developer-experience/SKILL.md
```

The skill should teach:

- Start from the product layer before implementation detail.
- Use "GraphRAG MCP" for product docs.
- Treat Chain Insights as the AML framework layer.
- Keep debug and contributor workflows out of README unless they are part of
  the beginner path.
- Use `cia mcp networks` or the current equivalent to discover network
  capability.
- Explain `live_topology`, `archive_topology`, and `facts` consistently.
- Add new AML tools by documenting:
  - user problem
  - required inputs
  - output contract
  - case/evidence behavior
  - graph report behavior
  - tests and UAT path
- Dogfood README and CLI changes from a clean workspace before claiming the
  developer experience is good.

## Supporting Docs

`docs/contributing.md`:

- Local setup.
- Where to add new AML tools.
- How to update skills and docs.
- Testing expectations.
- Release/version/changelog expectations.

`docs/debugging.md`:

- Local GraphRAG MCP debug setup.
- Debug-token and test-access-key workflows.
- Inspector commands.
- UAT scripts.
- Common troubleshooting.

`docs/development.md` should remain concise and link to these deeper docs
instead of owning all debug and contribution details.

## Validation

Run at minimum:

```bash
npm run build
npm test -- tests/skills-contract.test.ts tests/cli.test.ts
npm run typecheck
npm test
npm run release:check
git diff --check
```

Dogfood validation must also run:

```bash
cia --version
cia init <fresh-workspace>
cia mcp networks
cia mcp tools --refresh
cia case open ...
cia mcp address-risk ... or cia mcp track-funds ...
```

Use the actual command names discovered from `cia --help` if they differ from
the examples above.

## Risks

- README can become marketing-only and lose runnable commands. Mitigation:
  keep an easy-path quick start and one concrete demonstration.
- README can become technical again. Mitigation: move debug and contribution
  detail to `docs/debugging.md` and `docs/contributing.md`.
- Dogfood run can accidentally write investigation output to the repo or home
  config directory. Mitigation: use a dedicated workspace under
  `/home/aphex5/work/` and inspect generated files.
- Network availability may change. Mitigation: document network discovery
  commands rather than hard-coding only one assumed network.

## Decision

No user decision remains open. Use the recommended shipped skill plus
contributor/debug docs approach, and include the clean dogfood run before
finalizing README copy.
