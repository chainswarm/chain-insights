---
phase: 01-foundation-distribution
plan: 01
subsystem: infra
tags: [typescript, commander, hono, duckdb, zod, tsdown, vitest, npm, cli]

requires: []

provides:
  - "npm package scaffold: chain-insights v0.1.0 with bin, dist, ESM+CJS build"
  - "Commander CLI: serve, status, config subcommands and --claude option"
  - "Zod config system: loadConfig/saveConfig/resetConfigCache, ~/.chain-insights/config.json"
  - "DuckDB singleton: getDb/initSchema/healthCheck, cases table, 0o600 db file permissions"
  - "Hono local server: startServer() bound to 127.0.0.1, /health and /status routes"
  - "Public API surface: src/index.ts exports all subsystem modules"

affects:
  - 01-02
  - all future phases

tech-stack:
  added:
    - "commander@14.0.3 — CLI subcommand routing"
    - "hono@4.12.18 + @hono/node-server@2.0.2 — local HTTP server"
    - "@duckdb/node-api@1.5.2-r.1 — embedded analytical database (Neo client)"
    - "zod@4.4.3 — Zod 4 config schema validation"
    - "tsdown@0.21.10 — ESM+CJS dual output bundler"
    - "vitest@4.1.5 — test runner"
    - "tsx@4.21.0 — dev-time TypeScript execution"
    - "typescript@6.0.3"
  patterns:
    - "CJS bin shim → dynamic import() → ESM dist (bin/cli.js → dist/cli.mjs)"
    - "DuckDB module-level singleton to avoid file-lock conflicts"
    - "HOME-isolation in tests: process.env.HOME override + tmpdir()"
    - "Zod 4 namespace import: import * as z from 'zod'"
    - "config path derived at call time (not module load) for test isolation"
    - "127.0.0.1 server binding (security: localhost-only, T-01-01)"

key-files:
  created:
    - package.json
    - tsconfig.json
    - tsdown.config.ts
    - vitest.config.ts
    - bin/cli.js
    - src/cli.ts
    - src/config/schema.ts
    - src/config/index.ts
    - src/db/init.ts
    - src/db/index.ts
    - src/server/app.ts
    - src/server/index.ts
    - src/index.ts
    - tests/cli.test.ts
    - tests/config.test.ts
    - tests/db.test.ts
    - tests/server.test.ts
  modified: []

key-decisions:
  - "tsdown 0.21.10 pinned (0.22.x requires node ^22.18.0, engine field says >=22.0.0)"
  - "bin/cli.js imports dist/cli.mjs not dist/cli.js (tsdown 0.21.x always emits .mjs for ESM)"
  - "Hono server bound to 127.0.0.1 (T-01-01: prevents LAN exposure of investigation data)"
  - "DuckDB file chmod 0o600 after create (T-01-03: owner-only investigation data)"
  - "Config file written with mode 0o600 (T-01-02: mcpAuthToken privacy)"
  - "DuckDB singleton at module level to avoid IO Error: Could not set lock on file"
  - "@duckdb/node-api version range >=1.5.0-r.1 (package uses pre-release tags, ^1.5.0 won't resolve)"

patterns-established:
  - "Pattern: CJS shim — bin/*.js are CJS, use dynamic import() to reach ESM dist"
  - "Pattern: test isolation — override process.env.HOME to tmpdir in beforeEach/afterEach"
  - "Pattern: module singletons — _instance/_cached with reset exports for test isolation"
  - "Pattern: node: prefix — all Node stdlib imports use node: protocol prefix"

requirements-completed: [FOUND-02, FOUND-03, FOUND-04, FOUND-05]

duration: 4min
completed: 2026-05-11
---

# Phase 01 Plan 01: Walking Skeleton Summary

**Commander CLI, DuckDB embedded database, Hono localhost server, and Zod config system wired end-to-end as a buildable npm package with 11 passing Vitest tests**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-10T22:35:32Z
- **Completed:** 2026-05-10T22:39:13Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 17

## Accomplishments

