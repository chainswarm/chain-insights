---
phase: 01-foundation-distribution
verified: 2026-05-11T00:45:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 1: Foundation & Distribution Verification Report

**Phase Goal:** Investigator can install the toolkit globally, run the CLI, and have a working local server with embedded database -- the skeleton that all investigation features build on
**Verified:** 2026-05-11T00:45:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #   | Truth                                                                                                  | Status     | Evidence                                                                                                                          |
|-----|--------------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------------------------------------------|
| 1   | User can run `npx chain-insights --claude` and get a working installation with Claude Code skills registered | ✓ VERIFIED | `node bin/install.cjs --claude` exits 0, copies `ci-status/SKILL.md` and `ci-case/SKILL.md` to `~/.claude/skills/`, writes `config.json` at 0o600; 5 installer tests pass |
| 2   | CLI responds to `chain-insights --help` showing available commands                                     | ✓ VERIFIED | `node bin/cli.js --help` prints name, `serve`, `status`, `config`, `--claude` option; 4 CLI tests pass                           |
| 3   | DuckDB database initializes on first run and passes postinstall health check                           | ✓ VERIFIED | `node bin/cli.js status` prints "DB: healthy"; `healthCheck()` returns `{ok:true}`; 2 DuckDB tests pass                          |
| 4   | Local Hono server starts on demand, serves responses on localhost, and stops cleanly                   | ✓ VERIFIED | `startServer()` binds to `127.0.0.1` only; GET /health returns `{ok:true}`; 2 server tests pass; `server.close()` returned       |
| 5   | Configuration directory `.chain-insights/` exists with MCP endpoint and wallet settings               | ✓ VERIFIED | `loadConfig()` returns Zod defaults when absent; `saveConfig()` writes at 0o600; 3 config tests pass; installer creates dir      |

**Score:** 5/5 truths verified

### PLAN Frontmatter Must-Haves (01-01)

| #   | Truth                                                                                  | Status     | Evidence                                                      |
|-----|----------------------------------------------------------------------------------------|------------|---------------------------------------------------------------|
| 1   | `node bin/cli.js --help` prints the chain-insights CLI usage                           | ✓ VERIFIED | Confirmed live: outputs Commander usage with all subcommands  |
| 2   | `node bin/cli.js status` executes DuckDB health check and reports 'healthy'            | ✓ VERIFIED | Confirmed live: "DB: healthy" printed                         |
| 3   | `node bin/cli.js serve` starts a server on 127.0.0.1:4321 returning `{ok:true}`       | ✓ VERIFIED | `hostname: '127.0.0.1'` in `src/server/index.ts`; test verifies /health returns 200 + `{ok:true}` |
| 4   | Config loads from `~/.chain-insights/config.json` with Zod defaults when file absent  | ✓ VERIFIED | `loadConfig()` catches read error and returns DEFAULT_CONFIG  |
| 5   | `npx vitest run` passes all tests                                                      | ✓ VERIFIED | 16/16 tests pass across 5 test files                          |

### PLAN Frontmatter Must-Haves (01-02)

| #   | Truth                                                                                              | Status     | Evidence                                                            |
|-----|----------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------|
| 1   | `node bin/install.cjs --claude` copies skill files and creates `~/.chain-insights/config.json`     | ✓ VERIFIED | Confirmed live with `HOME=$(mktemp -d)`; printed summary confirms   |
| 2   | Copied skill files at `ci-status/SKILL.md` and `ci-case/SKILL.md` under `~/.claude/skills/`       | ✓ VERIFIED | 2 installer tests assert exact paths; `name: ci-status` and `name: ci-case` confirmed in source |
| 3   | `~/.chain-insights/config.json` created with mode 0o600 and valid default JSON                     | ✓ VERIFIED | installer test asserts `(st.mode & 0o777).toString(8) === '600'` and `serverPort === 4321` |
| 4   | Installer prints a summary showing skills and config paths                                          | ✓ VERIFIED | Live run shows "Chain Insights installed" + Skills/Config/Data dir lines |
| 5   | `npx vitest run tests/installer.test.ts` passes                                                    | ✓ VERIFIED | 5/5 installer tests pass                                            |

### Required Artifacts

