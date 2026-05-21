# Phase 02: MCP Connection & Payments - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 11 new/modified files
**Analogs found:** 10 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/wallet/index.ts` | utility | transform | `src/config/index.ts` | role-match (file I/O + validation, same secrets-on-disk pattern) |
| `src/mcp/client.ts` | service | request-response | `src/server/app.ts` | partial (HTTP client vs HTTP server; same fetch-wrapping concept) |
| `src/mcp/proxy.ts` | service | event-driven | `src/server/index.ts` | partial (long-lived process, startup + signal handling) |
| `src/mcp/schema-cache.ts` | utility | file-I/O | `src/config/index.ts` | role-match (JSON read/write with TTL vs default fallback) |
| `src/mcp/format.ts` | utility | transform | `src/cli.ts` (status action) | partial (structured console output) |
| `src/cli.ts` (extend) | controller | request-response | `src/cli.ts` | exact (same file, Commander subcommand pattern) |
| `src/config/schema.ts` (extend) | model | transform | `src/config/schema.ts` | exact (same file, Zod field addition) |
| `src/index.ts` (extend) | config | — | `src/index.ts` | exact (same file, re-export barrel) |
| `bin/install.cjs` (extend) | config | request-response | `bin/install.cjs` | exact (same file, CJS installer extension) |
| `bin/mcp-proxy.cjs` | config | event-driven | `bin/cli.js` | role-match (CJS shim bridging to ESM dist) |
| `tsdown.config.ts` (extend) | config | — | `tsdown.config.ts` | exact (same file, entry point addition) |
| `tests/wallet.test.ts` | test | — | `tests/config.test.ts` | exact (tmpdir isolation, HOME override, 0o600 permissions check) |
| `tests/mcp-schema-cache.test.ts` | test | — | `tests/config.test.ts` | exact (tmpdir isolation, file read/write, TTL logic) |
| `tests/mcp-proxy.test.ts` | test | — | `tests/server.test.ts` | role-match (in-process server lifecycle, async startup) |
| `tests/installer.test.ts` (extend) | test | — | `tests/installer.test.ts` | exact (same file, execSync pattern, fakeHome isolation) |

---

## Pattern Assignments

### `src/wallet/index.ts` (utility, transform)

**Analog:** `src/config/index.ts`

**Imports pattern** (`src/config/index.ts` lines 1-4):
```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConfigSchema, DEFAULT_CONFIG, type InvestigatorConfig } from './schema.js'
```
Wallet module imports: swap `ConfigSchema` for internal types; add `crypto from 'node:crypto'`.

**File path derivation pattern** (`src/config/index.ts` lines 6-9):
```typescript
// Config path derived from HOME at call time so tests can override HOME.
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}
```
Copy this pattern verbatim — derive `walletPath()` from `os.homedir()` at call time, not module load time, so tests can override `HOME`.

**File write with 0o600 permissions** (`src/config/index.ts` lines 28-31):
```typescript
const p = configPath()
await mkdir(path.dirname(p), { recursive: true })
await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
_cached = next
```
`wallet.json` must also use `{ mode: 0o600 }`. Never write then chmod — use mode in `writeFile` options.

**Error handling pattern** (`src/config/index.ts` lines 15-22):
```typescript
try {
  const raw = await readFile(configPath(), 'utf8')
  const parsed = JSON.parse(raw) as unknown
  _cached = ConfigSchema.parse(parsed)
  return _cached
} catch {
  return DEFAULT_CONFIG
}
```
For `decryptKey`: do NOT silently swallow errors. Throw with a clear message on `Error: Unsupported state or unable to authenticate data` (GCM tag failure = wrong machine key). Only `ENOENT` (wallet file absent) should produce the graceful-degradation error message.

**No caching for wallet** — unlike config, the wallet module should NOT cache the decrypted private key in memory. Decrypt on demand and discard. The in-memory exposure window should be minimal.

---

### `src/mcp/client.ts` (service, request-response)

**Analog:** `src/server/app.ts` (closest for HTTP + error handling structure); `src/config/index.ts` (for lazy-import pattern)

**Imports pattern** (`src/server/app.ts` lines 1-1, adapted):
```typescript
import { Hono } from 'hono'
```
For client.ts: the import block uses the x402/viem ecosystem:
```typescript
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
```
No default imports from project modules — keep this module self-contained.

**Error propagation pattern** (`src/server/app.ts` lines 17-22):
```typescript
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
```
In `client.ts`, do NOT catch errors — let them propagate to the proxy which converts them to MCP error responses. The client's job is to return a payment-wrapped fetch function, not to handle errors.

**Lazy init pattern** (`src/server/index.ts` lines 3-4, `src/cli.ts` lines 41-42):
```typescript
// from server/index.ts:
const app = createApp()
// from cli.ts action handlers:
const { startServer } = await import('./server/index.js')
```
`client.ts` exports a factory function (`createMcpFetchClient(privateKey)`) — not a singleton. The proxy calls it at startup with the decrypted key.

---

### `src/mcp/proxy.ts` (service, event-driven)

**Analog:** `src/server/index.ts`

**Process lifecycle pattern** (`src/server/index.ts` lines 14-17):
```typescript
process.on('SIGINT',  () => { server.close(); process.exit(0) })
process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
```
Copy this pattern — the stdio proxy must handle SIGINT/SIGTERM to close the MCP transport cleanly.

**Server startup pattern** (`src/server/index.ts` lines 3-13):
```typescript
export function startServer(port = 4321): () => void {
  const app    = createApp()
  const server = serve({
    fetch:    app.fetch,
    hostname: '127.0.0.1',
    port,
  })
  console.log(`Chain Insights server running on http://127.0.0.1:${port}`)
  // ...
  return () => server.close()
}
```
For proxy.ts: the startup is `async` (must await `remoteClient.connect()` + `remoteClient.listTools()` before `server.connect(transport)`). Return nothing (stdio transport owns the process for its lifetime).

**CRITICAL difference from analog:** `proxy.ts` must NEVER use `console.log()`. All debug output goes to `console.error()`. stdout is reserved exclusively for MCP JSON-RPC framing (`StdioServerTransport` owns it).

**Lazy import of wallet/client** (adapted from `src/cli.ts` lines 41-42):
```typescript
const { startServer } = await import('./server/index.js')
```
In proxy.ts main body: `await import('../wallet/index.js')` + `await import('./client.js')` to keep the module graph lazy and avoid import-time side effects.

---

### `src/mcp/schema-cache.ts` (utility, file-I/O)

**Analog:** `src/config/index.ts`

**Read/write + mkdir pattern** (`src/config/index.ts` lines 25-32):
```typescript
export async function saveConfig(updates: Partial<InvestigatorConfig>): Promise<void> {
  const current = await loadConfig()
  const next = ConfigSchema.parse({ ...current, ...updates })
  const p = configPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  _cached = next
}
```
For `saveSchema()`: same shape — `mkdir`, `writeFile` with `JSON.stringify`. Include a `cachedAt: Date.now()` field in the JSON for 24h TTL comparison.

**File path derivation pattern** (`src/config/index.ts` lines 6-9):
```typescript
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}
```
Schema cache path: `path.join(os.homedir(), '.chain-insights', 'mcp-schema.json')` — same derivation at call time, same HOME-override testability.

**Graceful fallback on missing file** (`src/config/index.ts` lines 15-22):
```typescript
try {
  const raw = await readFile(configPath(), 'utf8')
  // ...
} catch {
  return DEFAULT_CONFIG
}
```
For `loadSchema()`: catch `ENOENT` → return `null` (cache miss, caller must fetch fresh). Do NOT swallow JSON parse errors — those should propagate (corrupt cache file).

**No module-level cache singleton** — unlike `_cached` in config, schema-cache.ts should not hold an in-memory singleton. The 24h TTL is disk-based (the proxy can restart and still use the cached schema). Reading from disk on each `loadSchema()` call is cheap and simpler.

---

### `src/mcp/format.ts` (utility, transform)

**Analog:** `src/cli.ts` status action (lines 49-55)

**Console output pattern** (`src/cli.ts` lines 49-55):
```typescript
console.log('DB:     ', db.ok ? 'healthy' : `error — ${db.error ?? 'unknown'}`)
console.log('Config: ', config.dataDir)
console.log('Server: ', `http://127.0.0.1:${config.serverPort}`)
```
`format.ts` exports `formatToolsTable(tools: McpTool[]): string` — returns a string (not `console.log` directly) so the CLI action controls the output stream and tests can assert on the returned value without capturing stdout.

**No ANSI in pure formatter** — ANSI color codes live in the installer (`bin/install.cjs` lines 15-19). `format.ts` returns plain text; the CLI action may optionally add color. Keeping them separate makes tests simpler.

---

### `src/cli.ts` (extend — controller, request-response)

**Analog:** `src/cli.ts` (same file)

**Subcommand group pattern** (`src/cli.ts` lines 57-90):
```typescript
program
  .command('config')
  .description('Read or write configuration values')
  .addCommand(
    new Command('get')
      .argument('<key>', 'Config key to read')
      .action(async (key: string) => {
        const { loadConfig } = await import('./config/index.js')
        // ...
      })
  )
  .addCommand(
    new Command('set')
      // ...
  )
