# Phase 3: Case Management - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cases/schema.ts` | model | transform | `src/config/schema.ts` | exact |
| `src/cases/frontmatter.ts` | utility | transform | `references/get-shit-done/sdk/src/query/frontmatter.ts` | exact |
| `src/cases/store.ts` | service | CRUD + file-I/O | `src/config/index.ts` | exact |
| `src/cases/evidence.ts` | service | file-I/O + batch | `src/wallet/index.ts` | role-match |
| `src/cases/dossier.ts` | service | file-I/O + CRUD | `src/config/index.ts` | role-match |
| `src/cases/session.ts` | service | file-I/O + batch | `src/config/index.ts` | role-match |
| `src/cases/index.ts` | utility | transform | `src/db/index.ts` | exact |
| `src/db/init.ts` | service | CRUD | `src/db/init.ts` (self-evolve) | exact |
| `src/cli.ts` | controller | request-response | `src/cli.ts` (self-evolve) | exact |
| `tests/cases-*.test.ts` (5 files) | test | file-I/O | `tests/config.test.ts`, `tests/db.test.ts` | exact |

---

## Pattern Assignments

### `src/cases/schema.ts` (model, transform)

**Analog:** `src/config/schema.ts`

**Imports pattern** (`src/config/schema.ts` lines 1-3):
```typescript
import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'
```

**Core Zod schema pattern** (`src/config/schema.ts` lines 5-15):
```typescript
export const ConfigSchema = z.object({
  mcpEndpoint:   z.string().url().default('http://localhost:4000'),
  mcpAuthToken:  z.string().optional(),
  walletAddress: z.string().optional(),
  serverPort:    z.number().int().min(1024).max(65535).default(4321),
  dataDir:       z.string().default(path.join(os.homedir(), '.chain-insights')),
  version:       z.string().default('1'),
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>
export const DEFAULT_CONFIG: InvestigatorConfig = ConfigSchema.parse({})
```

**Apply:** Define `CaseSchema`, `EvidenceSchema`, `DossierSchema`, `SessionSchema` using the same `z.object()` → `z.infer<typeof XSchema>` pattern. Use `z.string().regex(/^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/)` for case ID validation per the security threat model. Use `z.enum(['open', 'active', 'suspended', 'closed'])` for status. Export named type aliases alongside each schema.

---

### `src/cases/frontmatter.ts` (utility, transform)

**Analog:** `references/get-shit-done/sdk/src/query/frontmatter.ts`

**Minimal hand-rolled parser pattern** (from `03-RESEARCH.md` — verified against GSD reference):
```typescript
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter: fm, body: m[2] };
}

export function serializeFrontmatter(fm: Record<string, string>, body: string): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${lines}\n---\n${body}`;
}
```

**Key constraint:** All values are flat strings. Store arrays (tags, riskTags) as comma-separated strings (`tags: aml,mixer,defi`). Parse them back with `split(',').map(t => t.trim())`. This sidesteps Pitfall 3 (YAML array round-trip loss). The GSD reference parser (`references/get-shit-done/sdk/src/query/frontmatter.ts`) is far more complex — do NOT copy it. The minimal two-function version in RESEARCH.md is the correct implementation for Phase 3.

---

### `src/cases/store.ts` (service, CRUD + file-I/O)

**Analog:** `src/config/index.ts`

**Imports pattern** (`src/config/index.ts` lines 1-4):
```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConfigSchema, DEFAULT_CONFIG, type InvestigatorConfig } from './schema.js'
```

**Module-level singleton / cache pattern** (`src/config/index.ts` lines 7-11):
```typescript
// Config path derived from HOME at call time so tests can override HOME.
function configPath(): string {
  return path.join(os.homedir(), '.chain-insights', 'config.json')
}

