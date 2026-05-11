# Chain Insights AML Toolkit

## What This Is

An open-source agent framework for blockchain AML investigations. Like GSD is for software development, Chain Insights is for crypto compliance — it gives AI coding agents (Claude Code, Codex, Open Claw) the skills, state management, and tooling to run professional AML investigations. Investigators open cases, build dossiers, monitor wallets, run playbooks, and visualize money flows — all through their AI agent of choice, powered by the Chain Insights MCP via x402 micropayments.

## Core Value

An investigator can install the toolkit, connect to the Chain Insights MCP, and run a complete investigation — from querying on-chain data to producing a money flow visualization — entirely through their AI agent.

## Requirements

### Validated

- [x] npm-based installation and distribution (GSD-style global install) — Phase 1
- [x] Local JS server with embedded database (DuckDB) for case data, monitoring results, and query caching — Phase 1
- [x] x402 payment gateway integration for MCP access — Phase 2
- [x] MCP schema skill — agents know what tools/endpoints are available — Phase 2
- [x] Quick prompt execution against Chain Insights MCP (like GSD's /gsd-fast) — Phase 2
- [x] Case management — open, close, tag, track investigation state — Phase 3
- [x] Dossier system — accumulate evidence, notes, findings per entity/case (flat files, human-readable) — Phase 3
- [x] Investigation memory — persistent context across sessions per case — Phase 3
- [x] D3.js money flow visualizations (force/tree graphs) served from local server, reusing rbmk viz code — Phase 4
- [x] Playbook system — reusable investigation workflows (trace funds, risk check, entity profiling) — Phase 5

### Active

- [ ] Claude Code skills and hooks (slash commands for investigation workflows)
- [ ] Watcher system — monitor addresses/wallets/transactions for new activity
- [ ] Multi-runtime support architecture (Claude Code first, then Codex, Open Claw)

### Out of Scope

- Docker requirement for end users — embedded DB (DuckDB) keeps it dependency-free
- Building a new MCP server — the Chain Insights MCP already exists (graphrag repo)
- Mobile or web SaaS interface — this is a local-first agent framework
- Vector store / embeddings — defer to later milestone when semantic search is needed
- Real-time streaming from chains — watchers poll via MCP, not direct chain connections

## Context

- **Existing MCP**: Chain Insights MCP is already running locally, code in `rbmk/repos/ml/graphrag`. Provides query endpoints, schema, and probes (stolen funds detection, risk scoring). Currently accessed from localhost.
- **Existing viz code**: D3.js force/tree graph visualizations exist in `rbmk/repos/agents` and `rbmk/repos/infra/*` — will be reused, not rebuilt.
- **Architecture inspiration**: GSD framework (`references/get-shit-done/`) — borrowing distribution model, multi-runtime support, skill/hook system, installation flow, pipeline architecture.
- **Built in public**: Open source (MIT), repo at chainswarm/chain-insights. The framework drives x402 MCP revenue — free toolkit, paid API calls.
- **Domain vocabulary**: Cases (not tasks), playbooks (not skills), evidence (not artifacts), dossiers (not memory), watches (not crons). Avoids collision with GSD terminology.

## Constraints

- **Distribution**: npm package, global install via npx — no Docker, no Python, no system deps beyond Node.js 22+
- **Storage**: DuckDB (embedded, analytical, Parquet-native) + flat markdown/JSON files for case state
- **Payment**: x402 protocol for MCP micropayments — requires local EVM wallet
- **Privacy**: Framework code is public, but investigation data stays local. No telemetry, no cloud sync.
- **MCP access**: Currently private/localhost MCP; will transition to public x402-gated endpoint

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | MCP integration, npm distribution, GSD architecture alignment, Anthropic agent SDK | — Pending |
| DuckDB over StarRocks/Postgres | Embedded, no server process, user-friendly, Parquet-native, analytical queries | — Pending |
| Flat files for case state | Human-readable, AI-agent-friendly, git-trackable, same pattern as GSD's .planning/ | — Pending |
| Claude Code first | Primary user base, GSD proves the model, skills/hooks system is mature | — Pending |
| Reuse rbmk viz code | D3.js force/tree graphs already built and tested, no need to rebuild | — Pending |
| x402 for monetization | Aligns with crypto-native user base, per-call pricing, no subscription friction | — Pending |
| Playbook definitions as TypeScript constants | Avoids asset-copy drift for built-in playbooks in npm distribution | Adopted in Phase 5 |
| Validate playbook tools against live MCP schema before execution | Prevents hallucinated playbooks from running against nonexistent tools | Adopted in Phase 5 |
| Use GraphRAG debug bearer for local UAT | Exercises the real public MCP tool surface without requiring production x402 spend in tests | Adopted in Phase 5 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-11 after milestone v1.0 verification*
