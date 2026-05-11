---
phase: 02-mcp-connection-payments
plan: "03"
subsystem: cli-mcp-subcommand-installer-registration
tags: [mcp, cli, wallet, x402, installer, tdd, build, proxy-registration]
dependency_graph:
  requires:
    - "02-01 (src/wallet/index.ts — encryptKey, decryptKey, isWalletConfigured)"
    - "02-01 (src/mcp/client.ts — createMcpFetchClient)"
    - "02-02 (src/mcp/schema-cache.ts — loadSchema, saveSchema)"
    - "02-02 (src/mcp/format.ts — formatToolsTable)"
    - "02-02 (src/mcp/proxy.ts — stdio proxy binary entry)"
  provides:
    - tsdown.config.ts (mcp-proxy build entry — produces dist/mcp-proxy.mjs + dist/mcp-proxy.cjs)
    - bin/mcp-proxy.cjs (CJS ESM bridge shim for stdio proxy)
    - bin/install.cjs (MCP proxy registration via claude mcp add --scope user)
    - src/cli.ts (mcp tools + mcp call subcommands; walletPrivateKey interceptor in config set)
    - src/index.ts (barrel exports for wallet and mcp/client modules)
  affects:
    - tests/ (10 CLI mcp tests + 3 installer tests added)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle for both tasks
    - Commander addCommand pattern for mcp subcommand group
    - Lazy import in all CLI action handlers (no top-level side effects)
    - walletPrivateKey interceptor returns before saveConfig (D-01 enforcement)
    - process.stderr.write() exclusively in CJS shim (zero stdout before ESM loads)
    - CJS stdlib-only in installer (require('child_process').execSync, no await)
    - try/catch around execSync — installer never throws on claude CLI absence
    - __dirname path resolution for proxy bin path (works in dev and global npm install)
key_files:
  created:
    - bin/mcp-proxy.cjs
    - tests/cli-mcp.test.ts
  modified:
    - tsdown.config.ts
    - bin/install.cjs
    - src/cli.ts
    - src/index.ts
    - package.json
    - tests/installer.test.ts
decisions:
  - "walletPrivateKey interceptor returns before saveConfig — private key never written to config.json (D-01 locked)"
  - "process.stderr.write() in bin/mcp-proxy.cjs shim — console.error() could write to stdout before ESM loads (StdioServerTransport owns stdout)"
  - "Installer uses __dirname (CJS global) not import.meta for proxy path — resolves correctly from both dev and global npm install"
  - "CLI tests use standalone action handler helpers rather than Commander parsing — tests logic isolation, avoids process.exit() during Commander parse"
  - "Installer step outputs chain-insights-proxy in both success and fallback paths — test assertion is path-agnostic"
metrics:
  duration: "6 minutes"
  completed_date: "2026-05-11T05:21:00Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 6
---

# Phase 02 Plan 03: Build Wiring, CLI mcp Subcommand, Installer Registration Summary

Build pipeline wired for mcp-proxy entry, CLI extended with mcp tools/call subcommands and walletPrivateKey interceptor (D-01), installer registers the proxy in Claude Code, barrel exports updated.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | CLI mcp + walletPrivateKey tests | 43db90c | tests/cli-mcp.test.ts |
| 1 (GREEN) | Build wiring + CLI + barrel exports | cf1d800 | tsdown.config.ts, bin/mcp-proxy.cjs, src/cli.ts, src/index.ts, package.json |
| 2 (RED) | Installer MCP registration tests | e139d61 | tests/installer.test.ts |
| 2 (GREEN) | Installer MCP registration impl | 9b68549 | bin/install.cjs |

## What Was Built

**Build wiring** (`tsdown.config.ts`): Added `'mcp-proxy': 'src/mcp/proxy.ts'` to the entry object. Build now produces `dist/mcp-proxy.mjs` and `dist/mcp-proxy.cjs` alongside the existing CLI and index entries.

**CJS ESM bridge shim** (`bin/mcp-proxy.cjs`): Dynamic import of `../dist/mcp-proxy.mjs`. Uses `process.stderr.write()` exclusively (not `console.error()`) — stdout must never be touched before `StdioServerTransport` takes ownership. Registered as `chain-insights-mcp-proxy` bin entry in package.json.

**CLI mcp subcommand group** (`src/cli.ts`):
- `chain-insights mcp tools` — loads schema cache (24h TTL); on cache miss, connects to remote MCP via x402 payment fetch client, fetches tool list, saves cache, prints table. Accepts `--refresh` to bypass cache. Missing wallet exits 1 with clear message.
- `chain-insights mcp call <tool> [key=value...]` — parses key=value arguments (no shell expansion), calls named tool via x402 client, prints text content. Invalid arg format and missing wallet exit 1 with clear messages.
- All action handlers use lazy imports to prevent top-level side effects.

