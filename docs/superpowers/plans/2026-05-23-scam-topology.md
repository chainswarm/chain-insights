# Scam Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chain Insights `scam_topology` investigation tool that starts from known scam cases, explains laundering topology, and emits evidence-backed label candidates for analyst review and ML training.

**Architecture:** `scam_topology` is a Chain Insights local high-level tool over the existing Go GraphRAG `graph_query_batch` primitive. It reuses the proven `runFundFlowProbe` traversal/report pipeline, classifies scam-case roles, and emits label candidates plus graph roles without adding a new public GraphRAG Go tool or writing labels through the read-only graph endpoint.

**Tech Stack:** TypeScript, Vitest, MCP SDK, Chain Insights graph report writer, GraphRAG Go MCP `graph_query_batch`, Bittensor dev docker compose stack.

---

## Definition Of Done

- Chain Insights exposes `scam_topology` as an MCP tool when the remote GraphRAG MCP only exposes graph primitives.
- `cia mcp scam-topology` and `cia mcp call scam_topology ...` run the same local recipe.
- The tool accepts explicit seed roles: `victim_addresses` and `scammer_addresses`, at least one required, max five per role, no overlap.
- Victim/source addresses are represented as case roles, but are not emitted as risky `SCAM` training labels.
- Known scammer seed addresses produce high-confidence `SCAM` label candidates with provenance.
- Laundering intermediates and exchange deposit candidates produce lower-confidence `SCAM` label candidates with path evidence and `review_required` promotion status.
- Exchange/service endpoints and reverse leads are preserved as topology evidence but are not automatically risky labels.
- Output includes investigator summary text, `structuredContent.schema = chain-insights.result.v1`, `structuredContent.tool = scam_topology`, `facts.label_candidates`, `facts.case_roles`, local graph report metadata in `_meta.chainInsights.graph`, and canonical `chain-insights.graph.v1` graph data with roles suitable for existing visualization.
- The tool does not introduce Go-side local hash joins or a new GraphRAG public tool.
- Tests cover role safety, label candidate generation, MCP registration, CLI call routing, and playbook/docs exposure.
- Verification includes `npm test`, `npm run typecheck`, `npm run build`, and real Bittensor dev UAT against the local GraphRAG MCP through docker compose where the local stack is available.

## Gap Resolutions

- **Confirmed labels vs candidates:** The graph path is read-only and should not write directly to `core_address_labels`. `scam_topology` emits label candidates and evidence; later ingestion can promote approved candidates into StarRocks labels.
- **Victim safety:** A known victim/source is not a bad actor. It appears in `case_roles` and graph roles, not as a risky ML positive.
- **Known scammer safety:** A known scammer seed can be a confirmed-risk candidate because the operator is explicitly providing scam ground truth.
- **Reachability safety:** Reachable nodes are role-scored. Intermediaries and deposit candidates are candidates, not confirmed labels, and carry confidence/provenance.
- **Backend ownership:** GraphRAG Go remains the universal graph-query backend. Chain Insights owns the high-level investigation recipe.

## File Structure

- Create `src/investigation/scam-topology.ts`: Scam topology orchestration, candidate classification, graph merge, summary, and optional case evidence append.
- Modify `src/investigation/public-tools.ts`: export `scamTopology` and shared result type for proxy/CLI use.
- Modify `src/mcp/proxy.ts`: describe and register `scam_topology`, attach graph report metadata, update workflow/help copy.
- Modify `src/cli.ts`: add `mcp scam-topology` command and local `mcp call scam_topology` routing.
- Modify `src/playbooks/builtins.ts`: add `scam-topology` built-in playbook.
- Modify `skills/chain-insights-trace-funds/SKILL.md`: mention when to use `scam_topology` versus `track_funds`.
- Modify `README.md`: document `scam_topology` as a local high-level Chain Insights recipe.
- Add `tests/scam-topology.test.ts`: pure behavior tests for seed validation and label-candidate semantics.
- Modify `tests/mcp-proxy.test.ts`: registration and graph report behavior.
- Modify `tests/cli-mcp.test.ts` and `tests/cli.test.ts`: CLI call and help behavior.
- Modify `tests/playbook-builtins.test.ts` and `tests/playbook-cli.test.ts`: built-in playbook exposure.
- Modify `tests/skills-contract.test.ts`: skill docs mention `scam_topology`.

