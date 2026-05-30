# Changelog

All notable changes to Chain Insights are recorded here.

## [0.3.1] - 2026-05-30

- Tightened trace traversal boundaries so exchange hot wallets are terminal
  endpoints only: forward trace tools now require every non-terminal path node
  to be non-exchange, reverse deposit traceback excludes exchange sources and
  exchange deposit seeds, and defensive result filtering drops backend rows that
  would classify exchange nodes as deposit or suspect candidates.
- Updated generated runtime schema guidance, shipped Chain Insights skills, MCP
  server instructions, and graph-tool docs to state that BFS, fixed-depth
  fallback, shortest-path, and manual `FLOWS_TO` traversals must not expand
  through exchange hot wallets.

## [0.3.0] - 2026-05-29

- Replaced the public trace workflow surface with role-specific
  `trace_victim_funds`, `trace_deposit_sources`, and `trace_suspect_funds`
  tools returning `chain-insights.trace.v1`; legacy public `track_funds` and
  `scam_topology` exposure is hidden.
- Added CLI commands for the new trace tools and updated workspace runtime
  skill, shipped skills, docs, playbooks, and UAT guidance to teach the
  victim -> deposit traceback -> suspect chaining workflow.
- Added a shipped Memgraph examples reference for `chain-insights-cypher`,
  covering staging-tested GraphRAG MCP reads, archive/facts examples, and
  fixed-hop traversal fallbacks for native Memgraph deep traversal syntax that
  the hosted endpoint currently rejects.
- Allowed skill-local `references/` bundles to be tracked and shipped while
  keeping root-level local investigation references ignored.
- Expanded Bittensor Cypher guidance with practical prefix search,
  address-family census, and combined SS58/EVM examples under
  `network=bittensor`.

## [0.2.31] - 2026-05-29

- Added shipped `chain-insights-cypher` and
  `chain-insights-bittensor-cypher` skills for schema-aware GraphRAG MCP
  GQL/Cypher work, including generic live/archive/facts layer guidance and
  Bittensor-specific SS58 plus EVM-pallet address handling.
- Updated graph-tool and MCP proxy docs to point agents at the new Cypher
  skills and to use portable schema probes that avoid non-portable metadata
  functions.

## [0.2.30] - 2026-05-29

- Clarified the investigation skill for Bittensor: native Substrate/SS58 `5...`
  addresses and EVM-pallet `0x...` addresses are queried under the same
  `network=bittensor`; agents should not switch networks based only on address
  format.

## [0.2.29] - 2026-05-29

- Added `usage_status` documentation and client coverage for the GraphRAG MCP public free `graph_query` quota.
- Updated graph access guidance to call out the default 10 execution seconds per IP per UTC day, explicit query `LIMIT`/pagination, and paid fallback after quota exhaustion.
- Let paid-mode GraphRAG MCP clients make public free calls before wallet setup, while still surfacing wallet-ready guidance when the endpoint returns payment required.

## [0.2.28] - 2026-05-29

- Added `chain-insights wallet import <private-key>` as the user-facing way to configure a Base payment wallet.
- Removed raw `walletPrivateKey` and debug-bypass guidance from hosted missing-wallet errors; normal users are now pointed to `wallet ready`, `wallet topup`, or invited tester access keys.
- Updated wallet setup docs to keep payment setup protocol details out of the normal activation path.

## [0.2.27] - 2026-05-29

- Made `chain-insights wallet ready` default output fully user-facing: normal users now see one-time payment setup guidance instead of approval mechanics or transaction hashes, while `--json` keeps machine-readable readiness fields for operators.
- Added `wallet ready --check-only` and `--payment-usdc` as the user-facing flags, keeping the older approval-named flags as hidden compatibility aliases.
- Clarified staging activation docs: approved testers should use `https://staging-mcp.chain-insights.ai/mcp` only until production is live.

## [0.2.26] - 2026-05-29

- The MCP proxy now starts its local Chain Insights tool surface even when paid GraphRAG MCP fetch setup needs wallet or access-key configuration. Fresh MCP clients can list `help`, wallet/case tools, and the local AML workflows first, then receive user-facing `wallet ready` or `access-key` guidance when graph-backed calls need hosted access instead of seeing the proxy exit during `tools/list`.

## [0.2.25] - 2026-05-28

- `scam_topology` auto-promotion now uses a decay-calibrated confidence threshold (0.5) instead of 0.72. Because carried value is scored from native token amounts — whose magnitudes sit far below the USD-scale value saturation — even a hop-1 incident-scale edge decays to ~0.5-0.6, so the old 0.72 bar was unreachable on victim-anchored traces and nothing ever auto-promoted. Combined with the `hop <= 2` gate, the close-hop real-value core now promotes while dust and deeper edges stay review-only.


## [0.2.24] - 2026-05-28

- Added `chain-insights wallet ready` to check Base USDC, Base ETH gas, and one-time payment approval readiness in one user-facing command before paid GraphRAG MCP calls.
- Paid GraphRAG MCP calls now automatically prepare the local wallet and retry once when the x402 endpoint reports missing payment approval, so new users do not need to understand low-level approval mechanics.
- Updated payment guidance across the CLI, MCP proxy, workspace scaffold, and docs to point users at `wallet ready` first.

