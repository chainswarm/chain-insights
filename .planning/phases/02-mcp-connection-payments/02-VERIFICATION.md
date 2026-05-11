---
phase: 02-mcp-connection-payments
verified: 2026-05-11T07:36:00Z
status: human_needed
score: 3/3
overrides_applied: 0
human_verification:
  - test: "Configure a real EVM private key via `chain-insights config set walletPrivateKey <key>` and verify wallet.json is written at ~/.chain-insights/wallet.json with 0o600 permissions and the key is absent from config.json"
    expected: "wallet.json exists, config.json does not contain the private key, CLI prints 'Wallet private key encrypted and stored'"
    why_human: "End-to-end write-to-disk test; automated tests use a mocked/fake HOME and fakeHome isolation — cannot verify the real on-disk path behavior without a live key"
  - test: "Start the proxy via `node dist/mcp-proxy.mjs` with a configured wallet and an unreachable MCP endpoint, and verify the proxy writes to stderr only (never stdout) and exits with code 1"
    expected: "stderr contains 'Chain Insights MCP unreachable', process exits 1, stdout is empty"
    why_human: "Stdout purity under real-process conditions (not in-process Vitest mocking) requires spawning the process and reading its streams separately — cannot verify inside the test runner"
  - test: "Run `chain-insights mcp tools` with a configured wallet connected to a live Chain Insights MCP endpoint and verify the tool table is printed"
    expected: "A formatted table of tool names and descriptions is printed to stdout; no raw JSON or stack traces"
    why_human: "Requires a live x402-capable MCP endpoint and a funded wallet — cannot be tested without real external infrastructure"
---

# Phase 02: MCP Connection and Payments — Verification Report

**Phase Goal:** Investigator can query the Chain Insights MCP through their AI agent, paying per-call via x402 micropayments, and discover what tools the MCP offers
**Verified:** 2026-05-11T07:36:00Z
**Status:** human_needed (3/3 truths VERIFIED; 3 items require human/live-environment testing)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can configure an EVM wallet and the toolkit automatically handles x402 payment for MCP calls | VERIFIED | `src/wallet/index.ts` implements AES-256-GCM encrypt/decrypt with 0o600 perms; `src/mcp/client.ts` wraps fetch with `wrapFetchWithPaymentFromConfig` on `eip155:8453`; `src/cli.ts` intercepts `walletPrivateKey` in `config set` and routes to `encryptKey()` with an explicit `return` before `saveConfig` |
| 2 | Agent can introspect the MCP and list available tools/endpoints with descriptions | VERIFIED | `src/mcp/schema-cache.ts` caches tool list with 24h TTL; `src/mcp/format.ts` formats a plain-text table; `src/cli.ts` exposes `chain-insights mcp tools` with `--refresh` flag; `src/mcp/proxy.ts` registers remote tools on a local `McpServer` via `StdioServerTransport`; installer registers `chain-insights-proxy` in Claude Code via `claude mcp add --scope user` |
| 3 | User can describe an investigation query in natural language and the agent translates it into MCP calls and returns results | VERIFIED | `src/mcp/proxy.ts` (`createProxy()`) registers each remote tool locally, forwards all arguments via `remoteClient.callTool`, surfaces errors as `{ isError: true, content: [...] }` MCP responses rather than crashes; `src/cli.ts` exposes `chain-insights mcp call <tool> [key=value...]` for direct tool invocation; proxy uses `z.object({}).passthrough()` to forward arbitrary tool arguments without schema rejection |

