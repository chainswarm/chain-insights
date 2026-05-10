# Phase 1: Foundation & Distribution - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 13 new files
**Analogs found:** 13 / 13 (all from GSD reference — greenfield project)

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `bin/install.js` | installer | request-response | `references/get-shit-done/bin/install.js` | exact |
| `bin/cli.js` | bin-shim | request-response | `references/get-shit-done/bin/gsd-sdk.js` | exact |
| `src/cli.ts` | CLI entrypoint | request-response | `references/get-shit-done/sdk/src/cli.ts` | role-match |
| `src/config/schema.ts` | model | transform | `references/get-shit-done/sdk/src/config.ts` | role-match |
| `src/config/index.ts` | service | CRUD | `references/get-shit-done/sdk/src/config.ts` | role-match |
| `src/db/init.ts` | service | CRUD | RESEARCH.md Pattern 3 (no existing DB analog) | no analog |
| `src/db/index.ts` | service | CRUD | RESEARCH.md Pattern 3 (no existing DB analog) | no analog |
| `src/server/app.ts` | service | request-response | RESEARCH.md Pattern 2 (no existing Hono analog) | no analog |
| `src/server/index.ts` | service | request-response | RESEARCH.md Pattern 2 (no existing Hono analog) | no analog |
| `skills/ci-status/SKILL.md` | config | — | `references/get-shit-done/commands/gsd/help.md` | role-match |
| `skills/ci-case/SKILL.md` | config | — | `references/get-shit-done/commands/gsd/help.md` | role-match |
| `tests/*.test.ts` | test | — | `references/get-shit-done/sdk/src/config.test.ts` | role-match |
| `vitest.config.ts` | config | — | `references/get-shit-done/vitest.config.ts` | exact |

---

## Pattern Assignments

### `bin/install.js` (installer, CJS, no build step)

**Analog:** `references/get-shit-done/bin/install.js`

**Shebang + stdlib-only imports** (lines 1–7):
```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');
```
Only Node.js stdlib — zero npm imports. This is mandatory: the installer runs before `npm install` has provisioned `node_modules`.

**ANSI color constants** (lines 9–16):
```javascript
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
```
All installer output uses these inline. No chalk or colors package.

**Argv flag parsing** (lines 81–106):
```javascript
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal  = args.includes('--local')  || args.includes('-l');
const hasClaude = args.includes('--claude');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');
```
Chain Insights only needs `--claude` and `--local`/`--global`. Same pattern.