- Walking skeleton npm package: `node bin/cli.js --help` works, `node bin/cli.js status` reports "DB: healthy"
- All 11 Vitest tests pass across CLI, config, DuckDB, and Hono test suites
- Security mitigations applied: 127.0.0.1 binding (T-01-01), 0o600 on config (T-01-02) and DB file (T-01-03)

## Task Commits

1. **Task 1: Project scaffold + failing tests (RED)** — `630e6cf` (test)
2. **Task 2: Source tree — CLI, config, DuckDB, Hono (GREEN)** — `d6dac76` (feat)

## Files Created/Modified

- `package.json` — chain-insights 0.1.0 with bin, deps, engine constraint >=22.0.0
- `tsconfig.json` — NodeNext module resolution for ESM/CJS dual output
- `tsdown.config.ts` — dual ESM+CJS build with shims:true
- `vitest.config.ts` — unit/integration project split, node environment
- `bin/cli.js` — CJS shim: `import('../dist/cli.mjs')` bridges to ESM dist
- `src/cli.ts` — Commander program: serve, status, config, --claude option
- `src/config/schema.ts` — ConfigSchema (Zod), InvestigatorConfig type, DEFAULT_CONFIG
- `src/config/index.ts` — loadConfig/saveConfig/resetConfigCache with 0o600 permissions
- `src/db/init.ts` — DuckDB singleton, initSchema (cases table), healthCheck, chmodSync 0o600
- `src/db/index.ts` — stable re-export surface
- `src/server/app.ts` — Hono factory: /health, /status routes
- `src/server/index.ts` — startServer() bound to 127.0.0.1 with SIGINT/SIGTERM shutdown
- `src/index.ts` — public programmatic API surface
- `tests/cli.test.ts` — Commander --help, --version assertions (FOUND-02)
- `tests/config.test.ts` — Zod config load/save/permissions (FOUND-05)
- `tests/db.test.ts` — DuckDB healthCheck and initSchema (FOUND-03)
- `tests/server.test.ts` — Hono 127.0.0.1 binding and /health route (FOUND-04)

## Decisions Made

- tsdown 0.21.10 pinned for Node 22.0 compat (0.22.x requires ^22.18.0)
- bin/cli.js imports `dist/cli.mjs` not `dist/cli.js` (tsdown 0.21.x always emits .mjs)
- Hono bound to `127.0.0.1` not `0.0.0.0` (security requirement T-01-01)
- DuckDB and config files chmod 0o600 after creation (T-01-02, T-01-03)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @duckdb/node-api version range uses pre-release tags**
- **Found during:** Task 1 (npm install)
- **Issue:** `^1.5.0` doesn't match `1.5.0-r.1` — npm pre-release semantics exclude pre-release from semver range
- **Fix:** Changed version range to `>=1.5.0-r.1`
- **Files modified:** package.json
- **Verification:** npm install succeeded, 94 packages installed
- **Committed in:** 630e6cf (Task 1 commit)

**2. [Rule 1 - Bug] tsdown 0.21.x emits .mjs not .js for ESM output**
- **Found during:** Task 2 (post-build verification)
- **Issue:** Plan specified `import('../dist/cli.js')` in bin shim, but tsdown 0.21.x outputs `dist/cli.mjs`; `outputExtensions` option not supported in 0.21.x
- **Fix:** Changed bin/cli.js to import `../dist/cli.mjs`
- **Files modified:** bin/cli.js
- **Verification:** `node bin/cli.js --help` outputs correct Commander usage
- **Committed in:** d6dac76 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** Both necessary for correctness. No scope creep. The .mjs extension is a tsdown behavior — future phases should be aware that dist/cli.mjs is the ESM entry point.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Walking skeleton complete: `npm run build` and `npx vitest run` both pass
- Contracts established: InvestigatorConfig type, loadConfig/saveConfig, healthCheck, startServer
- Plan 01-02 (skills registration + bin/install.cjs) can build directly on this skeleton
- dist/cli.mjs is the ESM entry; plan 01-02 must use this extension when referencing the built CLI

---
*Phase: 01-foundation-distribution*
*Completed: 2026-05-11*
