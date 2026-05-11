---
phase: 04-money-flow-visualization
reviewed: 2026-05-11T09:41:02Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/cli.ts
  - src/index.ts
  - src/server/app.ts
  - src/viz/data-extractor.ts
  - src/viz/graph-model.ts
  - src/viz/html-generator.ts
  - src/viz/index.ts
  - src/viz/templates/graph.html
  - tests/viz-cli.test.ts
  - tests/viz-data-extractor.test.ts
  - tests/viz-graph-model.test.ts
  - tests/viz-html-generator.test.ts
  - tests/viz-server.test.ts
findings:
  critical: 3
  warning: 3
  info: 1
  total: 7
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-11T09:41:02Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the money flow visualization pipeline: CLI `viz` command, Hono server, data extractor, graph model (Zod schemas), HTML generator, and the bundled `graph.html` canvas renderer.

Three blockers were found. The most severe is a broken distribution: the `graph.html` template is read with `readFileSync` at module-load time using a path relative to `__dirname` in `dist/`, but `tsdown` does not copy the template to `dist/` and it is not listed in `package.json#files`. Any `npx chain-insights viz` call after `npm install` will crash immediately with `ENOENT`. The second blocker is a script-injection XSS: `JSON.stringify` does not escape `</script>`, so a node address or label containing `</script>` in the input data breaks out of the inline `<script>` tag. The third blocker is a path traversal write: `writeVizHtml` and `extractGraphFromCase` both use a caller-supplied `caseId` directly in `path.join` without sanitization; `path.join` does not resolve `..` away.

---

## Critical Issues

### CR-01: Template not distributed — package broken after `npm install`

**File:** `src/viz/html-generator.ts:10`

**Issue:** `readFileSync` is called at module-load time using a path resolved relative to `__dirname` (which is `dist/` at runtime). `tsdown.config.ts` has no `copy` step and `package.json#files` lists only `["bin","dist","skills"]`. `dist/templates/` does not exist. Any invocation of `chain-insights viz` after a real `npm install` will throw `ENOENT: no such file or directory, open '.../dist/templates/graph.html'` and crash the entire CLI on import.

Verified: `dist/` contains no `.html` files and no `templates/` subdirectory. Tests pass only because they run via `tsx src/` which reads from the source tree.

**Fix:** Two equivalent options — prefer option A:

Option A (keep readFileSync): add a `copy` step to `tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown'
import { cpSync } from 'node:fs'

export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts', 'mcp-proxy': 'src/mcp/proxy.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: true,
  clean: true,
  shims: true,
  hooks: {
    'build:done': () => {
      cpSync('src/viz/templates', 'dist/templates', { recursive: true })
    },
  },
})
```

Option B (inline the template at build time): use a vite/rollup plugin or a pre-build script to embed the template as a TypeScript string literal, eliminating the runtime file dependency.

---

### CR-02: XSS via `</script>` injection in `INLINE_DATA`

**File:** `src/viz/html-generator.ts:76-78`

**Issue:** `JSON.stringify` does not escape the `</script>` sequence. When a node `id`, `label`, or edge `txHash` in the input data contains `</script>`, the generated inline script tag is syntactically broken and the injected content is interpreted as HTML:

```
<script>var INLINE_DATA = {"nodes":[{"address":"</script><script>alert(1)</script>"}],...};</script>
```

This is reproducible: `node -e "console.log(JSON.stringify({a:'</script><script>alert(1)</script>'}))"` produces unescaped `</script>`. While this is a local HTML file, it contains real investigation data (wallet addresses, transaction hashes) that could be named adversarially by a counterparty under investigation, or crafted by a malicious evidence file.

**Fix:** Escape `</script>` sequences after serialization:
```ts
// html-generator.ts:76-78
export function generateHtml(data: GraphData, _title: string): string {
  const graphHtmlData = transformToGraphHtml(data)
  const dataJson = JSON.stringify(graphHtmlData)
    .replace(/<\/script>/gi, '<\\/script>')   // prevent tag breakout
    .replace(/<!--/g, '<\\!--')               // prevent comment injection
  const inlineScript = `<script>var INLINE_DATA = ${dataJson};</script>`
  return template.replace('</body>', `${inlineScript}\n</body>`)
}
```

---

### CR-03: Path traversal write via unsanitized `caseId`

**File:** `src/viz/html-generator.ts:85`, `src/viz/data-extractor.ts:8`

**Issue:** `writeVizHtml` (line 85) and `caseDir()` (line 8 in data-extractor) use the caller-supplied `caseId` directly in `path.join`. `path.join` normalizes `..` components but does not contain them:

```
path.join(home, '.chain-insights', 'cases', '../../evil', 'viz')
// => /home/user/evil/viz
```

