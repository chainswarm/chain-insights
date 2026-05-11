# Phase 3: Case Management - Research

**Researched:** 2026-05-11
**Domain:** File-based investigation state management, DuckDB schema evolution, Node.js crypto, Commander.js CLI
**Confidence:** HIGH

## Summary

Phase 3 delivers the persistent state layer for all investigation work. The architecture is entirely
within the existing stack — no new runtime dependencies are needed. The implementation is a
composition of five established codebase patterns: (1) the config module's file-based
read/write/cache pattern extended to per-case directories, (2) the DuckDB singleton's
`information_schema`-driven migration approach to evolve the existing `cases` table, (3) Node.js
built-in `crypto.createHash('sha256')` for evidence integrity, (4) a hand-rolled YAML frontmatter
parser (matching the GSD reference approach), and (5) Commander.js `.addCommand()` nested
subcommand groups (matching the `mcp` subcommand pattern already in `src/cli.ts`).

The DuckDB database already exists on the developer's machine with the `cases` table from Phase 1
(four columns: id, name, status, created\_at). Phase 3 must migrate this table by adding
`updated_at`, `tags`, `description`, and `slug` columns — using the
`information_schema.columns`-based safe-migration pattern verified in this session.

All source of truth lives in flat files. DuckDB is an analytical index only. SHA-256 integrity is
via `manifest.json` per case. Per-entity dossiers accumulate findings with content-hash
deduplication. Session memory uses a rolling window of five full session files plus a compressed
`history.md`.

**Primary recommendation:** Build `src/cases/` as a self-contained module (store, schema, CLI
action handlers), integrate it into `src/cli.ts` via one `addCommand()` call, and evolve
`src/db/init.ts` with an idempotent schema migration applied at startup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Case Storage and Lifecycle**
- Case data lives in `~/.chain-insights/cases/<case-id>/` — per-case directories under the global config dir
- Case ID format: `{YYYYMMDD}_{NNN}_{slug}` (e.g., `20260511_001_tornado-mixer`)
- Case state stored as `case.md` with YAML frontmatter (id, name, status, created, updated, tags)
- DuckDB `cases` table is an index only — flat files are source of truth
- Case lifecycle: open → active → suspended → closed via `chain-insights case open/activate/suspend/close`

**Evidence Store Design**
- Each evidence entry is a separate markdown file in `<case-dir>/evidence/`
- Evidence file naming: `{NNN}_{source}_{timestamp}.md` (e.g., `001_mcp-query_20260511T1423.md`)
- Evidence metadata in YAML frontmatter: source, timestamp, case ID, query parameters, response summary
- Single `manifest.json` per case maps each evidence file to its SHA-256 hash — append-only, verified on case resume

**Dossier System**
- One markdown file per entity in `<case-dir>/dossiers/` (e.g., `dossiers/0x1234abcd.md`)
- Dossier structure: YAML frontmatter (entity address, type, first/last seen, risk tags) + sections: Summary, Findings (append-only), Links to Evidence, Related Entities
- Content-hash deduplication — SHA-256 the content and skip if already present
- Case-local only in v1

**Investigation Memory**
- Structured markdown `session.md` per session with YAML frontmatter (session ID, start/end time, status) + body (investigation log, key findings, next steps)
- Persists summaries, NOT raw MCP responses
- Context restoration on case resume: `case.md` + latest session file + all dossier summaries
- Rolling window — keep last 5 full session files; older sessions compressed to one-paragraph in `history.md`

### Claude's Discretion
- Internal implementation of SHA-256 hashing and manifest management
- DuckDB schema for the cases index table (may evolve existing `cases` table from Phase 1)
- CLI subcommand structure and option flags
- Error handling and validation details
- Test strategy (unit vs integration split)

