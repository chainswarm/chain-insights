# Project Research Summary

**Project:** Chain Insights AML Toolkit
**Domain:** Local-first agent framework for blockchain AML investigations
**Researched:** 2026-05-10
**Confidence:** HIGH

## Executive Summary

Chain Insights is a local-first, npm-distributed TypeScript toolkit that gives AI coding agents (Claude Code, Codex, Open Claw) the skills, state, and tooling to conduct professional blockchain AML investigations. Unlike commercial platforms (Chainalysis, TRM, Elliptic, Crystal) costing $40K+/year, Chain Insights is free infrastructure: investigators pay only for on-chain data queries via x402 micropayments, and all investigation data stays local. The architecture borrows heavily from GSD (file-based state, skill/hook system, installer pattern) and adapts it for AML with domain-specific vocabulary (cases, dossiers, playbooks, watches, evidence).

## Recommended Stack

- **TypeScript 6.0 / Node.js 22+** — GSD/x402/MCP ecosystem is TypeScript-first
- **Fastify 5.x** — local HTTP; official `@x402/fastify` middleware; built-in validation/logging
- **`@duckdb/node-api` 1.5.x (Neo client)** — embedded analytical DB; NOT the deprecated `duckdb` package
- **viem 2.x + `@x402/fetch` 2.1.x** — EVM wallet signing + automatic 402 payment handling
- **D3.js 7.x** — money flow graph rendering; reuses existing rbmk code
- **Commander.js 14.x** — CLI framework
- **Zod 4.x** — runtime + compile-time validation
- **tsdown 0.20.x** — bundler (tsup successor); ESM + CJS + `.d.ts`
- **Vitest 4.x** — test runner
- **`@modelcontextprotocol/sdk` 1.29.x** — MCP client

## Feature Landscape

### Table Stakes (Phase 1-2)
- Wallet/address lookup, transaction tracing, risk scoring
- Case management, evidence/dossier system, investigation memory
- Money flow visualization (D3.js), MCP schema discovery
- x402 payment integration

### Differentiators (Phase 3-4)
- **Playbook system** — reusable AI-executable investigation workflows in markdown (killer feature)
- Watcher system — persistent address monitoring
- Quick MCP query (`/ci-fast`)
- Investigation report generation

### Anti-Features (never build)
- GUI/dashboard, blockchain indexer, entity attribution DB
- Real-time chain streaming, SAR filing, multi-user collaboration

## Architecture

Six major components:
1. **Command Layer** — skills + hooks (slash commands)
2. **Case Manager** — flat-file state machine
3. **Evidence & Dossier Store** — markdown files, SHA-256 integrity manifest
4. **Playbook Engine** — declarative workflow executor
5. **DuckDB Analytical Store** — query cache, watcher events, analytics
6. **x402 MCP Client** — cache-before-pay pattern, cost tracking

**Key patterns:** Cache-before-pay (check DuckDB before paying for MCP call). Flat-file-first (write file, then index to DuckDB). Dual-write storage (flat files = human-facing source of truth, DuckDB = machine-generated source of truth).

## Critical Pitfalls

1. **DuckDB native addon install failures** — use Neo client, postinstall health check, CI matrix
2. **x402 latency death spiral** — aggressive caching, credit/session model, cost estimates before expensive ops
3. **Private key exposure** — isolated signing subprocess, spending caps, minimal hot wallet
4. **Evidence chain of custody** — SHA-256 manifest, git-as-ledger, append-only evidence
5. **Analysis presented as ground truth** — always show confidence levels, explicit warnings for ambiguous patterns
6. **Premature multi-runtime abstraction** — build for Claude Code only, extract abstractions after second runtime

## Suggested Build Order (7 phases)

| Phase | Name | Delivers | Key Pitfalls Addressed |
|-------|------|----------|----------------------|
| 1 | Foundation & Distribution | CLI, DuckDB init, installer, localhost server | Install failures, single-writer, privacy |
| 2 | Case Management | Case lifecycle, evidence store, dossiers, file integrity | Evidence custody, race conditions |
| 3 | MCP Integration & x402 | x402 client, query cache, wallet setup, `/ci-fast` | Payment latency, key exposure, context bloat |
| 4 | Investigation Primitives | Lookup, tracing, risk scoring, confidence levels | Analysis as truth |
| 5 | Money Flow Visualization | D3.js graphs, self-contained HTML, auto-open browser | rbmk viz code reuse validation |
| 6 | Playbooks & Reports | Playbook engine, built-in playbooks, guardrails, reports | Playbook footgun, cost overruns |
| 7 | Watchers & Multi-Runtime | Watch daemon, polling, Codex support | Premature abstraction |

## Research Flags

- **Needs research:** Phase 3 (x402 credit model), Phase 5 (rbmk viz reuse), Phase 7 (watcher daemon)
- **Standard patterns:** Phase 1, 2, 4, 6

---
*Synthesized: 2026-05-10*
