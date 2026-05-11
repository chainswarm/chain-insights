---
phase: 03-case-management
verified: 2026-05-11T09:12:00Z
status: passed
score: 13/13
overrides_applied: 0
re_verification: false
---

# Phase 3: Case Management Verification Report

**Phase Goal:** Investigator can open cases, accumulate evidence and dossiers across sessions, and resume investigations with full context — the persistent state layer for all investigation work
**Verified:** 2026-05-11T09:12:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Investigator can run `chain-insights case open` and get a case directory at `~/.chain-insights/cases/YYYYMMDD_NNN_slug/` | VERIFIED | `generateCaseId()` in store.ts produces correct format; `mkdir` creates `evidence/` and `dossiers/` subdirs; test `CaseStore.create() creates directory structure` passes |
| 2 | `case.md` exists in case directory with correct YAML frontmatter (id, name, status=open, created, updated, tags) | VERIFIED | `writeFile` with `serializeFrontmatter(fm, body)` in store.ts L55; test `case.md has correct YAML frontmatter` passes |
| 3 | DuckDB cases table has a row for the new case (updated_at, tags, description, slug columns present) | VERIFIED | `migrateCasesTable()` in db/init.ts adds all 4 columns; INSERT uses all columns; test `CaseStore.list() returns cases from DuckDB` passes |
| 4 | Investigator can activate, suspend, close a case — case.md status field and DuckDB row both update | VERIFIED | `CaseStore.setStatus()` in store.ts writes case.md and runs `UPDATE cases SET status=...`; test `CaseStore.setStatus() updates case.md` passes |
| 5 | All case files written with 0o600 permissions | VERIFIED | `{ mode: 0o600 }` on case.md (store.ts L55), manifest.json (store.ts L58), evidence files (evidence.ts L73), dossier files (dossier.ts L69), session files (session.ts L38); permission tests pass |
| 6 | DuckDB schema migration is idempotent — running twice does not crash | VERIFIED | `migrateCasesTable()` checks `information_schema.columns` before each `ALTER TABLE`; test `migrateCasesTable is idempotent (no throw on double call)` passes |
| 7 | Investigator can add evidence: evidence file created in `cases/<id>/evidence/` with YAML frontmatter and SHA-256 entry in manifest.json | VERIFIED | `EvidenceStore.append()` in evidence.ts; `appendToManifest()` writes SHA-256; all 7 evidence tests pass |
| 8 | Evidence manifest integrity check passes for clean case and fails when file is tampered | VERIFIED | `EvidenceStore.verifyManifest()` re-hashes files vs stored SHA-256; tests `verifyManifest() returns ok:true` and `ok:false when file is tampered` both pass |
| 9 | Investigator can update a dossier for an entity: `dossiers/<id>/<safeAddr>.md` created or appended, deduplication skips identical findings | VERIFIED | `DossierStore.appendFinding()` in dossier.ts; text-presence dedup check at L54; tests for create, append, and dedup all pass |
| 10 | Investigator can start and end investigation sessions: `session_NNN.md` files created with correct YAML frontmatter | VERIFIED | `SessionStore.start()` and `SessionStore.end()` in session.ts; tests `start() creates session_001.md` and `end() updates session file` pass |
| 11 | When more than 5 session files exist, `archiveOldSessions()` compresses the oldest to history.md | VERIFIED | `archiveOldSessions()` in session.ts with `MAX_SESSIONS=5`; ENOENT-safe `.catch(() => '')` for missing history.md; tests for archive and ENOENT-safety pass |
| 12 | Case resume (`loadContext`) returns structured object with case metadata, latest session body, all dossier summaries, and evidence count | VERIFIED | `CaseStore.loadContext()` in store.ts L135-183; uses `Promise.all` for parallel reads; tests `loadContext() returns case metadata` and `includes latest session and dossier summaries` pass |
| 13 | CLI wires all case subcommands: open/activate/suspend/close/list/evidence add+verify/dossier update/session start+end/resume | VERIFIED | `src/cli.ts` L194-424; all stores imported via dynamic `import('./cases/index.js')`; `node dist/cli.mjs case --help` shows all 9 top-level subcommands |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cases/schema.ts` | CaseSchema, EvidenceSchema, DossierSchema, SessionSchema + types | VERIFIED | All 4 schemas exported; caseIdRegex guards path traversal |
| `src/cases/frontmatter.ts` | parseFrontmatter, serializeFrontmatter — hand-rolled regex parser | VERIFIED | FRONTMATTER_RE regex present; no gray-matter/js-yaml dependency |
| `src/cases/store.ts` | CaseStore: create, setStatus, list, get, loadContext, generateCaseId | VERIFIED | All 5 methods + generateCaseId present and substantive |
| `src/cases/index.ts` | Barrel re-exports for all cases/ modules | VERIFIED | Exports CaseStore, EvidenceStore, DossierStore, SessionStore, all schemas, all types |
| `src/cases/evidence.ts` | EvidenceStore: append, verifyManifest | VERIFIED | SHA-256 via createHash, exclusive wx flag, 0o600 permissions |
| `src/cases/dossier.ts` | DossierStore: appendFinding, get, listSummaries | VERIFIED | Address sanitization, content dedup, 0o600 permissions |
| `src/cases/session.ts` | SessionStore: start, end, archiveOldSessions, getLatest | VERIFIED | Rolling 5-session window, ENOENT-safe history.md read, 0o600 permissions |
| `src/db/init.ts` | migrateCasesTable() — idempotent ALTER TABLE migration | VERIFIED | Checks information_schema before each ALTER; called from initSchema() |
| `src/cli.ts` | case subcommand group with all subcommands | VERIFIED | open/activate/suspend/close/list/evidence/dossier/session/resume all present |
| `tests/cases-frontmatter.test.ts` | Frontmatter parser unit tests | VERIFIED | 8 tests, all passing |
| `tests/cases-store.test.ts` | CaseStore unit tests (CASE-01) | VERIFIED | 7 tests, all passing |
| `tests/cases-evidence.test.ts` | EvidenceStore tests (CASE-02) | VERIFIED | 7 tests, all passing |
| `tests/cases-dossier.test.ts` | DossierStore tests (CASE-03) | VERIFIED | 5 tests, all passing |
| `tests/cases-session.test.ts` | SessionStore + loadContext tests (CASE-04) | VERIFIED | 10 tests, all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli.ts` case open action | `CaseStore.create()` | `await import('./cases/index.js')` | WIRED | Dynamic import at cli.ts; CaseStore used immediately after |
| `CaseStore.create()` | `~/.chain-insights/cases/<id>/case.md` | `writeFile` with `{ mode: 0o600 }` | WIRED | store.ts L55; file content is full serialized frontmatter+body |
| `CaseStore.create()` | DuckDB cases table | Prepared statement INSERT with `$id, $name, $status, ...` named params | WIRED | store.ts L60-65; all 8 columns bound |
| `initSchema()` | `migrateCasesTable()` | Direct call after CREATE TABLE | WIRED | db/init.ts L55 |
| `EvidenceStore.append()` | `cases/<id>/manifest.json` | `appendToManifest()` with `createHash('sha256')` | WIRED | evidence.ts L86-87 |
| `DossierStore.appendFinding()` | `cases/<id>/dossiers/<safeAddr>.md` | contentHash text-presence dedup check before append | WIRED | dossier.ts L54 |
| `SessionStore.archiveOldSessions()` | `cases/<id>/history.md` | ENOENT-safe read + compress + write | WIRED | session.ts L110, L122-123 |
| `CaseStore.loadContext()` | case.md + latest session + all dossier frontmatters | `Promise.all` parallel reads | WIRED | store.ts L152-156 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `CaseStore.list()` | rows from `SELECT id, name, status FROM cases` | DuckDB live query | Yes — SELECT returns inserted rows | FLOWING |
| `EvidenceStore.verifyManifest()` | manifest entries + actual file contents | manifest.json + readFile | Yes — re-hashes real files | FLOWING |
| `CaseStore.loadContext()` | case, lastSession, dossierSummaries, evidenceCount | readFile(case.md) + SessionStore.getLatest + DossierStore.listSummaries + manifest.json | Yes — all sources read real flat files | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npx vitest run` | 93 tests, 15 files, all passing | PASS |
| Phase-specific tests pass | `npx vitest run tests/cases-*.test.ts` | 37 tests, 5 files, all passing | PASS |
| CLI shows all subcommands | `node dist/cli.mjs case --help` | open/activate/suspend/close/list/evidence/dossier/session/resume all listed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CASE-01 | 03-01-PLAN.md | Case lifecycle — open, activate, suspend, close via CLI | SATISFIED | CaseStore.create/setStatus wired to CLI; 7 store tests pass |
| CASE-02 | 03-02-PLAN.md | Evidence store — append-only files with SHA-256 integrity manifest | SATISFIED | EvidenceStore.append + verifyManifest; 7 evidence tests pass |
| CASE-03 | 03-02-PLAN.md | Dossier system — per-entity findings accumulated across sessions | SATISFIED | DossierStore.appendFinding with dedup; 5 dossier tests pass |
| CASE-04 | 03-02-PLAN.md | Investigation memory — context persistence across conversations | SATISFIED | CaseStore.loadContext + SessionStore rolling archive; 10 session tests pass |

All 4 requirement IDs declared across both plans are accounted for. No orphaned requirements — REQUIREMENTS.md maps CASE-01 through CASE-04 exclusively to Phase 3, all marked Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cases/dossier.ts` | 103 | `return []` | Info | ENOENT guard in `listSummaries()` — not a stub; directory missing is a valid empty state |
| `src/cases/session.ts` | 84, 88 | `return null` | Info | ENOENT guard in `getLatest()` — not a stub; no sessions is a valid initial state tested explicitly |

No blockers. No warnings. All `return null`/`return []` instances are intentional empty-state returns in ENOENT error paths, exercised by passing tests.

### Human Verification Required

None. All must-haves are verifiable programmatically. The full test suite passes (93/93), all flat-file operations are covered by integration tests using real temp directories, and the CLI help output confirms all subcommands are wired.

### Gaps Summary

No gaps. All 13 observable truths are verified against actual codebase evidence. The phase goal — investigator can open cases, accumulate evidence and dossiers across sessions, and resume investigations with full context — is fully achieved.

---

_Verified: 2026-05-11T09:12:00Z_
_Verifier: Claude (gsd-verifier)_