**walletPrivateKey interceptor** (`src/cli.ts`): In the `config set` action handler, a branch for `key === 'walletPrivateKey'` calls `encryptKey(value)` and returns before the generic `saveConfig` path — the raw private key never reaches `config.json`. Enforces D-01 at the CLI boundary.

**Installer MCP registration** (`bin/install.cjs`): New step 4 (before summary print) resolves proxy bin path via `path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs')` and runs `claude mcp add chain-insights-proxy --scope user -- node <path>` via `execSync`. On success prints registration confirmation. On any failure (claude CLI absent, non-zero exit) prints the manual instruction. Never throws — installer always completes and prints summary.

**Barrel exports** (`src/index.ts`): Added `encryptKey`, `decryptKey`, `isWalletConfigured` from `./wallet/index.js` and `createMcpFetchClient` from `./mcp/client.js`. Proxy is NOT exported (it is a standalone binary entry, not a library function).

## Test Results

All 54 tests pass across 10 test files (0 failures):

- `tests/cli-mcp.test.ts` — 10 tests: cache hit/miss, missing wallet, --refresh, mcp call args, invalid format, walletPrivateKey interceptor paths
- `tests/installer.test.ts` — 8 tests: 5 pre-existing + 3 new (no-throw on claude absence, chain-insights-proxy in output, mcp-proxy.mjs path in output)
- Pre-existing suites all green: wallet, mcp-client, mcp-schema-cache, mcp-proxy, config, db, server, cli

## TDD Gate Compliance

Both tasks followed the RED -> GREEN cycle:
- Task 1 RED: commit `43db90c` (test: add failing tests for CLI mcp subcommand)
- Task 1 GREEN: commit `cf1d800` (feat: add mcp-proxy build entry, CLI mcp subcommand, walletPrivateKey interceptor, barrel exports)
- Task 2 RED: commit `e139d61` (test: add failing tests for installer MCP proxy registration)
- Task 2 GREEN: commit `9b68549` (feat: extend installer to register MCP proxy in Claude Code)

## Deviations from Plan

None — plan executed exactly as written. The acceptance criteria grep for `grep -c "program.command.*mcp"` returns 0 because Commander's fluent chaining puts `.command('mcp')` on its own line, but `grep -c "\.command('mcp')"` returns 1 confirming the subcommand is registered. The plan's grep pattern was a documentation artifact; the code is correct.

## Known Stubs

None — all CLI commands are wired to real modules. The `mcp tools` command connects to a real MCP endpoint when wallet is configured. The `mcp call` command forwards real tool arguments.

## Threat Surface Scan

All T-02-10 through T-02-14 mitigations confirmed present:

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-02-10 (installer tampering) | Uses `claude mcp add --scope user` (official CLI), never writes ~/.claude.json directly |
| T-02-11 (mcp call info disclosure) | key=value parsed with indexOf, no shell expansion, no eval |
| T-02-12 (proxy path spoofing) | Path resolved from `__dirname` (installer's own dir), not user input |
| T-02-13 (stdout contamination) | `process.stderr.write()` only in bin/mcp-proxy.cjs, grep confirmed 0 console.log/error |
| T-02-14 (walletPrivateKey disclosure) | Interceptor returns before saveConfig — test asserts saveConfig never called for walletPrivateKey |

## Self-Check: PASSED

Files created:
- [x] bin/mcp-proxy.cjs — FOUND
- [x] tests/cli-mcp.test.ts — FOUND

Files modified:
- [x] tsdown.config.ts — mcp-proxy entry present
- [x] bin/install.cjs — chain-insights-proxy registration present
- [x] src/cli.ts — mcp subcommand group + walletPrivateKey interceptor present
- [x] src/index.ts — wallet + client exports present
- [x] package.json — chain-insights-mcp-proxy bin entry present
- [x] tests/installer.test.ts — 3 new installer tests present

Commits verified:
- [x] 43db90c — test(02-03): add failing tests for CLI mcp subcommand and walletPrivateKey interceptor
- [x] cf1d800 — feat(02-03): add mcp-proxy build entry, CLI mcp subcommand, walletPrivateKey interceptor, barrel exports
- [x] e139d61 — test(02-03): add failing tests for installer MCP proxy registration
- [x] 9b68549 — feat(02-03): extend installer to register MCP proxy in Claude Code

Build verified:
- [x] dist/mcp-proxy.mjs — FOUND (ESM entry for Claude Code)
- [x] dist/mcp-proxy.cjs — FOUND (CJS variant)

Full test suite: 54 passed, 0 failed
