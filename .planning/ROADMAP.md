# Roadmap: Chain Insights AML Toolkit

## Overview

From empty repo to working AML investigation toolkit in five phases: lay the foundation (CLI, DuckDB, Hono server), connect the data pipe (x402 payments and MCP queries), build the investigation state layer (cases, evidence, dossiers), add money flow visualization (D3.js graphs), and cap it with reusable playbooks that orchestrate everything into repeatable investigation workflows.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Distribution** - CLI scaffold, DuckDB, Hono server, config system, npm installer (completed 2026-05-10)
- [ ] **Phase 2: MCP Connection & Payments** - x402 integration, schema discovery, free-form MCP queries
- [ ] **Phase 3: Case Management** - Case lifecycle, evidence store, dossiers, investigation memory
- [ ] **Phase 4: Money Flow Visualization** - D3.js graphs, self-contained HTML, browser auto-open
- [ ] **Phase 5: Playbooks** - Playbook engine and built-in starter playbooks

## Phase Details

### Phase 1: Foundation & Distribution
**Goal**: Investigator can install the toolkit globally, run the CLI, and have a working local server with embedded database -- the skeleton that all investigation features build on
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05
**Success Criteria** (what must be TRUE):
  1. User can run `npx chain-insights --claude` and get a working installation with Claude Code skills registered
  2. CLI responds to `chain-insights --help` showing available commands
  3. DuckDB database initializes on first run and passes postinstall health check
  4. Local Hono server starts on demand, serves responses on localhost, and stops cleanly
  5. Configuration directory `.chain-insights/` exists with MCP endpoint and wallet settings
**Plans**: 2 plans

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Walking Skeleton: package scaffold, build pipeline, CLI (Commander), DuckDB, Hono server, config system, test infrastructure

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Installer and skill registration: bin/install.js --claude, skills/ci-status, skills/ci-case

### Phase 2: MCP Connection & Payments
**Goal**: Investigator can query the Chain Insights MCP through their AI agent, paying per-call via x402 micropayments, and discover what tools the MCP offers
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):
  1. User can configure an EVM wallet and the toolkit automatically handles x402 payment for MCP calls
  2. Agent can introspect the MCP and list available tools/endpoints with descriptions
  3. User can describe an investigation query in natural language and the agent translates it into MCP calls and returns results
**Plans**: 3 plans

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Wallet encryption (AES-256-GCM) + x402 payment-wrapped fetch client + dependencies

**Wave 2** *(blocked on Wave 1 completion; 02-02 and 02-03 run in parallel)*
- [x] 02-02-PLAN.md — MCP schema cache (24h TTL) + tool table formatter + stdio MCP proxy
- [x] 02-03-PLAN.md — CLI mcp subcommand + build wiring (tsdown entry) + bin shim + installer MCP registration

### Phase 3: Case Management
**Goal**: Investigator can open cases, accumulate evidence and dossiers across sessions, and resume investigations with full context -- the persistent state layer for all investigation work
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CASE-01, CASE-02, CASE-03, CASE-04
**Success Criteria** (what must be TRUE):
  1. User can open, activate, suspend, and close cases via slash commands, with case state persisted in flat files
  2. Investigation findings are saved as append-only evidence files with SHA-256 integrity verification
  3. Per-entity dossier files accumulate findings across multiple sessions and are human-readable markdown
  4. Resuming a case in a new conversation restores investigation context from the previous session
**Plans**: 2 plans

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Case lifecycle: schemas, frontmatter parser, CaseStore (open/activate/suspend/close/list), DuckDB migration, CLI case subcommand group (CASE-01)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-02-PLAN.md — Evidence + dossier + session stores: EvidenceStore (SHA-256 manifest), DossierStore (content-hash dedup), SessionStore (rolling archive), CaseStore.loadContext, CLI evidence/dossier/session/resume subcommands (CASE-02, CASE-03, CASE-04)

### Phase 4: Money Flow Visualization
**Goal**: Investigator can generate interactive money flow graphs from on-chain data and view them in the browser -- making fund flows visually traceable
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: VIZ-01, VIZ-02, VIZ-03
**Success Criteria** (what must be TRUE):
  1. D3.js renders force-directed and tree layout money flow graphs from transaction data
  2. Visualization is a self-contained HTML file served from the local Hono server (no external dependencies)
  3. Generated visualization auto-opens in the user's default browser
**Plans**: 2 plans
**UI hint**: yes

Plans:
**Wave 1**
- [x] 04-01-PLAN.md — End-to-end viz slice: graph data model (Zod), theme/CSS, D3 viz-logic template, HTML generator, Hono /viz/:id route, CLI viz command, standalone --data mode (VIZ-01, VIZ-02, VIZ-03)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04-02-PLAN.md — Case-based data extraction: evidence JSON parser, dossier entity enrichment, CLI integration test (VIZ-01, VIZ-02, VIZ-03)

### Phase 5: Playbooks
**Goal**: Investigator can run repeatable, multi-step investigation workflows from markdown-declared playbooks -- turning common patterns (trace funds, risk check, entity profile) into one-command operations
**Mode:** mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: PLAY-01, PLAY-02
**Success Criteria** (what must be TRUE):
  1. User can execute a playbook by name and the runner steps through each declared investigation step in sequence
  2. Built-in starter playbooks (trace-funds, risk-check, entity-profile) are available out of the box and produce structured output
**Plans**: 2 plans

Plans:
**Wave 1**
- [x] 05-01-PLAN.md — Playbook engine core: Zod schemas, markdown parser, name resolver, sequential runner with retry/resume/dry-run (PLAY-01)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 05-02-PLAN.md — Built-in playbook definitions (TypeScript string constants) + CLI playbook subcommand (run/list/show) (PLAY-01, PLAY-02)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Foundation & Distribution | 2/2 | Complete   | 2026-05-10 |
| 2. MCP Connection & Payments | 0/3 | Not started | - |
| 3. Case Management | 1/2 | In Progress|  |
| 4. Money Flow Visualization | 0/2 | Not started | - |
| 5. Playbooks | 0/2 | Not started | - |
