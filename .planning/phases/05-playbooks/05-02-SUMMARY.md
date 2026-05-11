---
phase: 05-playbooks
plan: "02"
subsystem: playbooks
tags: [playbooks, builtins, cli, commander, tdd]

dependency_graph:
  requires:
    - 05-01  # PlaybookParser, PlaybookRunner, resolvePlaybook, listPlaybooks
  provides:
    - BUILTIN_PLAYBOOKS map (src/playbooks/builtins.ts)
    - resolvePlaybookContent() (src/playbooks/resolver.ts)
    - CLI playbook subcommand: run/list/show (src/cli.ts)
  affects:
    - src/playbooks/parser.ts (added frontmatter params array parsing)
    - src/playbooks/resolver.ts (updated to use BUILTIN_PLAYBOOKS map)
    - tests/playbook-resolver.test.ts (updated for new built-in-via-map behavior)

tech_stack:
  added: []
  patterns:
    - TDD RED-GREEN: failing test committed before builtins.ts existed
    - Built-in playbooks as TypeScript string constants (avoids tsdown asset-copy)
    - resolvePlaybookContent() user-dir-first, BUILTIN_PLAYBOOKS fallback
    - Dynamic import() for playbook modules in CLI actions (fast startup)
    - YAML params array parsed from frontmatter without external YAML library

key_files:
  created:
    - src/playbooks/builtins.ts
    - tests/playbook-builtins.test.ts
    - tests/playbook-cli.test.ts
  modified:
    - src/cli.ts
    - src/playbooks/parser.ts
    - src/playbooks/resolver.ts
    - tests/playbook-resolver.test.ts

decisions:
  - "Built-in playbooks as TypeScript string constants (not .md files) to avoid tsdown asset-copy issues (D-01 from 05-CONTEXT)"
  - "resolvePlaybookContent() added alongside resolvePlaybook() for content-first access pattern; resolvePlaybook() marked @deprecated"
  - "BUILTIN_PLAYBOOKS map replaces readdir-based built-in lookup in listPlaybooks() — deterministic, no filesystem dependency"
  - "Parser updated to parse YAML params array from frontmatter without external YAML library (custom parseFrontmatterParamsArray)"

metrics:
  duration: "4 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  files_created: 3
  files_modified: 4
---

# Phase 5 Plan 02: Playbook CLI and Built-in Definitions Summary

**One-liner:** Three built-in playbook definitions as TypeScript string constants wired to a Commander CLI subcommand (run/list/show) with dry-run, params injection, and user-dir override support.

## What Was Built

### src/playbooks/builtins.ts

Three built-in playbook definitions embedded as TypeScript string constants:

- `TRACE_FUNDS_PLAYBOOK` — traces fund flows from an address (2 steps: trace_funds, get_transaction_graph)
- `RISK_CHECK_PLAYBOOK` — risk exposure and sanctions screening (2 steps: check_risk_exposure, get_entity_details)
- `ENTITY_PROFILE_PLAYBOOK` — comprehensive entity profile (3 steps: get_transaction_history, get_counterparties, check_risk_exposure)
- `BUILTIN_PLAYBOOKS` — `Record<string, string>` map for O(1) lookup by name

MCP tool names in these playbooks are placeholders with a developer note to verify against `chain-insights mcp tools` output (T-05-07).

### src/playbooks/parser.ts (updated)

Added `parseFrontmatterParamsArray()` to parse the multi-line YAML params block from frontmatter without an external YAML library. The parser now correctly populates `PlaybookDefinition.params` with typed `ParamSpec` entries including `required`, `default`, and `type` fields.

### src/playbooks/resolver.ts (updated)

- Added `resolvePlaybookContent(name)`: returns markdown directly — checks user dir (`~/.chain-insights/playbooks/<name>.md`), falls back to `BUILTIN_PLAYBOOKS[name]`
- Updated `listPlaybooks()` to use `Object.keys(BUILTIN_PLAYBOOKS)` instead of `readdir` for built-in enumeration (deterministic, no FS dependency)
- `resolvePlaybook()` marked `@deprecated` (returns `builtin:<name>` sentinel for built-ins)

### src/cli.ts (updated)

