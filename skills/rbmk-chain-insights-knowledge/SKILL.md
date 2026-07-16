---
name: rbmk-chain-insights-knowledge
description: Use when working in the chain-insights repository — cia CLI, chain-insights-mcp-proxy, the canonical aml_*/graph_*/meta_*/wallet_* tool surface, tool-visibility, graphMcpEndpoint / CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT config, investigation workspaces, graph reports, x402 wallet payment, shipped chain-insights-* product skills, the local Bittensor graph devkit (devkit:smoke, parity smoke, 18012/mcp), or the release gate (release:check, CHANGELOG bump, npm pack).
---

# RBMK Chain Insights Knowledge

Load after `rbmk-knowledge-index` for work inside `repos/infra/chain-insights`.

## Purpose & Boundaries

Public open-source AML investigation toolkit: npm package `chain-insights` providing the `cia` / `chain-insights` CLI and a stdio MCP proxy (`chain-insights-mcp-proxy`) over a Chain Insights Graph (GraphRAG MCP) endpoint, plus local wallet/x402 payment, investigation workspaces, graph reports/viz, shipped product skills, and a local Bittensor graph devkit.

Owns:
- CLI + MCP proxy source under `src/` (`src/cli.ts`, `src/mcp/proxy.ts`, `src/mcp/tool-visibility.ts`, `src/mcp/capabilities.ts`, `src/wallet/`, `src/investigation/`, `src/viz/`, `src/workspace/`).
- The canonical prefixed public tool surface `aml_*`/`graph_*`/`meta_*`/`wallet_*`; unprefixed remote names are hidden via `HIDDEN_REMOTE_TOOL_NAMES` in `src/mcp/tool-visibility.ts`; local tools (`meta_network_capabilities`, `meta_usage_status`, `meta_help`, `wallet_balance`) live in `src/mcp/proxy.ts`.
- Shipped PRODUCT skills under `skills/` (`chain-insights-*`, `ci-status`, `test-chain-insights-graph`) — a SEPARATE product surface packaged into the npm tarball (`package.json` files[]) and enforced by `tests/skills-contract.test.ts`. This RBMK knowledge skill must not duplicate or replace them.
- `devkit/`: deterministic local Bittensor graph backend (StarRocks facade tables, Memgraph, and a devkit-only lite Go backend under `devkit/chain-insights-graph-devkit/`); the lite backend landed via PR #130, fixture parity via PRs #131/#132.
- Public docs (`README.md`, `docs/mcp-proxy.md`, `docs/graph-tools.md`, `docs/architecture/`, `docs/acceptance/`, `docs/investigation-workspaces.md`, `docs/debugging.md`), release gate `scripts/check-release-gate.mjs`, and `CHANGELOG.md`.

Consumes (does NOT own):
- The Chain Insights Graph MCP endpoint — GraphRAG MCP lives inside data-pipeline; serving-tier and sync detail is owned by `rbmk-system-knowledge`.
- Devkit fixture data generated from the RBMK-controlled export path: `bash scripts/devops/chain-insights-devkit/build-fixture.sh` run from the RBMK root.
- Base mainnet RPC for wallet/x402 payment (`src/wallet/tools.ts`, `BASE_RPC_URL` override) — payment chain only, not a graph-support claim.

## Data Contracts

