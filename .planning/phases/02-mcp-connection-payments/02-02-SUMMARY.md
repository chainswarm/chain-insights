---
phase: 02-mcp-connection-payments
plan: "02"
subsystem: mcp-schema-cache-and-proxy
tags: [mcp, schema-cache, ttl, stdio-proxy, x402, tool-forwarding, tdd, stdout-purity]
dependency_graph:
  requires:
    - "02-01 (src/wallet/index.ts — isWalletConfigured, decryptKey)"
    - "02-01 (src/mcp/client.ts — createMcpFetchClient)"
  provides:
    - src/mcp/schema-cache.ts (loadSchema, saveSchema, McpTool with 24h TTL)
    - src/mcp/format.ts (formatToolsTable)
    - src/mcp/proxy.ts (createProxy — stdio MCP bridge with x402 payment)
  affects:
    - bin/cli.ts (plan 02-03 will wire mcp proxy command)
    - tests/ (11 schema-cache + 4 proxy tests added)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle for both tasks
    - schemaPath() derived at call time (not module load) for test HOME isolation
    - IIFE entry point guarded by import.meta.url check to prevent test-time execution
    - Constructor mocks use regular functions (not arrow) for `new` compatibility
    - z.object().passthrough() for opaque tool argument forwarding
    - StreamableHTTPClientTransport → SSEClientTransport fallback on connection failure
    - process.stderr.write() for all proxy diagnostic output (zero stdout writes)
key_files:
  created:
    - src/mcp/schema-cache.ts
    - src/mcp/format.ts
    - src/mcp/proxy.ts
    - tests/mcp-schema-cache.test.ts
    - tests/mcp-proxy.test.ts
  modified: []
decisions:
  - "schemaPath() derived at call time from os.homedir() — not module-load time — mirrors config/index.ts pattern for test isolation"
  - "createProxy() exported as named function so tests can import it without triggering the IIFE entry point"
  - "IIFE guarded by import.meta.url vs process.argv[1] check — prevents proxy startup during test imports"
  - "Constructor mocks use vi.fn(function() {...}) not vi.fn().mockImplementation(() => {}) — arrow functions cannot be called with new"
  - "passthrough() on z.object({}) allows arbitrary tool arguments without schema validation — tools declare their own schemas remotely"
  - "SSEClientTransport fallback mirrors RESEARCH.md assumption A1 — tested environments may not support StreamableHTTP"
metrics:
  duration: "5 minutes"
  completed_date: "2026-05-11T05:12:00Z"
  tasks_completed: 2
  files_created: 5
  files_modified: 0
---

# Phase 02 Plan 02: MCP Schema Cache and stdio Proxy Summary

TTL-based disk-backed MCP schema cache, tool table formatter, and stdio MCP proxy that bridges Claude Code to the remote Chain Insights HTTP MCP with automatic x402 payment.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Schema cache + formatter tests | 34d1c06 | tests/mcp-schema-cache.test.ts |
| 1 (GREEN) | Schema cache + formatter impl | 49fd80b | src/mcp/schema-cache.ts, src/mcp/format.ts |
| 2 (RED) | Proxy tests | fd49090 | tests/mcp-proxy.test.ts |
| 2 (GREEN) | Proxy implementation | 4355ec1 | src/mcp/proxy.ts, tests/mcp-proxy.test.ts (mock fixes) |

## What Was Built

**Schema cache** (`src/mcp/schema-cache.ts`): `loadSchema()` reads `~/.chain-insights/mcp-schema.json` and returns cached tools if within 24-hour TTL, null on miss or expiry. `saveSchema(tools)` writes `{ tools, cachedAt: Date.now() }` with 0o600 permissions. JSON parse errors on a corrupt cache propagate (not swallowed) — mitigates T-02-09. No in-memory singleton: every `loadSchema()` call reads from disk, enabling test isolation via HOME override.

**Tool formatter** (`src/mcp/format.ts`): `formatToolsTable(tools)` returns a plain text table with tool names padded to 30 characters and descriptions truncated at 60 characters. Returns `"No tools available."` for an empty array. Caller controls the output stream.

**stdio MCP proxy** (`src/mcp/proxy.ts`): Exported `createProxy()` function that: checks wallet configuration; decrypts private key; creates x402 payment fetch; tries schema cache (skips remote connection on hit); connects to remote via `StreamableHTTPClientTransport` with fallback to `SSEClientTransport`; fetches and caches tool list; registers each tool locally on a `McpServer` using `z.object({}).passthrough()` for argument forwarding; connects `StdioServerTransport`; handles SIGINT/SIGTERM with clean shutdown. Tool errors return `{ isError: true, content: [{type: 'text', text: 'MCP call failed: ...'}] }` instead of crashing. Zero stdout writes — all diagnostic output goes to `process.stderr`.

