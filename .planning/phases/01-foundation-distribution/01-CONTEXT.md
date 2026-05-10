# Phase 1: Foundation & Distribution - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Investigator can install the toolkit globally, run the CLI, and have a working local server with embedded database — the skeleton that all investigation features build on. This is pure infrastructure: npm package structure, CLI scaffold, DuckDB initialization, Hono server, and config system.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and GSD reference architecture (`references/get-shit-done/`) to guide decisions.

Key constraints from PROJECT.md:
- TypeScript 6.0 / Node.js 22+
- Hono (NOT Fastify) for local server
- DuckDB Neo client (`@duckdb/node-api`, NOT deprecated `duckdb` package)
- Commander.js for CLI
- tsdown for build
- Vitest for tests
- Package name: `chain-insights`
- Config directory: `.chain-insights/`
- Installer: `npx chain-insights --claude` (GSD-style)
- MCP auth: Bearer token (private endpoint for now)
- Domain vocabulary: cases, playbooks, evidence, dossiers, watches

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `references/get-shit-done/` — GSD framework reference for installer pattern, CLI structure, skill registration, hook system

### Established Patterns
- No existing codebase — greenfield project
- GSD patterns to follow: `bin/install.js` installer, Commander-based CLI, skill/hook registration

### Integration Points
- None yet — this is the foundation phase

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
