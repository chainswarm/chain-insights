---
phase: 05-playbooks
plan: "01"
subsystem: playbooks
tags: [playbooks, engine, parser, runner, resolver, zod, mcp, tdd]

dependency_graph:
  requires:
    - 03-01  # CaseStore, EvidenceStore
    - 02-01  # MCP client, config, wallet
    - 04-01  # generateVisualization
  provides:
    - PlaybookParser (src/playbooks/parser.ts)
    - PlaybookRunner (src/playbooks/runner.ts)
    - resolvePlaybook/listPlaybooks (src/playbooks/resolver.ts)
    - Zod schemas (src/playbooks/schema.ts)
  affects:
    - tsconfig.json (added types:node to fix pre-existing TS errors)

tech_stack:
  added:
    - Zod 4 record schema: z.record(z.string(), z.string()) — required for typed params
  patterns:
    - TDD RED-GREEN: failing tests committed before implementation
    - Single MCP connection per playbook run (open-before-loop, close-in-finally)
    - Template substitution: {{param}} tokens replaced before step execution
    - User-dir-first name resolution for playbook overrides

key_files:
  created:
    - src/playbooks/schema.ts
    - src/playbooks/parser.ts
    - src/playbooks/resolver.ts
    - src/playbooks/runner.ts
    - tests/playbook-parser.test.ts
    - tests/playbook-resolver.test.ts
    - tests/playbook-runner.test.ts
  modified:
    - tsconfig.json

decisions:
  - "Zod 4 z.record() requires two args (key type + value type) — updated StepSchema.params to z.record(z.string(), z.string())"
  - "tsconfig.json types:[node] added to fix 213 pre-existing TS errors affecting entire codebase (console, process, setTimeout, URL, NodeJS namespace)"
  - "Path traversal test updated: ../../etc/passwd sanitizes to 'etcpasswd' (not empty) — throws Playbook not found, not Invalid playbook name"

metrics:
  duration: "5 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  files_created: 7
  files_modified: 1
---

# Phase 5 Plan 01: Playbook Engine Core Summary

**One-liner:** Markdown-driven playbook engine with Zod schemas, H2-section parser, user-dir-first resolver, and sequential MCP runner with retry and x402 payment handling.

## What Was Built

Four new modules in `src/playbooks/` implement the complete playbook execution pipeline:

1. **schema.ts** — Zod 4 schemas for `ParamSpec`, `Step`, and `Playbook` with inferred TypeScript types. `PlaybookSchema.parse()` provides validation at both parse-time and run-time.

2. **parser.ts** — `PlaybookParser.parse(markdown, params)` extracts playbook definition from markdown: frontmatter gives name/description/version, H2 sections become steps with `tool` and `params` fenced blocks. `{{param}}` template tokens are substituted before the step is returned.

3. **resolver.ts** — `resolvePlaybook(name)` checks `~/.chain-insights/playbooks/` before the built-in directory, with path traversal prevention (`/[^a-z0-9_-]/gi` sanitization). `listPlaybooks()` returns all playbooks with `user` or `builtin` source markers.

4. **runner.ts** — `PlaybookRunner.run(playbook, opts)` orchestrates sequential step execution: initializes DB schema, resolves or auto-creates a case, opens a single MCP connection for the full step loop, calls each step tool with 3-retry logic on timeouts, stores evidence via `EvidenceStore.append()`, and triggers `generateVisualization()` for trace-funds playbooks (non-fatal if no transaction data).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod 4 z.record() API change**
- **Found during:** Task 1 implementation (TypeScript check)
- **Issue:** Zod 4 requires `z.record(keySchema, valueSchema)` — calling `z.record(z.string())` with one arg causes TS error TS2554
- **Fix:** Changed `z.record(z.string())` to `z.record(z.string(), z.string())` in StepSchema
- **Files modified:** `src/playbooks/schema.ts`
- **Commit:** ca3f3a9