let _cached: InvestigatorConfig | null = null
```

**File read with ENOENT fallback** (`src/config/index.ts` lines 13-23):
```typescript
export async function loadConfig(): Promise<InvestigatorConfig> {
  if (_cached) return _cached
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    _cached = ConfigSchema.parse(parsed)
    return _cached
  } catch {
    return DEFAULT_CONFIG
  }
}
```

**File write with mkdir + permissions** (`src/config/index.ts` lines 25-32):
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

**Reset for test isolation** (`src/config/index.ts` lines 34-36):
```typescript
export async function resetConfigCache(): Promise<void> {
  _cached = null
}
```

**DuckDB singleton reuse** (`src/db/init.ts` lines 16-26):
```typescript
let _instance: DuckDBInstance | null = null

export async function getDb(): Promise<DuckDBConnection> {
  if (!_instance) {
    fs.mkdirSync(dataDir(), { recursive: true })
    _instance = await DuckDBInstance.create(dbPath())
    fs.chmodSync(dbPath(), 0o600)
  }
  return _instance.connect()
}
```

**DuckDB prepared statement pattern** (from `03-RESEARCH.md` — verified):
```typescript
// $name parameters, NOT ?. bind() takes a dict. destroySync() after use.
const stmt = await conn.prepare('INSERT INTO cases VALUES ($id, $name, $status, $created_at, $updated_at, $tags, $description, $slug)');
await stmt.bind({ id, name, status, created_at, updated_at, tags, description, slug });
await stmt.run();
stmt.destroySync();
```

**Always close conn in finally** (from Phase 2 code review — WR-03 pattern in `src/mcp/proxy.ts`):
```typescript
// From src/mcp/proxy.ts lines 131-138 (mcp tools action):
try {
  const result = await client.listTools()
  // ... use result
} finally {
  await client.close()
}
```

Apply the same `finally { conn.closeSync() }` to all DuckDB connections opened in `store.ts`.

---

### `src/cases/evidence.ts` (service, file-I/O + batch)

**Analog:** `src/wallet/index.ts`

**Imports pattern** (`src/wallet/index.ts` lines 1-4):
```typescript
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
```

**ENOENT-safe file read** (`src/wallet/index.ts` lines 68-79):
```typescript
try {
  raw = await readFile(walletPath(), 'utf8')
} catch (err: unknown) {
  const nodeErr = err as NodeJS.ErrnoException
  if (nodeErr.code === 'ENOENT') {
    throw new Error('Wallet not configured. Run ...')
  }
  throw err
}
```

**SHA-256 hash + manifest append pattern** (from `03-RESEARCH.md` — verified):
```typescript
import { createHash } from 'node:crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function appendToManifest(manifestPath: string, entry: { file: string; sha256: string }): Promise<void> {
  const existing = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{"entries":[]}'));
  existing.entries.push(entry);
  await writeFile(manifestPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 });
}
```

**Exclusive write to prevent sequence collision** (Pitfall 4 mitigation):
```typescript
// Use { flag: 'wx' } to fail if file exists — retry with incremented sequence
await writeFile(evidencePath, content, { mode: 0o600, flag: 'wx' });
```

**File permissions:** All writes use `{ mode: 0o600 }` matching `src/wallet/index.ts` line 58.

---

### `src/cases/dossier.ts` (service, file-I/O + CRUD)

**Analog:** `src/config/index.ts`

Same imports, path-resolution, and read/write pattern as `store.ts`. Key differences:

**Content-hash deduplication** (from `03-RESEARCH.md`):
```typescript
import { createHash } from 'node:crypto';

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
// Before append: check if hash already present in dossier body sections
```

**Address sanitization** (security threat model from RESEARCH.md):
```typescript
// Sanitize address before using as filename — prevent path traversal
const safeAddr = address.replace(/[^a-zA-Z0-9]/g, '').slice(0, 66);
const dossierPath = path.join(caseDir, 'dossiers', `${safeAddr}.md`);
```

**ENOENT → create pattern** (create dossier if absent, append if present):
```typescript
let content: string;
try {
  content = await readFile(dossierPath, 'utf8');
} catch (err: unknown) {
  const nodeErr = err as NodeJS.ErrnoException;
  if (nodeErr.code !== 'ENOENT') throw err;
  content = ''; // will be initialized with template
}
```

---

### `src/cases/session.ts` (service, file-I/O + batch)

**Analog:** `src/config/index.ts` + `src/wallet/index.ts`

Same imports and file I/O pattern. Key specific pattern:

**ENOENT-safe history.md append** (Pitfall 5 mitigation from RESEARCH.md):
```typescript
// history.md may not exist on first archive — treat absent as empty
const existing = await readFile(historyPath, 'utf8').catch(() => '');
```

**Rolling window archival:** Count `session_NNN.md` files, delete oldest beyond 5, compress to `history.md`. Sort session files by sequence number extracted from filename.

---

### `src/cases/index.ts` (utility, transform — public exports)

**Analog:** `src/db/index.ts`

**Barrel export pattern** (`src/db/index.ts` line 3):
```typescript
// Stable import surface for the DB module. Keeps init.ts focused on lifecycle.
export { getDb, initSchema, healthCheck, resetDbInstance } from './init.js'
```

Apply the same pattern: `export { CaseStore, ... } from './store.js'`, etc.

---

### `src/db/init.ts` (service, CRUD — evolve existing file)

**Analog:** `src/db/init.ts` (self-evolve)

**Existing `initSchema` function** (`src/db/init.ts` lines 28-37) to extend:
```typescript
export async function initSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id         VARCHAR PRIMARY KEY,
      name       VARCHAR NOT NULL,
      status     VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}
