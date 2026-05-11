---
phase: 03
slug: case-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CASE-01 | — | Case state file created with 0o600 permissions | unit | `npx vitest run tests/cases-store.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | CASE-02 | — | SHA-256 manifest append-only, verified on load | unit | `npx vitest run tests/cases-evidence.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | CASE-03 | — | Dossier dedup by content hash | unit | `npx vitest run tests/cases-dossier.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | CASE-04 | — | Session context restore from flat files | unit | `npx vitest run tests/cases-session.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/cases-store.test.ts` — stubs for CASE-01
- [ ] `tests/cases-evidence.test.ts` — stubs for CASE-02
- [ ] `tests/cases-dossier.test.ts` — stubs for CASE-03
- [ ] `tests/cases-session.test.ts` — stubs for CASE-04
- [ ] `tests/cases-frontmatter.test.ts` — YAML frontmatter parser tests

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Case resume restores context in a new conversation | CASE-04 | Requires multi-session agent interaction | Open case, add evidence, close terminal, reopen, run `case activate` — verify context restored |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