## Test Results

All new tests pass (15/15):
- `tests/mcp-schema-cache.test.ts` — 11 tests: ENOENT miss, TTL hit, TTL expiry, round-trip, 0o600 perms, JSON parse propagation, formatter empty/render/padding/truncation/no-description
- `tests/mcp-proxy.test.ts` — 4 tests: tool registration, call forwarding, error surfacing, cache hit prevents connect

Pre-existing failures unchanged: `tests/cli.test.ts` (4 tests fail — missing `dist/cli.mjs`, deferred from plan 02-01).

## TDD Gate Compliance

Both tasks followed the RED → GREEN cycle:
- Task 1 RED: commit `34d1c06` (test: add failing tests)
- Task 1 GREEN: commit `49fd80b` (feat: implement schema cache and formatter)
- Task 2 RED: commit `fd49090` (test: add failing tests for proxy)
- Task 2 GREEN: commit `4355ec1` (feat: implement proxy)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] console.log in comment triggered stdout purity grep gate**
- **Found during:** Task 2 acceptance criteria check
- **Issue:** The JSDoc comment said `NEVER call console.log()` — the literal string `console.log` in the comment caused `grep -c "console.log" src/mcp/proxy.ts` to return 1 (not 0 as required by T-02-05 mitigation)
- **Fix:** Rephrased comment to `NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.`
- **Files modified:** src/mcp/proxy.ts
- **Commit:** 4355ec1

**2. [Rule 1 - Bug] Constructor mocks used arrow functions (cannot be called with `new`)**
- **Found during:** Task 2 GREEN phase (test execution)
- **Issue:** `vi.fn().mockImplementation(() => {...})` with arrow functions fails when production code calls `new Client()`, `new McpServer()`, etc. — same root cause as the ExactEvmScheme bug in plan 02-01
- **Fix:** Changed all constructor mocks to `vi.fn(function() { return {...} })` (regular functions work with `new`)
- **Files modified:** tests/mcp-proxy.test.ts
- **Commit:** 4355ec1

**3. [Rule 1 - Bug] IIFE `.catch` pattern incompatible with Vitest module import**
- **Found during:** Task 2 GREEN phase (test execution)
- **Issue:** `(async () => {...}).catch(...)` executed immediately when the module was imported by tests, calling real dependencies before mocks could intercept. Error: `(intermediate value).catch is not a function` in the test context
- **Fix:** Replaced IIFE with `import.meta.url` guard: `if (process.argv[1] && import.meta.url.includes(process.argv[1]...))` — only executes when run as the CLI entry point, not when imported
- **Files modified:** src/mcp/proxy.ts
- **Commit:** 4355ec1

## Known Stubs

None — all implemented functionality is wired to real modules (schema-cache, wallet, client).

## Threat Surface Scan

All T-02-05 through T-02-09 mitigations confirmed present:

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-02-05 (stdout poisoning) | `grep -c "console.log" src/mcp/proxy.ts` → 0 confirmed |
| T-02-06 (tool result tampering) | Content forwarded verbatim, no eval/exec |
| T-02-07 (DoS via startup) | Single connect attempt, fail-fast with clear stderr message + exit 1 |
| T-02-08 (schema disclosure) | 0o600 on mcp-schema.json confirmed by test |
| T-02-09 (corrupt cache) | JSON.parse errors propagate (test confirms) |

No new network endpoints or auth paths introduced beyond the planned remote MCP connection.

## Self-Check: PASSED

Files created:
- [x] src/mcp/schema-cache.ts — FOUND
- [x] src/mcp/format.ts — FOUND
- [x] src/mcp/proxy.ts — FOUND
- [x] tests/mcp-schema-cache.test.ts — FOUND
- [x] tests/mcp-proxy.test.ts — FOUND

Commits verified:
- [x] 34d1c06 — test(02-02): add failing tests for MCP schema cache and tool formatter
- [x] 49fd80b — feat(02-02): implement MCP schema cache and tool table formatter
- [x] fd49090 — test(02-02): add failing tests for stdio MCP proxy
- [x] 4355ec1 — feat(02-02): implement stdio MCP proxy with tool discovery and forwarding
