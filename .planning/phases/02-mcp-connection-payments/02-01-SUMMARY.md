---
phase: 02-mcp-connection-payments
plan: "01"
subsystem: wallet-and-payment-client
tags: [wallet, x402, viem, mcp, encryption, aes-256-gcm, tdd]
dependency_graph:
  requires: []
  provides:
    - src/wallet/index.ts (encryptKey, decryptKey, isWalletConfigured, walletPath)
    - src/mcp/client.ts (createMcpFetchClient)
  affects:
    - src/mcp/ (future plans will import createMcpFetchClient)
    - bin/cli.ts (plan 02-03 wires walletPrivateKey config command)
tech_stack:
  added:
    - "@modelcontextprotocol/sdk@1.29.0"
    - "@x402/fetch@2.11.0"
    - "@x402/evm@2.11.0"
    - "viem@2.48.11"
  patterns:
    - AES-256-GCM encryption with machine-identity-derived scrypt key
    - wallet.json stored at ~/.chain-insights/wallet.json with 0o600 permissions
    - GCM auth tag verified before decryption (T-02-02 mitigation)
    - x402 fetch wrapped with ExactEvmScheme on eip155:8453 (Base Mainnet)
key_files:
  created:
    - src/wallet/index.ts
    - src/mcp/client.ts
    - tests/wallet.test.ts
    - tests/mcp-client.test.ts
  modified:
    - package.json (added 4 new dependencies)
    - package-lock.json (new lockfile with 202 packages)
decisions:
  - "walletPath() derived at call time from os.homedir() — not module-load time — for test isolation"
  - "deriveKey() binds encryption to machine identity (hostname:username) for portability guard"
  - "GCM auth tag written AFTER cipher.final() and read BEFORE decipher.update() per Node.js crypto requirement"
  - "ExactEvmScheme mock uses function keyword (not arrow function) to support 'new' constructor call"
  - "cli.test.ts pre-existing failures (missing dist/) are out-of-scope — deferred"
metrics:
  duration: "3 minutes"
  completed_date: "2026-05-11T05:03:24Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
---

# Phase 02 Plan 01: Wallet Encryption and x402 Payment Client Summary

AES-256-GCM wallet encryption with machine-identity binding and x402-wrapped fetch factory pinned to Base Mainnet.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Wallet module tests | 080933f | tests/wallet.test.ts, package.json, package-lock.json |
| 1 (GREEN) | Wallet encryption module | bc391a3 | src/wallet/index.ts |
| 2 (RED) | MCP client tests | 6ea517f | tests/mcp-client.test.ts |
| 2 (GREEN) | x402 fetch client factory | 6aaf9a7 | src/mcp/client.ts |

## What Was Built

**Wallet module** (`src/wallet/index.ts`): Encrypts EVM private keys to `~/.chain-insights/wallet.json` using AES-256-GCM. The encryption key is derived from the machine's hostname and username via `scryptSync` with the salt `chain-insights-wallet-v1` — if the machine identity changes, decryption fails with a clear human-readable error. The GCM auth tag is stored alongside the ciphertext and verified before decryption, detecting any tampering. Files are written with `0o600` permissions (owner read/write only). Private keys are never written to `config.json`.

**MCP client factory** (`src/mcp/client.ts`): Pure factory function `createMcpFetchClient(privateKey)` that wraps the native `fetch` with x402 automatic payment handling. Uses `@x402/fetch`'s `wrapFetchWithPaymentFromConfig` with `ExactEvmScheme` from `@x402/evm`, configured for `eip155:8453` (Base Mainnet). When the Chain Insights MCP returns HTTP 402, the wrapped fetch transparently signs and retries with a USDC payment. No state, no caching.

## Test Results

All new tests pass (10/10):
- `tests/wallet.test.ts` — 5 tests: round-trip encrypt/decrypt, 0o600 perms, ENOENT error, isWalletConfigured
- `tests/mcp-client.test.ts` — 5 tests: factory return type, eip155:8453 network, ExactEvmScheme construction, privateKeyToAccount delegation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ExactEvmScheme mock needed function keyword for constructor support**
- **Found during:** Task 2 GREEN phase (test execution)
- **Issue:** Plan's mock template used `vi.fn().mockImplementation((account) => ...)` with an arrow function — arrow functions cannot be called with `new`, causing `TypeError: ... is not a constructor` when the production code calls `new ExactEvmScheme(account)`
- **Fix:** Changed mock to `vi.fn(function (account) { return { account, _isExactEvmScheme: true } })` — regular function works with `new`
- **Files modified:** tests/mcp-client.test.ts
- **Commit:** 6aaf9a7

## Deferred Items

**cli.test.ts failures (pre-existing, out-of-scope):** 4 tests in `tests/cli.test.ts` fail because `dist/cli.mjs` does not exist (the project hasn't been built). These failures existed before this plan's changes — verified by stash-checking the state before any edits. Deferred to a build-related plan.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond what was planned. All threat mitigations confirmed present:

- **T-02-01:** Private key stored only in `wallet.json` (0o600), never in `config.json`, never in logs — confirmed by `grep -rn "walletPrivateKey" src/config/` returning 0 results and `grep -n "console.log" src/wallet/index.ts` returning 0 results.
- **T-02-02:** GCM auth tag verified via `decipher.setAuthTag(tag)` before `decipher.update()` — ciphertext tampering detected.
- **T-02-03:** Error messages reference generic instructions, not the private key value.
- **T-02-04:** Replay prevention delegated to ExactEvmScheme (EIP-3009 nonce + validity window) — accepted.

## Self-Check: PASSED

All created files exist. All task commits verified in git log.
