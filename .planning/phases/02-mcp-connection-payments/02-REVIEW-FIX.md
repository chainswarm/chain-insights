---
phase: 02-mcp-connection-payments
fixed_at: 2026-05-11T07:31:00Z
review_path: .planning/phases/02-mcp-connection-payments/02-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 5
skipped: 2
status: partial
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-11T07:31:00Z
**Source review:** .planning/phases/02-mcp-connection-payments/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 7
- Fixed: 5
- Skipped: 2

## Fixed Issues

### CR-01: Command injection via `proxyBinPath` in `execSync` call

**Files modified:** `bin/install.cjs`
**Commit:** 5ae8796
**Applied fix:** Replaced `execSync` with `execFileSync` and an explicit argv array `['mcp', 'add', 'chain-insights-proxy', '--scope', 'user', '--', 'node', proxyBinPath]`. Shell is no longer invoked — path metacharacters cannot be interpreted.

---

### CR-02: Weak key derivation — fixed salt, no random salt

**Files modified:** `src/wallet/index.ts`, `tests/wallet.test.ts`
**Commits:** 65565ad (source), dc262b7 (tests)
**Applied fix:** Changed `deriveKey()` to accept a `Buffer` salt parameter. In `encryptKey()`, generate `crypto.randomBytes(16)` as the salt and store it as `salt` hex in `wallet.json` alongside `iv/tag/data`. In `decryptKey()`, read `stored.salt` and reconstruct the salt before deriving the key. Added `WalletData.salt` field. Added two regression tests: one verifies `salt` is present in `wallet.json` with expected length (32 hex chars = 16 bytes); another verifies two encryptions of the same key produce different salts and ciphertexts.

---

### CR-03: Installer registers wrong entry point (`dist/mcp-proxy.mjs` instead of `bin/mcp-proxy.cjs`)

**Files modified:** `bin/install.cjs`, `tests/installer.test.ts`
**Commits:** 5ae8796 (source, combined with CR-01), 338596b (test)
**Applied fix:** Changed `proxyBinPath` from `path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs')` to `path.resolve(__dirname, 'mcp-proxy.cjs')`. Claude Code now registers the CJS shim which safely loads the ESM module and enforces the stdout-purity contract. Updated the installer test to assert `mcp-proxy.cjs` instead of `mcp-proxy.mjs`.

---

### WR-01: Cache hit in proxy does not reconnect `remoteClient` — tool calls fail

**Files modified:** `src/mcp/proxy.ts`, `tests/mcp-proxy.test.ts`
**Commits:** 9bf5aac (source), 338596b (test)
**Applied fix:** Moved `remoteClient.connect()` (with StreamableHTTP → SSE fallback) to before the `loadSchema()` cache check. The `if (!tools)` block now only handles `listTools()` + `saveSchema()` (the cache-miss path). The client is always connected before tool handlers are registered. Updated the proxy test from "connect not called on cache hit" to "connect called once, listTools not called on cache hit".

---

### WR-03: MCP client connection leak on error paths in `src/cli.ts`

**Files modified:** `src/cli.ts`
**Commit:** 3d357b8
**Applied fix:** In the `mcp tools` action: wrapped `client.listTools()` + `saveSchema()` in `try/finally { await client.close() }` so the client is always closed even if `listTools` throws. In the `mcp call` action: wrapped `client.callTool()` + content printing in `try/finally { await client.close() }`. Both commands previously called `client.close()` only on the success path.

---

## Skipped Issues

### WR-02: Missing `--local` flow

**File:** `bin/install.cjs`
**Reason:** skipped per user instruction — not blocking, low priority.
**Original issue:** `--local` install path not fully implemented.

---

### WR-04: Fragile main-module detection in `src/mcp/proxy.ts`

**File:** `src/mcp/proxy.ts:121`
**Reason:** skipped per user instruction — low priority, no correctness impact in the current deployment context.
**Original issue:** `import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))` uses string inclusion rather than URL equality; can fail with URL-encoded paths or on case-insensitive filesystems.

---

_Fixed: 2026-05-11T07:31:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
