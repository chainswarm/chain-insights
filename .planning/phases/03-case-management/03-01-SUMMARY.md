---
phase: 03-case-management
plan: "01"
subsystem: cases
tags: [case-management, duckdb, cli, tdd, zod, frontmatter]
dependency_graph:
  requires: []
  provides: [src/cases/schema.ts, src/cases/frontmatter.ts, src/cases/store.ts, src/cases/index.ts]
  affects: [src/db/init.ts, src/cli.ts]
tech_stack:
  added: []
  patterns: [zod-schema, hand-rolled-frontmatter, duckdb-named-params, commander-addCommand, 0o600-permissions]
key_files:
  created:
    - src/cases/schema.ts
    - src/cases/frontmatter.ts
    - src/cases/store.ts
    - src/cases/index.ts
    - tests/cases-frontmatter.test.ts
    - tests/cases-store.test.ts
  modified:
    - src/db/init.ts
    - src/cli.ts
decisions:
  - "Tags stored as VARCHAR (comma-separated string) in DuckDB, not VARCHAR[] — DuckDB Neo bind() cannot create values of type ANY for array params"
  - "Case ID regex guards against path traversal per T-03-01 threat model"
  - "All case files written with 0o600 permissions matching config/wallet convention"
metrics:
  duration: "27 minutes"
  completed: "2026-05-11"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 2
  tests_added: 15
  tests_total: 71
---

# Phase 03 Plan 01: Case Lifecycle Management Summary

Case lifecycle management delivered as a complete vertical slice: Zod schemas for all case data types, hand-rolled frontmatter parser, CaseStore (create/setStatus/list/get), idempotent DuckDB schema migration, and `case` CLI subcommand group (open/activate/suspend/close/list) — all with 0o600 file permissions and TDD coverage.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Schemas + frontmatter parser (RED→GREEN) | 55f8c31 | src/cases/schema.ts, src/cases/frontmatter.ts, tests/cases-frontmatter.test.ts |
| 2 | CaseStore + DuckDB migration (RED→GREEN) | db78dbf | src/cases/store.ts, src/cases/index.ts, src/db/init.ts, tests/cases-store.test.ts |
| 3 | Wire case CLI subcommand group | 5afc671 | src/cli.ts |

## Verification

- `npx vitest run` — 71 tests, 12 files, all passing (was 56/10 before plan)
- `npx tsdown` — clean build, 29 files, no TypeScript errors
- `node dist/cli.mjs case --help` — shows open/activate/suspend/close/list subcommands
- TDD gate compliance: RED commit (55f8c31) → GREEN commit (db78dbf) sequence maintained

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed DuckDB tags column from VARCHAR[] to VARCHAR**
- **Found during:** Task 2 GREEN phase
- **Issue:** DuckDB Neo `bind()` cannot create values of type ANY for array parameters. Binding a JS `string[]` to a `VARCHAR[]` column throws "Cannot create values of type ANY. Specify a specific type."
- **Fix:** Changed tags column to `VARCHAR` (stores comma-separated string `"aml,mixer,defi"`), consistent with how tags are stored in case.md frontmatter. The canonical array form lives at the Zod schema level, deserialized on read.
- **Files modified:** src/db/init.ts (column type), src/cases/store.ts (bind value)
- **Commit:** db78dbf

## TDD Gate Compliance

- RED gate: test(03-01) commit present at 55f8c31 (frontmatter tests fail — module not found)
- GREEN gate: feat(03-01) commit present at db78dbf (all 8 CaseStore tests pass)
- REFACTOR gate: not needed — code was clean on first pass

## Known Stubs

None — all data flows are wired. CaseStore.create() persists to both filesystem and DuckDB. case.md frontmatter contains all required fields. DuckDB list() returns live data.

## Threat Flags

None — all threat model items from plan's `<threat_model>` were implemented:
- T-03-01: Slug generation strips non-alphanumeric chars
- T-03-02: CaseSchema regex validates case IDs before file I/O
- T-03-03: All case files written with 0o600
- T-03-05: All SQL uses $name named parameters with bind() dict

## Self-Check: PASSED
