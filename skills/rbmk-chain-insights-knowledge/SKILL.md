---
name: rbmk-chain-insights-knowledge
description: Use when working in the chain-insights repository — cia CLI, chain-insights-mcp-proxy, the canonical aml_*/graph_*/meta_*/wallet_* tool surface, tool-visibility, graphMcpEndpoint / CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT config, investigation workspaces, graph reports, x402 wallet payment, shipped chain-insights-* product skills, the local Bittensor graph devkit (devkit:smoke, parity smoke, 18012/mcp), internal detection scanners (cia detect), or the release gate (release:check, CHANGELOG bump, npm pack).
---

# RBMK Chain Insights Knowledge

Load after `rbmk-knowledge-index` for work inside `repos/infra/chain-insights`.

## Purpose & Boundaries

Public open-source AML investigation toolkit: npm package `chain-insights` providing the `cia` / `chain-insights` CLI and a stdio MCP proxy (`chain-insights-mcp-proxy`) over a Chain Insights Graph (GraphRAG MCP) endpoint, plus local wallet/x402 payment, investigation workspaces, graph reports/viz, shipped product skills, and a local Bittensor graph devkit.

Owns:
- CLI + MCP proxy source under `src/` (`src/cli.ts`, `src/mcp/proxy.ts`, `src/mcp/tool-visibility.ts`, `src/mcp/capabilities.ts`, `src/wallet/`, `src/investigation/`, `src/detection/`, `src/viz/`, `src/workspace/`).
- The canonical prefixed public tool surface `aml_*`/`graph_*`/`meta_*`/`wallet_*`; unprefixed remote names are hidden via `HIDDEN_REMOTE_TOOL_NAMES` in `src/mcp/tool-visibility.ts`; local tools (`meta_network_capabilities`, `meta_usage_status`, `meta_help`, `wallet_balance`) live in `src/mcp/proxy.ts`.
- Internal-only findings tooling relocated from data-pipeline's `internal/recipes/*.go` (rbmk#462): `src/detection/` (registry.ts, runtime.ts, run.ts, checkpoint.ts, emit.ts, graph-client.ts, lookalike.ts, params.ts, detectors/{fake-token,mixer,address-poisoning,attack-attribution}.ts) plus `src/investigation/scam-corridor-trace.ts` and `exchange-likeness.ts`. All six `DETECTION_TOOL_NAMES` (`src/investigation/detection-findings.ts`) — `aml_scam_corridor_trace`, `aml_exchange_likeness`, `aml_address_poisoning`, `aml_fake_token`, `aml_attack_attribution`, `aml_mixer_likeness` — are CLI-only, absent from `tool-visibility.ts`'s public contracts (enforced by `tests/detection-tools-visibility.test.ts`), and never set a finding's reviewer/label directly.
- Shipped PRODUCT skills under `skills/` (`chain-insights-*`, `ci-status`, `test-chain-insights-graph`) — a SEPARATE product surface packaged into the npm tarball (`package.json` files[]) and enforced by `tests/skills-contract.test.ts`. This RBMK knowledge skill must not duplicate or replace them.
- `devkit/`: deterministic local Bittensor graph backend (StarRocks facade tables, Memgraph, and a devkit-only lite Go backend under `devkit/chain-insights-graph-devkit/`); the lite backend landed via PR #130, fixture parity via PRs #131/#132.
- Public docs (`README.md`, `docs/mcp-proxy.md`, `docs/graph-tools.md`, `docs/search-limits.md`, `docs/architecture/`, `docs/acceptance/`, `docs/investigation-workspaces.md`, `docs/debugging.md`), release gate `scripts/check-release-gate.mjs`, and `CHANGELOG.md`.