```
The new `mcp` subcommand group follows this exact pattern:
- `program.command('mcp').description('...')` with `.addCommand(new Command('tools')...)` and `.addCommand(new Command('call')...)`
- Each action uses `await import(...)` for lazy loading

**Error exit pattern** (`src/cli.ts` lines 68-71):
```typescript
if (value === undefined) {
  console.error(`Unknown config key: ${key}`)
  process.exit(1)
}
```
`mcp call` on error: `console.error(errorMessage); process.exit(1)`. `mcp tools` on unreachable MCP: same — non-zero exit, clear message with endpoint URL.

---

### `src/config/schema.ts` (extend — model, transform)

**Analog:** `src/config/schema.ts` (same file)

**Zod field addition pattern** (`src/config/schema.ts` lines 5-12):
```typescript
export const ConfigSchema = z.object({
  mcpEndpoint:   z.string().url().default('http://localhost:4000'),
  mcpAuthToken:  z.string().optional(),
  walletAddress: z.string().optional(),
  serverPort:    z.number().int().min(1024).max(65535).default(4321),
  dataDir:       z.string().default(path.join(os.homedir(), '.chain-insights')),
  version:       z.string().default('1'),
})
```
Add `walletAddress` is already present. Add nothing else to this schema — the private key lives in `wallet.json`, NOT `config.json`. The schema extension is: keep existing fields as-is.

**Key point:** `walletPrivateKey` must NOT appear in `ConfigSchema`. The `config set walletPrivateKey` CLI command writes to `wallet.json` (via `src/wallet/index.ts`) separately. The config schema's `walletAddress` stores only the derived public address.

---

### `src/index.ts` (extend — barrel re-exports)

**Analog:** `src/index.ts` (same file, lines 1-8):
```typescript
export { loadConfig, saveConfig, resetConfigCache } from './config/index.js'
export { getDb, initSchema, healthCheck } from './db/index.js'
export { createApp } from './server/app.js'
export { startServer } from './server/index.js'
export type { InvestigatorConfig } from './config/schema.js'
```
Add new exports: `encryptKey`, `decryptKey`, `isWalletConfigured` from `./wallet/index.js` and `createMcpFetchClient` from `./mcp/client.js`. Do NOT export `proxy.ts` — it is a standalone binary entry point, not a library function.

---

### `bin/install.cjs` (extend — config, request-response)

**Analog:** `bin/install.cjs` (same file)

**CJS stdlib-only constraint** (`bin/install.cjs` lines 8-12):
```javascript
// Chain Insights installer — CJS, stdlib-only.
// Runs before node_modules exists; zero npm imports allowed.
const fs   = require('fs');
const path = require('path');
const os   = require('os');
```
The MCP registration extension must stay CJS + stdlib-only. Use `require('child_process').execSync` for `claude mcp add`. No `await`, no ESM.

**Graceful skip pattern** (`bin/install.cjs` lines 26-33):
```javascript
if (!hasClaude && !hasLocal) {
  console.log(`\n${bold}chain-insights installer${reset}`);
  // ...
  process.exit(0);
}
```
Graceful skip for missing `claude` CLI: wrap `execSync('claude mcp add ...')` in `try/catch`. On failure, print a manual instruction instead of throwing. Pattern:
```javascript
try {
  execSync(`claude mcp add chain-insights-proxy --scope user -- node ${proxyBinPath}`, { stdio: 'pipe' });
  console.log(`  ${cyan}MCP proxy:${reset} registered in ~/.claude.json`);
} catch {
  console.log(`  ${dim}MCP proxy: run manually:${reset} claude mcp add chain-insights-proxy --scope user -- node ${proxyBinPath}`);
}
```

**`__dirname` for path resolution** (`bin/install.cjs` line 38):
```javascript
const srcSkillsDir = path.join(__dirname, '..', 'skills');
```
Proxy bin path: `path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs')` — `__dirname` in install.cjs resolves to the npm package's `bin/` directory both locally and when globally installed.