**Score:** 3/3 truths verified (all programmatic checks pass; live-environment behavior deferred to human verification)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/wallet/index.ts` | encryptKey, decryptKey, isWalletConfigured, walletPath | VERIFIED | Exports all four functions; AES-256-GCM with `scryptSync` machine-identity key; `0o600` permissions; clear ENOENT and GCM auth-tag failure messages |
| `src/mcp/client.ts` | createMcpFetchClient(privateKey) returning x402-wrapped fetch | VERIFIED | Pure factory; `wrapFetchWithPaymentFromConfig` with `ExactEvmScheme` on `eip155:8453` (Base Mainnet); `privateKeyToAccount` from `viem/accounts` |
| `src/mcp/schema-cache.ts` | loadSchema(), saveSchema() with 24h TTL | VERIFIED | `TTL_MS = 24 * 60 * 60 * 1000`; ENOENT returns null; TTL check present; 0o600 on write; no in-memory singleton |
| `src/mcp/format.ts` | formatToolsTable(tools) returning plain text string | VERIFIED | Returns `"No tools available."` for empty; 30-char name padding; 60-char desc truncation |
| `src/mcp/proxy.ts` | stdio MCP proxy with StdioServerTransport | VERIFIED | `createProxy()` exported for testing; IIFE guarded by `import.meta.url` check; `StdioServerTransport`; `StreamableHTTPClientTransport` + SSE fallback; SIGINT/SIGTERM clean shutdown; zero `console.log` calls |
| `bin/mcp-proxy.cjs` | CJS ESM bridge shim | VERIFIED | Dynamic import of `../dist/mcp-proxy.mjs`; `process.stderr.write()` only (no `console.error`); `#!/usr/bin/env node` + `'use strict'` |
| `bin/install.cjs` | MCP proxy registration via `claude mcp add --scope user` | VERIFIED | Step 4 added; `execFileSync('claude', ['mcp', 'add', 'chain-insights-proxy', '--scope', 'user', ...])` in try/catch; fallback manual instruction on failure; never throws |
| `src/cli.ts` | mcp subcommand group + walletPrivateKey interceptor | VERIFIED | `program.command('mcp')` with `tools` and `call` subcommands; `walletPrivateKey` branch returns before `saveConfig`; `encryptKey` called via lazy import |
| `src/index.ts` | barrel re-exports for wallet and mcp/client | VERIFIED | Exports `encryptKey`, `decryptKey`, `isWalletConfigured`, `createMcpFetchClient`; proxy.ts NOT exported |
| `tsdown.config.ts` | mcp-proxy build entry | VERIFIED | `'mcp-proxy': 'src/mcp/proxy.ts'` present in entry object |
| `dist/mcp-proxy.mjs` | Built ESM proxy entry | VERIFIED | File exists in dist/ |
| `dist/mcp-proxy.cjs` | Built CJS proxy entry | VERIFIED | File exists in dist/ |
| `tests/wallet.test.ts` | Wallet unit tests | VERIFIED | 5 tests: round-trip, 0o600 perms, ENOENT error, isWalletConfigured |
| `tests/mcp-client.test.ts` | x402 client tests | VERIFIED | 5 tests: factory return type, eip155:8453 network, ExactEvmScheme, privateKeyToAccount |
| `tests/mcp-schema-cache.test.ts` | Schema cache + formatter tests | VERIFIED | 11 tests: ENOENT miss, TTL hit/expiry, round-trip, 0o600, JSON parse error propagation, formatter cases |
| `tests/mcp-proxy.test.ts` | Proxy integration tests | VERIFIED | 4 tests: tool registration, call forwarding, error surfacing, cache hit prevents remote connect |
| `tests/cli-mcp.test.ts` | CLI mcp subcommand tests | VERIFIED | 10 tests: cache hit/miss, missing wallet, --refresh, mcp call, invalid format, walletPrivateKey interceptor |
| `tests/installer.test.ts` | Installer MCP registration tests | VERIFIED | 8 tests including 3 new: no-throw on claude absence, chain-insights-proxy in output, mcp-proxy.cjs path in output |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/wallet/index.ts` | `~/.chain-insights/wallet.json` | `writeFile` with `mode: 0o600` | VERIFIED | Line 58: `{ mode: 0o600 }` present |
| `src/mcp/client.ts` | `@x402/fetch` | `wrapFetchWithPaymentFromConfig` | VERIFIED | Direct import and call at lines 1, 17 |
| `src/mcp/client.ts` | `eip155:8453` | `ExactEvmScheme` network parameter | VERIFIED | Line 20: `network: 'eip155:8453'` |
| `src/mcp/proxy.ts` | `src/mcp/schema-cache.ts` | `loadSchema()` / `saveSchema()` | VERIFIED | Lines 59, 65: both called |
| `src/mcp/proxy.ts` | `src/mcp/client.ts` | `createMcpFetchClient(decryptKey())` | VERIFIED | Line 33: `createMcpFetchClient(privateKey as ...)` |
| `src/mcp/proxy.ts` | `StdioServerTransport` | `server.connect(transport)` | VERIFIED | Lines 103-104 |
| `src/mcp/proxy.ts` | `StreamableHTTPClientTransport` | `remoteClient.connect(transport)` | VERIFIED | Line 41; SSE fallback at line 47 |
| `bin/mcp-proxy.cjs` | `dist/mcp-proxy.mjs` | `import('../dist/mcp-proxy.mjs')` | VERIFIED | Line 7 |
| `bin/install.cjs` | `claude mcp add` | `execFileSync('claude', ['mcp', 'add', 'chain-insights-proxy', '--scope', 'user', ...])` | VERIFIED | Lines 112-116 |
| `src/cli.ts mcp tools` | `src/mcp/schema-cache.ts` | `loadSchema()` in action handler | VERIFIED | Line 114 |
| `src/cli.ts mcp call` | `src/mcp/client.ts` | `createMcpFetchClient` in action handler | VERIFIED | Line 125 (tools), line 170 (call) |
| `src/cli.ts config set walletPrivateKey` | `src/wallet/index.ts` | `encryptKey(value)` interceptor | VERIFIED | Lines 81-91; `return` at line 90 prevents fallthrough |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `src/mcp/proxy.ts` | `tools` (tool list) | `remoteClient.listTools()` → `saveSchema()` → `loadSchema()` | Yes — live remote MCP call or disk cache; no hardcoded values | FLOWING |
| `src/cli.ts` (mcp tools action) | `tools` | `loadSchema()` or `remoteClient.listTools()` | Yes — cache or live call | FLOWING |
| `src/wallet/index.ts` | private key | AES-256-GCM decrypt from `wallet.json` | Yes — reads real disk file | FLOWING |
| `src/mcp/client.ts` | wrapped fetch | `wrapFetchWithPaymentFromConfig` with live account | Yes — calls real x402 library with viem account | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npx vitest run` | 56 tests passed, 0 failed, 10 test files | PASS |
| wallet.json uses AES-256-GCM | `grep -c "aes-256-gcm" src/wallet/index.ts` | 2 | PASS |
| proxy never writes to stdout | `grep -c "console.log" src/mcp/proxy.ts` | 0 | PASS |
| walletPrivateKey not in config schema | `grep -n "walletPrivateKey" src/config/schema.ts \| wc -l` | 0 | PASS |
| dist/mcp-proxy.mjs built | `ls dist/mcp-proxy.mjs` | file exists | PASS |
| dist/mcp-proxy.cjs built | `ls dist/mcp-proxy.cjs` | file exists | PASS |
| eip155:8453 (Base Mainnet) configured | `grep -c "eip155:8453" src/mcp/client.ts` | 2 | PASS |
| StdioServerTransport present in proxy | `grep -c "StdioServerTransport" src/mcp/proxy.ts` | 2 | PASS |
| SIGINT/SIGTERM handlers in proxy | `grep -c "SIGINT\|SIGTERM" src/mcp/proxy.ts` | 2 | PASS |
| installer has chain-insights-proxy | `grep -c "chain-insights-proxy" bin/install.cjs` | 3 | PASS |
| installer has scope user | `grep -c "scope user" bin/install.cjs` | 3 (in array: 'user') | PASS |
| installer has fallback manual instruction | `grep -c "run manually" bin/install.cjs` | 1 | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MCP-01 | 02-01 | x402 payment gateway integration (viem wallet + @x402/fetch) | SATISFIED | `src/wallet/index.ts` + `src/mcp/client.ts` fully implemented; 10 unit tests pass |
| MCP-02 | 02-02, 02-03 | MCP schema discovery — agent can introspect available tools | SATISFIED | `src/mcp/schema-cache.ts`, `src/mcp/format.ts`, `chain-insights mcp tools` CLI, proxy tool registration, installer registration |
| MCP-03 | 02-02, 02-03 | Free-form MCP query execution via agent | SATISFIED | `src/mcp/proxy.ts` translates Claude Code tool calls to remote MCP calls with x402 payment; `chain-insights mcp call` for direct debug invocation |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `bin/install.cjs` line 108 | Installer registers `bin/mcp-proxy.cjs` as the proxy node path, not `dist/mcp-proxy.mjs`. The plan said `dist/mcp-proxy.mjs` but the implementation chose the CJS shim. | INFO | The CJS shim dynamically imports the ESM file, so this is a valid indirection — Claude Code spawns `node bin/mcp-proxy.cjs` which loads `dist/mcp-proxy.mjs`. The installer test at line 72 explicitly documents this as intentional ("CR-03: CJS shim, not raw .mjs"). No functional impact. |

