# Phase 4: Money Flow Visualization - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 12 (6 new, 4 modified, 2 new test files)
**Analogs found:** 10 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/viz/index.ts` | service (public API) | transform | `src/cases/index.ts` | role-match |
| `src/viz/graph-model.ts` | model (schema) | transform | `src/cases/schema.ts` | exact |
| `src/viz/data-extractor.ts` | service | transform | `src/cases/evidence.ts` | role-match |
| `src/viz/html-generator.ts` | utility | file-I/O | `src/cases/evidence.ts` | partial |
| `src/viz/templates/viz-logic.ts` | utility (template) | transform | -- (no analog) | none |
| `src/viz/theme.ts` | config | transform | `src/config/schema.ts` | partial |
| `src/server/app.ts` (modify) | controller | request-response | `src/server/app.ts` (self) | exact |
| `src/cli.ts` (modify) | controller | request-response | `src/cli.ts` (self) | exact |
| `src/index.ts` (modify) | config (barrel export) | -- | `src/index.ts` (self) | exact |
| `package.json` (modify) | config | -- | `package.json` (self) | exact |
| `tests/viz-graph-model.test.ts` | test | -- | `tests/cases-evidence.test.ts` | role-match |
| `tests/viz-html-generator.test.ts` | test | -- | `tests/server.test.ts` | role-match |

## Pattern Assignments

### `src/viz/index.ts` (service, public API)

**Analog:** `src/cases/index.ts` (barrel export pattern)

**Imports pattern** (`src/cases/index.ts` lines 1-8):
```typescript
// Stable public surface for the cases module.
export { CaseStore, generateCaseId } from './store.js'
export { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
export { CaseSchema, EvidenceSchema, DossierSchema, SessionSchema, CaseStatusEnum } from './schema.js'
export type { Case, Evidence, Dossier, Session, CaseStatus } from './schema.js'
export { EvidenceStore } from './evidence.js'
export { DossierStore } from './dossier.js'
export { SessionStore } from './session.js'
```

**Core pattern:** This file serves dual purpose -- barrel exports for the `src/viz/` module AND the `generateVisualization()` orchestrator function. The orchestrator should follow the same async function pattern used in `CaseStore.create()` (`src/cases/store.ts` lines 30-71): accept a typed input, do file I/O, return a typed result.

**Orchestrator pattern** (adapted from `src/cases/store.ts` lines 30-40):
```typescript
// The viz index.ts should export:
// 1. Barrel exports: types, schemas, functions from submodules
// 2. Main orchestrator function
export async function generateVisualization(opts: {
  caseId?: string;
  dataFile?: string;
}): Promise<{ vizId: string; htmlPath: string }> {
  // Pattern: validate input -> extract/load data -> transform -> write file -> return result
}
```

---

### `src/viz/graph-model.ts` (model/schema, transform)

**Analog:** `src/cases/schema.ts`

**Imports pattern** (`src/cases/schema.ts` line 1):
```typescript
import * as z from 'zod'
```

**Core schema pattern** (`src/cases/schema.ts` lines 1-20):
```typescript
import * as z from 'zod'

// Case ID format: YYYYMMDD_NNN_slug (e.g. 20260511_001_tornado-mixer)
// Regex rejects path traversal chars (../, shell chars) per T-03-01 threat model.
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/

export const CaseStatusEnum = z.enum(['open', 'active', 'suspended', 'closed'])
export type CaseStatus = z.infer<typeof CaseStatusEnum>

export const CaseSchema = z.object({
  id:          z.string().regex(caseIdRegex, 'Invalid case ID format'),
  name:        z.string().min(1).max(200),
  status:      CaseStatusEnum.default('open'),
  created:     z.string().datetime(),
  updated:     z.string().datetime(),
  tags:        z.array(z.string()).default([]),
  description: z.string().default(''),
  slug:        z.string().optional(),
})
export type Case = z.infer<typeof CaseSchema>
```

**Key conventions to copy:**
- `import * as z from 'zod'` (namespace import, not destructured)
- Enums defined as `z.enum([...])` with separate `export type` using `z.infer<>`
- Schema objects use aligned colons for readability
- Regex validation inline with descriptive error messages
- Defaults provided via `.default()`
- Type exports colocated with schema exports: `export type X = z.infer<typeof XSchema>`

---

### `src/viz/data-extractor.ts` (service, transform)

**Analog:** `src/cases/evidence.ts`

**Imports pattern** (`src/cases/evidence.ts` lines 1-5):
```typescript
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { serializeFrontmatter } from './frontmatter.js'
```

**Directory resolution pattern** (`src/cases/evidence.ts` lines 7-8):
```typescript
function caseDir(caseId: string): string {
  return path.join(os.homedir(), '.chain-insights', 'cases', caseId)
}
```

**Core file reading pattern** (`src/cases/dossier.ts` lines 85-105, `DossierStore.listSummaries`):
```typescript
async listSummaries(caseId: string): Promise<Array<{ address: string; type: string; ... }>> {
  const dossierDir = path.join(caseDir(caseId), 'dossiers')
  try {
    const files = await readdir(dossierDir)
    const summaries = []
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const raw = await readFile(path.join(dossierDir, file), 'utf8')
      const { frontmatter } = parseFrontmatter(raw)
      summaries.push({
        address: frontmatter['address'] ?? file.replace('.md', ''),
        type: frontmatter['type'] ?? 'unknown',
        // ...
      })
    }
    return summaries
  } catch {
    return []
  }
}
```

**Key conventions to copy:**
- Export as object literal with methods (`export const DataExtractor = { ... }`) following `EvidenceStore` and `DossierStore` patterns
- Use `readFile` from `node:fs/promises` for all file reads
- Graceful fallback with `try/catch` returning empty arrays/defaults on missing directories
- Parse frontmatter from evidence markdown files to extract structured data
- Path construction via `os.homedir()` + `.chain-insights/cases/<id>/` helper function

---

### `src/viz/html-generator.ts` (utility, file-I/O)

**Analog:** `src/cases/evidence.ts` (file write pattern)

**File write pattern** (`src/cases/evidence.ts` lines 70-83):
```typescript
// Write with exclusive flag to prevent sequence collision (Pitfall 4)
const filePath = path.join(evidenceDir, filename)
try {
  await writeFile(filePath, fileContent, { mode: 0o600, flag: 'wx' })
} catch (err: unknown) {
  const e = err as NodeJS.ErrnoException
  if (e.code === 'EEXIST') {
    // Retry with timestamp-unique suffix
    filename = `${seqStr}_${safeSource}_${timestamp}_${Math.random().toString(36).slice(2, 6)}.md`
    await writeFile(path.join(evidenceDir, filename), fileContent, { mode: 0o600, flag: 'wx' })
  } else {
    throw err
  }
}
```

**Directory creation pattern** (`src/cases/store.ts` lines 41-42):
```typescript
const dir = caseDir(id)
await mkdir(path.join(dir, 'evidence'), { recursive: true })
```

**Key conventions to copy:**
- `mkdir` with `{ recursive: true }` before writing files
- File permissions `{ mode: 0o600 }` for user data (all case files use this)
- `import.meta.dirname` for resolving paths relative to module location (used in `src/cli.ts` line 13: `const __dirname = path.dirname(fileURLToPath(import.meta.url))`)
- For reading `d3.min.js` from `node_modules`, use `createRequire(import.meta.url).resolve('d3/dist/d3.min.js')` pattern from RESEARCH.md Pitfall 1

---

### `src/viz/templates/viz-logic.ts` (utility/template, transform)

**No analog found.** This file contains client-side D3 JavaScript as a template literal string -- a pattern that does not exist in the codebase. Use RESEARCH.md Patterns 2-5 (D3 force, tree, zoom, drag) as the reference.

---

### `src/viz/theme.ts` (config, transform)

**Analog:** `src/config/schema.ts` (partial -- constants pattern)

**Constants pattern** (`src/config/schema.ts` lines 1-15):
```typescript
import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'

