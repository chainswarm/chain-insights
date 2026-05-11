---
phase: 02
slug: mcp-connection-payments
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | MCP-01 | — | Wallet private key encrypted at rest | unit | `npx vitest run tests/wallet` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | MCP-01 | — | x402 fetch wrapper signs payments | unit | `npx vitest run tests/mcp-client` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | MCP-02 | — | MCP proxy starts and lists tools | integration | `npx vitest run tests/mcp-proxy` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | MCP-02 | — | Schema cache TTL and round-trip | unit | `npx vitest run tests/mcp-schema-cache` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | MCP-02 | — | CLI mcp tools command lists tools; walletPrivateKey interceptor routes to encryptKey() | integration | `npx vitest run tests/cli-mcp` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 3 | MCP-03 | — | Installer registers MCP proxy in Claude Code | integration | `npx vitest run tests/installer` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test files are created **inline** during task execution (TDD-within-task pattern) — no separate Wave 0 plan needed.

- [x] `tests/wallet.test.ts` — created inline in 02-01/Task 1 (wallet encryption module)
- [x] `tests/mcp-client.test.ts` — created inline in 02-01/Task 2 (x402 fetch client)
- [x] `tests/mcp-schema-cache.test.ts` — created inline in 02-02/Task 1 (schema cache + formatter)
- [x] `tests/mcp-proxy.test.ts` — created inline in 02-02/Task 2 (stdio proxy)
- [x] `tests/cli-mcp.test.ts` — created inline in 02-03/Task 1 (CLI mcp subcommand + walletPrivateKey interceptor)
- [x] `tests/installer.test.ts` — extended inline in 02-03/Task 2 (MCP registration)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| x402 payment succeeds on Base | MCP-01 | Requires real wallet with USDC balance | 1. Configure wallet with testnet USDC, 2. Run `chain-insights mcp call <tool>`, 3. Verify payment log |
| Claude Code discovers MCP tools | MCP-02 | Requires Claude Code runtime | 1. Install with `--claude`, 2. Start new Claude Code session, 3. Verify MCP tools visible |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (created inline via TDD-within-task)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
