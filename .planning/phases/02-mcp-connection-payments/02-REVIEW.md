---
phase: 02-mcp-connection-payments
reviewed: 2026-05-11T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - bin/install.cjs
  - bin/mcp-proxy.cjs
  - src/cli.ts
  - src/index.ts
  - src/mcp/client.ts
  - src/mcp/format.ts
  - src/mcp/proxy.ts
  - src/mcp/schema-cache.ts
  - src/wallet/index.ts
  - tests/cli-mcp.test.ts
  - tests/installer.test.ts
  - tests/mcp-client.test.ts
  - tests/mcp-proxy.test.ts
  - tests/mcp-schema-cache.test.ts
  - tests/wallet.test.ts
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the MCP connection and payments phase: the proxy, CLI MCP subcommands, wallet encryption, schema cache, and installer. The architecture is sound and the privacy-sensitive decisions (0o600 permissions, walletPrivateKey interceptor, stdout purity in the proxy) are correctly implemented.

Three blockers were found: a command injection vulnerability in `bin/install.cjs`, a weak key-derivation scheme that does not use a random salt, and a CJS/ESM mismatch in `bin/mcp-proxy.cjs` that will prevent the shim from loading. Four warnings cover a silent cache-bypass bug in the proxy, the missing `--local` installer flow, MCP client connection leak on error paths, and a fragile main-module detection heuristic. Three info items cover minor quality gaps.

---

## Critical Issues

### CR-01: Command injection via `proxyBinPath` in `execSync` call

**File:** `bin/install.cjs:112-115`
**Issue:** `proxyBinPath` is concatenated directly into a shell command string passed to `execSync`. If the package is installed under a path that contains shell-special characters (spaces, semicolons, backticks, `$()`, etc.) the shell will interpret them. `path.resolve` does not sanitise shell metacharacters — it only resolves path segments. An attacker who controls the installation directory name (e.g. via a malicious `npm pack` extraction path) can inject arbitrary shell commands.

```js
// Current — vulnerable
execSync(
  'claude mcp add chain-insights-proxy --scope user -- node ' + proxyBinPath,
  { stdio: 'pipe' }
);
```

**Fix:** Use `execFileSync` (which bypasses the shell entirely) with an explicit argv array, or at minimum wrap `proxyBinPath` in `JSON.stringify()` / single-quotes with escaping. `execFileSync` is already imported on line 3 of `src/cli.ts` and is available in `child_process`:

```js
const { execFileSync } = require('child_process');

execFileSync(
  'claude',
  ['mcp', 'add', 'chain-insights-proxy', '--scope', 'user', '--', 'node', proxyBinPath],
  { stdio: 'pipe' }
);
```

---

### CR-02: Weak key derivation — machine identity used as salt, no random salt

**File:** `src/wallet/index.ts:13-18`
**Issue:** `scryptSync` is called with the static string `'chain-insights-wallet-v1'` as the **salt** and the machine identity (`hostname:username`) as the **password**. This is backwards from correct scrypt usage. The salt must be random and unique per-encryption — its purpose is to prevent precomputation attacks. Using a fixed, predictable salt means:
1. An attacker who obtains two `wallet.json` files from machines with the same hostname and username can confirm they encrypt the same key with zero cost.
2. Because `hostname` and `username` are not secret (trivially discoverable on any multi-user system or from process listings), the "machine binding" protection is much weaker than it appears. The effective key space is the entropy of the hostname+username pair, not 256 bits.

The correct fix is to store a random per-wallet salt alongside `iv` and `tag`.

**Fix:**
```ts
interface WalletData {
  salt: string   // add random salt
  iv: string
  tag: string
  data: string
}

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(
    `${os.hostname()}:${os.userInfo().username}`,
    salt,   // random salt stored in wallet.json
    32,
  )
}

export async function encryptKey(privateKey: string): Promise<void> {
  const salt = crypto.randomBytes(16)   // random per-wallet salt
  const key = deriveKey(salt)
  const iv = crypto.randomBytes(12)
  // ... rest unchanged ...
  const walletData: WalletData = {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  }
  // ...
}

export async function decryptKey(): Promise<string> {
  // ...
  const salt = Buffer.from(stored.salt, 'hex')
  const key = deriveKey(salt)
  // ...
}
```