| Artifact                      | Expected                                         | Status     | Details                                                                 |
|-------------------------------|--------------------------------------------------|------------|-------------------------------------------------------------------------|
| `package.json`                | bin entry, deps, engine >=22.0.0                 | ✓ VERIFIED | `"chain-insights": "./bin/cli.js"`, `"node": ">=22.0.0"`               |
| `bin/cli.js`                  | CJS shim delegating to `dist/cli.mjs`            | ✓ VERIFIED | `import('../dist/cli.mjs')` — adjusted from plan (tsdown emits .mjs)   |
| `src/cli.ts`                  | Commander with serve, status, --claude           | ✓ VERIFIED | All subcommands and `install.cjs` reference confirmed                   |
| `src/config/schema.ts`        | Zod ConfigSchema, InvestigatorConfig type        | ✓ VERIFIED | Exports ConfigSchema, InvestigatorConfig, DEFAULT_CONFIG                |
| `src/config/index.ts`         | loadConfig, saveConfig, resetConfigCache         | ✓ VERIFIED | All three exported; 0o600 on write                                      |
| `src/db/init.ts`              | DuckDB singleton, initSchema, healthCheck        | ✓ VERIFIED | `_instance` singleton, `chmodSync(0o600)`, healthCheck passes           |
| `src/db/index.ts`             | Re-export surface                                | ✓ VERIFIED | Re-exports getDb, initSchema, healthCheck, resetDbInstance              |
| `src/server/app.ts`           | Hono app with /health and /status routes         | ✓ VERIFIED | createApp() returns Hono; /status calls healthCheck()                   |
| `src/server/index.ts`         | startServer() bound to 127.0.0.1                 | ✓ VERIFIED | `hostname: '127.0.0.1'` confirmed                                       |
| `bin/install.cjs`             | CJS stdlib-only, copyCommandsAsClaudeSkills      | ✓ VERIFIED | 0 ESM imports, `require('fs')`, copyCommandsAsClaudeSkills function     |
| `skills/ci-status/SKILL.md`   | Claude Code skill, name: ci-status               | ✓ VERIFIED | `name: ci-status` + `allowed-tools:` confirmed                          |
| `skills/ci-case/SKILL.md`     | Claude Code skill, name: ci-case                 | ✓ VERIFIED | `name: ci-case` confirmed                                               |
| `tests/cli.test.ts`           | Tests for FOUND-02                               | ✓ VERIFIED | 4 tests pass                                                            |
| `tests/config.test.ts`        | Tests for FOUND-05                               | ✓ VERIFIED | 3 tests pass                                                            |
| `tests/db.test.ts`            | Tests for FOUND-03                               | ✓ VERIFIED | 2 tests pass                                                            |
| `tests/server.test.ts`        | Tests for FOUND-04                               | ✓ VERIFIED | 2 tests pass                                                            |
| `tests/installer.test.ts`     | Tests for FOUND-01                               | ✓ VERIFIED | 5 tests pass                                                            |
| `dist/cli.mjs`                | Built ESM entry point                            | ✓ VERIFIED | Present in dist/                                                        |

### Key Link Verification

| From                   | To                            | Via                               | Status     | Details                                                       |
|------------------------|-------------------------------|-----------------------------------|------------|---------------------------------------------------------------|
| `bin/cli.js`           | `dist/cli.mjs`                | dynamic import()                  | ✓ WIRED    | `import('../dist/cli.mjs')` confirmed — deviation from plan's `.js` (tsdown emits .mjs) |
| `src/cli.ts`           | `src/server/index.ts`         | dynamic import on serve           | ✓ WIRED    | `import('./server/index.js')` inside serve action             |
| `src/cli.ts`           | `src/db/index.ts`             | dynamic import on status          | ✓ WIRED    | `import('./db/index.js')` inside status action                |
| `src/cli.ts`           | `bin/install.cjs`             | execFileSync on --claude           | ✓ WIRED    | `install.cjs` reference confirmed, 2 occurrences              |
| `src/server/app.ts`    | `src/db/index.ts`             | /status route calls healthCheck() | ✓ WIRED    | `import('../db/index.js')` + `healthCheck()` in /status route |
| `src/config/index.ts`  | `~/.chain-insights/config.json` | readFile on CONFIG_PATH          | ✓ WIRED    | `path.join(os.homedir(), '.chain-insights', 'config.json')` confirmed |
| `bin/install.cjs`      | `skills/`                     | fs.readdirSync + copyFileSync     | ✓ WIRED    | `copyCommandsAsClaudeSkills` function confirmed                |
| `bin/install.cjs`      | `~/.claude/skills/ci-*/SKILL.md` | fs.mkdirSync + writeFileSync   | ✓ WIRED    | `.claude.*skills` pattern confirmed; live test passed         |
| `bin/install.cjs`      | `~/.chain-insights/config.json` | writeFileSync + chmodSync       | ✓ WIRED    | `chmodSync.*config` confirmed                                 |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces CLI tools and infrastructure modules, not data-rendering UI components. No dynamic data rendering artifacts to trace.

