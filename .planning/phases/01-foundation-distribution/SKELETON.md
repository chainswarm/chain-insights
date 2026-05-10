# Walking Skeleton — Chain Insights AML Toolkit

**Phase:** 1
**Generated:** 2026-05-11

## Capability Proven End-to-End

An investigator installs the toolkit via `npx chain-insights --claude`, runs `chain-insights status` to confirm the DuckDB database is live, and runs `chain-insights serve` to start a local Hono server they can curl at `http://127.0.0.1:4321/health`.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript 6.0 / Node.js 22+ | Type safety for complex investigation data models; npm distribution alignment; x402/viem/MCP ecosystem is TS-first |
| CLI framework | Commander.js 14.x | Subcommands, help generation, option parsing out of the box; less custom code than rolling a parser |
| Local server | Hono 4.x + @hono/node-server | Web Standards fetch-based; lightweight; multi-runtime compatible; localhost-only binding enforced |
| Embedded database | @duckdb/node-api 1.5.x (Neo client) | Columnar, Parquet-native, analytical; no server process; no Docker; owner of file lock per instance |
| Config validation | Zod 4.x | Single schema → runtime validation + TypeScript types; config.json validated on every load |
| Bundler | tsdown 0.21.10 | Dual ESM+CJS output; faster than tsup; compatible with Node 22.0+ |
| Distribution | npm / npx | `npx chain-insights --claude` global install; CJS bin shim → dynamic import() to ESM dist |
| Skill integration | Claude Code skills (~/.claude/skills/ci-*/SKILL.md) | Global skills format (Claude Code 2.1.88+); copied by CJS installer |
| Config directory | ~/.chain-insights/ | Parallel to GSD's ~/.claude/; investigation data stays local |
| Security posture | ASVS L1 | Hono binds 127.0.0.1; config + DB files chmod 0o600; Zod rejects unknown config keys |
| Test runner | Vitest 4.x | Jest-compatible; native ESM/TS; fast; HOME-isolation pattern for filesystem tests |
| Directory layout | src/ (TS) → dist/ (ESM+CJS); bin/ (CJS shims); skills/ (SKILL.md bundles) | Mirrors GSD reference; bin/ scripts are stdlib-only CJS; src/ is ESM TypeScript |

## Stack Touched in Phase 1

- [x] Project scaffold — package.json, tsconfig.json, tsdown.config.ts, vitest.config.ts
- [x] Routing — Commander.js subcommands (serve, status, config get/set)
- [x] Database — DuckDB opens, schema initializes (cases table), healthCheck reads SELECT 1
- [x] UI — `chain-insights status` CLI output wired to DB health + config read
- [x] Deployment — `npx chain-insights --claude` installer; full-stack run: `npm run build && node bin/cli.js serve`

## Out of Scope (Deferred to Later Slices)

- x402 micropayment integration — Phase 2
- MCP schema discovery and free-form queries — Phase 2
- Case lifecycle (open/activate/suspend/close) — Phase 3
- Evidence store + SHA-256 integrity — Phase 3
- Dossier system — Phase 3
- D3.js money flow visualization — Phase 4
- Playbook engine + starter playbooks — Phase 5
- EVM wallet signing (viem) — Phase 2
- Watcher / polling system — v2 backlog
- GUI dashboard — out of scope (agent IS the interface)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering the architectural decisions above:

- Phase 2: Investigator queries the Chain Insights MCP through their AI agent, paying per-call via x402 micropayments
- Phase 3: Investigator opens a case, records evidence, builds a dossier, and resumes the investigation in a new session
- Phase 4: Investigator generates an interactive money flow graph and views it in the browser
- Phase 5: Investigator runs a named playbook (trace-funds, risk-check, entity-profile) and gets structured output
