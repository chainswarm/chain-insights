# Changelog

All notable changes to Chain Insights are recorded here.

## [0.2.12] - 2026-05-23

- Added `case_id` / `--case` support to `scam_topology` across direct CLI, generic `mcp call`, and the Chain Insights MCP proxy.
- Made `scam_topology` case evidence match `track_funds`: cases now receive compact `chain-insights.evidence_pointer.v1` entries that point to workspace graph, HTML, CSV, compact JSON, and Markdown report artifacts.
- Updated README and investigation skills to document the scam-topology case evidence and artifact contract.

## [0.2.11] - 2026-05-23

- Reworked `scam_topology` traversal to use one explicit activity policy mode: `node_relative_only` by default or `global_incident_only` when requested.
- Added node-relative novelty wave metadata, non-expanding convergence edges, and one primary run in the structured result.
- Updated CIA CLI help, MCP schema, built-in scam-topology playbook, README JSON contract notes, and graph report output to use the canonical `source` / `target` edge convention.

## [0.2.10] - 2026-05-23

- Reworked `scam_topology` public input to one `victim_address` plus required `incident_timestamp_ms`; removed the public scammer seed, scope, since timestamp, per-address limit, and amount filter knobs.
- Added ML-ready `scam_labels` with simple `scam: true` flags and victim incident provenance while keeping `label_candidates` as review context.
- Fixed scam topology live queries to bind source addresses in the `MATCH` pattern, cap per-hop frontier breadth, and skip slow downstream frontier reads instead of failing the whole incident topology.

## [0.2.9] - 2026-05-23

- Expanded `scam_topology` label discovery around exchange-deposit clusters reached from known scam victim/scammer seeds.
- Added `deposit_cluster_inflow` topology edges so shared deposit senders become review-required laundering candidates instead of being omitted from the scam cluster.
- Preserved generic address labels as review context while keeping victims and exchange endpoints out of risky label candidates.

## [0.2.8] - 2026-05-23

- Reworked `scam_topology` into outward victim/scammer traversal with `history`, `incident`, and `compare` scopes.
- Added review-safe label candidate semantics: victims, exchange endpoints, and generic labeled context nodes are not automatic scam labels.
- Added `scope` and `since_timestamp_ms` support to the CIA CLI and MCP proxy.

## [0.2.7] - 2026-05-23

- Added `scam_topology` live infrastructure expansion: seed funding inputs, seed sweeps, and fan-in/fan-out context around traced laundering anchors.
- Raised `graph_query_batch` timeout metadata to 600 seconds so archive-scale graph reads can be requested through the Chain Insights proxy and GraphRAG MCP.
- Updated Chain Insights investigation docs/skills for the wider scam-topology graph report.

## [0.2.6] - 2026-05-22

- Switched Chain Insights graph recipes to MemGQL-native `live_topology`, `archive_topology`, and `facts` queries.
- Reworked `track_funds` to avoid MemGQL-unsupported BFS, variable-length paths, `labels()`, reserved aliases, and top-level `UNWIND`.
- Updated GraphRAG MCP UAT guidance for the primitive `graph_query` and `graph_query_batch` endpoint.

## [0.2.5] - 2026-05-21

- Removed the experimental archival topology backend path and kept local investigation recipes on Memgraph BFS.
- Simplified graph schema caching to one runtime schema file per network.

## [0.2.4] - 2026-05-21

- Kept Chain Insights probes on graph-language reads: `track_funds` and `address_risk` use bounded Memgraph BFS recipes over `graph_query_batch`.
- Added schema discovery for runtime graph reports and compact evidence files.
- Added numeric-string handling and reverse-lead degree checks so trace reports stay stable for Bittensor exchange-path probes.

## [0.2.3] - 2026-05-19

- Tightened investigation workspace output: large JSON evidence is stored under `reports/tables/` with compact evidence pointers, case briefs are more actionable, dossiers omit empty placeholder sections, and runtime logs now live under `.chain-insights/runtime/logs/`.
- Clarified that `reports/graphs/` is the canonical graph payload location and duplicated graph artifacts are not created.
- Fixed `cia mcp track-funds --case <number>` so numeric case selectors resolve to the real case ID before evidence is attached.
- Restored Python GraphRAG MCP golden semantics for local `track_funds` forward exchange discovery: Chain Insights now issues Memgraph `FLOWS_TO *BFS` through the Go Graph MCP primitive instead of replacing the probe with plain variable-length path enumeration.
- Restored Python GraphRAG MCP golden semantics for local `address_risk` exchange discovery: exchange outflow/inflow checks use Memgraph `FLOWS_TO *BFS` with Python-style result budgets instead of bounded `FLOWS_TO *1..N` recipes, and missing stored risk fields now produce deterministic risk facts instead of `unknown/null`.

## [0.2.2] - 2026-05-18

- Updated x402/viem dependencies and pinned `ws` override to clear production npm audit.

## [0.2.1] - 2026-05-18

- Added `chain-insights access-key set|clear|status` for simple invited tester setup without exposing x402 details.
- Documented Graph MCP test access key mode for invited users who should bypass x402 payment.
- Documented server-side test key hash configuration and rotation guidance.

## [0.2.0] - 2026-05-18

- Added GitHub release discipline: PR release gate, semver bump enforcement, and changelog enforcement.
- Added repository security posture: Verify, Security, OpenSSF Scorecard, Dependabot, npm registry signature verification, CodeQL, and secret-pattern scanning.
- Added canonical graph report schema support and local graph report serving from workspace `reports/graphs`.
- Added workspace output-root handling so investigation outputs stay in initialized workspaces.
- Added wallet balance visibility for Base ETH gas alongside USDC.
- Updated the default Graph MCP endpoint to staging.