```

**Add `migrateCasesTable()` call inside `initSchema`** (from `03-RESEARCH.md` — verified against live DB):
```typescript
export async function migrateCasesTable(conn: DuckDBConnection): Promise<void> {
  const r = await conn.runAndReadAll(
    "SELECT column_name FROM information_schema.columns WHERE table_name='cases'"
  );
  const existing = new Set(r.getRows().map((row: unknown[]) => row[0] as string));
  const additions: Array<[string, string]> = [
    ['updated_at', 'TIMESTAMPTZ'],
    ['tags', 'VARCHAR[]'],
    ['description', 'VARCHAR'],
    ['slug', 'VARCHAR'],
  ];
  for (const [col, type] of additions) {
    if (!existing.has(col)) {
      await conn.run(`ALTER TABLE cases ADD COLUMN ${col} ${type}`);
    }
  }
}
```

**healthCheck pattern** (`src/db/init.ts` lines 39-50) — shows conn close in finally context:
```typescript
export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const conn   = await getDb()
    await initSchema(conn)
    const reader = await conn.runAndReadAll('SELECT 1 AS ping')
    const rows   = reader.getRows()
    conn.closeSync()
    return { ok: rows.length === 1 }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

Note: `healthCheck` closes conn in the happy path explicitly. For operations that can throw, use `try/finally { conn.closeSync() }` instead to ensure close on error paths.

---

### `src/cli.ts` (controller, request-response — evolve existing file)

**Analog:** `src/cli.ts` (self-evolve)

**Nested subcommand group pattern** (`src/cli.ts` lines 105-145):
```typescript
program
  .command('mcp')
  .description('Interact with the Chain Insights MCP endpoint')
  .addCommand(
    new Command('tools')
      .description('List available MCP tools (cached 24h)')
      .option('--refresh', 'Force refresh schema cache')
      .action(async (opts: { refresh?: boolean }) => {
        try {
          // ... dynamic imports after option check
        } catch (err) {
          console.error((err as Error).message)
          process.exit(1)
        }
      })
  )
  .addCommand(
    new Command('call')
      .description('Call an MCP tool directly (debug)')
      .argument('<tool>', 'Tool name to call')
      // ...
  )
```

**Dynamic import in action handler** (`src/cli.ts` lines 40-43):
```typescript
.action(async (opts: { port: string }) => {
  const { startServer } = await import('./server/index.js')
  startServer(parseInt(opts.port, 10))
})
```