New `playbook` subcommand with three actions:

- `chain-insights playbook run <name>` — resolves content, parses, validates required params, runs via `PlaybookRunner.run()`
- `chain-insights playbook list` — lists all built-in and user playbooks with source markers
- `chain-insights playbook show <name>` — prints description, params spec, and step list without executing

CLI options: `--dry-run`, `-p/--param key=value` (repeatable), `--case <id>`, `--from <n>`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resolver tests broke after switching built-in lookup from readdir to BUILTIN_PLAYBOOKS map**
- **Found during:** Task 1 implementation verification
- **Issue:** `tests/playbook-resolver.test.ts` mocked `readdir` for the built-in dir (old behavior). After switching to BUILTIN_PLAYBOOKS map, the mock no longer controlled built-in behavior.
- **Fix:** Updated 4 resolver tests to use the new built-in-via-map behavior (removed second readdir mock, adjusted assertions)
- **Files modified:** `tests/playbook-resolver.test.ts`
- **Commit:** fcccefe

## TDD Gate Compliance

- RED gate: `test(05-02): add failing tests for built-in playbook constants` (b607c4d) — all tests failed (module not found)
- GREEN gate: `feat(05-02): add built-in playbook constants and update resolver` (fcccefe) — all 11 builtins tests passed

## Commits

| Hash | Type | Description |
|------|------|-------------|
| b607c4d | test | Add failing tests for built-in playbook constants (RED) |
| fcccefe | feat | Add built-in playbook constants and update resolver (GREEN) |
| 1031f47 | feat | Add playbook CLI subcommand (run/list/show) |

## Verification

```
npx vitest run tests/playbook-parser.test.ts tests/playbook-runner.test.ts tests/playbook-resolver.test.ts tests/playbook-builtins.test.ts
Test Files  4 passed (4)
Tests       38 passed (38)

npx tsc --noEmit
(exit 0 — no errors)

npm run build
Build complete in 936ms

node bin/cli.js playbook list
  trace-funds          [builtin]
  risk-check           [builtin]
  entity-profile       [builtin]

node bin/cli.js playbook show trace-funds
Playbook: trace-funds v1.0.0
Trace fund flows from a target address — follows hops and auto-generates a money flow visualization

Parameters:
  address: string (required)
  hops: number (optional, default: 2)

Steps:
  1. Step 1: Trace Funds → tool: trace_funds
  2. Step 2: Get Transaction Graph → tool: get_transaction_graph

node bin/cli.js playbook run trace-funds --dry-run -p address=0xdeadbeef
Playbook: trace-funds (dry run — no MCP calls)
Steps: 2 total, starting from 1

Step 1/2: trace_funds (params: {"address":"0xdeadbeef","hops":"{{hops}}"})
Step 2/2: get_transaction_graph (params: {"root":"0xdeadbeef","depth":"{{hops}}"})

Cost: unknown (MCP pricing not available without live connection)
```

## Known Stubs

MCP tool names in builtins.ts are placeholders (T-05-07 from threat model). Actual tool names must be verified via `chain-insights mcp tools` before live investigation use. A developer note is included at the top of `builtins.ts`.

## Threat Surface Scan

No new unplanned trust boundaries. All threat mitigations from plan threat model implemented:
- T-05-06: `--param` parsing splits on first `=` only (`indexOf('=')`, not `split('=')`). Empty keys are rejected with `process.exit(1)`.
- T-05-07: Tool names in builtins are TypeScript constants (not user input). Developer comment warns to verify via `chain-insights mcp tools`.
- T-05-08: Commander accumulates `--param` values as array — accepted risk (no bound enforced; MCP tool arg validation is downstream gate).
- T-05-09: All error messages use `console.error()` (stderr).

## Self-Check: PASSED

Files exist on disk:
- src/playbooks/builtins.ts: FOUND
- src/cli.ts: FOUND (modified)
- tests/playbook-builtins.test.ts: FOUND
- tests/playbook-cli.test.ts: FOUND

Commits found in git log:
- b607c4d (test RED builtins): FOUND
- fcccefe (feat GREEN builtins+resolver): FOUND
- 1031f47 (feat CLI subcommand): FOUND