### Deferred Ideas (OUT OF SCOPE)
- Cross-case entity search via DuckDB (v2 scope)
- HTML-formatted evidence files as alternative to markdown
- Spending tracking per case (MCPOPT-02 in v2 requirements)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CASE-01 | Case lifecycle — open, activate, suspend, close via slash commands, state persisted in flat files | Commander.js `case` subcommand group (addCommand pattern); case.md YAML frontmatter; DuckDB index sync; case ID generation algorithm verified |
| CASE-02 | Evidence store — append-only evidence files with SHA-256 integrity manifest | Node.js `crypto.createHash('sha256')` verified; manifest.json append pattern verified; evidence filename format tested |
| CASE-03 | Dossier system — per-entity findings accumulated across sessions in markdown | Content-hash dedup via SHA-256 verified; frontmatter parse/serialize pattern verified (no dependency); dossier markdown structure defined |
| CASE-04 | Investigation memory — per-case context persistence across conversations, restored on resume | Rolling session window logic verified; context restoration order defined (case.md + latest session + dossier summaries) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Case lifecycle management (open/activate/suspend/close) | CLI / Node.js | Filesystem + DuckDB index | Commands are local; state lives in flat files with DuckDB as analytical index |
| Evidence store | Filesystem | DuckDB evidence_index table | Flat files are source of truth; DuckDB enables cross-case queries later |
| Dossier accumulation | Filesystem | — | Per-case markdown; no analytical queries in v1 |
| Investigation memory / session state | Filesystem | — | session.md files; rolling window logic is pure file I/O |
| SHA-256 integrity verification | Node.js crypto (built-in) | — | No library needed; crypto module available since Node 0.x |
| Schema migration (cases table) | DuckDB via init.ts | — | Evolve existing Phase 1 table using information_schema-based safe migration |
| CLI surface | Commander.js | src/cli.ts | Matches existing `mcp` subcommand group pattern |
| Data validation | Zod 4 | — | CaseSchema, EvidenceSchema, DossierSchema — same pattern as ConfigSchema |

## Standard Stack

### Core (all already in package.json — zero new runtime dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `node:fs/promises` | built-in | Read/write case files, evidence, dossiers, sessions | Same pattern as config/index.ts and wallet/index.ts |
| Node.js `node:crypto` | built-in | SHA-256 for evidence integrity and dossier dedup | Verified: `createHash('sha256').update(content).digest('hex')` |
| Node.js `node:path`, `node:os` | built-in | Path composition, `os.homedir()` | Already used throughout |
| Commander.js | `^14.0.3` | `case` subcommand group | Already in dependencies; `.addCommand()` pattern verified |
| Zod 4 | `^4.4.3` | CaseSchema, EvidenceSchema, DossierSchema | Already in dependencies; `z.enum`, `z.object`, `z.string().regex()` verified |
| @duckdb/node-api | `>=1.5.0-r.1` | cases, evidence_index, dossier_index tables | Already in dependencies; ALTER TABLE + information_schema migration pattern verified |

**No new dependencies needed for Phase 3.** [VERIFIED: package.json + live DuckDB tests]

### YAML Frontmatter

Do not add `gray-matter` or `js-yaml` as dependencies. Follow the GSD reference pattern: hand-roll a minimal regex-based frontmatter parser. Verified round-trip fidelity for the simple key-value structure used in case.md, evidence files, dossiers, and session.md.

```typescript
// Source: verified in this session against project's own GSD reference at
// references/get-shit-done/sdk/src/query/frontmatter.ts
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

## Architecture Patterns

### System Architecture Diagram

```
CLI entry (src/cli.ts)
    │
    ├── case open <name> [--tags]
    │       │
    │       ▼
    │   CaseStore.create()
    │       ├── generateCaseId()  →  YYYYMMDD_NNN_slug
    │       ├── mkdir cases/<id>/evidence/ dossiers/
    │       ├── write case.md  (YAML frontmatter + body)
    │       ├── write manifest.json  ({entries:[]})
    │       └── DuckDB INSERT cases (id, name, status, slug, ...)
    │
    ├── case activate/suspend/close <case-id>
    │       │
    │       ▼
    │   CaseStore.setStatus()
    │       ├── read + update case.md frontmatter
    │       └── DuckDB UPDATE cases SET status=... WHERE id=...
    │
    ├── case evidence add <case-id> --source <tool> --content <text>
    │       │
    │       ▼
    │   EvidenceStore.append()
    │       ├── nextSequence()  →  count files in evidence/ + 1
    │       ├── generateFilename()  →  NNN_source_timestamp.md
    │       ├── write evidence/<filename>  (YAML frontmatter + content)
    │       ├── SHA-256 hash of written content
    │       └── manifest.json append  {file, sha256}
    │
    ├── case dossier update <case-id> <address> --finding <text>
    │       │
    │       ▼
    │   DossierStore.appendFinding()
    │       ├── read dossiers/<address>.md (or create if absent)
    │       ├── contentHash(newFinding)  →  skip if already present
    │       └── append to Findings section + update frontmatter.lastSeen
    │
    ├── case session start <case-id>
    │       │
    │       ▼
    │   SessionStore.start()
    │       ├── nextSequence()  →  count session_NNN.md files + 1
    │       └── write session_NNN.md  (YAML frontmatter + empty body)
    │
    ├── case session end <case-id> --findings <text> --next-steps <text>
    │       │
    │       ▼
    │   SessionStore.end()
    │       ├── update current session_NNN.md (append findings/next-steps, set endTime)
    │       └── archiveOldSessions()  →  sessions > 5 compressed to history.md
    │
    └── case resume <case-id>
            │
            ▼
        CaseStore.loadContext()
            ├── read case.md  (status, metadata)
            ├── read latest session_NNN.md  (what happened last)
            ├── read all dossier summaries  (frontmatter only)
            └── return structured context object for agent injection
