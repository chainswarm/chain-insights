---
phase: 01-foundation-distribution
plan: 02
subsystem: infra
tags: [installer, claude-code-skills, cjs, vitest, npm, skills-registration]

requires:
  - phase: 01-01
    provides: "npm package scaffold with bin/cli.js, src/cli.ts --claude flag calling execFileSync on bin/install.cjs"

provides:
  - "bin/install.cjs: CJS stdlib-only installer that runs `npx chain-insights --claude`"
  - "skills/ci-status/SKILL.md: Claude Code /ci-status skill (status check)"
  - "skills/ci-case/SKILL.md: Claude Code /ci-case skill placeholder (Phase 3)"
  - "config directory ~/.chain-insights/ created with config.json at 0o600"
  - "Full installer test suite: 5 tests verifying skill copy, config creation, chmod, serverPort"

affects:
  - "all future phases using Claude Code skills"
  - "Phase 3 case management (ci-case skill placeholder)"

tech-stack:
  added: []
  patterns:
    - "CJS .cjs extension required when package.json has type:module (avoids ESM misdetection)"
    - "stdlib-only installer: require() only, no npm imports (runs before node_modules)"
    - "skill dirs bundled in package under skills/ci-*/SKILL.md, copied verbatim at install time"
    - "clean reinstall: remove stale ci-* dirs before copying (T-02-02)"
    - "ESM-safe test imports: top-level import in .ts tests, no inline require()"

key-files:
  created:
    - bin/install.cjs
    - skills/ci-status/SKILL.md
    - skills/ci-case/SKILL.md
    - tests/installer.test.ts
  modified: []

key-decisions:
  - ".cjs extension mandatory: package.json type:module makes .js files ESM; require() crashes with SyntaxError in ESM"
  - "stdlib-only constraint: installer runs before node_modules, zero npm imports allowed"
  - "global install target ~/.claude/skills/ (--claude flag); local via --local to ./.claude/commands/"
  - "skill prefix ci: all chain-insights Claude Code skills are prefixed ci-"
  - "config.json chmod 0o600 at write time (T-02-01: mcpAuthToken may be stored there)"
  - "clean reinstall: rmSync stale ci-* dirs before copy prevents stale skill versions persisting"
  - "ESM-safe installer tests: top-level import in .ts test files, not inline require() (would throw ReferenceError in ESM)"

patterns-established:
  - "Pattern: CJS installer — bin/*.cjs are CJS stdlib-only; use require() not import()"
  - "Pattern: skill registration — skills/ dirs copied verbatim to ~/.claude/skills/ during --claude install"
  - "Pattern: config security — chmod 0o600 immediately after writeFileSync for any sensitive config"

requirements-completed: [FOUND-01, FOUND-02]

duration: 2min
completed: 2026-05-11
---

# Phase 01 Plan 02: Installer and Skill Registration Summary

**CJS stdlib-only installer copies ci-status/ci-case SKILL.md files to ~/.claude/skills/ and creates ~/.chain-insights/config.json at 0o600, verified by 5 new Vitest tests (16 total passing)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-10T22:41:14Z
- **Completed:** 2026-05-10T22:42:42Z
- **Tasks:** 2 (TDD: skill files + installer/tests)
- **Files modified:** 4

## Accomplishments

- `npx chain-insights --claude` gesture is fully functional: installer copies skills, creates config directory, writes config.json with 0o600 permissions
- Claude Code skills registered: /ci-status and /ci-case available after install
- 5 installer tests pass using HOME isolation (fake tmpdir, no real HOME writes)
- Full test suite: 16/16 tests pass across all 5 test files

## Task Commits

1. **Task 1: Claude Code skill files (ci-status and ci-case)** — `82fa956` (feat)
2. **Task 2: CJS installer script and installer tests** — `11daaad` (feat)

## Files Created/Modified

- `skills/ci-status/SKILL.md` — /ci-status Claude Code skill (status, DB health, MCP endpoint)
- `skills/ci-case/SKILL.md` — /ci-case Claude Code skill placeholder (Phase 3 case management)
- `bin/install.cjs` — CJS stdlib-only installer: copyCommandsAsClaudeSkills, config dir creation, chmod 0o600
- `tests/installer.test.ts` — 5 tests: skill copy, config creation, 0o600 chmod, serverPort 4321, ESM-safe imports

## Decisions Made

- `.cjs` extension used (not `.js`) because `package.json` has `"type": "module"` — without `.cjs`, Node treats the file as ESM and `require()` crashes with SyntaxError
- Installer is stdlib-only (fs, path, os) — no npm imports because it must run before `node_modules` exists
- Skills source is `skills/` bundled in the npm package; installer copies each subdirectory verbatim as a skill dir
- Stale `ci-*` dirs removed before copy on reinstall to prevent old skill versions persisting (T-02-02)
- Test files use top-level ESM `import` statements — inline `require()` throws `ReferenceError` in ESM test context

## Deviations from Plan

None — plan executed exactly as written. Both skill files and installer match the plan's exact code patterns.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 complete: FOUND-01 through FOUND-05 all delivered
  - FOUND-01: `npx chain-insights --claude` installs skills and creates config (this plan)
  - FOUND-02 through FOUND-05: Walking skeleton from plan 01-01
- `node bin/install.cjs --claude` and `node bin/cli.js --help` both work
- Skill files in place at `skills/ci-status/SKILL.md` and `skills/ci-case/SKILL.md`
- Phase 2 or 3 can implement /ci-case case management (ci-case SKILL.md already registered)

---
*Phase: 01-foundation-distribution*
*Completed: 2026-05-11*