No STUB patterns found. No TODO/FIXME/placeholder comments in delivered files. No `return null` or `return []` stubs — all functions produce real data.

---

## Human Verification Required

### 1. Wallet Encryption End-to-End (on Real Disk)

**Test:** With a real EVM private key (use a throwaway test key), run `chain-insights config set walletPrivateKey 0x<key>`. Then inspect `~/.chain-insights/wallet.json` exists, check `cat ~/.chain-insights/config.json` to confirm the key is absent, and run `chain-insights status` to confirm the toolkit loads.
**Expected:** `wallet.json` is present with owner-only permissions (`ls -la ~/.chain-insights/wallet.json` shows `-rw-------`). `config.json` does not contain the private key string. CLI confirms "Wallet private key encrypted and stored in ~/.chain-insights/wallet.json".
**Why human:** Automated tests use `fakeHome` isolation with fake HOME directory — they do not test against the real `~/.chain-insights/` path. Real filesystem permissions and path resolution need manual confirmation.

### 2. Proxy Stdout Purity Under Real Process Conditions

**Test:** Run `node dist/mcp-proxy.mjs 2>/tmp/proxy-stderr.txt 1>/tmp/proxy-stdout.txt`. Check that `proxy-stdout.txt` is empty (or contains only MCP JSON-RPC protocol messages after the transport connects) and `proxy-stderr.txt` contains the wallet-not-configured message.
**Expected:** `proxy-stdout.txt` is empty before the MCP transport connects. `proxy-stderr.txt` contains "Wallet not configured." and the process exits 1.
**Why human:** In-process Vitest mocks intercept `process.stderr.write` — they cannot verify the actual byte-level stdout/stderr separation that the real OS sees when Claude Code spawns the process.