## Task 1: Core Scam Topology Semantics

**Files:**
- Create: `tests/scam-topology.test.ts`
- Create: `src/investigation/scam-topology.ts`
- Modify: `src/investigation/public-tools.ts`

- [x] **Step 1: Write failing tests** for required seeds, victim safety, and scammer-derived label candidates.
- [x] **Step 2: Run RED:** `npx vitest run tests/scam-topology.test.ts`, expecting missing implementation failure.
- [x] **Step 3: Implement minimal core** with explicit seed-role validation, calls to `runFundFlowProbe`, deduped label candidates, case roles, safety decisions, normalized graph data, and optional compact case evidence.
- [x] **Step 4: Export from public tools** with `export { scamTopology, type ScamTopologyOptions, type ScamTopologyResult } from './scam-topology.js'`.
- [x] **Step 5: Run GREEN:** `npx vitest run tests/scam-topology.test.ts`.

## Task 2: MCP Proxy Exposure

**Files:**
- Modify: `src/mcp/proxy.ts`
- Modify: `tests/mcp-proxy.test.ts`

- [x] **Step 1: Write failing proxy test** asserting `scam_topology` registration, structured result, and graph report URL when remote only has graph primitives.
- [x] **Step 2: Run RED:** `npx vitest run tests/mcp-proxy.test.ts -t scam_topology`.
- [x] **Step 3: Register `scam_topology`** as a graph-app local tool with required args, schema, description, graph report write, and help/workflow copy.
- [x] **Step 4: Run GREEN:** `npx vitest run tests/mcp-proxy.test.ts -t scam_topology`.

## Task 3: CLI And Playbook Exposure

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/playbooks/builtins.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/cli-mcp.test.ts`
- Modify: `tests/playbook-builtins.test.ts`
- Modify: `tests/playbook-cli.test.ts`

- [x] **Step 1: Write failing CLI/playbook tests** for `mcp scam-topology`, local `mcp call scam_topology`, and built-in playbook exposure.
- [x] **Step 2: Run RED:** `npx vitest run tests/cli.test.ts tests/cli-mcp.test.ts tests/playbook-builtins.test.ts tests/playbook-cli.test.ts -t "scam|scam_topology"`.
- [x] **Step 3: Implement CLI/playbooks** with `--victim-addresses`, `--scammer-addresses`, `--network`, `--case`, `--max-hops`, `--per-address-limit`, and `--min-amount-sum`.
- [x] **Step 4: Run GREEN:** same targeted command.

## Task 4: Docs And Skills

**Files:**
- Modify: `README.md`
- Modify: `skills/chain-insights-trace-funds/SKILL.md`
- Modify: `tests/skills-contract.test.ts`

- [x] **Step 1: Write failing docs test** requiring `scam_topology`, seed roles, and label candidates in guidance.
- [x] **Step 2: Run RED:** `npx vitest run tests/skills-contract.test.ts -t scam_topology`.
- [x] **Step 3: Update docs** explaining that `track_funds` answers where funds went while `scam_topology` derives topology roles and label candidates from known scam cases.
- [x] **Step 4: Run GREEN:** same targeted command.

## Task 5: Full Verification And Dev UAT

**Files:**
- No planned source edits unless verification exposes defects.

- [x] **Step 1: Run local verification:** `npm test`, `npm run typecheck`, and `npm run build`.
- [x] **Step 2: Build local dev containers:** from `/home/aphex5/work/rbmk/repos/ml`, run `docker compose build graphrag-mcp-go`, `docker compose up -d --no-deps graphrag-mcp-go`, and `docker compose ps graphrag-mcp-go memgql-bittensor`.
- [x] **Step 3: Run standard Chain Insights GraphRAG UAT:** `skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh` against `http://localhost:8012/mcp`.
- [x] **Step 4: Run Bittensor scam topology smoke:** `node bin/cli.js mcp scam-topology --network bittensor --scammer-addresses 5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6 --max-hops 2 --per-address-limit 2`.

## Completion Audit

Before claiming completion:
- Restate each Definition of Done item.
- Map each item to a file, test, command, or UAT artifact.
- Re-run or inspect evidence for each item.
- Treat missing dev docker compose or UAT failures as incomplete unless clearly unrelated and documented with command output.
