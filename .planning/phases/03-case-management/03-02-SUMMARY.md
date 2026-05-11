---
phase: 03-case-management
plan: "02"
subsystem: cases
tags: [case-management, evidence, dossier, session, tdd, sha256, cli]
dependency_graph:
  requires: [03-01-SUMMARY.md]
  provides: [src/cases/evidence.ts, src/cases/dossier.ts, src/cases/session.ts, src/cases/store.ts loadContext, src/cases/index.ts]
  affects: [src/cli.ts]
tech_stack:
  added: []
  patterns: [sha256-manifest-append-only, content-hash-dedup, rolling-session-window, exclusive-wx-flag, 0o600-permissions]
key_files:
  created:
    - src/cases/evidence.ts
    - src/cases/dossier.ts
    - src/cases/session.ts
    - tests/cases-evidence.test.ts
    - tests/cases-dossier.test.ts
    - tests/cases-session.test.ts
  modified:
    - src/cases/store.ts
    - src/cases/index.ts
    - src/cli.ts
decisions:
  - "Address sanitization retains 'x' in hex addresses (0x...) — /[^a-zA-Z0-9]/g keeps alphanumeric including 'x'"
  - "Test expectations updated to match actual sanitizer behavior (0x prefix retained in filenames)"
  - "New subcommands added to existing case command block rather than creating a second program.command('case')"
metrics:
  duration: "7 minutes"
  completed: "2026-05-11"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 3
  tests_added: 22
  tests_total: 93
---

# Phase 03 Plan 02: Evidence, Dossier, Session, and Case Resume Summary

Evidence append-only store with SHA-256 integrity manifest, per-entity dossier accumulation with content-hash deduplication, investigation sessions with rolling 5-session archive to history.md, and CaseStore.loadContext() for full case resume — all wired to CLI subcommands with 0o600 file permissions throughout.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | EvidenceStore SHA-256 manifest (RED→GREEN) | 1bd8e7d | src/cases/evidence.ts, tests/cases-evidence.test.ts |
| 2 | DossierStore + SessionStore + loadContext (RED→GREEN) | 06d7ad6 | src/cases/dossier.ts, src/cases/session.ts, tests/cases-dossier.test.ts, tests/cases-session.test.ts, src/cases/store.ts, src/cases/index.ts |
| 3 | Wire CLI subcommands | 9eb56fd | src/cli.ts |

## Verification

- `npx vitest run` — 93 tests, 15 files, all passing (was 71/12 before plan)
- `npx tsdown` — clean build, no TypeScript errors
- `node dist/cli.mjs case --help` — shows open/activate/suspend/close/list/evidence/dossier/session/resume
- `node dist/cli.mjs case evidence --help` — shows add/verify
- `node dist/cli.mjs case session --help` — shows start/end
- TDD gate compliance: RED (tests written first, confirmed failing) → GREEN (implementation passes)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test regex pattern did not match actual timestamp format**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test regex `\d+` would not match `20260511T070609` (timestamp with `T` separator)
- **Fix:** Updated test regex to `\d+T\d+` to match actual `YYYYMMDDTHHMMSS` format
- **Files modified:** tests/cases-evidence.test.ts
- **Commit:** 1bd8e7d

**2. [Rule 1 - Bug] Dossier filename test expected wrong sanitization output**
- **Found during:** Task 2 GREEN phase  
- **Issue:** Test expected `01234abcd5678ef90.md` (without `x`) but sanitizer `/[^a-zA-Z0-9]/g` retains `x` (alphanumeric), producing `0x1234abcd5678ef90.md`
- **Fix:** Updated test expectations to match actual sanitizer output (`0x` prefix retained)
- **Files modified:** tests/cases-dossier.test.ts
- **Commit:** 06d7ad6

**3. [Rule 1 - Bug] CLI had duplicate `program.command('case')` block**
- **Found during:** Task 3 implementation
- **Issue:** Plan said to add new subcommands as addCommand() calls, but adding a new `program.command('case')` block created a duplicate; Commander would silently ignore the second one
- **Fix:** Merged new subcommands into existing `case` block by replacing the closing paren with `.addCommand(` chain continuations
- **Files modified:** src/cli.ts
- **Commit:** 9eb56fd

## TDD Gate Compliance

- RED gate: Tests written first and confirmed failing before any implementation
- GREEN gate: Implementation committed after all tests pass
- Task 1: evidence tests (7) RED → implementation → GREEN
- Task 2: dossier + session tests (15) RED → implementation → GREEN

## Known Stubs

None — all data flows are wired. Evidence files created with real SHA-256 hashes. Dossier dedup compares actual text content. Session archive reads and compresses real session files.

## Threat Flags

None — all threat model items implemented:
- T-03-06: Address sanitization `/[^a-zA-Z0-9]/g` present in dossier.ts
- T-03-07: EvidenceStore.verifyManifest() re-hashes all evidence files
- T-03-08: All writes use `{ mode: 0o600 }` 
- T-03-10: Exclusive `wx` flag prevents evidence collision
- T-03-11: Source sanitization `/[^a-z0-9_-]/gi` in evidence.ts

## Self-Check: PASSED