**2. [Rule 3 - Blocking] Fixed pre-existing tsconfig missing Node.js type definitions**
- **Found during:** Task 2 verification (`npx tsc --noEmit`)
- **Issue:** tsconfig.json `lib: ["ES2022"]` does not include Node.js globals (`console`, `process`, `URL`, `setTimeout`, `NodeJS` namespace). All 213 TS errors across the entire codebase were caused by this. The plan requires `npx tsc --noEmit` to exit 0.
- **Fix:** Added `"types": ["node"]` to `tsconfig.json` `compilerOptions`
- **Files modified:** `tsconfig.json`
- **Commit:** ca3f3a9
- **Note:** This fix resolved all 213 pre-existing errors, not just errors in new files.

**3. [Rule 1 - Test] Path traversal test corrected for actual behavior**
- **Found during:** Task 1 GREEN (test failed unexpectedly)
- **Issue:** `../../etc/passwd` after sanitization becomes `etcpasswd` (non-empty), so it throws `Playbook not found` not `Invalid playbook name`. The test expected the wrong error.
- **Fix:** Split into two tests — one for genuinely empty names (`...` sanitizes to empty string → `Invalid playbook name`), one for traversal attempts that produce a safe name (→ `Playbook not found`).
- **Files modified:** `tests/playbook-resolver.test.ts`
- **Commit:** 3c8640b

## TDD Gate Compliance

- RED gate: `test(05-01): add failing tests for playbook parser and resolver` (2618fae) — confirmed all 7 tests failed before implementation
- GREEN gate: `feat(05-01): implement playbook schemas, parser, and resolver` (3c8640b) — all 17 tests passed
- RED gate: `test(05-01): add failing tests for PlaybookRunner` (3ef6c0b) — confirmed all 10 tests failed before implementation
- GREEN gate: `feat(05-01): implement PlaybookRunner sequential execution engine` (ca3f3a9) — all 27 tests passed

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 2618fae | test | Add failing tests for playbook parser and resolver (RED) |
| 3c8640b | feat | Implement playbook schemas, parser, and resolver (GREEN) |
| 3ef6c0b | test | Add failing tests for PlaybookRunner (RED) |
| ca3f3a9 | feat | Implement PlaybookRunner sequential execution engine (GREEN) |

## Verification

```
npx vitest run tests/playbook-parser.test.ts tests/playbook-runner.test.ts tests/playbook-resolver.test.ts
Test Files  3 passed (3)
Tests       27 passed (27)

npx tsc --noEmit
(exit 0 — no errors)
```

## Known Stubs

None. All modules are fully wired:
- Parser calls `PlaybookSchema.parse()` (real Zod validation, not stub)
- Resolver calls real `access()` and `readdir()` (mocked in tests only)
- Runner calls real `CaseStore`, `EvidenceStore`, `Client`, `generateVisualization`

## Threat Surface Scan

No new unplanned trust boundaries introduced. Threat mitigations from plan threat model were all implemented:
- T-05-01: Path traversal prevention in resolver.ts (name sanitization)
- T-05-02: Zod StepSchema enforces `z.string().min(1)` for tool names
- T-05-04: Hard cap of 3 retries on timeout; x402 payment failure requires explicit user action

## Self-Check: PASSED

All created files found on disk:
- src/playbooks/schema.ts: FOUND
- src/playbooks/parser.ts: FOUND
- src/playbooks/resolver.ts: FOUND
- src/playbooks/runner.ts: FOUND
- tests/playbook-parser.test.ts: FOUND
- tests/playbook-resolver.test.ts: FOUND
- tests/playbook-runner.test.ts: FOUND

All commits found in git log:
- 2618fae (test RED parser+resolver): FOUND
- 3c8640b (feat GREEN parser+resolver): FOUND
- 3ef6c0b (test RED runner): FOUND
- ca3f3a9 (feat GREEN runner): FOUND