Consumes (does NOT own):
- The Chain Insights Graph MCP endpoint — GraphRAG MCP lives inside data-pipeline; serving-tier and sync detail is owned by `rbmk-system-knowledge`.
- Devkit fixture data generated from the RBMK-controlled export path: `bash scripts/devops/chain-insights-devkit/build-fixture.sh` run from the RBMK root.
- Base mainnet RPC for wallet/x402 payment (`src/wallet/tools.ts`, `BASE_RPC_URL` override) — payment chain only, not a graph-support claim.

## Data Contracts

- Public MCP tool arg contracts: `PUBLIC_MCP_TOOL_REQUIRED_ARGS` / `PUBLIC_MCP_TOOL_ALLOWED_ARGS` in `src/mcp/tool-visibility.ts` (e.g. `aml_address_risk` requires address+network; `graph_query_batch` allows `per_query_timeout_seconds`; `aml_trace_deposit_sources` allows `max_hops`/`row_limit`, `aml_trace_victim_funds`/`aml_trace_suspect_funds` allow `max_hops`/`per_address_limit`). An argument absent from this allowlist is silently stripped by `normalizeRemoteToolArguments`, so every new tunable arg must be added here and to `src/mcp/call-args.ts`'s numeric-argument set the moment it appears on a tool schema (`tests/configurable-limits.test.ts` covers this end-to-end).
- Every search bound across investigation and detection tools resolves through one shared registry, `src/config/limits.ts` (`LIMIT_SPECS`), highest layer wins: per-call argument (MCP arg / CLI flag / detector `--param`) → `networkLimits.<network>.<key>` in `~/.chain-insights/config.json` → `limits.<key>` (all networks) → per-network default table (`NETWORK_LIMIT_DEFAULTS`, empty today) → built-in default. Every knob carries a hard `ceiling`; only a code change to `limits.ts` may raise it, a per-network entry may only lower it, and an out-of-range request (per-call or config) throws `LimitRangeError` rather than being silently clamped. Covers `trace_max_hops`/`trace_per_address_limit` (victim/suspect fund tracing), `deposit_sources_max_hops`/`deposit_sources_row_limit` (`aml_trace_deposit_sources`), `corridor_max_hops`/`corridor_frontier_cap`/`corridor_query_row_limit` (`aml_scam_corridor_trace`), `exchange_likeness_max_candidates` (`aml_exchange_likeness`), `viz_max_nodes`, and the detection numeric caps below. Hop-depth knobs (`HOP_LIMIT_KEYS`) carry the tightest ceilings because cost grows exponentially with depth, not linearly. Trace/detection results report `input.search_limits` (`limitsReport()`: requested/used/default/ceiling per knob) so a bounded search is visible without reading warnings; defaults are unchanged from their pre-registry hardcoded values. Full table: `docs/search-limits.md`.
- `aml_trace_deposit_sources`'s reverse-path queries (`reverseDepositSourceQueryAtDepth` in `src/investigation/public-tools.ts`) rank upstream paths by their narrowest (bottleneck) edge value before `deposit_sources_row_limit` truncates, so a high-fan-in deposit loses its least value-bearing routes first instead of an arbitrary slice (chain-insights#237; on a real deposit the old unordered 500-row cap left the origin unreachable at four hops, while 5000 closed the same trace in ~6s). The truncation warning names the weakest retained path's value (the upper bound on anything dropped) and how much ceiling headroom `row_limit` still has.
- `visibleRemoteTools()` filters the remote tool list so unprefixed backend names (`address_risk`, `trace_victim_funds`, `trace_suspect_funds`, `trace_deposit_sources`, `trace_funds`, `track_funds`, `network_capabilities`, `usage_status`, `balance`, `topup`, `help`, `money_flows_between_exchanges`, `address_connection_risk`) never surface publicly.
- `meta_network_capabilities` collapses backend networks into a single public `bittensor` entry (`BITTENSOR_SEMANTIC_NETWORKS` in `src/mcp/capabilities.ts`).
- Endpoint precedence: `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` > legacy `GRAPH_MCP_ENDPOINT` > saved `graphMcpEndpoint` > default `http://127.0.0.1:8012/mcp`. `http://` only for loopback or Kubernetes `*.svc.cluster.local` service DNS (`validateMcpEndpoint` in `src/config/mcp-endpoint.ts`); other remote hosts must be `https://`; no credentials/query/fragment in the URL. Hosted staging: `https://staging-mcp.chain-insights.ai/mcp`; production not live yet.
- Devkit backend exposes ONLY `network_capabilities`/`usage_status`/`graph_query`/`graph_query_batch` at `http://127.0.0.1:18012/mcp` and intentionally tracks production contract: two-graph query timeouts (topology 10s, facts 30s), topology/facts capability sublayers, unmetered usage_status; `USE topology`→Memgraph directly (the unified graph serving all recent and historical topology), `USE facts`→StarRocks via the corpus translator (MemGQL retired). Tier detail is owned by `rbmk-system-knowledge`.
- The four `cia detect <detector>` scanners read only through `src/detection/graph-client.ts`'s `graph_query` wrapper (never direct warehouse access) and are pure `scan(window, client, network, params) → findings[]` cores (`DetectorScan` in `src/detection/runtime.ts`). All four are parametrized (rbmk#462): each ships a per-network default table layered with operator `--param key=value` overrides, and the effective config is always echoed in the findings document's `threshold_provenance`. Numeric search-bound knobs (attack-attribution's `max_hops`/`max_frontier`/`max_rows`, address-poisoning's `max_rows`, fake-token's `max_pages`/`page_size`) resolve through the shared `config/limits.ts` registry above via `limitFromParams` and reject an out-of-range `--param` with `LimitRangeError` (previously `numParam` accepted any non-negative number with no ceiling — a live way to hang the graph). Non-bounded knobs still use `src/detection/params.ts`'s coercion helpers (`numParam`/`strParam`/`listParam` — malformed numbers fall back to the default, csv lists are trimmed/lowercased). `mixer` (`src/detection/detectors/mixer.ts`) ships per-network default hourglass floors (`MIXER_NETWORK_DEFAULTS`: bittensor 50/50, bittensor_evm 20/20, generic fallback 5/5) with `min_in`/`min_out`/`max_candidates`/`time_scope`/`role_keywords` overrides — none of mixer's knobs moved to the shared registry; its degree-qualified batch scan defaults `time_scope=recent` (live shard only) since node-metric degrees are window-exact, not mergeable across temporal shards. `address-poisoning` ships a per-network dust floor (`POISONING_NETWORK_DEFAULTS`: bittensor and bittensor_evm both 0.0001) with `dust_floor`/`scan_window_days` via `numParam` and `max_rows` via the shared registry (`poisoning_max_rows`). `attack-attribution`'s per-network table (`ATTRIBUTION_NETWORK_DEFAULTS`) now holds only non-numeric taxonomy overrides (`seedLabels`/`boundaryKeywords`, empty today); its `max_hops`/`max_frontier`/`max_rows` are shared-registry knobs (`attribution_max_hops`/`attribution_max_frontier`/`attribution_max_rows`), and the seed override param is `seed_labels` (taxonomy node labels, default `Scam`) — `seed_subtypes` is kept only as a provenance/docs constant (`ATTRIBUTION_SEED_SUBTYPES`), not a live param. `fake-token` has no per-network divergence either (the assets dimension is small everywhere) but exposes `max_pages`/`page_size` as shared-registry knobs (`fake_token_max_asset_pages`/`fake_token_max_rows`).
- Investigation output stays local in user workspace dirs: `.chain-insights/` (including per-detector-per-network scan checkpoints under `.chain-insights/detectors/`, `src/detection/checkpoint.ts`), `cases/`, `reports/` (`aml_scam_corridor_trace`/`aml_exchange_likeness` findings land under `reports/tables/*.detection-findings.json` via `serializeFindings()`), `artifacts/`, `detections/` (the four `cia detect` scanners' findings JSON, named `<generated_at_timestamp>-<detector>-<network>.findings.json` by `src/detection/emit.ts`), `published/cases/<case_id>/` (monitor case dossiers/notes/timeline rendered by `src/monitor/render/`, e.g. `dossier.md`).
- Graph app UI resource `ui://chain-insights/graph` is attached to the four `aml_*` tools (`GRAPH_APP_TOOL_NAMES` in `src/mcp/proxy.ts`).
- Devkit smoke evidence lands under `workspace/devkit-smoke/` and `workspace/devkit-smoke/chain-insights-parity/`.

## Shared-Graph Model (highest-value correction)

`bittensor` and `bittensor_evm` are TWO VIEWS OVER ONE address-grain topology
graph, not two graphs. EVM H160 addresses live INSIDE the bittensor Memgraph
shards — 8,585 of them across the three temporal shards, verified live on the
dev stack 2026-07-26 — separated from SS58 addresses only by the
`Address.network` node PROPERTY. Consequences:

- `network` passed to `graph_query` selects the GRAPH, not the address subset.
  A `USE topology` match on `:Address` without an exact address MUST add a
  `<alias>.network = "<network>"` predicate — that is exactly what
  `networkPredicate()` in `src/detection/graph-client.ts` exists for (PR #229,
  after unscoped sweeps published wrong-network attributions at double cost).
  Address-anchored lookups stay unscoped on purpose: the address is a unique
  key, and scoping fails closed on an H160 screened under `network=bittensor`.
- `meta_network_capabilities` collapses the views into ONE public `bittensor`
  network; there is no `network=bittensor_evm` public argument. Detector cells
  may still name `bittensor_evm` because they scope by the node property.
- `USE facts` is the inverse: it is the only tier where each network gets its
  own backing database (`facts.routing.starrocks_database`), and the facts
  `Address` label has NO mapped `network` property — projecting it hard-fails
  with `unknown graph identifier: property "network" is not mapped on label
  "Address"`. Facts also serves `Address` only as a `TRANSFER` endpoint, so a
  single-node `MATCH (a:Address)` is refused (transfers-only tier).

Getting this backwards caused a production regression and a wrong-network
detector sweep in the same day. Verify against the live stack before restating
it.

## Monitor Surface (`src/monitor/`)

`cia monitor` (shipped v0.11.x) is the standing-watch surface over the same
detection machinery: `src/monitor/{runner,tracker,cases,review,alerts,export,
watchlist,watchlist-run,probe,init,store,report,config,paths,jsonl,atomic,
lock}.ts` plus the case-render pipeline `src/monitor/render/{index,mermaid,
trace-io,verdict,dossier,notes}.ts`, wired as the `monitor` command group in
`src/cli.ts`.

- Two profiles (victim lane, PR #268): `profile: 'operator'` (default) runs
  the detector cell matrix on `intervalSeconds`; `profile: 'victim'` runs zero
  detector cells and instead traces its one case only when new activity is
  observed (`trace_mode` defaults to `on_movement` for this profile,
  `interval` otherwise — `resolvedProfile`/`resolvedTraceMode` in
  `src/monitor/config.ts` resolve both so every existing config literal stays
  type-valid). `cia monitor init victim --case-id --network --seed ...`
  (`src/monitor/init.ts`) bootstraps a fresh workspace in one command — case
  first, managed watchlist second, `config.json` last as the commit point, so
  a crash mid-init never leaves a configured monitor missing its case.
- Event-driven trace gating (`runMonitorOnce` in `src/monitor/runner.ts`): in
  `on_movement` mode an open case is traced only if it has no prior
  `*.snapshot.json`, has `dirty_since_timestamp` set, or `--force-trace` was
  passed on `cia monitor run`; otherwise the cell records
  `trace_skipped_reason: 'no_activity'` so a quiet monitor still reads as
  healthy rather than absent.
- Activity probe (`src/monitor/probe.ts`, victim lane spec req 4/5): one
  `graph_query_batch` per distinct watched network for
  `last_activity_timestamp > $cursor` over every address that network
  watches; per-shard rows are merged client-side by MAX, and a hit's
  `source_ref` is `"<address>|<last_activity_timestamp>"`. Per-network cursors
  persist in the append-only `logs/probe-cursors.jsonl` (last line wins) as a
  pure cost optimization — dedup against `watchlist_hits` is what actually
  prevents re-alerts, so a deleted or stale cursor can never fire a duplicate
  alert. A probe hit on a case-managed watchlist entry calls `markCaseDirty`
  (`src/monitor/cases.ts`), which is the gate letting `on_movement` mode trace
  that case in the same pass.
- Cluster auto-watchlist (`syncManagedWatchlist` in `src/monitor/watchlist.ts`,
  called from `src/monitor/tracker.ts` after every successful trace, unchanged
  traces included): refreshes each case's `managed_by: "case:<id>"` watchlist
  entries to the current corridor (seeds plus candidate intermediates/deposit
  endpoints), excluding `exchange_terminal` addresses (always active, so
  watching them would turn the movement tripwire into a constant alarm), and
  never touching manual entries or entries managed by another case.
- Case render pipeline (`src/monitor/render/index.ts`'s `renderCase`, wired as
  the runner's optional `renderCase` hook after the trace pass): on a changed
  case (sha256 over the latest snapshot, `case.json`, and the case's alert
  count — `caseRenderKey`) it re-traces both roles over the case seeds and
  writes `published/cases/<case_id>/dossier.md` (ACTIVE/DORMANT headline from
  `verdict.ts`, computed from the newest edge `first_seen_timestamp`/
  `last_seen_timestamp` — epoch milliseconds — against
  `render.dormant_after_days`, default 30), a bounded mermaid flow, per-address
  notes, and a timeline; an unchanged case is skipped with
  `skipped_reason: 'unchanged'`, tracked in
  `.chain-insights/monitor/render-state.json`.
- `cia monitor run` is a ONE-SHOT (one pass, exits). Deliberate: one-shot
  idempotent core, never a stateful service. The recommended standing-watch
  pairing is pm2 supervising `cia monitor watch` (`autorestart: true`; `watch`
  owns the loop on `intervalSeconds` from the monitor config, pm2 owns process
  lifetime/logs/status/boot persistence) — `pm2 list` showing `online` means
  healthy. Pairing pm2 with the one-shot `monitor run` via `cron_restart` is
  now documented as an anti-pattern: it is one missing `autorestart: false`
  away from pm2 treating every clean exit as a crash and hot-looping the full
  detector matrix against metered graph allowance. Plain `cron` + `monitor
  run` remains fine for hosts that already run cron and own their own log/
  alert plumbing.
- Exit codes (`cia monitor run` / cron scheduling only): `0` clean, `2`
  ISOLATED CELL FAILURE (pass completed, ≥1 cell errored —
  `MONITOR_EXIT_ISOLATED`), `1` the run could not start. Under `cia monitor
  watch` the process never exits between passes, so per-pass exit codes are
  not visible to a supervisor; an isolated cell failure instead lands on the
  cell entry in the pass's run document and in `cia monitor status` — check
  there, not pm2's process state.
- Default matrix (only when the config file is ENOENT): four detectors ×
  `bittensor`/`bittensor_evm`. An unreadable or invalid config throws — it must
  never silently fall back.
- Detector window modes: `address-poisoning` is `incremental` (advances a scan
  checkpoint); `fake-token`, `mixer`, `attack-attribution` are `full-state`
  (no checkpoint; an emitted-findings key set under `.chain-insights/detectors/
  <detector>.<network>.emitted.json`, `src/detection/emitted-state.ts`). So an
  unchanged run legitimately emits ZERO findings — that is the anti-backlog
  design, not a broken sweep. `--full` (on `cia detect`, never on
  `cia monitor run`) resets emitted state and re-emits everything. Empty
  documents are written and replayed by `monitor rebuild` as provenance but are
  NOT queued as pending review work (PR #233).
- Review is the only path to a label: approve writes a reviewer-stamped COPY
  under `detections/reviewed/`; the original findings document is never
  modified; `export labels` reads approved decisions only.
- Shipped skill `chain-insights-monitoring` (plus
  `references/pm2-scheduling.md`) is the agent-facing surface; `docs/
  monitoring.md` is the human one. Keep both in step with any monitor change —
  `skills/` ships in the tarball, so a capability no skill mentions is
  invisible to agents.

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
- Detection findings are artifacts, never a direct label write: `reviewer` stays intentionally unset on every generated findings document; only a separate RBMK-root quality-gated import path turns a reviewed findings document into curated `core_address_labels` rows.

## Layout & Entry Points

- `bin/cli.js` → `src/cli.ts` (CLI bins: `cia`, `chain-insights`).
- `bin/mcp-proxy.cjs` → `src/mcp/proxy.ts` (MCP server bin: `chain-insights-mcp-proxy`).
- `src/index.ts` — library exports (`dist/index.mjs|cjs`).
- `src/config/limits.ts` — shared tunable/bounded search-limits registry (`LIMIT_SPECS`, `NETWORK_LIMIT_DEFAULTS`, `resolveLimit`/`resolveLimitDetail`, `LimitRangeError`); validated as part of `src/config/schema.ts`'s `limits`/`networkLimits` config keys.
- `src/detection/` (registry.ts, runtime.ts, run.ts, checkpoint.ts, emit.ts, graph-client.ts, lookalike.ts, params.ts, detectors/*) wired via `src/cli.ts`'s top-level `detect <detector>` command (`--full`, `--watch`, `--param k=v`); `src/investigation/scam-corridor-trace.ts` + `exchange-likeness.ts` are wired via the `cia mcp aml-scam-corridor-trace` / `aml-exchange-likeness` subcommands.
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
- The `aml_*`-named detection/findings tool ids (`aml_scam_corridor_trace`, `aml_exchange_likeness`, `aml_address_poisoning`, `aml_fake_token`, `aml_attack_attribution`, `aml_mixer_likeness`) are CLI-only findings-document tags, not registered MCP tools, and do not appear in `tool-visibility.ts` — don't confuse them with the canonical public `aml_*` surface.

## Source Of Truth

Repo-relative, inside `repos/infra/chain-insights`:

- `AGENTS.md` (twin of `CLAUDE.md`) — repo rules.
- `README.md` — install, quick start, endpoint config.
- `docs/mcp-proxy.md`, `docs/graph-tools.md` — proxy and tool surface docs.
- `docs/search-limits.md` — tunable search-bounds table and precedence.
- `src/mcp/tool-visibility.ts`, `src/mcp/proxy.ts`, `src/mcp/capabilities.ts` — public tool surface truth.
- `src/config/limits.ts` — tunable search-bounds registry truth.
- `src/investigation/detection-findings.ts`, `src/detection/registry.ts` — detection findings schema + detector id truth.
- `devkit/README.md` — devkit contract, fixture, smoke procedures.
- `.github/workflows/verify.yml` — CI truth.
- `package.json` — scripts, bins, files[], engines, overrides.
- `tests/skills-contract.test.ts` — shipped-skills contract.
- `scripts/check-release-gate.mjs` — release-gate truth.
- `docs/architecture/ARCHITECTURE.md`, `docs/acceptance/` — architecture and acceptance evidence.

Cross-repo context (graph serving tiers, data-pipeline ownership, dev stack, releases): `rbmk-system-knowledge`, `rbmk-dev-stack`, `rbmk-cia-mcp-inspector`, `rbmk-acp-release`.
