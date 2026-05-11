---
phase: 02
slug: mcp-connection-payments
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 02-01-03 | 01 | 1 | MCP-02 | — | MCP proxy starts and lists tools | integration | `npx vitest run tests/mcp-proxy` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | MCP-02 | — | CLI mcp tools command lists tools | integration | `npx vitest run tests/cli-mcp` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | MCP-03 | — | Installer registers MCP proxy in Claude Code | integration | `npx vitest run tests/installer` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/wallet.test.ts` — stubs for wallet encryption/decryption
- [ ] `tests/mcp-client.test.ts` — stubs for x402 fetch wrapper
- [ ] `tests/mcp-proxy.test.ts` — stubs for MCP proxy server
- [ ] `tests/cli-mcp.test.ts` — stubs for CLI mcp subcommand
- [ ] `tests/installer.test.ts` — extend existing installer tests for MCP registration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| x402 payment succeeds on Base | MCP-01 | Requires real wallet with USDC balance | 1. Configure wallet with testnet USDC, 2. Run `chain-insights mcp call <tool>`, 3. Verify payment log |
| Claude Code discovers MCP tools | MCP-02 | Requires Claude Code runtime | 1. Install with `--claude`, 2. Start new Claude Code session, 3. Verify MCP tools visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