**Summary section** (`bin/install.cjs` lines 107-112):
```javascript
console.log(`\n${bold}${green}Chain Insights installed${reset}`);
console.log(`  ${cyan}Skills:${reset}   ${skillsDir}`);
console.log(`  ${cyan}Config:${reset}   ${configPath}`);
console.log(`  ${cyan}Data dir:${reset} ${dataDir}`);
```
Add `MCP proxy:` line to the installation summary.

---

### `bin/mcp-proxy.cjs` (config — CJS ESM bridge)

**Analog:** `bin/cli.js` (lines 1-10):
```javascript
#!/usr/bin/env node
'use strict';

// CJS shim — bridges the npm bin entry (CJS, no build step) to the
// ESM dist built by tsdown. Dynamic import() is the correct bridge pattern
import('../dist/cli.mjs').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
```
Copy this pattern exactly — only change target file and error message:
```javascript
#!/usr/bin/env node
'use strict';

// CJS shim for stdio MCP proxy — spawned by Claude Code.
// IMPORTANT: do not write to stdout here — stdout is owned by StdioServerTransport.
import('../dist/mcp-proxy.mjs').catch((err) => {
  process.stderr.write(`Failed to load chain-insights MCP proxy: ${err.message}\n`);
  process.exit(1);
});
```
Note: use `process.stderr.write()` instead of `console.error()` to avoid any chance of stdout contamination before the ESM module loads and `StdioServerTransport` takes ownership.

