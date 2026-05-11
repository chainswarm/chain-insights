---
phase: 04
slug: money-flow-visualization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | VIZ-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | VIZ-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | VIZ-03 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/viz/` — test directory for visualization tests
- [ ] Test stubs for VIZ-01 (graph rendering), VIZ-02 (HTML serving), VIZ-03 (browser open)

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Graph renders correctly in browser | VIZ-01 | Visual verification | Open generated HTML, check nodes/edges display |
| Browser auto-opens | VIZ-03 | Requires GUI | Run `chain-insights viz --data sample.json`, verify browser opens |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