**Error handling in action** (`src/cli.ts` lines 141-144):
```typescript
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
```

**Add `case` subcommand group** using `program.command('case').description(...).addCommand(new Command('open')...)` following the same `mcp` pattern. Each sub-action does a dynamic import of the relevant `src/cases/*.js` module.

---

## Shared Patterns

### File Permissions
**Source:** `src/config/index.ts` line 30, `src/wallet/index.ts` line 58
**Apply to:** All file writes in `src/cases/` — evidence, dossiers, sessions, case.md, manifest.json
```typescript
await writeFile(p, content, { mode: 0o600 })
```

### Path Resolution (HOME-derived, test-overridable)
**Source:** `src/config/index.ts` lines 7-9, `src/db/init.ts` lines 7-9
**Apply to:** All path functions in `src/cases/`
```typescript
// Derive path at call time — NOT at module load — so tests can override HOME
function caseDir(caseId: string): string {
  return path.join(os.homedir(), '.chain-insights', 'cases', caseId)
}
```

### Error Handling (ENOENT)
**Source:** `src/wallet/index.ts` lines 68-79
**Apply to:** All file reads in `src/cases/`
```typescript
} catch (err: unknown) {
  const nodeErr = err as NodeJS.ErrnoException
  if (nodeErr.code === 'ENOENT') { /* handle missing file */ }
  throw err
}
```

### Zod Parse Pattern
**Source:** `src/config/index.ts` lines 17-18
**Apply to:** All input validation in store/evidence/dossier/session
```typescript
const parsed = JSON.parse(raw) as unknown
_cached = ConfigSchema.parse(parsed)
```

### DuckDB Conn Close in Finally
**Source:** `src/db/init.ts` lines 39-50 (healthCheck), Phase 2 WR-03
**Apply to:** All DuckDB operations in `src/cases/store.ts`
```typescript
const conn = await getDb()
try {
  // ... query
} finally {
  conn.closeSync()
}
```

---

## Test Pattern Assignments

### All `tests/cases-*.test.ts` files

**Analog:** `tests/config.test.ts` (primary), `tests/db.test.ts` (for DuckDB isolation)

**Test isolation pattern** (`tests/config.test.ts` lines 1-20):
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

**Dynamic import after HOME override** (`tests/config.test.ts` lines 22-26):
```typescript
it('returns DEFAULT_CONFIG when config file absent', async () => {
  // Dynamic import after HOME override so config path resolves to fakeHome
  const { loadConfig, resetConfigCache } = await import('../src/config/index.js')
  await resetConfigCache()
  const config = await loadConfig()
```

**DuckDB variant** — use `vi.resetModules()` between tests or set unique `fakeHome` per test run so DuckDB sees a different DB path and avoids file lock collision (`tests/db.test.ts` lines 10-15):
```typescript
beforeEach(async () => {
  fakeHome = join(tmpdir(), `ci-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(fakeHome, { recursive: true })
  prevHome = process.env['HOME']
  process.env['HOME'] = fakeHome
})
```

**File permission assertion** (`tests/config.test.ts` lines 40-46):
```typescript
it('saveConfig writes file with 0o600 permissions', async () => {
  // ...
  const st = await stat(join(fakeHome, '.chain-insights', 'config.json'))
  expect((st.mode & 0o777).toString(8)).toBe('600')
})
```

**Apply the same pattern to all five `tests/cases-*.test.ts` files.** Each must:
1. Set `fakeHome` with unique suffix in `beforeEach`
2. Use dynamic imports after `process.env['HOME']` override
3. Export a `reset*` function from the module under test for cache busting
4. Clean up with `rm(fakeHome, { recursive: true, force: true })` in `afterEach`

---

## No Analog Found

All files have close analogs in the codebase. No entries needed here.

---

## Metadata

**Analog search scope:** `src/`, `tests/`, `references/get-shit-done/sdk/src/query/`
**Files scanned:** 13 source files, 10 test files, 1 GSD reference file
**Pattern extraction date:** 2026-05-11