---

### `tsdown.config.ts` (extend — config)

**Analog:** `tsdown.config.ts` (same file, lines 1-13):
```typescript
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: true,
  clean: true,
  shims: true,
})
```
Add `'mcp-proxy': 'src/mcp/proxy.ts'` to the `entry` object. All other options remain identical — the proxy is a Node.js ESM module like the rest.

---

## Test Pattern Assignments

### `tests/wallet.test.ts` (test)

**Analog:** `tests/config.test.ts`

**Test structure** (`tests/config.test.ts` lines 1-20):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Config system (FOUND-05)', () => {
  let fakeHome: string
  let prevHome: string | undefined

  beforeEach(async () => {
    fakeHome = join(tmpdir(), `ci-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
    prevHome = process.env['HOME']
    process.env['HOME'] = fakeHome
  })

  afterEach(async () => {
    process.env['HOME'] = prevHome
    await rm(fakeHome, { recursive: true, force: true })
  })
```
Copy this `beforeEach`/`afterEach` boilerplate exactly — `wallet.test.ts` needs the same HOME override and tmpdir isolation.

**Permissions assertion** (`tests/config.test.ts` lines 40-47):
```typescript
it('saveConfig writes file with 0o600 permissions', async () => {
  // ...
  const { stat } = await import('node:fs/promises')
  const st = await stat(join(fakeHome, '.chain-insights', 'config.json'))
  expect((st.mode & 0o777).toString(8)).toBe('600')
})
```
Copy for `wallet.test.ts` — check `wallet.json` has `0o600` permissions after `encryptKey()` writes it.

**Dynamic import pattern** (`tests/config.test.ts` lines 25-28):
```typescript
const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
await resetConfigCache()
const config = await loadConfig()
```
Wallet tests: `const { encryptKey, decryptKey, isWalletConfigured } = await import('../src/wallet/index.js')` inside each `it` block to pick up the HOME override.

---

### `tests/mcp-schema-cache.test.ts` (test)

**Analog:** `tests/config.test.ts`

Same tmpdir isolation pattern as `wallet.test.ts`. Key assertions:
- `loadSchema()` returns `null` when `mcp-schema.json` absent
- `loadSchema()` returns cached data within 24h (write a schema with `cachedAt: Date.now()`, read back)
- `loadSchema()` returns `null` after TTL expiry (write schema with `cachedAt: Date.now() - 25 * 60 * 60 * 1000`)
- `saveSchema()` writes a file readable by `loadSchema()`

---

### `tests/mcp-proxy.test.ts` (test, integration)

**Analog:** `tests/server.test.ts`

**In-process server lifecycle** (`tests/server.test.ts` lines 1-19):
```typescript
import { describe, it, expect, afterEach } from 'vitest'

describe('Hono server (FOUND-04)', () => {
  let stop: (() => void) | null = null

  afterEach(() => {
    if (stop) { stop(); stop = null }
  })

  it('GET /health returns { ok: true }', async () => {
    const { startServer } = await import('../src/server/index.js')
    stop = startServer(14321)
    await new Promise(resolve => setTimeout(resolve, 100))
    // ...
  })
```
For `mcp-proxy.test.ts`: use an in-process mock MCP server (`McpServer` + `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`) instead of a real remote. Vitest `afterEach` closes both ends. File lives in `tests/mcp-proxy.integration.test.ts` so Vitest routes it to the `integration` project (30s timeout).

---

### `tests/installer.test.ts` (extend — test)

**Analog:** `tests/installer.test.ts` (same file)

**execSync with HOME override** (`tests/installer.test.ts` lines 24-28):
```typescript
it('--claude copies ci-status SKILL.md to ~/.claude/skills/ci-status/', () => {
  execSync(`HOME=${fakeHome} node bin/install.cjs --claude`, { stdio: 'pipe' })
  const skillPath = join(fakeHome, '.claude', 'skills', 'ci-status', 'SKILL.md')
  expect(existsSync(skillPath)).toBe(true)
})
```
Add test: `--claude` attempts `claude mcp add` (will fail in CI — wrap in try/catch in installer) and check that installer does NOT throw. Optionally assert that a fallback instruction string appears in stdout by capturing `stdio: 'pipe'` and checking `result.stdout`.

---

## Shared Patterns

### Secrets File Permissions (0o600)
**Source:** `src/config/index.ts` line 30, `bin/install.cjs` line 103
**Apply to:** `src/wallet/index.ts` (wallet.json write), `src/mcp/schema-cache.ts` (mcp-schema.json write — schema is not secret, but consistent permissions reduce attack surface)
```typescript
// src/config/index.ts line 30 — exact pattern to copy:
await writeFile(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
```

### HOME-Derived Path (Call-Time, Not Module-Load-Time)
**Source:** `src/config/index.ts` lines 6-9
**Apply to:** `src/wallet/index.ts` (walletPath), `src/mcp/schema-cache.ts` (schemaPath)
```typescript
// Derived at call time so tests can override HOME via process.env['HOME']
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}
```

### Lazy Import in CLI Actions
**Source:** `src/cli.ts` lines 41-42, 50-51, 64-65
**Apply to:** `src/cli.ts` `mcp` subcommand actions
```typescript
// Every action handler uses dynamic import — no top-level module side effects in CLI
const { startServer } = await import('./server/index.js')
const { loadConfig } = await import('./config/index.js')
```

### CJS ESM Bridge Shim
**Source:** `bin/cli.js` lines 1-10
**Apply to:** `bin/mcp-proxy.cjs`
```javascript
#!/usr/bin/env node
'use strict';
import('../dist/cli.mjs').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
```

### Error + process.exit(1) for CLI Failures
**Source:** `src/cli.ts` lines 28-33, 68-71
**Apply to:** `src/cli.ts` `mcp tools` and `mcp call` actions
```typescript
console.error(`Unknown config key: ${key}`)
process.exit(1)
```

### tmpdir + HOME Override Test Isolation
**Source:** `tests/config.test.ts` lines 9-20, `tests/installer.test.ts` lines 9-21
**Apply to:** `tests/wallet.test.ts`, `tests/mcp-schema-cache.test.ts`
```typescript
beforeEach(async () => {
  fakeHome = join(tmpdir(), `ci-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
  prevHome = process.env['HOME']
  process.env['HOME'] = fakeHome
})
afterEach(async () => {
  process.env['HOME'] = prevHome
  await rm(fakeHome, { recursive: true, force: true })
})
```

### Process Signal Handling for Long-Lived Processes
**Source:** `src/server/index.ts` lines 14-17
**Apply to:** `src/mcp/proxy.ts`
```typescript
process.on('SIGINT',  () => { server.close(); process.exit(0) })
process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/mcp/proxy.ts` (MCP SDK usage) | service | event-driven | No MCP server/client code exists yet. Pattern sourced from RESEARCH.md `@modelcontextprotocol/sdk` examples. Closest structural analog is `src/server/index.ts` for lifecycle, but MCP SDK API (`McpServer`, `StdioServerTransport`, `Client`, `StreamableHTTPClientTransport`) has no codebase precedent. |

---

## Metadata

**Analog search scope:** `src/`, `bin/`, `tests/`
**Files scanned:** 14
**Pattern extraction date:** 2026-05-11
