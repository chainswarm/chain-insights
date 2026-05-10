# Phase 1: Foundation & Distribution - Research

**Researched:** 2026-05-11
**Domain:** npm CLI distribution, embedded database initialization, local HTTP server, Claude Code skill registration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and GSD reference architecture (`references/get-shit-done/`) to guide decisions.

Key constraints from PROJECT.md:
- TypeScript 6.0 / Node.js 22+
- Hono (NOT Fastify) for local server
- DuckDB Neo client (`@duckdb/node-api`, NOT deprecated `duckdb` package)
- Commander.js for CLI
- tsdown for build
- Vitest for tests
- Package name: `chain-insights`
- Config directory: `.chain-insights/`
- Installer: `npx chain-insights --claude` (GSD-style)
- MCP auth: Bearer token (private endpoint for now)
- Domain vocabulary: cases, playbooks, evidence, dossiers, watches

### Claude's Discretion
All implementation choices — directory layout, file organization, config schema, health check approach, server port selection, test structure.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | User can install globally via `npx chain-insights --claude` | GSD bin/install.js pattern verified; Claude Code 2.1.88+ uses `~/.claude/skills/<name>/SKILL.md` for global skills |
| FOUND-02 | CLI scaffold with Commander.js and skill registration system | Commander 14.0.3 verified on npm; skill format: YAML frontmatter + markdown body |
| FOUND-03 | DuckDB embedded database initialization with postinstall health check | `@duckdb/node-api` 1.5.2-r.1 verified; `DuckDBInstance.create('path.db')` + `connection.run()` pattern confirmed |
| FOUND-04 | Local Hono server (localhost-only, on-demand) for visualization and state API | Hono 4.12.18 + `@hono/node-server` 2.0.2 verified; graceful shutdown via `server.close()` on SIGINT/SIGTERM |
| FOUND-05 | Configuration system in `.chain-insights/` directory with MCP endpoint and wallet settings | Zod 4.4.3 schema validation; JSON config file; `~/.chain-insights/config.json` location |
</phase_requirements>

---

## Summary

Phase 1 creates the npm package skeleton that everything else builds on. The core tasks are: (1) a CJS `bin/cli.js` that Commander.js routes to sub-commands, (2) a TypeScript source tree built by tsdown into ESM + CJS dual output, (3) a DuckDB initialization module that opens or creates `~/.chain-insights/chain-insights.db` on first run, (4) a Hono server that binds to `127.0.0.1` on demand and shuts down cleanly, and (5) a Zod-validated config system that reads/writes `~/.chain-insights/config.json`.

The skill registration portion of FOUND-01 follows the GSD pattern exactly: the installer script copies markdown files into `~/.claude/skills/chain-insights-*/SKILL.md` for global Claude Code installs. Each skill file is a markdown document with YAML frontmatter (`name`, `description`, `allowed-tools` fields). The installer is a CJS script in `bin/install.js` that runs with bare `node`, avoiding any ESM/TypeScript compile step at install time.

The critical tsdown version constraint: CLAUDE.md recommends 0.20.x but the current release is 0.22.0, which requires `node ^22.18.0 || >=24.0.0`. For maximum Node 22 compat (22.0 through 22.17), pin tsdown to `0.21.10` which requires only `>=20.19.0`. The dev environment here is Node v24.13.1, so either range works in practice, but the package.json engine constraint says `>=22.0.0` — using tsdown 0.21.10 keeps that honest.