---

### CR-03: `bin/mcp-proxy.cjs` uses `'use strict'` + `import()` — valid CJS but entry point registered incorrectly in installer

**File:** `bin/mcp-proxy.cjs:7` cross-referenced with `bin/install.cjs:108`
**Issue:** `bin/install.cjs` registers the MCP proxy with Claude Code as:
```
node dist/mcp-proxy.mjs
```
(`proxyBinPath = path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs')`)

But `bin/mcp-proxy.cjs` is the intended shim entry point — it dynamically imports `dist/mcp-proxy.mjs`. The installer bypasses the CJS shim entirely and points Claude Code directly at the `.mjs` file. When Claude Code runs `node dist/mcp-proxy.mjs` it will try to execute the compiled ESM module directly. This works only if Node can run it as a top-level script — but `dist/mcp-proxy.mjs` contains `import.meta.url` checks and expects to be the main module. More critically, the CJS shim's stderr-only error-handling contract (stdout purity) is bypassed: any pre-boot error from the raw `.mjs` will go to stdout, corrupting the MCP stdio stream.

The installer should register the **CJS shim**, not the compiled `.mjs`:

**Fix:** In `bin/install.cjs`, change line 108:
```js
// Current — registers .mjs directly, bypasses CJS shim
const proxyBinPath = path.resolve(__dirname, '..', 'dist', 'mcp-proxy.mjs');

// Fix — register the CJS shim (which safely loads the .mjs)
const proxyBinPath = path.resolve(__dirname, 'mcp-proxy.cjs');
```

---

## Warnings

### WR-01: Cache hit in proxy does not reconnect `remoteClient` — tool calls will fail at runtime

**File:** `src/mcp/proxy.ts:36-104`
**Issue:** When `loadSchema()` returns a cached tool list (cache hit), the proxy skips `remoteClient.connect()` entirely (line 41: `if (!tools)`). The `remoteClient` object is created (line 39) but never connected. Tool handler closures on lines 86-103 call `remoteClient.callTool(...)` — this will throw because the client is not connected. The proxy will start and register all tools successfully but every tool call will fail with a client-not-connected error.

This is a logic error: the connection to the remote MCP is required for every tool call regardless of whether the schema was cached.

**Fix:** Always connect `remoteClient` before registering tool handlers. Move the connection outside the `if (!tools)` block:

```ts
// Connect unconditionally — required for tool call forwarding
await remoteClient.connect(
  new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }),
)

let tools: McpTool[] | null = await loadSchema()
if (!tools) {
  const result = await remoteClient.listTools()
  tools = result.tools as McpTool[]
  await saveSchema(tools)
}
```

---

### WR-02: `mcp-proxy.cjs` declares `'use strict'` but uses dynamic `import()` — `'use strict'` is a no-op and misleading; `__dirname` is not available

**File:** `bin/mcp-proxy.cjs:2-7`
**Issue:** The file header has `'use strict'` which is valid CJS syntax, but `import()` (dynamic import) is available in both CJS and ESM — this is fine. However, the file comment says "CJS shim" yet the body contains only a dynamic `import()` call with no fallback. More importantly, if `dist/mcp-proxy.mjs` does not exist (e.g. after a fresh clone before `npm run build`), the error message on line 8 reads `Failed to load chain-insights MCP proxy: ${err.message}` — `err.message` for a module-not-found error from `import()` is typically a long stack that includes paths. The message is adequate but `err` should be checked for `code === 'ERR_MODULE_NOT_FOUND'` to give a more actionable hint ("run `npm run build` first").

**Fix:**
```js
import('../dist/mcp-proxy.mjs').catch((err) => {
  const hint = err.code === 'ERR_MODULE_NOT_FOUND'
    ? ' (run `npm run build` to compile the proxy)'
    : '';
  process.stderr.write(`Failed to load chain-insights MCP proxy: ${err.message}${hint}\n`);
  process.exit(1);
});
```

---

### WR-03: `createMcpFetchClient` is called before the MCP connection in the proxy cache-miss path, but the `paymentFetch` function is constructed even when schema is served from cache — no payment client needed