**Skill copy core — `copyCommandsAsClaudeSkills`** (lines 5640–5743):
```javascript
function copyCommandsAsClaudeSkills(srcDir, skillsDir, prefix, pathPrefix, runtime, isGlobal = false) {
  if (!fs.existsSync(srcDir)) { return; }
  fs.mkdirSync(skillsDir, { recursive: true });

  // Remove stale ci-* skill dirs before copying
  const existing = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`)) {
      fs.rmSync(path.join(skillsDir, entry.name), { recursive: true });
    }
  }

  function recurse(currentSrcDir, currentPrefix) {
    const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(currentSrcDir, entry.name);
      if (entry.isDirectory()) {
        recurse(srcPath, `${currentPrefix}-${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith('.md')) { continue; }

      const baseName  = entry.name.replace('.md', '');
      const skillName = `${currentPrefix}-${baseName}`;
      const skillDir  = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });

      let content = fs.readFileSync(srcPath, 'utf8');
      // path substitution (chain-insights doesn't need multi-runtime substitution)
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    }
  }
  recurse(srcDir, prefix);
}
```
Chain Insights adaptation: call with `srcDir = path.join(__dirname, '..', 'skills')`, `skillsDir = path.join(os.homedir(), '.claude', 'skills')`, `prefix = 'ci'`.

**Config directory creation** (lines 4264, 4518–4519 pattern):
```javascript
// Create ~/.chain-insights/ if absent
const dataDir = path.join(os.homedir(), '.chain-insights');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`${green}✓${reset} Created ${dataDir}`);
}

// Write default config.json if absent
const configPath = path.join(dataDir, 'config.json');
if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    mcpEndpoint: 'http://localhost:4000',
    mcpAuthToken: '',
    walletAddress: '',
    serverPort: 4321,
    dataDir,
    version: '1',
  };
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n');
  fs.chmodSync(configPath, 0o600);   // owner-only read/write — security
  console.log(`${green}✓${reset} Created ${configPath}`);
}
```

**Installation summary print** (end of GSD install.js, after all copy work):
```javascript
console.log(`\n${bold}${green}Chain Insights installed${reset}`);
console.log(`  ${cyan}Skills:${reset}  ${skillsDir}`);
console.log(`  ${cyan}Config:${reset}  ${configPath}`);
console.log(`  ${cyan}Data:${reset}    ${dataDir}`);
console.log(`\nRun ${cyan}chain-insights status${reset} to verify the installation.\n`);
```

---

### `bin/cli.js` (bin-shim, CJS → ESM bridge)

**Analog:** `references/get-shit-done/bin/gsd-sdk.js` (lines 1–37)

The GSD shim uses `spawnSync` to delegate to a pre-built JS file. For chain-insights we use dynamic `import()` instead (simpler, no child process overhead for a CLI):

```javascript
#!/usr/bin/env node
'use strict';

// CJS shim — bridges the npm bin entry (CJS, no build step) to the
// ESM dist built by tsdown. Dynamic import() is the correct bridge.
import('../dist/cli.js').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
```

**Why dynamic import() over spawnSync:** GSD's `gsd-sdk.js` uses `spawnSync` because the SDK dist is a separate package with its own Node invocation. For a single-package CLI, `import()` avoids a child process and properly propagates exit codes via Commander's built-in `process.exit()`.

---

### `src/cli.ts` (CLI entrypoint, Commander.js)

**Analog:** `references/get-shit-done/sdk/src/cli.ts` — role-match (GSD uses `parseArgs` directly; chain-insights uses Commander, which is more ergonomic for subcommands)

**Imports pattern** (adapt from RESEARCH.md Pattern 5):
```typescript
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };
```
The `new URL('../package.json', import.meta.url)` pattern is the correct ESM-safe way to load a sibling file — no `__dirname` needed (tsdown's `shims: true` option adds `__dirname` for CJS output, but the ESM source should use `import.meta.url`).

**Commander program definition** (adapt from RESEARCH.md Pattern 5):
```typescript
const program = new Command();

program
  .name('chain-insights')
  .description('AML investigation toolkit for blockchain analysis')
  .version(pkg.version)
  .hook('preAction', () => {
    // future: load config once here, cache on process
  });

program
  .command('serve')
  .description('Start local visualization server')
  .option('-p, --port <number>', 'Port to bind', '4321')
  .action(async (opts) => {
    const { startServer } = await import('./server/index.js');
    startServer(parseInt(opts.port, 10));
  });

program
  .command('status')
  .description('Show toolkit status and database health')
  .action(async () => {
    const { healthCheck } = await import('./db/init.js');
    const { loadConfig } = await import('./config/index.js');
    const config = await loadConfig();
    const db = await healthCheck();
    console.log('DB:', db.ok ? 'healthy' : `error — ${db.error}`);
    console.log('Config:', config.dataDir);
  });

program
  .command('config')
  .description('Read or write configuration')
  .addCommand(
    new Command('get')
      .argument('<key>', 'Config key to read')
      .action(async (key) => { /* ... */ })
  )
  .addCommand(
    new Command('set')
      .argument('<key>', 'Config key')
      .argument('<value>', 'Value to set')
      .action(async (key, value) => { /* ... */ })
  );

program.parse(process.argv);
```

**Key pattern from GSD cli.ts** (lines 9–21 — module imports follow a stdlib-first, then internal order):
```typescript
// stdlib first
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// then internal modules
import { loadConfig } from './config.js';
```
Maintain this ordering in chain-insights `src/cli.ts`.

---

### `src/config/schema.ts` (model, Zod schema)

**Analog:** `references/get-shit-done/sdk/src/config.ts` (lines 14–82) — role-match (GSD uses plain TypeScript interfaces; chain-insights uses Zod for runtime validation)

**Full pattern** (from RESEARCH.md Pattern 4 — verified against zod.dev/v4):
```typescript
import * as z from 'zod';
import os from 'node:os';
import path from 'node:path';

export const ConfigSchema = z.object({
  mcpEndpoint:   z.string().url().default('http://localhost:4000'),
  mcpAuthToken:  z.string().optional(),
  walletAddress: z.string().optional(),
  serverPort:    z.number().int().min(1024).max(65535).default(4321),
  dataDir:       z.string().default(path.join(os.homedir(), '.chain-insights')),
  version:       z.string().default('1'),
});

export type InvestigatorConfig = z.infer<typeof ConfigSchema>;
export const DEFAULT_CONFIG: InvestigatorConfig = ConfigSchema.parse({});
```

**Note on Zod 4 import:** Use `import * as z from 'zod'` (namespace import), not `import { z } from 'zod'`. Zod 4 exports the namespace as the default export; the namespace import is the idiomatic form shown in zod.dev/v4 docs.

---

### `src/config/index.ts` (service, config CRUD)

**Analog:** `references/get-shit-done/sdk/src/config.ts` (CRUD section) — role-match

**GSD config load pattern** (lines 8–9, 100+ area — async readFile + merge with defaults):
```typescript
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigSchema, DEFAULT_CONFIG, type InvestigatorConfig } from './schema.js';

const CONFIG_PATH = path.join(os.homedir(), '.chain-insights', 'config.json');

let _cached: InvestigatorConfig | null = null;

export async function loadConfig(): Promise<InvestigatorConfig> {
  if (_cached) return _cached;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _cached = ConfigSchema.parse(parsed);   // Zod fills in any missing defaults
    return _cached;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(updates: Partial<InvestigatorConfig>): Promise<void> {
  const current = await loadConfig();
  const next = ConfigSchema.parse({ ...current, ...updates });
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  _cached = next;
}

export async function resetConfigCache(): Promise<void> {
  _cached = null;
}
```

**GSD test pattern for config** (from `config.test.ts` lines 1–34):
```typescript
// Override HOME env var to isolate real filesystem in tests
beforeEach(async () => {
  fakeHome = join(tmpdir(), `ci-config-test-${Date.now()}`);
  await mkdir(join(fakeHome, '.chain-insights'), { recursive: true });
  prevHome = process.env.HOME;
  process.env.HOME = fakeHome;
});
afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
  process.env.HOME = prevHome;
});
```
Chain Insights tests for `config/index.ts` must isolate `~/.chain-insights/` with this same `HOME` override technique.

---

### `src/db/init.ts` (service, DuckDB singleton + schema)

**No exact analog** — no DuckDB code exists in GSD reference. Use RESEARCH.md Pattern 3 (verified against DuckDB Neo client docs).

**Full pattern** (from RESEARCH.md Code Examples, lines 547–591):
```typescript
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DATA_DIR = path.join(os.homedir(), '.chain-insights');
const DB_PATH  = path.join(DATA_DIR, 'chain-insights.db');

let _instance: DuckDBInstance | null = null;

export async function getDb(): Promise<DuckDBConnection> {
  if (!_instance) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _instance = await DuckDBInstance.create(DB_PATH);
  }
  return _instance.connect();
}

export async function initSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id         VARCHAR PRIMARY KEY,
      name       VARCHAR NOT NULL,
      status     VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  // Additional domain tables added in Phase 3
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn   = await getDb();
    const reader = await conn.runAndReadAll('SELECT 1 AS ping');
    const rows   = reader.getRows();
    conn.closeSync();
    return { ok: rows.length === 1 };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

**Critical constraints:**
- `_instance` must be a module-level singleton — DuckDB holds a file lock per instance. Two instances on the same path throw `IO Error: Could not set lock on file`.
- Always `conn.closeSync()` (not `conn.close()`) in health check to avoid dangling connections.
- `DuckDBInstance.create(path)` is the Neo API — do NOT use `new DuckDB.Database()` (that is the deprecated callback-based package).

---

### `src/db/index.ts` (service, connection pool re-export)

**No exact analog** — companion to `init.ts`.

```typescript
// Re-exports the connection getter and init utilities for use by command handlers.
// Keeps `init.ts` focused on lifecycle; this file is the stable import surface.
export { getDb, initSchema, healthCheck } from './init.js';
```

In Phase 3, this file grows to expose typed query helpers (find case by id, etc.).

---

### `src/server/app.ts` (service, Hono app factory)

**No exact analog** — no Hono code in GSD reference. Use RESEARCH.md Pattern 2 (verified against Hono docs via Context7).

**Full pattern** (from RESEARCH.md Code Examples, lines 511–527):
```typescript
import { Hono } from 'hono';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
  app.get('/status', async (c) => {
    const { healthCheck } = await import('../db/index.js');
    const db = await healthCheck();
    return c.json({ database: db.ok ? 'healthy' : 'error', server: 'running' });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
```

**Error handling** — Hono's `app.onError()` is the central error handler. Register it once in `createApp()`. Individual route handlers should `throw` errors rather than catch and re-format them, so the central handler has full context.

---

### `src/server/index.ts` (service, server lifecycle)

**No exact analog** — companion to `app.ts`. Use RESEARCH.md Pattern 2.

**Full pattern** (from RESEARCH.md Code Examples, lines 529–543):
```typescript
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

export function startServer(port = 4321): () => void {
  const app    = createApp();
  const server = serve({
    fetch:    app.fetch,
    hostname: '127.0.0.1',   // localhost-only — REQUIRED; default is 0.0.0.0
    port,
  });

  console.log(`Chain Insights server running on http://127.0.0.1:${port}`);

  process.on('SIGINT',  () => { server.close(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });

  return () => server.close();
}
```

**Security constraint:** `hostname: '127.0.0.1'` is non-negotiable. Without it, `serve()` binds to `0.0.0.0` (all interfaces), making investigation data accessible on the local network.

---

### `skills/ci-status/SKILL.md` and `skills/ci-case/SKILL.md` (Claude Code skills)

**Analog:** `references/get-shit-done/commands/gsd/help.md` (lines 1–6) — role-match

**SKILL.md frontmatter format** (from GSD command source, lines 1–6):
```markdown
---
name: gsd:help
description: Show available GSD commands and usage guide
allowed-tools:
  - Read
---
```

Chain Insights adaptation — the installer's `copyCommandsAsClaudeSkills` transforms `commands/gsd/help.md` → `~/.claude/skills/gsd-help/SKILL.md` and converts the `name:` field. For chain-insights, source files already live in `skills/ci-*/SKILL.md` and are copied verbatim (no conversion step needed). The SKILL.md files bundled in the package are already in the target format:

```markdown
---
name: ci-status
description: "Show Chain Insights toolkit status, database health, and active cases"
allowed-tools:
  - Read
  - Bash
---

# /ci-status

Shows toolkit status: database health, active case, MCP connectivity.

## Usage

`/ci-status`

## What it does

1. Runs `chain-insights status` via Bash
2. Reads `.chain-insights/config.json` for MCP endpoint
3. Reports database connection and active case (if any)
```

**Key fields:**
- `name:` must match the invocation token exactly (e.g., `ci-status` → user types `/ci-status`)
- `allowed-tools:` is a YAML list, not a comma string
- Body is plain markdown — no XML tags, no agent-specific content

---

### `tests/*.test.ts` (Vitest unit + integration tests)

**Analog:** `references/get-shit-done/sdk/src/config.test.ts` and `sdk/src/cli.test.ts`

**Test file structure** (from `config.test.ts` lines 1–34 and `cli.test.ts` lines 1–18):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('<module under test>', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ci-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('<behavior description>', async () => {
    // arrange
    // act
    // assert
    expect(result).toEqual(expected);
  });
});
```

**Isolation pattern** — for tests touching `~/.chain-insights/`, override `process.env.HOME` in `beforeEach` and restore in `afterEach` (from `config.test.ts` lines 17–32). This prevents tests from writing to the real user home.

**Test naming:** Use `<module>.test.ts` collocated with source (GSD pattern) OR in a top-level `tests/` directory (RESEARCH.md recommended `tests/` for chain-insights, since the source tree uses index files). Follow RESEARCH.md layout: `tests/config.test.ts`, `tests/db.test.ts`, `tests/server.test.ts`, `tests/cli.test.ts`, `tests/installer.test.ts`.

---

### `vitest.config.ts` (test runner config)

**Analog:** `references/get-shit-done/vitest.config.ts` (lines 1–24) — exact match for structure

**GSD pattern** (lines 1–24):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          root: './sdk',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          root: './sdk',
          include: ['src/**/*.integration.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
```

**Chain Insights adaptation** — single-package (no `sdk/` subdirectory), simpler config:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.integration.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
```

---

## Shared Patterns

### CJS stdlib-only constraint for `bin/` scripts
**Source:** `references/get-shit-done/bin/install.js` lines 1–7
**Apply to:** `bin/install.js`, `bin/cli.js`

Both files must use only `require()` (CJS). No `import` statements. No npm dependencies. This is because `npx chain-insights` executes the bin entry before the package's `node_modules` is fully resolved. `bin/cli.js` bridges to the ESM dist via dynamic `import()`.

### ESM-safe package.json read in TypeScript source
**Source:** RESEARCH.md Pattern 5
**Apply to:** `src/cli.ts`

```typescript
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string; name: string };
```
Use `import.meta.url` not `__dirname`. tsdown's `shims: true` adds `__dirname` to CJS output but the TypeScript source should stay ESM-idiomatic.

### Async fs with `node:` prefix for stdlib imports
**Source:** `references/get-shit-done/sdk/src/config.ts` line 8, `sdk/src/cli.ts` lines 10–13
**Apply to:** All `src/**/*.ts` files

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
```
Always use the `node:` prefix for Node.js builtins. This is the TypeScript/ESM convention and avoids name collisions with npm packages.

### File permission hardening on sensitive files
**Source:** RESEARCH.md Security Domain (ASVS V5, line 717)
**Apply to:** `bin/install.js` (config.json creation), `src/config/index.ts` (saveConfig)

```javascript
// bin/install.js (CJS)
fs.chmodSync(configPath, 0o600);

// src/config/index.ts (TypeScript)
await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
```
Both `~/.chain-insights/config.json` and `~/.chain-insights/chain-insights.db` should be owner-readable only.

### HOME-isolation for filesystem tests
**Source:** `references/get-shit-done/sdk/src/config.test.ts` lines 13–33
**Apply to:** `tests/config.test.ts`, `tests/db.test.ts`

Override `process.env.HOME` in `beforeEach` to point at a `tmpdir()` subdirectory. Restore in `afterEach`. Clean up with `rm(tmpDir, { recursive: true, force: true })`. This prevents tests from touching the real `~/.chain-insights/`.

### Singleton module-level state pattern
**Source:** RESEARCH.md Pattern 3 + Pitfall 6
**Apply to:** `src/db/init.ts` (`_instance`), `src/config/index.ts` (`_cached`)

```typescript
let _instance: SomeType | null = null;

export async function getInstance(): Promise<SomeType> {
  if (!_instance) {
    _instance = await createExpensiveThing();
  }
  return _instance;
}
```
Module-level singletons are reset between test files by Vitest's module isolation. For tests that need a fresh singleton, use `vi.resetModules()` or export a `reset()` helper.

---

## No Analog Found

All files have analogs from the GSD reference or from RESEARCH.md verified patterns. The following have no in-codebase analog but have HIGH-confidence RESEARCH.md patterns verified against official docs:

| File | Role | Data Flow | Pattern Source |
|------|------|-----------|----------------|
| `src/db/init.ts` | service | CRUD | RESEARCH.md Pattern 3 — DuckDB Neo client docs (Context7 verified) |
| `src/db/index.ts` | service | CRUD | Companion to `init.ts` — re-export surface |
| `src/server/app.ts` | service | request-response | RESEARCH.md Pattern 2 — Hono Node.js adapter docs (Context7 verified) |
| `src/server/index.ts` | service | request-response | RESEARCH.md Pattern 2 — Hono graceful shutdown pattern |

---

## Metadata

**Analog search scope:** `references/get-shit-done/bin/`, `references/get-shit-done/sdk/src/`, `references/get-shit-done/commands/gsd/`, root `vitest.config.ts`
**Files scanned:** 8 analog files read (install.js, gsd-sdk.js, sdk/cli.ts, sdk/config.ts, sdk/config.test.ts, sdk/cli.test.ts, vitest.config.ts, commands/gsd/help.md)
**Pattern extraction date:** 2026-05-11