### 3. Live MCP Tool Discovery and x402 Payment

**Test:** With a configured wallet (funded with USDC on Base Mainnet) and the Chain Insights MCP endpoint set (`chain-insights config set mcpEndpoint <url>`), run `chain-insights mcp tools`. Then run `chain-insights mcp call <toolname> address=0x...` with a known tool name.
**Expected:** Tool table is printed with tool names and descriptions. The call returns investigation results. The wallet balance decreases by the x402 micropayment amount.
**Why human:** Requires live external infrastructure (funded wallet, running MCP endpoint accepting x402 payments). Cannot be tested without real Base Mainnet USDC and a running Chain Insights MCP server.

---

## Gaps Summary

No gaps found. All programmatic must-haves are verified. The three human verification items are live-environment checks that cannot be automated without real external dependencies (funded wallet, running MCP endpoint).

**Note on installer proxy path:** The installer registers `bin/mcp-proxy.cjs` (the CJS shim) rather than `dist/mcp-proxy.mjs` directly. This is intentional and documented in the test suite — the CJS shim is the correct spawn target because it handles ESM loading in all Node.js environments. The plan's acceptance criterion (`grep -c "mcp-proxy.mjs" bin/install.cjs >= 1`) was written before this design decision was finalized. The implementation is correct; the plan criterion was stale. No gap.

---

_Verified: 2026-05-11T07:36:00Z_
_Verifier: Claude (gsd-verifier)_