export const ConfigSchema = z.object({
  mcpEndpoint:   z.string().url().default('http://localhost:4000'),
  // ...
})

export type InvestigatorConfig = z.infer<typeof ConfigSchema>
export const DEFAULT_CONFIG: InvestigatorConfig = ConfigSchema.parse({})
```

**Key conventions to copy:**
- Export constants as typed `const` objects
- Use Zod for type definitions where validation is needed
- For pure config/constants (CSS variables, color mappings), simple `export const` objects suffice without Zod

---

### `src/server/app.ts` (modify -- add /viz/:id route)

**Self-analog:** `src/server/app.ts` lines 1-23

**Existing route pattern** (lines 6-15):
```typescript
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.get('/status', async (c) => {
  const { healthCheck } = await import('../db/index.js')
  const db = await healthCheck()
  return c.json({
    database: db.ok ? 'healthy' : 'error',
    server: 'running',
  })
})
```

**Error handler pattern** (lines 17-20):
```typescript
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
```

**Key conventions to copy:**
- Routes use `c.json()` for JSON responses, `c.html()` for HTML responses
- Dynamic imports inside route handlers (`await import(...)`) for lazy loading
- Error responses as `c.json({ error: '...' }, statusCode)`
- New `/viz/:id` route should be added BEFORE `app.onError()` (the error handler is last)
- Input validation with regex before path construction (per RESEARCH.md security: `if (!/^[a-zA-Z0-9_-]+$/.test(id))`)

---

### `src/cli.ts` (modify -- add viz subcommand)

**Self-analog:** `src/cli.ts` lines 37-43 (`serve` command) and lines 196-218 (`case open` command)

**Simple subcommand pattern** (lines 37-43):
```typescript
program
  .command('serve')
  .description('Start local visualization server')
  .option('-p, --port <number>', 'Port to bind (default: 4321)', '4321')
  .action(async (opts: { port: string }) => {
    const { startServer } = await import('./server/index.js')
    startServer(parseInt(opts.port, 10))
  })