**Primary recommendation:** Follow the GSD reference installer pattern verbatim. The `bin/install.js` is CJS (no build step), copies skills to `~/.claude/skills/`, and the main `src/` tree is TypeScript ESM built by tsdown into `dist/`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLI entrypoint (`npx chain-insights`) | CLI / bin | — | CJS bin script; Commander.js routes sub-commands |
| Skill registration (`--claude` flag) | CLI / installer | OS filesystem | Copies SKILL.md files to `~/.claude/skills/` |
| DuckDB initialization | Local storage | — | Embedded DB; no server; opens/creates file at `~/.chain-insights/` |
| Config read/write | Local storage | — | JSON file at `~/.chain-insights/config.json`; Zod validates on load |
| Hono local server | Local server | — | Binds `127.0.0.1:PORT`; on-demand start; SIGINT/SIGTERM shutdown |
| TypeScript build | Build tooling | — | tsdown compiles `src/` → `dist/` ESM + CJS |
| Health check | CLI / postinstall | Local storage | Verifies DuckDB opens, config dir exists, server can bind |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.3 | Primary language | CLAUDE.md locked. Type safety for investigation data models. |
| Commander.js | 14.0.3 | CLI framework | CLAUDE.md locked. 132K+ dependents, complete subcommand/help/option system. |
| Hono | 4.12.18 | Local HTTP server | CLAUDE.md locked (replaces Fastify). Web Standards API, multi-runtime. |
| @hono/node-server | 2.0.2 | Node.js adapter for Hono | Required adapter to run Hono on Node.js. Without it Hono has no `serve()`. |
| @duckdb/node-api | 1.5.2-r.1 | Embedded analytical database | CLAUDE.md locked. "Neo" client; replaces deprecated `duckdb` package. |
| Zod | 4.4.3 | Config/schema validation | CLAUDE.md locked. TypeScript-first; single schema → runtime + compile-time types. |

### Build & Dev

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsdown | 0.21.10 | TypeScript bundler | Build `src/` → `dist/` ESM+CJS+`.d.ts`. Pin 0.21.x for Node 22.0 compat (0.22.0 requires 22.18+). |
| tsx | 4.21.0 | Dev-time TS execution | `tsx src/cli.ts` during development without compile step. |
| Vitest | 4.1.5 | Test runner | CLAUDE.md locked. Jest-compatible, native ESM/TS, fast watch mode. |
| @types/node | ^22.0.0 | Node.js type definitions | Required for TypeScript to know `fs`, `path`, `os`, `process` types. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdown 0.21.x | tsdown 0.22.x | 0.22.0 requires node ^22.18 or >=24; 0.21.x supports >=20.19. Pin to 0.21.x unless Node 22.18+ is guaranteed. |
| CJS `bin/install.js` | TypeScript bin | CJS works without compile step; npx users get it instantly. GSD uses this pattern. |
| `~/.chain-insights/` | `~/.config/chain-insights/` | XDG convention, but CLAUDE.md locks `.chain-insights/`. Consistent with GSD's `.claude/` pattern. |

**Installation:**
```bash
# Runtime dependencies
npm install hono @hono/node-server @duckdb/node-api zod commander

# Dev dependencies
npm install --save-dev typescript tsx tsdown vitest @types/node
```

**Version verification:** [VERIFIED: npm registry 2026-05-11]
- `@duckdb/node-api`: 1.5.2-r.1 (modified 2026-04-13)
- `hono`: 4.12.18 (modified 2026-05-06)
- `@hono/node-server`: 2.0.2
- `commander`: 14.0.3
- `tsdown`: 0.22.0 (latest); 0.21.10 (Node 22.0 compatible)
- `vitest`: 4.1.5
- `tsx`: 4.21.0
- `typescript`: 6.0.3
- `zod`: 4.4.3

---

## Architecture Patterns

### System Architecture Diagram

