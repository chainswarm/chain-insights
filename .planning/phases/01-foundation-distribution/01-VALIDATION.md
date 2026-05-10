---
phase: 01
slug: foundation-distribution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
| **Config file** | vitest.config.ts (Wave 0 creates) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | FOUND-01 | — | N/A | integration | `npx vitest run tests/cli.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | FOUND-02 | — | N/A | integration | `npx vitest run tests/cli.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | FOUND-03 | — | N/A | integration | `npx vitest run tests/db.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | FOUND-04 | — | N/A | integration | `npx vitest run tests/server.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | FOUND-05 | — | N/A | integration | `npx vitest run tests/config.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — test configuration
- [ ] `tests/cli.test.ts` — stubs for FOUND-01, FOUND-02
- [ ] `tests/db.test.ts` — stubs for FOUND-03
- [ ] `tests/server.test.ts` — stubs for FOUND-04
- [ ] `tests/config.test.ts` — stubs for FOUND-05

*Greenfield project — all test infrastructure created in Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| npx global install works | FOUND-01 | Requires clean npm env | Run `npx chain-insights --claude` in fresh terminal |
| Browser opens for viz | — | Requires GUI | Future phase (Phase 4) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