```

**Subcommand with argument + options + error handling** (lines 196-218):
```typescript
new Command('open')
  .description('Open a new investigation case')
  .argument('<name>', 'Case name (e.g. "Tornado Mixer Investigation")')
  .option('--tags <tags>', 'Comma-separated tags (e.g. aml,mixer,defi)', '')
  .option('--description <desc>', 'Brief description of the investigation', '')
  .action(async (name: string, opts: { tags: string; description: string }) => {
    try {
      // Dynamic imports
      const { getDb, initSchema } = await import('./db/init.js')
      const { CaseStore } = await import('./cases/index.js')
      // ... work ...
      console.log(`Case opened: ${c.id}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
```

**Key conventions to copy:**
- Dynamic imports (`await import(...)`) inside action handlers for lazy loading
- Error handling: `try/catch` with `console.error((err as Error).message)` + `process.exit(1)`
- Options typed explicitly in the action signature: `(opts: { data?: string; port: string })`
- `program.command('viz')` at top level (like `serve`, `status`, `config`, `mcp`, `case`)
- Optional argument syntax: `.argument('[case-id]', 'Case ID to visualize')`

---

### `src/index.ts` (modify -- add viz exports)

**Self-analog:** `src/index.ts` lines 1-10

**Barrel export pattern** (lines 1-10):
```typescript
// Public API surface for programmatic use.
// CLI users go through bin/cli.js -> dist/cli.js.
export { loadConfig, saveConfig, resetConfigCache } from './config/index.js'
export { getDb, initSchema, healthCheck } from './db/index.js'
export { createApp } from './server/app.js'
export { startServer } from './server/index.js'
export type { InvestigatorConfig } from './config/schema.js'
export { encryptKey, decryptKey, isWalletConfigured } from './wallet/index.js'
export { createMcpFetchClient } from './mcp/client.js'
```

**Key conventions to copy:**
- Named exports with explicit re-export syntax
- Type-only exports with `export type`
- Comment explaining the module's purpose
- Add: `export { generateVisualization } from './viz/index.js'` and relevant type exports

---

### `tests/viz-graph-model.test.ts` (test)

**Analog:** `tests/cases-evidence.test.ts`

**Test structure pattern** (`tests/cases-evidence.test.ts` lines 1-8, 37-48):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, stat, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

describe('EvidenceStore (CASE-02)', () => {
  let fakeHome: string
  let prevHome: string | undefined
  // ...
```

**Test isolation pattern** (`tests/cases-evidence.test.ts` lines 11-35):
```typescript
beforeEach(async () => {
  vi.resetModules()
  fakeHome = join(tmpdir(), `ci-evidence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
  prevHome = process.env['HOME']
  process.env['HOME'] = fakeHome
  // ...
})

afterEach(async () => {
  process.env['HOME'] = prevHome
  await rm(fakeHome, { recursive: true, force: true })
  vi.resetModules()
})
```

**Key conventions to copy:**
- `describe('FeatureName (REQ-ID)', () => { ... })` -- requirement ID in describe block
- `vi.resetModules()` in beforeEach/afterEach for clean dynamic import state
- Fake HOME directory with tmpdir for filesystem isolation
- Dynamic imports inside test bodies: `const { Module } = await import('../src/module/index.js')`
- Cleanup via `rm(fakeHome, { recursive: true, force: true })` in afterEach
- Graph model tests do NOT need HOME override (pure schema validation) -- simpler pattern like `tests/cli.test.ts`

**Simple test pattern** (`tests/cli.test.ts` lines 1-8):
```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('CLI scaffold (FOUND-02)', () => {
  it('--help prints chain-insights name', () => {
    const out = execSync('node bin/cli.js --help', { encoding: 'utf8' })
    expect(out).toContain('chain-insights')
  })
```

---

### `tests/viz-html-generator.test.ts` (test)

**Analog:** `tests/server.test.ts`

**Server test pattern** (`tests/server.test.ts` lines 1-18):
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
    // Allow server to bind
    await new Promise(resolve => setTimeout(resolve, 100))
    const res = await fetch('http://127.0.0.1:14321/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
```

**Key conventions to copy:**
- Server lifecycle: start in test, stop in afterEach
- Unique port per test file (14321, 14322...) -- use 14400+ range for viz tests
- `await new Promise(resolve => setTimeout(resolve, 100))` for server bind wait
- Direct `fetch()` for HTTP assertions
- Type cast response bodies: `await res.json() as { ... }`

---

## Shared Patterns

### Dynamic Imports (Lazy Loading)
**Source:** `src/cli.ts` (used throughout, e.g. lines 41, 49-50, 114-116)
**Apply to:** `src/cli.ts` viz command action, `src/server/app.ts` viz route, `src/viz/index.ts` orchestrator
```typescript
// Dynamic import pattern used everywhere in CLI actions:
const { generateVisualization } = await import('./viz/index.js')
const { startServer } = await import('./server/index.js')
const open = (await import('open')).default
```

### Error Handling (CLI)
**Source:** `src/cli.ts` (lines 213-217, repeated in every command action)
**Apply to:** All new CLI action handlers
```typescript
try {
  // ... work ...
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
```

### File Permissions
**Source:** `src/cases/evidence.ts` (line 73), `src/cases/store.ts` (line 55), `src/cases/dossier.ts` (line 69)
**Apply to:** `src/viz/html-generator.ts` when writing HTML files
```typescript
await writeFile(filePath, content, { mode: 0o600 })
```

### Directory Helper Functions
**Source:** `src/cases/evidence.ts` (lines 7-9), `src/cases/store.ts` (lines 8-12), `src/cases/dossier.ts` (lines 7-9)
**Apply to:** `src/viz/data-extractor.ts`, `src/viz/html-generator.ts`
```typescript
function caseDir(caseId: string): string {
  return path.join(os.homedir(), '.chain-insights', 'cases', caseId)
}
```

### Input Sanitization
**Source:** `src/cases/schema.ts` (line 5 -- caseIdRegex), `src/cases/evidence.ts` (lines 11-13 -- sanitizeSource), `src/cases/dossier.ts` (lines 12-14 -- sanitizeAddress)
**Apply to:** Viz ID validation in `src/server/app.ts`, data file path validation in `src/viz/data-extractor.ts`
```typescript
// Case ID regex from src/cases/schema.ts line 5:
const caseIdRegex = /^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/

// Sanitize pattern from src/cases/evidence.ts lines 11-13:
function sanitizeSource(source: string): string {
  return source.replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
}

// For viz route: validate viz ID with regex before path construction
if (!/^[a-zA-Z0-9_-]+$/.test(vizId)) {
  return c.json({ error: 'Invalid visualization ID' }, 400)
}
```

### Zod Schema Convention
**Source:** `src/cases/schema.ts` (lines 1-20), `src/config/schema.ts` (lines 1-15)
**Apply to:** `src/viz/graph-model.ts`
```typescript
import * as z from 'zod'

// Convention: namespace import, enum first, then schema objects, then type exports
export const EntityType = z.enum(['eoa', 'contract', 'exchange', 'mixer', 'unknown'])
export type EntityType = z.infer<typeof EntityType>
```

### Test Isolation with Fake HOME
**Source:** `tests/cases-evidence.test.ts` (lines 11-35)
**Apply to:** `tests/viz-html-generator.test.ts`, `tests/viz-data-extractor.test.ts` (any test that reads/writes to `~/.chain-insights/`)
```typescript
let fakeHome: string
let prevHome: string | undefined

beforeEach(async () => {
  vi.resetModules()
  fakeHome = join(tmpdir(), `ci-viz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(join(fakeHome, '.chain-insights'), { recursive: true })
  prevHome = process.env['HOME']
  process.env['HOME'] = fakeHome
})

afterEach(async () => {
  process.env['HOME'] = prevHome
  await rm(fakeHome, { recursive: true, force: true })
  vi.resetModules()
})
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/viz/templates/viz-logic.ts` | utility (template) | transform | No client-side JavaScript template pattern exists in the codebase. This file exports a template literal string containing D3 v7 client-side code (force simulation, tree layout, zoom, drag, tooltips). Use RESEARCH.md Patterns 2-5 and Code Examples for D3 API patterns. |

## Metadata

**Analog search scope:** `src/`, `tests/`
**Files scanned:** 34 (19 source + 15 test)
**Pattern extraction date:** 2026-05-11