```

### Recommended Project Structure

```
src/
├── cases/
│   ├── index.ts          # public exports
│   ├── schema.ts         # Zod schemas: CaseSchema, EvidenceSchema, DossierSchema, SessionSchema
│   ├── store.ts          # CaseStore: create, setStatus, list, loadContext, generateCaseId
│   ├── evidence.ts       # EvidenceStore: append, verify (manifest integrity)
│   ├── dossier.ts        # DossierStore: upsert, appendFinding, get
│   ├── session.ts        # SessionStore: start, end, archive, getLatest
│   └── frontmatter.ts    # parseFrontmatter, serializeFrontmatter (shared)
├── db/
│   └── init.ts           # evolve: add migrateCasesTable() called from initSchema()
├── cli.ts                # add: program.addCommand(caseCmd)
└── ...                   # (unchanged: config, wallet, mcp, server)

tests/
├── cases-store.test.ts      # CASE-01
├── cases-evidence.test.ts   # CASE-02
├── cases-dossier.test.ts    # CASE-03
├── cases-session.test.ts    # CASE-04
└── cases-frontmatter.test.ts  # shared parser utility
```

### Pattern 1: Case ID Generation

```typescript
// Source: verified in this session
export function generateCaseId(name: string, existingIds: string[]): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  const todayNums = existingIds
    .filter(id => id.startsWith(date + '_'))
    .map(id => parseInt(id.split('_')[1] ?? '0', 10))
    .filter(n => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${date}_${String(next).padStart(3, '0')}_${slug}`;
}
```

### Pattern 2: Idempotent DuckDB Schema Migration

```typescript
// Source: verified against live chain-insights.db in this session
// The existing cases table has 4 columns: id, name, status, created_at
// Phase 3 adds: updated_at, tags, description, slug
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

### Pattern 3: SHA-256 Evidence Manifest (append-only)

```typescript
// Source: verified in this session with Node.js built-in crypto
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

### Pattern 4: DuckDB Named Bind Prepared Statement

```typescript
// Source: verified in this session — DuckDB Neo uses named $param syntax + .bind({}) + .run()
const stmt = await conn.prepare('INSERT INTO cases VALUES ($id, $name, $status, $created_at, $updated_at, $tags, $description, $slug)');
await stmt.bind({ id, name, status, created_at, updated_at, tags, description, slug });
await stmt.run();
stmt.destroySync();
```

Note: `conn.prepare()` uses `$name` placeholders, NOT `?`. Bind via `.bind({ name: value })` dict.
Using `?` or positional syntax causes "Invalid Input Error: Values were not provided" at runtime.
[VERIFIED: tested in this session]

### Anti-Patterns to Avoid

- **Adding gray-matter or js-yaml**: Hand-rolled regex parser is sufficient and avoids a dependency. The frontmatter in case files uses only flat key-value pairs — no nested YAML needed.
- **Using `conn.run('INSERT INTO ... VALUES (\'literal\', ...)')` for case writes**: Use prepared statements with `$name` bind for correctness and safety.
- **Storing raw MCP responses as session memory**: Too large. Store summaries, key findings, and next steps only.
- **DuckDB as source of truth**: Flat files are the source of truth. DuckDB is rebuilt from files if corrupted. Never write to DuckDB without also writing the flat file first.
- **Using `?` positional parameters with DuckDB Neo**: The Neo client uses `$name` named parameters, not `?`. [VERIFIED]
- **`conn.closeSync()` forgetting in finally blocks**: The Phase 2 code review flagged this. Always close in finally.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash function | `node:crypto` `createHash('sha256')` | Built-in, FIPS-compliant, zero config |
| YAML parsing for complex nested structures | Regex parser | `gray-matter` or `js-yaml` | However: Phase 3 uses only flat key-value frontmatter — the hand-rolled parser is sufficient |
| File path composition | String concatenation | `node:path` `join()` | Cross-platform, handles edge cases |
| Sequence number atomicity | Counter file | Count existing files in directory | Atomic enough for single-user local tool; no concurrency concerns |

**Key insight:** This phase needs no new npm dependencies. Everything required is either in Node.js builtins or already in `package.json`.

## Common Pitfalls

### Pitfall 1: DuckDB File Lock Collision in Tests

**What goes wrong:** Tests import `src/db/init.ts` which uses a module-level `_instance` singleton.
If two test files both call `getDb()` pointing at the same file path, the second call gets "Could
not set lock on file."

**Why it happens:** DuckDB holds an exclusive file lock per `DuckDBInstance`. The singleton is
module-level and persists across test cases within a process.

**How to avoid:** Follow the established pattern in `tests/db.test.ts`: set `process.env['HOME']`
to a `tmpdir()` subdirectory in `beforeEach`, restore in `afterEach`. Each test gets its own DB
file path. Use dynamic imports (`await import('../src/cases/store.js')`) after setting HOME so the
singleton initializes to the test path.

**Warning signs:** "IO Error: Could not set lock on file" in test output.

### Pitfall 2: DuckDB Prepared Statement Parameter Syntax

**What goes wrong:** Using `?` positional parameters causes "Invalid Input Error: Values were not
provided for the following prepared statement parameters: 1, 2, 3."

**Why it happens:** DuckDB Neo client uses named `$name` parameters, not JDBC-style `?`.

**How to avoid:** Always use `$name` in SQL and `.bind({ name: value })` dict syntax.
[VERIFIED in this session]

### Pitfall 3: Frontmatter Round-Trip Loss for Lists/Arrays

**What goes wrong:** Storing YAML arrays (e.g., `tags: [aml, mixer]`) in frontmatter and
re-reading them returns a string `"[aml, mixer]"`, not an array.

**Why it happens:** The hand-rolled frontmatter parser treats all values as strings.

**How to avoid:** Store tags as comma-separated string in case.md frontmatter
(`tags: aml,mixer`), parse with `split(',').map(t => t.trim())`. The canonical array form lives
in the Zod schema and DuckDB `VARCHAR[]` column.

### Pitfall 4: Evidence Sequence Collision on Rapid Append

**What goes wrong:** Two rapid calls to `appendEvidence()` both read `evidence/` directory,
both see N existing files, both generate sequence N+1, and the second write silently overwrites.

**Why it happens:** Read-count-then-write is not atomic.

**How to avoid:** Use timestamp component in filename to ensure uniqueness even with same
sequence number. Use `{ flag: 'wx' }` (exclusive create) in `writeFile` to fail if file exists,
then retry with next sequence. For a single-user local tool, timestamp-based uniqueness is
sufficient — this is a single-operator tool with no concurrency.

### Pitfall 5: Session Archive Corrupting history.md on First Archive

**What goes wrong:** When archiving sessions > 5 for the first time, `history.md` may not exist.
Attempting to append to a non-existent file fails.

**Why it happens:** `readFile(historyPath)` throws ENOENT, and the error is not caught.

**How to avoid:** Use `readFile(...).catch(() => '')` to treat absent `history.md` as empty.
Create it fresh on first archive.

### Pitfall 6: Schema Migration Running Twice Concurrently

**What goes wrong:** If `initSchema()` is called twice rapidly (e.g., during parallel test setup),
the `ALTER TABLE ... ADD COLUMN` throws "Catalog Error: Column with name X already exists."

**Why it happens:** `information_schema.columns` check and ALTER TABLE are not atomic.

**How to avoid:** The DuckDB singleton ensures one connection per process. Tests use isolated tmp
dirs. In production, `initSchema()` is called once at startup. The race is not a real concern for
this tool — document the assumption.

## Code Examples

### Case.md File Template

```markdown
---
id: 20260511_001_tornado-mixer
name: Tornado Mixer Investigation
status: open
created: 2026-05-11T14:23:00.000Z
updated: 2026-05-11T14:23:00.000Z
tags: aml,mixer,defi
description: Investigation into potential Tornado Cash mixing activity
---

# Tornado Mixer Investigation

*Opened: 2026-05-11T14:23:00.000Z*

Investigation notes added here by agent.
```

### Evidence File Template

```markdown
---
id: 20260511_001_tornado-mixer_ev001
caseId: 20260511_001_tornado-mixer
source: get_transaction_details
timestamp: 2026-05-11T14:30:00.000Z
queryParams: address=0x1234abcd chain=ethereum
---

## Evidence: get_transaction_details

**Source:** get_transaction_details
**Captured:** 2026-05-11T14:30:00.000Z

[MCP response content here]
```

### Dossier File Template

```markdown
---
address: 0x1234abcd5678ef90
type: eoa
firstSeen: 2026-05-11T14:30:00.000Z
lastSeen: 2026-05-11T14:30:00.000Z
riskTags: mixer-interaction
---

# Entity: 0x1234abcd5678ef90

## Summary

EVM EOA address. First observed in Case 20260511_001_tornado-mixer.

## Findings

- [2026-05-11T14:30:00.000Z] Received 5 ETH from Tornado Cash 0xd4 (evidence: 001_get_transaction_details_20260511T143000.md)

## Links to Evidence

- [001_get_transaction_details_20260511T143000.md](../evidence/001_get_transaction_details_20260511T143000.md)

## Related Entities

- 0xd4... (Tornado Cash proxy)
```

### Session File Template

```markdown
---
sessionId: 20260511_001_tornado-mixer_s001
caseId: 20260511_001_tornado-mixer
startTime: 2026-05-11T14:23:00.000Z
endTime:
status: active
---

# Session 1: 2026-05-11

## Investigation Log

[Agent appends investigation notes here]

## Key Findings

[Agent appends findings here]

## Next Steps

[Agent appends next steps here]
```

### Manifest.json Template

```json
{
  "caseId": "20260511_001_tornado-mixer",
  "entries": [
    {
      "file": "001_get_transaction_details_20260511T143000.md",
      "sha256": "3fa20115d96f2f92a8b4e92c5a8d4f1e7c3b2a09d5e6f8c1b4a7d2e9f0c3b6a"
    }
  ]
}
```

### Case Resume Context Object

```typescript
// What CaseStore.loadContext() returns — consumed by CLI `case resume` output
interface CaseContext {
  case: {
    id: string;
    name: string;
    status: string;
    created: string;
    updated: string;
    tags: string[];
  };
  lastSession: {
    sessionId: string;
    startTime: string;
    endTime?: string;
    body: string;  // full markdown body of latest session file
  } | null;
  dossierSummaries: Array<{
    address: string;
    type: string;
    riskTags: string;
    firstSeen: string;
    lastSeen: string;
  }>;
  evidenceCount: number;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `duckdb` npm package | `@duckdb/node-api` (Neo client) | DuckDB 1.0+ | Prepared statement API changed: use `.bind({name: value})`, not `?` positional params |
| `gray-matter` for YAML frontmatter | Hand-rolled regex parser (GSD pattern) | Project convention | No additional dependency; sufficient for flat key-value frontmatter |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Sequence numbers for evidence/sessions are generated by counting existing files in the directory — no separate counter state | Architecture Patterns | Race condition in (impossible) concurrent writes; mitigation: exclusive `wx` flag on write |
| A2 | The `cases` directory is created at first `case open` — not pre-created by postinstall | Standard Stack | No functional risk; `mkdir -p` handles it either way |
| A3 | `session.md` naming uses sequence numbers (`session_001.md`) matching the rolling window sort logic | Code Examples | If sessions use UUID names, sort-by-sequence logic breaks; use timestamp ISO sort instead |

## Open Questions

1. **`case activate` — should it deactivate any currently-active case?**
   - What we know: The lifecycle is open → active → suspended → closed; no constraint on simultaneous active cases stated.
   - What's unclear: Can two cases be `active` at once? The CONTEXT.md does not restrict this.
   - Recommendation: Allow multiple active cases (simpler, less surprising); display a warning if activating when another case is already active.

2. **Evidence capture hooks in `src/mcp/proxy.ts`**
   - What we know: CONTEXT.md lists `src/mcp/proxy.ts` as an integration point for evidence capture.
   - What's unclear: Phase 3 scope says "via slash commands" — so should evidence capture be automatic-on-MCP-call or manual-via-command?
   - Recommendation: Manual for Phase 3 (agent explicitly calls `case evidence add`). Automatic hook integration is Phase 3+ scope; keep the hook point in proxy.ts as a stub comment for now.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.13.1 | — |
| npm | Package management | Yes | 11.13.0 | — |
| @duckdb/node-api | Database | Yes | installed | — |
| node:crypto | SHA-256 | Yes | built-in | — |
| node:fs/promises | File I/O | Yes | built-in | — |
| Commander.js | CLI | Yes | ^14.0.3 | — |
| Zod 4 | Validation | Yes | ^4.4.3 | — |
| Vitest | Testing | Yes | 4.1.5 | — |

**Missing dependencies with no fallback:** None. All dependencies are in-tree or Node.js built-ins.

**Existing runtime state:**
- `~/.chain-insights/chain-insights.db` exists with `cases` table (4 columns from Phase 1)
- Schema migration via `information_schema.columns` check is required and tested
- No `~/.chain-insights/cases/` directory exists yet (created at first `case open`)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run --reporter=verbose tests/cases-*.test.ts` |
| Full suite command | `npx vitest run` |

**Baseline:** 56 tests across 10 files — all passing as of research date. [VERIFIED: `npx vitest run`]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CASE-01 | `case open` creates case.md + dir structure + DuckDB row | unit | `npx vitest run tests/cases-store.test.ts -x` | Wave 0 |
| CASE-01 | `case activate/suspend/close` updates case.md status + DuckDB | unit | `npx vitest run tests/cases-store.test.ts -x` | Wave 0 |
| CASE-01 | `case list` reads DuckDB index | unit | `npx vitest run tests/cases-store.test.ts -x` | Wave 0 |
| CASE-02 | `appendEvidence()` writes file + manifest.json entry with SHA-256 | unit | `npx vitest run tests/cases-evidence.test.ts -x` | Wave 0 |
| CASE-02 | `verifyManifest()` detects tampered file | unit | `npx vitest run tests/cases-evidence.test.ts -x` | Wave 0 |
| CASE-03 | `appendFinding()` creates dossier on first call, appends on subsequent | unit | `npx vitest run tests/cases-dossier.test.ts -x` | Wave 0 |
| CASE-03 | `appendFinding()` deduplicates identical content | unit | `npx vitest run tests/cases-dossier.test.ts -x` | Wave 0 |
| CASE-04 | `SessionStore.start()` writes session file; `end()` updates it | unit | `npx vitest run tests/cases-session.test.ts -x` | Wave 0 |
| CASE-04 | `SessionStore.archive()` compresses sessions > 5 to history.md | unit | `npx vitest run tests/cases-session.test.ts -x` | Wave 0 |
| CASE-04 | `CaseStore.loadContext()` assembles case + session + dossier summaries | unit | `npx vitest run tests/cases-store.test.ts -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/cases-*.test.ts`
- **Per wave merge:** `npx vitest run` (full suite, 56 + new tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

All five test files need to be created in Wave 0:
- [ ] `tests/cases-store.test.ts` — covers CASE-01, CASE-04 (context load)
- [ ] `tests/cases-evidence.test.ts` — covers CASE-02
- [ ] `tests/cases-dossier.test.ts` — covers CASE-03
- [ ] `tests/cases-session.test.ts` — covers CASE-04
- [ ] `tests/cases-frontmatter.test.ts` — covers shared utility

**Test isolation requirement:** All case store tests MUST set `process.env['HOME']` to a `tmpdir()`
subdirectory in `beforeEach` and use dynamic imports after HOME is set. This matches the established
pattern in `tests/db.test.ts`, `tests/wallet.test.ts`, and `tests/config.test.ts`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — local tool, no auth |
| V3 Session Management | no | N/A — investigation sessions are not HTTP sessions |
| V4 Access Control | no | N/A — single-user local tool |
| V5 Input Validation | yes | Zod schemas: CaseSchema, EvidenceSchema, DossierSchema validate all user input |
| V6 Cryptography | yes | Node.js built-in `crypto.createHash('sha256')` — no hand-rolled crypto |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in case ID | Tampering | Zod regex `/^\d{8}_\d{3}_[a-z0-9][a-z0-9-]*$/` rejects `../` and shell chars |
| Path traversal in entity address (dossier filename) | Tampering | Sanitize address: `address.replace(/[^a-z0-9]/gi, '').slice(0, 66)` before using as filename |
| Manifest file tampering | Repudiation | SHA-256 verification on case resume detects modification |
| Secrets in evidence content | Information Disclosure | Evidence content stored locally with 0o600 mode — matches wallet.json pattern |
| Shell injection via case name → slug | Tampering | Slug generation uses `replace(/[^a-z0-9]+/g, '-')` — no shell execution |

**File permission standard:** All case files written with `{ mode: 0o600 }` matching the project-wide convention from `config/index.ts` and `wallet/index.ts`.

## Sources

### Primary (HIGH confidence)

- [VERIFIED: live DuckDB instance `/home/aphex5/.chain-insights/chain-insights.db`] — existing schema: `cases` table has 4 columns (id, name, status, created_at); ALTER TABLE + information_schema migration pattern tested
- [VERIFIED: `/home/aphex5/work/chain-insights/node_modules/@duckdb/node-api`] — DuckDB Neo API: prepared statements use `$name` params + `.bind({name: value})` + `.run()`; `.destroySync()` for cleanup
- [VERIFIED: Node.js v24.13.1 built-in `node:crypto`] — `createHash('sha256').update(content).digest('hex')` works as expected
- [VERIFIED: `/home/aphex5/work/chain-insights/node_modules/zod/index.cjs`] — Zod 4.4.3: `z.enum`, `z.object`, `z.string().regex()`, `z.array()`, `.default()` all function correctly
- [VERIFIED: `/home/aphex5/work/chain-insights/node_modules/commander`] — `.addCommand()` nested subcommand pattern verified; matches existing `mcp` subcommand in `src/cli.ts`
- [VERIFIED: `npx vitest run`] — 56 tests passing; baseline confirmed before Phase 3 begins
- [CITED: `references/get-shit-done/sdk/src/query/frontmatter.ts`] — hand-rolled YAML frontmatter parser pattern; verified round-trip for flat key-value structure

### Secondary (MEDIUM confidence)

- [CITED: `src/db/init.ts`] — existing DuckDB singleton pattern; `getDb()`, `initSchema()`, `resetDbInstance()` for test isolation
- [CITED: `src/config/index.ts`] — file-based singleton pattern with `_cached` + `resetConfigCache()`; template for CaseStore singleton
- [CITED: `src/wallet/index.ts`] — `{ mode: 0o600 }` file permission convention; AES-256-GCM file storage pattern
- [CITED: `tests/db.test.ts`, `tests/wallet.test.ts`] — test isolation pattern: fake HOME + dynamic imports + tmpdir cleanup

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire stack already installed; versions confirmed; no new dependencies
- Architecture: HIGH — all patterns verified with live DuckDB and Node.js in this session
- Pitfalls: HIGH — most pitfalls discovered through actual test runs (prepared stmt syntax, lock behavior)
- DuckDB prepared statements: HIGH — `$name` syntax + `.bind({})` + `.run()` verified; `?` syntax confirmed broken

**Research date:** 2026-05-11
**Valid until:** 2026-08-11 (stable stack; DuckDB Neo API unlikely to change; Zod 4 stable)
