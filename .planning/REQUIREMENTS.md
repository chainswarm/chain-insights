# Requirements: Chain Insights AML Toolkit

**Defined:** 2026-05-10
**Core Value:** An investigator can install the toolkit, connect to the Chain Insights MCP, and run a complete investigation — from querying on-chain data to producing a money flow visualization — entirely through their AI agent.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation & Distribution

- [ ] **FOUND-01**: User can install globally via `npx chain-insights --claude`
- [ ] **FOUND-02**: CLI scaffold with Commander.js and skill registration system
- [ ] **FOUND-03**: DuckDB embedded database initialization with postinstall health check
- [ ] **FOUND-04**: Local Hono server (localhost-only, on-demand) for visualization and state API
- [ ] **FOUND-05**: Configuration system in `.chain-insights/` directory with MCP endpoint and wallet settings

### MCP & Payments

- [ ] **MCP-01**: x402 payment gateway integration (viem wallet + `@x402/fetch` for automatic 402 handling)
- [ ] **MCP-02**: MCP schema discovery — agent can introspect available tools/endpoints from the Chain Insights MCP
- [ ] **MCP-03**: Free-form MCP query execution — user describes investigation intent in natural language, agent interprets into MCP calls

### Case Management

- [ ] **CASE-01**: Case lifecycle — user can open, activate, suspend, and close investigation cases via slash commands
- [ ] **CASE-02**: Evidence store — investigation findings saved as append-only evidence files with SHA-256 integrity manifest
- [ ] **CASE-03**: Dossier system — per-entity (address/wallet/actor) findings accumulated across sessions in markdown files
- [ ] **CASE-04**: Investigation memory — per-case context persistence across conversations, restored on case resume

### Visualization

- [ ] **VIZ-01**: D3.js money flow graphs with force-directed and tree layouts, reusing existing rbmk viz code
- [ ] **VIZ-02**: Self-contained HTML output served from local Hono server
- [ ] **VIZ-03**: Auto-open visualization in user's default browser when generated

### Playbooks

- [ ] **PLAY-01**: Basic playbook runner — execute markdown-declared multi-step investigation workflows
- [ ] **PLAY-02**: Built-in starter playbooks (trace-funds, risk-check, entity-profile)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### MCP Optimization

- **MCPOPT-01**: Query caching — cache-before-pay pattern in DuckDB to avoid redundant x402 payments
- **MCPOPT-02**: Cost tracking per case — running total of x402 spend per investigation
- **MCPOPT-03**: Credit/session model for batch operations to reduce x402 latency overhead

### Investigation Primitives

- **PRIM-01**: Dedicated address/wallet lookup command (`/ci-lookup`)
- **PRIM-02**: Transaction tracing command with multi-hop fund flow (`/ci-trace`)
- **PRIM-03**: Risk scoring command with sanctions/mixer/darknet flagging (`/ci-risk`)
- **PRIM-04**: Mixer/peeling chain detection assistance

### Operational

- **OPS-01**: Watcher system — persistent address/wallet monitoring with configurable polling
- **OPS-02**: Alert hooks on new watcher activity
- **OPS-03**: Investigation report generation (structured markdown from dossier contents)

### Multi-Runtime

- **MULTI-01**: Codex runtime support
- **MULTI-02**: Open Claw runtime support
- **MULTI-03**: Runtime adapter abstraction layer

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| GUI/dashboard | Agent IS the interface — no traditional UI beyond D3 graphs |
| Blockchain indexer | MCP provides all on-chain data — don't duplicate infrastructure |
| Entity attribution database | Compliance risk — leave to commercial platforms (Chainalysis, TRM) |
| Real-time chain streaming | Watchers poll via MCP — no direct chain connections |
| SAR filing system | Regulatory liability — defer to specialized compliance tools |
| Multi-user collaboration | Local-first tool — no shared state or user management |
| Docker requirement | DuckDB + Hono keep it dependency-free beyond Node.js |
| Vector store / embeddings | Semantic search deferred to later milestone |
| Fastify | Replaced by Hono — lighter, multi-runtime compatible |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | — | Pending |
| FOUND-02 | — | Pending |
| FOUND-03 | — | Pending |
| FOUND-04 | — | Pending |
| FOUND-05 | — | Pending |
| MCP-01 | — | Pending |
| MCP-02 | — | Pending |
| MCP-03 | — | Pending |
| CASE-01 | — | Pending |
| CASE-02 | — | Pending |
| CASE-03 | — | Pending |
| CASE-04 | — | Pending |
| VIZ-01 | — | Pending |
| VIZ-02 | — | Pending |
| VIZ-03 | — | Pending |
| PLAY-01 | — | Pending |
| PLAY-02 | — | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0
- Unmapped: 17

---
*Requirements defined: 2026-05-10*
*Last updated: 2026-05-10 after initial definition*
