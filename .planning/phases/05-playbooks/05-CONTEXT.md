# Phase 5: Playbooks - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Playbook engine for repeatable, multi-step investigation workflows declared as markdown files. Investigators run `chain-insights playbook run <name>` and the runner steps through each declared step, calling MCP tools via x402, storing results as case evidence. Built-in starter playbooks (trace-funds, risk-check, entity-profile) ship out of the box.

Depends on: Phase 2 (MCP connection + x402 payments), Phase 3 (case management + evidence store), Phase 4 (visualization for auto-viz in trace-funds).

</domain>

<decisions>
## Implementation Decisions

### Playbook Format & Declaration
- Playbooks are markdown files with YAML frontmatter for metadata + ordered H2 sections per step, each with `tool:` and `params:` code blocks — matches evidence file pattern from Phase 3
- Built-in playbooks in `src/playbooks/` bundled with dist, user playbooks in `~/.chain-insights/playbooks/`
- Name resolution: search user dir first, then built-in dir — user can override built-in playbooks by name
- Playbooks support parameters via YAML frontmatter `params:` array (name/type/required), injected via `{{param}}` template syntax in step definitions

### Runner Execution Model
- Sequential execution — each step calls an MCP tool via `@x402/fetch`, waits for response, stores result as evidence in the case, then proceeds to next step
- Timeout: auto-retry 3x (no cost — x402 charges only after successful MCP execution)
- MCP error: stop and report which step failed, what error, what completed so far
- x402 payment failure (insufficient funds): pause and prompt user to fund wallet, allow `retry` to continue from same step
- User can re-run from a failed step with `--from N`
- No active case required — if no `--case` specified, auto-create a quick case (`quick_{timestamp}_{playbook-name}`) so results are always stored as evidence. Full cases for serious investigations, quick cases for one-off runs
- Dry-run mode: `--dry-run` shows what steps would execute, what MCP tools would be called, estimated x402 cost per step. No actual calls made

### Output & Built-in Playbooks
- Each step result stored as evidence file in the case (Phase 3 evidence store pattern). Runner prints progress: `Step 1/3: trace-funds... ✓ (2 hops found)`. Final summary with key findings to stdout
- trace-funds and risk-check are built-in MCP tool actions — playbooks orchestrate them and process their entire output into evidence. The MCP determines what they actually do
- 3 built-in playbooks: **trace-funds** (query address → follow hops → build graph → auto-viz), **risk-check** (query address → check exposure → score), **entity-profile** (query address → gather history → build dossier)
- trace-funds: 2 hops by default, configurable via `hops` parameter — keeps x402 costs predictable
- trace-funds auto-generates visualization (Phase 4's `generateVisualization`) if case has transaction data. Other playbooks don't auto-viz

### Claude's Discretion
- Internal playbook parser implementation details
- Step result formatting before evidence storage
- Progress display formatting and verbosity levels
- Error message wording for x402 failures and MCP errors

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/mcp/client.ts` — MCP tool calling via `@x402/fetch`, handles x402 payments transparently
- `src/cases/evidence.ts` — `EvidenceStore.append()` for storing step results as evidence files
- `src/cases/dossier.ts` — `DossierStore.appendFinding()` for building entity profiles
- `src/cases/store.ts` — `CaseStore.get/create()` for case lifecycle
- `src/cases/session.ts` — Session management for investigation context
- `src/viz/index.ts` — `generateVisualization()` for auto-viz in trace-funds playbook
- `src/viz/data-extractor.ts` — `extractGraphFromCase()` for building graph from case evidence
- `src/cases/frontmatter.ts` — `parseFrontmatter()` for reading markdown with YAML frontmatter
- `src/cli.ts` — Commander-based CLI with subcommand pattern

### Established Patterns
- Flat markdown files with YAML frontmatter for all persistent data (cases, evidence, dossiers, sessions)
- Object literal exports (`EvidenceStore`, `DossierStore`, `CaseStore`) — not classes
- `~/.chain-insights/` as global config/data directory
- Pino structured logging via Hono server
- Zod for schema validation with runtime types

### Integration Points
- CLI: add `playbook` subcommand to `src/cli.ts` (Commander pattern: `program.command('playbook')`)
- MCP: use existing `@x402/fetch` wrapper for tool calls
- Cases: auto-create quick case or attach to existing case
- Evidence: store each step result via `EvidenceStore.append()`
- Viz: optional auto-viz at end of trace-funds via `generateVisualization()`

</code_context>

<specifics>
## Specific Ideas

- Quick cases for one-off playbook runs (auto-created, no manual `case open` needed)
- x402 charges only on successful MCP execution — timeouts are free to retry
- Interactive retry prompt on payment failure (insufficient funds)
- Playbook parameter templating with `{{param}}` syntax

</specifics>

<deferred>
## Deferred Ideas

- Playbook composition (one playbook calling another) — v2
- Conditional branching in playbooks (if/else based on step results) — v2
- Playbook marketplace/sharing — future
- Parallel step execution — future
- Cost estimation before full playbook run — future (would need MCP pricing metadata)

</deferred>