## [0.2.23] - 2026-05-28

- `scam_topology` exchange-endpoint detection now keys off the authoritative `is_exchange` flag and exact `exchange` registry labels, and explicitly ignores nodes typed SCAM or VICTIM. Previously, label text that merely contained the word "exchange" or a brand name could cause a scam-typed node to be mistaken for an exchange, prematurely terminating fund-flow traversal and corrupting the exchange-deposit list. Traversal now continues through such nodes.
- `scam_topology` candidate confidence now decays with hop distance and scales with the carried value of each transfer, so a close-hop, high-value laundering edge outranks a deep, low-value one instead of every candidate sitting at a near-flat floor.
- `scam_topology` value scoring prefers the native transferred amount and falls back to USD only when no native amount is available, so unreliable or missing deep-hop USD pricing no longer distorts confidence.
- `scam_topology` now emits an automatic promotable tier: a close-hop, high-confidence core is marked `promote_confirmed` while the diluted tail stays `review_required`, reducing manual triage of low-signal candidates.

## [0.2.22] - 2026-05-28

- `scam_topology` no longer auto-labels shared exchange-deposit infrastructure as scam. A penultimate-to-exchange address whose deposit edge exceeds shared-infrastructure thresholds (`tx_count >= 1000` or `amount_usd_sum >= 5,000,000`) is recorded as a `do_not_label_shared_exchange_deposit` safety decision instead of a SCAM `exchange_deposit_candidate`, so high-throughput omnibus/routing addresses ($M, thousands of transfers) stay out of `scam_labels`. Scammer-dedicated cash-out deposits (low throughput) are unchanged.

## [0.2.21] - 2026-05-27

- Clarified npm-facing endpoint configuration: local loopback remains the package default, hosted staging is an explicit operator setting, hosted access requires an approved access key or prepared wallet, and payment/chain details stay in focused MCP docs.

## [0.2.20] - 2026-05-27

- Removed internal planning artifacts from the public repository and ignored the local planning catalog path.
- Cleaned public docs, shipped skills, and agent guidance so they use product-facing Chain Insights and GraphRAG MCP language.

## [0.2.19] - 2026-05-27

- Added the Chain Insights `stake_insights` recipe over GraphRAG `STAKES_IN` live/archive topology queries, including MCP proxy and CLI exposure, graph report metadata, and explicit backend-unavailable failures.
- Removed the hardcoded hosted GraphRAG MCP default from runtime config and workspace scaffold paths; local defaults now point to loopback.
- Added MCP endpoint validation for operator config (`graphMcpEndpoint` / `mcpEndpoint`) with explicit errors for malformed URLs, remote `http://`, credentials, and query/fragment usage.
- Added README operator guidance for MCP server address configuration across local, staging, and production environments, including precedence and validation rules.
- Removed synthetic fallback private-key generation from wallet topup startup; topup servers now require valid EVM wallet addresses at runtime entry points.
- Hardened topup HTML generation by validating wallet addresses and escaping or script-serializing dynamic values before embedding them in HTML/JS.
- Added topup regression tests for invalid wallet-address rejection and safe artifact rendering.

## [0.2.18] - 2026-05-26

- Updated GitHub Actions dependencies for checkout, Node setup, CodeQL, and OpenSSF Scorecard so CI runs on current pinned action releases.
- Updated tooling, MCP/payment, Hono, and Node server dependency locks for the release.
- Replaced generic Streamable HTTP payment failures with actionable Chain Insights access guidance.

## [0.2.17] - 2026-05-25

- Reworked npm package positioning with growth-friendly description, homepage, repository, issue tracker, and keywords.
- Updated the npm-facing README to link the website, GitHub, and npm package, and to explain x402-paid GraphRAG MCP access without exposing backend infrastructure names.
- Removed backend infrastructure names from public package docs, shipped skills, MCP tool copy, and generated workspace runtime guidance.

## [0.2.16] - 2026-05-25

- Added GitHub Actions workflow for automated npm publishing on release or manual dispatch.

## [0.2.15] - 2026-05-24

- Fixed the Chain Insights MCP proxy so graph query timeout options survive runtime query logging and slow `graph_query_batch` calls do not fall back to the SDK default timeout.
- Made `address_risk` report partial enrichment query failures without failing the whole screening or graph report.
- Updated the GraphRAG MCP UAT skill to validate a local GraphRAG MCP endpoint on port 8012.

## [0.2.14] - 2026-05-24

- Reworked README into a product-first Chain Insights overview with a cleaner quick start, AML tool showcase, GraphRAG MCP layering, and live/archive/facts topology guidance.
- Added Chain Insights developer-experience guidance plus focused contributing and debugging docs.
- Dogfooded the installed `cia` workflow from a clean workspace and documented the resulting README/CLI feedback.

## [0.2.13] - 2026-05-24

- Split the overloaded README into focused graph tools, workspace, MCP proxy, architecture, and development docs while keeping README as the operator entry point.
- Added scaffolded `imports/README.md` and `templates/README.md` files so fresh investigation workspaces explain how to use empty input/template directories.
- Made `cia init` preflight all scaffold file collisions before writing directories or files, avoiding partial workspaces when a target already contains files such as `README.md`.

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