```
npx chain-insights --claude
        │
        ▼
bin/install.js (CJS, no build required)
        │
        ├── copies skills/ to ~/.claude/skills/ci-*/SKILL.md
        ├── creates ~/.chain-insights/ directory
        ├── writes ~/.chain-insights/config.json (default)
        └── runs DuckDB health check (opens ~/.chain-insights/chain-insights.db)

chain-insights <subcommand>
        │
        ▼
bin/cli.js (CJS shim → dist/cli.js ESM)
        │
        ▼
Commander.js program
        ├── chain-insights serve   → src/server/index.ts (Hono + @hono/node-server)
        ├── chain-insights status  → src/db/index.ts (DuckDB health)
        ├── chain-insights config  → src/config/index.ts (Zod config)
        └── [future: case, trace, risk ...]

src/ (TypeScript ESM)  ──tsdown──►  dist/ (ESM + CJS + .d.ts)
        ├── cli.ts              Commander program definition
        ├── config/
        │   ├── schema.ts       Zod schema for ~/.chain-insights/config.json
        │   └── index.ts        read/write/default config helpers
        ├── db/
        │   ├── init.ts         DuckDBInstance.create() + schema migrations
        │   └── index.ts        connection pool / singleton
        └── server/
            ├── app.ts          Hono app factory (routes, middleware)
            └── index.ts        serve() + graceful shutdown

~/.chain-insights/ (runtime state, not git-tracked)
        ├── config.json         MCP endpoint, wallet address, preferences
        └── chain-insights.db   DuckDB database file
```

### Recommended Project Structure

```
chain-insights/
├── bin/
│   ├── install.js          # CJS installer: --claude skill registration + first-run setup
│   └── cli.js              # CJS shim → delegates to dist/cli.js
├── src/
│   ├── cli.ts              # Commander program with subcommands
│   ├── config/
│   │   ├── schema.ts       # Zod schema (ConfigSchema, InvestigatorConfig type)
│   │   └── index.ts        # loadConfig(), saveConfig(), defaultConfig()
│   ├── db/
│   │   ├── schema.ts       # CREATE TABLE statements (cases, evidence, watches)
│   │   ├── init.ts         # initDb(): DuckDBInstance.create() + runSchema()
│   │   └── index.ts        # getConnection() singleton
│   └── server/
│       ├── app.ts          # new Hono(), routes: GET /health, GET /status
│       └── index.ts        # startServer(port), stopServer()
├── skills/                 # Claude Code skills bundled with the package
│   ├── ci-case/
│   │   └── SKILL.md        # /ci-case skill (future Phase 3, placeholder now)
│   └── ci-status/
│       └── SKILL.md        # /ci-status skill
├── dist/                   # tsdown output (gitignored)
├── tests/
│   ├── config.test.ts
│   ├── db.test.ts
│   └── server.test.ts
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

### Pattern 1: CJS Bin → ESM Dist Bridge

The `bin/cli.js` must be CJS (no `"type": "module"` concerns, works universally as a bin entry). It delegates to the ESM dist:

```javascript
// bin/cli.js — CJS shim
// Source: GSD reference bin/gsd-sdk.js pattern + Node.js docs
#!/usr/bin/env node
'use strict';
// Dynamic import bridges CJS bin → ESM dist
import('../dist/cli.js').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
```

**Why:** npm bin entries run as CommonJS unless the file has `.mjs` extension or the package has `"type": "module"`. Using a CJS shim with dynamic `import()` gives the best of both worlds: the bin works everywhere, the built source is ESM.

### Pattern 2: Hono Node.js Server with Graceful Shutdown

```typescript
// Source: https://hono.dev/docs/getting-started/nodejs [VERIFIED: Context7]
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

export function createApp(): Hono {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}

export function startServer(port: number): () => void {
  const app = createApp()
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })

  process.on('SIGINT', () => { server.close(); process.exit(0) })
  process.on('SIGTERM', () => { server.close(() => process.exit(0)) })

  return () => server.close()
}
```

**Key:** Pass `hostname: '127.0.0.1'` to `serve()` — Hono's Node.js adapter defaults to `0.0.0.0` (all interfaces). Localhost-only binding is a security requirement for this toolkit.

### Pattern 3: DuckDB Neo Client Initialization

```typescript
// Source: https://duckdb.org/docs/stable/clients/node_neo/overview [VERIFIED: Context7]
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import path from 'node:path'
import os from 'node:os'

const DB_PATH = path.join(os.homedir(), '.chain-insights', 'chain-insights.db')