- Public MCP tool arg contracts: `PUBLIC_MCP_TOOL_REQUIRED_ARGS` / `PUBLIC_MCP_TOOL_ALLOWED_ARGS` in `src/mcp/tool-visibility.ts` (e.g. `aml_address_risk` requires address+network; `graph_query_batch` allows `per_query_timeout_seconds`).
- `visibleRemoteTools()` filters the remote tool list so unprefixed backend names (`address_risk`, `trace_victim_funds`, `trace_suspect_funds`, `trace_deposit_sources`, `trace_funds`, `track_funds`, `network_capabilities`, `usage_status`, `balance`, `topup`, `help`, `money_flows_between_exchanges`, `address_connection_risk`) never surface publicly.
- `meta_network_capabilities` collapses backend networks into a single public `bittensor` entry (`BITTENSOR_SEMANTIC_NETWORKS` in `src/mcp/capabilities.ts`).
- Endpoint precedence: `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` > legacy `GRAPH_MCP_ENDPOINT` > saved `graphMcpEndpoint` > default `http://127.0.0.1:8012/mcp`. `http://` only for loopback or Kubernetes `*.svc.cluster.local` service DNS (`validateMcpEndpoint` in `src/config/mcp-endpoint.ts`); other remote hosts must be `https://`; no credentials/query/fragment in the URL. Hosted staging: `https://staging-mcp.chain-insights.ai/mcp`; production not live yet.
- Devkit backend exposes ONLY `network_capabilities`/`usage_status`/`graph_query`/`graph_query_batch` at `http://127.0.0.1:18012/mcp` and intentionally tracks production contract: two-graph query timeouts (topology 10s, facts 30s), topology/facts capability sublayers, unmetered usage_status; `USE topology`→Memgraph directly (the unified graph serving all recent and historical topology), `USE facts`→StarRocks via the corpus translator (MemGQL retired). Tier detail is owned by `rbmk-system-knowledge`.
- Investigation output stays local in user workspace dirs: `.chain-insights/`, `cases/`, `reports/`, `artifacts/`.
- Graph app UI resource `ui://chain-insights/graph` is attached to the four `aml_*` tools (`GRAPH_APP_TOOL_NAMES` in `src/mcp/proxy.ts`).
- Devkit smoke evidence lands under `workspace/devkit-smoke/` and `workspace/devkit-smoke/chain-insights-parity/`.

## Invariants & Operating Rules

- `AGENTS.md` and `CLAUDE.md` are twin files kept byte-identical — edit both together or neither.
- Every PR that changes tracked files must bump `package.json`, `package-lock.json`, and `CHANGELOG.md`; enforced by `npm run release:check` in `verify.yml` on pull_request.
- This is a PUBLIC repo: no private repo names, local workspace paths, internal planning catalogs, private deployment details, or org-only workflow names in tracked files. Use the name "Chain Insights Graph" for the graph layer.
- Public workflow network support is Bittensor-only; the wallet pays on Base mainnet as the payment chain only.
- The devkit exposes graph primitives only — never `aml_*`, wallet, x402, payment, quota, ACP, or telemetry tools; AML workflows are provided locally by Chain Insights over those primitives. The devkit never imports raw block streams, sync state, indexer checkpoints, wallet/payment/quota metadata, or telemetry tables; StarRocks holds only the graph-mapped view objects as physical tables.
- Node >= 22 required (`package.json` engines); CI installs with `npm ci --ignore-scripts`.
- Method ownership — reference, do not restate: Inspector/ACP surface audits (tools/list, prompts/list, prefixed-name sync, aml-acp catalogue) belong to root skill `rbmk-cia-mcp-inspector`; ACP release method to `rbmk-acp-release`; real local UAT against GraphRAG MCP to `test-chain-insights-graphrag-mcp`; npm release testing to `test-chain-insights-npm-release`.
- For a deterministic local Bittensor backend, use the devkit (`export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp`) instead of staging.
- Devkit clean-state cycle: `docker compose -f devkit/docker-compose.yml down -v --remove-orphans` then `up -d --build`; one-shot import/bootstrap services must exit 0 and starrocks/memgraph/chain-insights-graph-devkit must stay running.
- The devkit fixture is a static export of real Bittensor semantic data 2024-01-01 → 2026-07-02; the largest topology object is chunked into Git-safe parts.
- Keep docs product-first, user-workflow-first (install → init → configure graph access → run AML tools → review evidence); localhost endpoints are fine in debugging docs, private paths are not.
- MCP proxy mode: `CHAIN_INSIGHTS_MCP_PROXY_MODE=workspace` (default) or stateless/no-workspace (`resolveMcpProxyMode` in `src/mcp/proxy.ts`).

## Layout & Entry Points