**File:** `src/mcp/proxy.ts:31-33`
**Issue:** `decryptKey()` and `createMcpFetchClient()` are called unconditionally (lines 31-33), before the cache check on line 36. When the cache is hit, the payment client is constructed but never used — the private key is decrypted, the crypto operations run, and then the result is discarded. This is a minor waste but more importantly it means the private key is held in memory (as the `paymentFetch` closure captures `account`) for the lifetime of the proxy process even when it is not needed at startup.

Since tools must call `remoteClient.callTool()` at runtime (which uses `paymentFetch`), the payment client must be available for tool calls. But decryption could be deferred to connection time. This is a correctness trade-off: fix WR-01 first (unconditional connect), then evaluate whether deferred decryption is warranted.

**Fix:** No change required until WR-01 is fixed. After fixing WR-01, `paymentFetch` is always needed for the connection, so the current call placement becomes correct.

---

### WR-04: `bin/install.cjs` `copyCommandsAsClaudeSkills` does not recurse into subdirectories of skill dirs — nested files are silently skipped

**File:** `bin/install.cjs:72-79`
**Issue:** The inner loop at lines 72-79 reads the top-level entries of each skill subdirectory with `fs.readdirSync(skillSrc)` and copies them. It uses `fs.readFileSync` / `fs.writeFileSync` on each entry — if any entry is itself a directory (e.g. a `rules/` subdirectory within a skill), `readFileSync` will throw `EISDIR`. The installer silently fails for any skill that uses nested directories, and for flat skill directories this is fine — but the `--local` install path (which installs to `.claude/commands/chain-insights/`) is also handled by the same function, and Claude Code commands can have nested structure.

**Fix:** Add an `isFile()` guard before reading, or implement recursive copy:
```js
for (const file of files) {
  const srcFile  = path.join(skillSrc, file);
  const destFile = path.join(skillDest, file);
  const stat = fs.statSync(srcFile);
  if (!stat.isFile()) continue; // skip directories — add recursion if needed
  const content  = fs.readFileSync(srcFile, 'utf8');
  fs.writeFileSync(destFile, content, 'utf8');
}
```

---

## Info

### IN-01: `bin/mcp-proxy.cjs` is a `.cjs` file but uses `import()` syntax — the `'use strict'` directive is redundant

**File:** `bin/mcp-proxy.cjs:2`
**Issue:** CJS modules run in strict mode when `'use strict'` is declared, but `'use strict'` has no effect on the behaviour of `import()`. The comment "CJS shim" is accurate but the `'use strict'` adds no value. Minor clarity issue.

**Fix:** Remove `'use strict'` or add a comment explaining it is retained for linting tooling.

---

### IN-02: `src/mcp/proxy.ts` main-module detection heuristic is fragile

**File:** `src/mcp/proxy.ts:121`
**Issue:** The IIFE guard `import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))` uses string inclusion rather than URL equality. On case-insensitive filesystems (macOS default, Windows), this can produce false positives. Additionally, when `process.argv[1]` contains URL-encoded characters (e.g. spaces encoded as `%20`) the comparison fails silently — `createProxy()` is never called. The standard Node.js ESM idiom is:
```ts
// Standard idiom
import { fileURLToPath } from 'node:url';
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
```

**Fix:**
```ts
import { fileURLToPath } from 'node:url'
const isMain = fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  createProxy().catch(...)
}
```

---

### IN-03: `tests/cli-mcp.test.ts` duplicates all CLI action handler logic verbatim — test helpers will drift from production code

**File:** `tests/cli-mcp.test.ts:83-170`
**Issue:** `runMcpToolsAction`, `runMcpCallAction`, and `runConfigSetAction` are line-for-line copies of the Commander action handlers in `src/cli.ts`. When the production handlers change, these helpers must be manually kept in sync — they will not fail to compile if they diverge. This pattern provides false coverage confidence: the tests verify the helper's copy of the logic, not the actual Commander-wired handler.

The root cause is that the action handlers are inline anonymous functions in Commander's `.action()` call and cannot be imported for testing. Extracting them to named, exportable functions in `src/cli.ts` would allow direct import in tests.

**Fix:** Extract action handler logic into exported functions in `src/cli.ts` and import them in tests instead of duplicating.

---

_Reviewed: 2026-05-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