Running `chain-insights viz "../../evil"` writes a file at an arbitrary location under the user's home directory. While exploiting this requires the user to run the command themselves with a malicious caseId, it is still an unintended write outside the expected directory tree and a defense-in-depth failure.

The server's ID validation regex (`/^[a-zA-Z0-9_-]+$/`) blocks the corresponding HTTP request, but the file is already written before that validation runs.

**Fix:** Add a `path.basename`-based guard in both `writeVizHtml` and `caseDir()`, and throw explicitly if the resolved path escapes the intended root:

```ts
// Validate that resolved path stays within the .chain-insights root
function assertSafePath(resolvedPath: string, rootDir: string): void {
  if (!resolvedPath.startsWith(rootDir + path.sep) && resolvedPath !== rootDir) {
    throw new Error(`Invalid case ID: path traversal detected`)
  }
}

// In writeVizHtml:
const chainInsightsRoot = path.join(os.homedir(), '.chain-insights')
if (caseId) {
  vizDir = path.join(chainInsightsRoot, 'cases', caseId, 'viz')
  assertSafePath(vizDir, chainInsightsRoot)
}
```

Apply the same guard to `caseDir()` in `data-extractor.ts`.

---

## Warnings

### WR-01: Duplicate `process.on` signal handlers accumulate on each `startServer` call

**File:** `src/server/index.ts:14-15`

**Issue:** Every call to `startServer()` registers new `SIGINT` and `SIGTERM` listeners on `process`. In the test suite alone, five separate `startServer()` calls register 10 total signal listeners. Node.js emits a `MaxListenersExceededWarning` at 10 listeners, and when a signal fires, all registered handlers run in sequence — meaning all previously-started server instances attempt `server.close()` and `process.exit()` from stale closures. This is a correctness bug in the test environment and a resource leak in any long-running host process.

**Fix:** Register signal handlers only once, or clean them up on server close:

```ts
export function startServer(port = 4321): () => void {
  const app    = createApp()
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })

  console.log(`Chain Insights server running on http://127.0.0.1:${port}`)

  const onSigint  = () => { server.close(); process.exit(0) }
  const onSigterm = () => { server.close(() => process.exit(0)) }

  process.on('SIGINT',  onSigint)
  process.on('SIGTERM', onSigterm)

  return () => {
    process.off('SIGINT',  onSigint)
    process.off('SIGTERM', onSigterm)
    server.close()
  }
}
```

---

### WR-02: Port arguments parsed without NaN validation — silent bind to port `0`

**File:** `src/cli.ts:42`, `src/cli.ts:465`

**Issue:** Both the `serve` and `viz` commands call `parseInt(opts.port, 10)` without validating the result. `parseInt('abc', 10)` returns `NaN`. Passing `NaN` to `@hono/node-server` causes it to bind to a random ephemeral port (OS assigns port `0`), and the printed URL `http://127.0.0.1:NaN/viz/...` is non-functional. The user gets no error, just a broken URL.

**Fix:**
```ts
// serve command (line 42) and viz command (line 465):
const port = parseInt(opts.port, 10)
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${opts.port}`)
  process.exit(1)
}
```

---

### WR-03: Server implementation uses Hono instead of the project-mandated Fastify

**File:** `src/server/app.ts:1`, `src/server/index.ts:1`

**Issue:** `CLAUDE.md` explicitly mandates Fastify 5.x as the HTTP server, documents the rationale (official `@x402/fastify` middleware, built-in Pino logging, JSON Schema validation, plugin architecture), and calls out Hono as a rejected alternative: "Hono is excellent but optimized for edge/Cloudflare Workers. This is a local-only server where Fastify's Node.js optimization and plugin ecosystem matter more." The implementation uses `hono` and `@hono/node-server`. `fastify` is absent from `package.json#dependencies`.

This creates a gap for the planned x402 paywall integration, which requires `@x402/fastify` middleware. If that integration is built assuming Fastify, it will find a Hono app instead.

**Fix:** Replace the Hono server with Fastify 5.x. The route logic in `app.ts` (health, status, viz/:id) is straightforward to port.

---

## Info

### IN-01: Variable shadowing — `rawArgs` parameter shadows module-level const

**File:** `src/cli.ts:152`

**Issue:** The `mcp call` action handler declares a parameter named `rawArgs` (line 152) that shadows the module-level `const rawArgs = process.argv.slice(2)` declared at line 25. TypeScript allows this, but it risks maintenance confusion, especially since the two variables serve entirely different purposes. Static analysis tools (ESLint `no-shadow`) would flag this.

**Fix:** Rename the action parameter to `argPairs` or `rawArgPairs`:
```ts
.action(async (tool: string, argPairs: string[]) => {
  const args: Record<string, string> = {}
  for (const pair of argPairs) {
```

---

_Reviewed: 2026-05-11T09:41:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