- `bin/cli.js` → `src/cli.ts` (CLI bins: `cia`, `chain-insights`).
- `bin/mcp-proxy.cjs` → `src/mcp/proxy.ts` (MCP server bin: `chain-insights-mcp-proxy`).
- `src/index.ts` — library exports (`dist/index.mjs|cjs`).
- `devkit/docker-compose.yml` + `devkit/scripts/smoke.sh` + `devkit/scripts/smoke-chain-insights-parity.sh`.
- `.github/workflows/verify.yml` (typecheck/build/release:check/test/npm pack contents), `security.yml`, `scorecard.yml`, `docs.yml`, `secret-stdout-mask-smoke.yml` (manual token-masking check).
- `scripts/check-release-gate.mjs` — release gate.

## Verification Ladder

Before finishing changes (per `AGENTS.md`), then escalate as needed:

1. `npm run typecheck`
2. `npm run build`
3. `npm test` (vitest run)
4. `npm run release:check` (PR-only step in `verify.yml`)
5. `npm ci --ignore-scripts --audit=false --fund=false` (CI install step, when reproducing CI)
6. `npm run devkit:smoke` and `npm run devkit:smoke:parity` (devkit changes)
7. `docker compose -f devkit/docker-compose.yml ps -a` (devkit service state)
8. `cia --version && cia update --check` (installed CLI sanity)
9. `cia config get graphMcpEndpoint && cia mcp networks && cia mcp call meta_usage_status` (end-to-end proxy sanity)

## Gotchas

- `verify.yml` deliberately runs `ubuntu-latest` for pull_request and `chainswarm-runner` for push/dispatch (a runs-on ternary) — PR CI does not exercise the self-hosted fleet.
- UATs expecting unprefixed tool names (`address_risk`, `trace_funds`, ...) are stale: those names are deliberately hidden and `assertPublicMcpToolName()` throws with a suggested `aml_*`/`meta_*` replacement.
- Repo CI has a release gate blocking non-release PRs and a secret scan flagging `0x{64}` hex — avoid committing 64-hex strings; merges may need owner/`--admin`.
- `npm run build` is not plain tsdown: it also copies `src/viz/templates` → `dist/templates` and wallet mcp-proxy assets → `dist/assets`; skipping it stales the packaged UI assets.
- Devkit parity smoke checks `wallet_balance` only as a local unconfigured-wallet path — wallet state is owned by Chain Insights, never the devkit backend.
- The production Chain Insights Graph assembly is NOT used by the devkit — `devkit/chain-insights-graph-devkit` is a separate lite Go backend built entirely from this repo.
- Backend big-query memory limits can surface as generic timeout-like errors on archive queries — detail owned by `rbmk-system-knowledge`; do not diagnose as a proxy bug.
- `package.json` files[] ships `bin`, `dist`, `skills`, `docs/*.md`, `docs/images` — adding a skill or doc changes the published tarball; `verify.yml` runs `npm pack` and lists contents.
- npm overrides pin `ws` to 8.21.0 (`package.json`).

## Source Of Truth

Repo-relative, inside `repos/infra/chain-insights`:

- `AGENTS.md` (twin of `CLAUDE.md`) — repo rules.
- `README.md` — install, quick start, endpoint config.
- `docs/mcp-proxy.md`, `docs/graph-tools.md` — proxy and tool surface docs.
- `src/mcp/tool-visibility.ts`, `src/mcp/proxy.ts`, `src/mcp/capabilities.ts` — public tool surface truth.
- `devkit/README.md` — devkit contract, fixture, smoke procedures.
- `.github/workflows/verify.yml` — CI truth.
- `package.json` — scripts, bins, files[], engines, overrides.
- `tests/skills-contract.test.ts` — shipped-skills contract.
- `scripts/check-release-gate.mjs` — release-gate truth.
- `docs/architecture/ARCHITECTURE.md`, `docs/acceptance/` — architecture and acceptance evidence.

Cross-repo context (graph serving tiers, data-pipeline ownership, dev stack, releases): `rbmk-system-knowledge`, `rbmk-dev-stack`, `rbmk-cia-mcp-inspector`, `rbmk-acp-release`.
