# Phase 3: Case Management - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the persistent state layer for investigations: case lifecycle management (open, activate, suspend, close), append-only evidence store with integrity verification, per-entity dossier accumulation, and investigation memory that restores context across sessions. All state stored as flat files (markdown + YAML frontmatter) with DuckDB as an analytical index.

</domain>

<decisions>
## Implementation Decisions

### Case Storage & Lifecycle
- Case data lives in `~/.chain-insights/cases/<case-id>/` — per-case directories under the global config dir
- Case ID format: `{YYYYMMDD}_{NNN}_{slug}` (e.g., `20260511_001_tornado-mixer`) — date-stamped, zero-padded sequence number, descriptive slug from case name
- Case state stored as `case.md` with YAML frontmatter (id, name, status, created, updated, tags) — matches GSD's pure flat file approach
- DuckDB `cases` table is an index only — flat files are source of truth, DuckDB for cross-case analytical queries (list open cases, search by status/date)
- Case lifecycle: open → active → suspended → closed. CLI commands via `chain-insights case open/activate/suspend/close`

### Evidence Store Design
- Each evidence entry is a separate markdown file with YAML frontmatter, stored in `<case-dir>/evidence/`
- Evidence file naming: `{NNN}_{source}_{timestamp}.md` (e.g., `001_mcp-query_20260511T1423.md`) — ordered, source-tagged, timestamped
- Evidence metadata in YAML frontmatter: source (MCP tool name), timestamp, case ID, query parameters, response summary
- Single `manifest.json` per case maps each evidence file to its SHA-256 hash — append-only, verified on case resume
- HTML can be used alongside markdown in the future if richer formatting is needed

### Dossier System
- One markdown file per entity, stored in `<case-dir>/dossiers/` subfolder (e.g., `dossiers/0x1234abcd.md`)
- Dossier structure: YAML frontmatter (entity address, type, first/last seen, risk tags) + sections: Summary, Findings (append-only), Links to Evidence, Related Entities
- Content-hash deduplication — before appending a finding, SHA-256 the content and skip if already present
- Case-local only in v1 — each case has its own dossier files. Cross-case entity search via DuckDB deferred to v2

### Investigation Memory
- Structured markdown `session.md` per session — YAML frontmatter (session ID, start/end time, status) + body with investigation log, key findings, next steps
- Persists session summaries: key MCP queries made, findings, decisions, hypotheses, and explicit "next steps" — NOT raw MCP responses (too large)
- Context restoration on case resume: read `case.md` (status/frontmatter) + latest `session.md` (what happened last) + all dossier summaries
- Rolling window — keep last 5 full session files, older sessions compressed to a one-paragraph summary in `history.md`

### Claude's Discretion
- Internal implementation of SHA-256 hashing and manifest management
- DuckDB schema for the cases index table (may evolve existing `cases` table from Phase 1)
- CLI subcommand structure and option flags
- Error handling and validation details
- Test strategy (unit vs integration split)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/index.ts` — config load/save pattern with Zod validation, file-based with in-memory cache
- `src/config/schema.ts` — Zod schema pattern for data validation (`ConfigSchema`)
- `src/db/init.ts` — DuckDB singleton pattern, existing `cases` table (id, name, status, created_at), `healthCheck()` function
- `src/wallet/index.ts` — file-based encrypted storage pattern (AES-256-GCM)
- `src/cli.ts` — Commander.js CLI with subcommands (`serve`, `status`, `config`, `mcp`)

### Established Patterns
- Module-level singletons for shared resources (DuckDB instance, config cache)
- Dynamic imports for lazy-loading (`await import('./module.js')`)
- Zod for runtime validation with TypeScript type inference
- File permissions: `0o600` for sensitive data (DB file, wallet)
- YAML frontmatter + markdown for human-readable state (GSD pattern from `.planning/`)
- Path resolution via `os.homedir()` + `.chain-insights/`

### Integration Points
- CLI entry: `src/cli.ts` — add `case` subcommand group
- Database: `src/db/init.ts` — evolve `cases` table schema, add evidence/dossier index tables
- Config: `src/config/schema.ts` — may add case-related config (default tags, session settings)
- MCP proxy: `src/mcp/proxy.ts` — evidence capture hooks when MCP responses return

</code_context>

<specifics>
## Specific Ideas

- Case naming convention explicitly requested: `{YYYYMMDD}_{NNN}_{slug}` format
- GSD reference architecture confirms flat files as primary state (no internal database for state management)
- DuckDB role is analytical/index only, not source of truth

</specifics>

<deferred>
## Deferred Ideas

- Cross-case entity search via DuckDB (v2 scope)
- HTML-formatted evidence files as alternative to markdown
- Spending tracking per case (MCPOPT-02 in v2 requirements)

</deferred>