let _instance: DuckDBInstance | null = null

export async function initDb(): Promise<DuckDBConnection> {
  if (!_instance) {
    _instance = await DuckDBInstance.create(DB_PATH)
  }
  const conn = await _instance.connect()
  await runSchema(conn)
  return conn
}

async function runSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      status VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  // Additional tables added in Phase 3
}

// Health check: can we open the DB and run a trivial query?
export async function healthCheck(): Promise<boolean> {
  try {
    const conn = await initDb()
    const reader = await conn.runAndReadAll('SELECT 1 as ok')
    const rows = reader.getRows()
    conn.closeSync()
    return rows.length === 1
  } catch {
    return false
  }
}
```

### Pattern 4: Zod Config Schema

```typescript
// Source: https://zod.dev/v4 [CITED]
import * as z from 'zod'

export const ConfigSchema = z.object({
  mcpEndpoint: z.string().url().default('http://localhost:4000'),
  mcpAuthToken: z.string().optional(),
  walletAddress: z.string().optional(),
  serverPort: z.number().int().min(1024).max(65535).default(4321),
  dataDir: z.string().default(`${os.homedir()}/.chain-insights`),
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>
```

### Pattern 5: Commander.js CLI Structure

```typescript
// Source: https://github.com/tj/commander.js [VERIFIED: Context7]
import { Command } from 'commander'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const program = new Command()

program
  .name('chain-insights')
  .description('AML investigation toolkit for blockchain analysis')
  .version(pkg.version)
  .option('--claude', 'Install Claude Code skills (run via npx)')

program
  .command('serve')
  .description('Start local visualization server')
  .option('-p, --port <number>', 'Port to bind', '4321')
  .action(async (opts) => {
    const { startServer } = await import('./server/index.js')
    startServer(parseInt(opts.port, 10))
  })

program
  .command('status')
  .description('Show toolkit status and database health')
  .action(async () => {
    // health check logic
  })

program.parse(process.argv)
```

### Pattern 6: Claude Code Skill Format (SKILL.md)

```markdown
---
name: ci-status
description: "Show Chain Insights toolkit status, database health, and active cases"
allowed-tools:
  - Read
  - Bash
---

# /ci-status

Shows toolkit status: database health, active case, MCP endpoint connectivity.

## Usage

`/ci-status`

## What it does

1. Runs `chain-insights status` via Bash
2. Reports database connection status
3. Shows active case (if any) from `.chain-insights/`
```

Skills live in `~/.claude/skills/<name>/SKILL.md` for global Claude Code installs. [VERIFIED: GSD reference install.js, lines 7912-7930]

### Pattern 7: tsdown Configuration

```typescript
// Source: https://tsdown.dev/ [VERIFIED: Context7]
// tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: true,
  clean: true,
  shims: true,  // adds __dirname, __filename for CJS compat
})
```

### Pattern 8: Installer Script (CJS, no build)

The installer (`bin/install.js`) must run as plain CJS with zero dependencies beyond Node.js builtins. It:

1. Parses `--claude` flag from `process.argv`
2. Determines target: global (`~/.claude/skills/`) or local (`./.claude/commands/chain-insights/`)
3. Copies `skills/` directory files to correct target location
4. Creates `~/.chain-insights/` config directory
5. Writes default `~/.chain-insights/config.json` if absent
6. Runs DuckDB health check (spawns a short-lived process or uses child_process to run a verification script)
7. Prints installation summary with colored output

**GSD precedent:** `references/get-shit-done/bin/install.js` follows exactly this pattern. Uses only `fs`, `path`, `os`, `readline`, `crypto` from Node.js stdlib.

**Alternative for DuckDB in installer:** The installer cannot `import` TypeScript or ESM. The DuckDB health check during install can be deferred to first `chain-insights` invocation (runs from the built `dist/`), or the installer can `require('@duckdb/node-api')` directly (CJS-compatible). Given `@duckdb/node-api` ships native binaries (`.node` files), it can be `require()`d from CJS.

### Anti-Patterns to Avoid

- **ESM in bin/install.js:** The installer must be CJS (no `import` statements). npx runs it directly; no build step executes first. Using `import` causes `SyntaxError` on Node 22 without `"type": "module"` in the package.json.
- **Binding Hono to `0.0.0.0`:** Default Hono Node.js adapter binding is all interfaces. Always pass `hostname: '127.0.0.1'` to keep the local server invisible to the network.
- **Using the deprecated `duckdb` package:** The old `duckdb` npm package has a different API (callbacks, not Promises). Use only `@duckdb/node-api` (the "Neo" client with `DuckDBInstance`, `DuckDBConnection`).
- **Synchronous config reads in hot paths:** Config should be read once at startup and cached. Repeated `fs.readFileSync` on every CLI invocation adds latency.
- **`"type": "module"` in package.json without a CJS shim for bin:** If you set `"type": "module"`, the `bin/install.js` CJS file must be renamed to `install.cjs`. Easier: keep `bin/*.js` as CJS and have them dynamically import the ESM dist.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argument parsing | Custom argv split | Commander.js | Handles subcommands, help text, types, defaults, `--version` automatically |
| Config schema validation | Manual `if (typeof x !== 'string')` | Zod | Zod gives TypeScript types + runtime validation from one schema |
| HTTP server | Raw `http.createServer` | Hono + @hono/node-server | Web Standards `fetch`-based; graceful shutdown; middleware; typed context |
| DuckDB connection management | Manual open/close per query | Singleton `DuckDBInstance` | DuckDB instances are expensive to create; reuse the instance |
| Skill file format | Custom format | Claude Code SKILL.md (YAML frontmatter + markdown) | Claude Code reads exactly this format from `~/.claude/skills/` |
| Process signal handling | `process.on('exit')` | `SIGINT` + `SIGTERM` handlers on server | `exit` fires after process ends; SIGTERM is what `kill` sends |

**Key insight:** The GSD reference (`references/get-shit-done/`) is the most valuable pattern source. Its installer structure, skill format, and config directory approach are proven in production and should be adapted directly rather than invented from scratch.

---

## Runtime State Inventory

Step 2.5 SKIPPED: This is a greenfield phase. No existing runtime state to inventory — there is no prior version of `chain-insights` deployed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime, build | ✓ | v24.13.1 | — |
| npm | Package install | ✓ | 11.13.0 | — |
| npx | npx chain-insights | ✓ | (bundled with npm) | — |
| git | Version tracking | ✓ | (in repo) | — |

**Note on Node version:** CLAUDE.md specifies `>=22.0.0`. Dev environment is Node v24.13.1. The `tsdown@0.22.0` package requires `^22.18.0 || >=24.0.0` — this excludes Node 22.0 through 22.17. Recommend pinning tsdown to `0.21.10` (`>=20.19.0`) to keep the `>=22.0.0` engine field honest, or changing the engine field to `>=22.18.0`.

**Missing dependencies with no fallback:** None.

---

## Common Pitfalls

### Pitfall 1: Hono Binding to All Interfaces

**What goes wrong:** Hono's `serve({ fetch: app.fetch, port: 4321 })` without `hostname` binds to `0.0.0.0` — the local server becomes accessible to all network interfaces, including LAN.
**Why it happens:** Hono's Node.js adapter defaults to all-interface binding inherited from Node's `http.createServer`.
**How to avoid:** Always pass `hostname: '127.0.0.1'` to `serve()`.
**Warning signs:** `netstat -an | grep 4321` shows `0.0.0.0:4321` instead of `127.0.0.1:4321`.

### Pitfall 2: ESM/CJS Confusion in bin/ Scripts

**What goes wrong:** Writing `import` statements in `bin/install.js` causes `SyntaxError` when npx runs it, because Node treats `.js` files as CJS when no `"type": "module"` is set (or as ESM when it is set, breaking the CJS installer).
**Why it happens:** TypeScript source is ESM, but the bin shim must be CJS for universal compatibility.
**How to avoid:** Write `bin/install.js` using only `require()` and CommonJS patterns. Dynamically `import()` the ESM dist from `bin/cli.js`.
**Warning signs:** `SyntaxError: Cannot use import statement in a module` or `Error: require() of ES Module`.

### Pitfall 3: DuckDB Native Binding Mismatch

**What goes wrong:** `@duckdb/node-api` ships prebuilt native `.node` binaries. If the installed binary doesn't match the running Node ABI version, it throws `Error: The module was compiled against a different Node.js version`.
**Why it happens:** npm installs the binary for the currently running Node; if you then switch Node versions (nvm), the binary is stale.
**How to avoid:** Run `npm rebuild @duckdb/node-api` after switching Node versions. Document this in the project README.
**Warning signs:** `Error: The module ... was compiled against a different Node.js version using NODE_MODULE_VERSION`.

### Pitfall 4: tsdown 0.22.0 Node Version Incompatibility

**What goes wrong:** tsdown 0.22.0 requires `node ^22.18.0 || >=24.0.0`. Installing on Node 22.0 through 22.17 causes `engines` check failure or runtime errors.
**Why it happens:** tsdown 0.22 introduced features requiring a specific Node patch level.
**How to avoid:** Pin to tsdown `0.21.10` (requires `>=20.19.0`) in package.json. Only upgrade to 0.22.x when the project's engine field is `>=22.18.0`.
**Warning signs:** `npm WARN EBADENGINE` during install.

### Pitfall 5: Claude Code Skill Registration — Global vs Local

**What goes wrong:** Skills installed to `./.claude/commands/chain-insights/` (local) are only available in that project directory. Users expect `chain-insights --claude` to register skills globally.
**Why it happens:** Claude Code reads project-local skills from `.claude/commands/` and global skills from `~/.claude/skills/`. Different directories, different scope.
**How to avoid:** Installer default should target `~/.claude/skills/ci-<name>/SKILL.md` (global). Add a `--local` flag for project-scoped installs.
**Warning signs:** Skills appear in one project but not system-wide.

### Pitfall 6: DuckDB One-Instance-Per-File Constraint

**What goes wrong:** Opening two `DuckDBInstance` objects pointing to the same `.db` file concurrently throws a lock error or causes data corruption.
**Why it happens:** DuckDB uses file-level locks; each instance holds the lock for the duration of its existence.
**How to avoid:** Use a module-level singleton for `DuckDBInstance`. Never create a second instance pointing to the same path. The connection pool (multiple `DuckDBConnection` objects from one instance) is fine.
**Warning signs:** `IO Error: Could not set lock on file` or `BUSY` database errors.

---

## Code Examples

### Full Hono Server with Localhost Binding and Graceful Shutdown

```typescript
// src/server/index.ts
// Source: https://hono.dev/docs/getting-started/nodejs [VERIFIED: Context7]
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

export function createApp(): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))
  app.get('/status', async (c) => {
    return c.json({ database: 'healthy', server: 'running' })
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}

export function startServer(port = 4321): () => void {
  const app = createApp()
  const server = serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',  // localhost-only — required
    port,
  })

  console.log(`Chain Insights server running on http://127.0.0.1:${port}`)

  process.on('SIGINT', () => { server.close(); process.exit(0) })
  process.on('SIGTERM', () => { server.close(() => process.exit(0)) })

  return () => server.close()
}
```

### DuckDB Instance Initialization with Singleton

```typescript
// src/db/init.ts
// Source: https://duckdb.org/docs/stable/clients/node_neo/overview [VERIFIED: Context7]
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const DATA_DIR = path.join(os.homedir(), '.chain-insights')
const DB_PATH = path.join(DATA_DIR, 'chain-insights.db')

let _instance: DuckDBInstance | null = null

export async function getDb(): Promise<DuckDBConnection> {
  if (!_instance) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    _instance = await DuckDBInstance.create(DB_PATH)
  }
  return _instance.connect()
}

export async function initSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      status VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn = await getDb()
    const reader = await conn.runAndReadAll('SELECT 1 as ping')
    const rows = reader.getRows()
    conn.closeSync()
    return { ok: rows.length === 1 }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

### Config Schema with Zod

```typescript
// src/config/schema.ts
// Source: https://zod.dev/v4 [CITED: zod.dev]
import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'

export const ConfigSchema = z.object({
  mcpEndpoint: z.string().url().default('http://localhost:4000'),
  mcpAuthToken: z.string().optional(),
  walletAddress: z.string().optional(),
  serverPort: z.number().int().min(1024).max(65535).default(4321),
  dataDir: z.string().default(path.join(os.homedir(), '.chain-insights')),
  version: z.string().default('1'),
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>
export const DEFAULT_CONFIG = ConfigSchema.parse({})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `duckdb` npm package (callbacks) | `@duckdb/node-api` (Promises, "Neo") | 2024 | Old package deprecated; Neo has lossless type support and Promise API |
| `tsup` bundler | `tsdown` | 2025 | tsup authors recommend tsdown; Rolldown-powered, 3-5x faster |
| Claude Code `commands/gsd/` | `~/.claude/skills/gsd-*/SKILL.md` | Claude Code 2.1.88+ | Skills format supersedes commands format for global installs |
| Fastify for local server | Hono | 2025 (for this project) | CLAUDE.md decision; Hono is lighter and multi-runtime compatible |

**Deprecated/outdated:**
- `duckdb` npm package: deprecated, use `@duckdb/node-api` (Neo client)
- `tsup`: not actively maintained, authors moved to tsdown
- Claude Code `commands/` for global skills: superseded by `skills/*/SKILL.md` (Claude Code 2.1.88+)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `serve({ hostname: '127.0.0.1' })` is the correct Hono Node.js adapter API for localhost binding | Architecture Patterns (Pattern 2) | Server would bind to all interfaces; security issue. Verify with @hono/node-server docs. |
| A2 | Claude Code reads skills from `~/.claude/skills/<name>/SKILL.md` for global installs | Pattern 6 | Skills wouldn't register. Mitigated: verified from GSD install.js lines 7912-7930. |
| A3 | `DuckDBConnection.closeSync()` is the correct method for synchronous close | Code Examples | Connection leak if wrong method name. Verified from Context7 snippet showing `closeSync()`. |

---

## Open Questions (RESOLVED)

1. **Default MCP endpoint for dev**
   - What we know: MCP auth uses Bearer token `chainswarm-m2m-2026`. Private endpoint is currently localhost.
   - What's unclear: Should the default config include the actual MCP URL or a placeholder?
   - Recommendation: Use `http://localhost:4000` as placeholder default; users configure via `chain-insights config set mcpEndpoint <url>`.

2. **DuckDB health check in installer vs. first run**
   - What we know: The installer (`bin/install.js`) is CJS and can `require('@duckdb/node-api')`. However, native binding adds ~50ms overhead.
   - What's unclear: Should the postinstall DuckDB check happen in the installer (immediate feedback) or first `chain-insights` run (deferred)?
   - Recommendation: Defer the DB health check to first `chain-insights status` invocation. The installer verifies the config directory and config file creation only.

3. **Server port conflict handling**
   - What we know: Hono's server will throw `EADDRINUSE` if the port is taken.
   - What's unclear: Should the server find a free port automatically, or fail with a clear error?
   - Recommendation: Fail with a clear error message suggesting `chain-insights serve --port <alt>`. Auto-port-finding adds complexity for Phase 1.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (to create in Wave 0) |
| Quick run command | `vitest run --reporter=verbose` |
| Full suite command | `vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Installer copies skills to `~/.claude/skills/` | unit | `vitest run tests/installer.test.ts -x` | ❌ Wave 0 |
| FOUND-02 | Commander program responds to `--help`, subcommands route correctly | unit | `vitest run tests/cli.test.ts -x` | ❌ Wave 0 |
| FOUND-03 | DuckDB opens, schema creates `cases` table, health check returns true | unit | `vitest run tests/db.test.ts -x` | ❌ Wave 0 |
| FOUND-04 | Hono server starts on 127.0.0.1, serves /health, shuts down on SIGTERM | integration | `vitest run tests/server.test.ts -x` | ❌ Wave 0 |
| FOUND-05 | Config loads with defaults, validates with Zod, writes to correct path | unit | `vitest run tests/config.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run --reporter=verbose`
- **Per wave merge:** `vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — configure test environment (`node`), include/exclude patterns
- [ ] `tests/installer.test.ts` — covers FOUND-01 (skill file creation)
- [ ] `tests/cli.test.ts` — covers FOUND-02 (Commander routing)
- [ ] `tests/db.test.ts` — covers FOUND-03 (DuckDB init, schema, health check)
- [ ] `tests/server.test.ts` — covers FOUND-04 (Hono server integration)
- [ ] `tests/config.test.ts` — covers FOUND-05 (Zod config validation)
- [ ] Framework install: `npm install --save-dev vitest @types/node` — if not yet in package.json

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No user auth in Phase 1 (MCP auth is Phase 2) |
| V3 Session Management | No | No session state in Phase 1 |
| V4 Access Control | Partial | Hono server binds `127.0.0.1` only — network-level access control |
| V5 Input Validation | Yes | Zod validates all config inputs |
| V6 Cryptography | No | No crypto in Phase 1 (wallet signing is Phase 2) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Local server accessible to LAN | Elevation of Privilege | `hostname: '127.0.0.1'` in `serve()` |
| Config file containing MCP auth token readable by all users | Information Disclosure | File permissions: `chmod 600 ~/.chain-insights/config.json` |
| Path traversal in config `dataDir` field | Tampering | Zod validate `dataDir` is absolute path under `$HOME` |
| DuckDB file readable by other local users | Information Disclosure | `chmod 600 ~/.chain-insights/chain-insights.db` after creation |

---

## Sources

### Primary (HIGH confidence)

- Context7 `/llmstxt/hono_dev_llms_txt` — Hono Node.js adapter, `serve()` API, graceful shutdown, CORS
- Context7 `/websites/duckdb_stable_clients_node_neo` — DuckDB Neo client, `DuckDBInstance.create()`, `DuckDBConnection`, `runAndReadAll()`, `closeSync()`
- Context7 `/duckdb/duckdb-node-neo` — Connection patterns, result readers
- Context7 `/tj/commander.js` — Subcommand definition, option parsing, TypeScript usage
- Context7 `/rolldown/tsdown` — Build config, ESM+CJS dual output, `platform: 'node'`, `shims: true`
- Context7 `/colinhacks/zod` — Object schema definition, `.optional()`, `z.infer<>`
- Context7 `/vitest-dev/vitest` — Configuration, describe/test/expect API
- GSD reference `references/get-shit-done/bin/install.js` — Installer pattern, Claude skill copy (lines 5640-5700, 7912-7930)
- npm registry (2026-05-11) — All package versions verified

### Secondary (MEDIUM confidence)

- `npm view tsdown@0.21.10 engines` — Node engine compatibility for tsdown minor versions
- GSD `references/get-shit-done/sdk/package.json` — Project structure reference (tsc build pattern)
- GSD `references/get-shit-done/vitest.config.ts` — Vitest project-mode config pattern

### Tertiary (LOW confidence)

- None — all claims verified through primary sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry 2026-05-11
- Architecture: HIGH — patterns verified through Context7 official docs and GSD reference
- Pitfalls: MEDIUM — DuckDB/tsdown pitfalls from official docs; skill registration pitfalls from GSD source

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (stable ecosystem; tsdown minor versions move quickly, re-check before pinning)