### Behavioral Spot-Checks

| Behavior                          | Command                                    | Result                                           | Status  |
|-----------------------------------|--------------------------------------------|--------------------------------------------------|---------|
| CLI help output                   | `node bin/cli.js --help`                   | Shows chain-insights, serve, status, --claude    | ✓ PASS  |
| CLI version                       | `node bin/cli.js --version`                | `0.1.0`                                          | ✓ PASS  |
| DB health check via CLI           | `node bin/cli.js status`                   | "DB: healthy"                                    | ✓ PASS  |
| Installer with fake HOME          | `HOME=$(mktemp -d) node bin/install.cjs --claude` | "Chain Insights installed", exits 0        | ✓ PASS  |
| Full test suite                   | `npx vitest run`                           | 16/16 passed (5 files)                           | ✓ PASS  |
| dist/ populated after build       | `ls dist/cli.mjs dist/index.mjs`           | Both present                                     | ✓ PASS  |

### Requirements Coverage

| Requirement | Source Plan | Description                                                               | Status      | Evidence                                                         |
|-------------|------------|---------------------------------------------------------------------------|-------------|------------------------------------------------------------------|
| FOUND-01    | 01-02      | User can install globally via `npx chain-insights --claude`               | ✓ SATISFIED | bin/install.cjs copies skills + creates config; 5 tests pass     |
| FOUND-02    | 01-01      | CLI scaffold with Commander.js and skill registration system               | ✓ SATISFIED | Commander program with serve/status/config/--claude; 4 tests     |
| FOUND-03    | 01-01      | DuckDB embedded database initialization with postinstall health check      | ✓ SATISFIED | healthCheck() returns {ok:true}; singleton pattern; 2 tests      |
| FOUND-04    | 01-01      | Local Hono server (localhost-only, on-demand)                              | ✓ SATISFIED | 127.0.0.1 binding enforced; /health route; 2 tests               |
| FOUND-05    | 01-01      | Configuration system in `.chain-insights/` with MCP endpoint + wallet     | ✓ SATISFIED | Zod schema with mcpEndpoint/walletAddress/serverPort; 3 tests    |

No orphaned requirements found. All 5 Phase 1 requirements are claimed by plans and verified.

### Anti-Patterns Found

No blockers or warnings found.

| File                   | Pattern                        | Severity | Notes                                                                             |
|------------------------|--------------------------------|----------|-----------------------------------------------------------------------------------|
| `skills/ci-case/SKILL.md` | "placeholder" in body text  | INFO     | Intentional — plan explicitly declares this a placeholder for Phase 3 implementation. SKILL.md is structurally complete with frontmatter and allowed-tools. |

### Human Verification Required

None. All success criteria are verifiable programmatically. The phase produces CLI tools (not UI) and all behaviors were confirmed via live execution and passing tests.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are verified. All 21 declared artifacts exist and are substantive. All 9 key links are wired. 16/16 tests pass. Live behavioral spot-checks confirm end-to-end functionality.

**Notable deviation from plan (auto-fixed, no gap):** `bin/cli.js` imports `dist/cli.mjs` instead of `dist/cli.js` — tsdown 0.21.x emits `.mjs` for ESM output. The deviation was caught during execution and fixed correctly.

---

_Verified: 2026-05-11T00:45:00Z_
_Verifier: Claude (gsd-verifier)_
