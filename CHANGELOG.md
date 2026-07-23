
# Changelog

All notable changes to Chain Insights are recorded here.

## [0.10.13] - 2026-07-23

- Detection-to-CIA (rbmk#462), remaining detectors: `address-poisoning`,
  `attack-attribution`, and the mixer batch candidate-source now run through the
  same `cia detect <detector>` runtime as fake-token, completing the four-
  detector relocation from the data-pipeline backend recipes.
  `address-poisoning` scans a bounded recent facts window for dust transfers and
  flags dusters that are vanity lookalikes (shared prefix/suffix) of a victim's
  real prior counterparties. `attack-attribution` walks downstream FLOWS_TO from
  seed-labeled bad actors (poisoning_duster / dusting_source /
  fake_token_contract) up to a bounded hop depth, stopping at infrastructure
  boundaries (exchange/bridge/mixer/contract/validator). `mixer` gains a
  degree-qualified candidate source so its batch `scan()` enumerates hourglass
  candidates instead of returning empty. All emit reviewer-unset
  `chain-insights.detection-findings.v1` documents — the curated-import gate is
  unchanged. Ported thresholds are recorded as tunables (DEC-7); full-history
  poisoning sweeps beyond the bounded window are marked truncated pending the
  time_scope follow-up (DEC-11). Backend recipes remain untouched (operator-
  gated retirement, DEC-9).

## [0.10.12] - 2026-07-23

- Detection-to-CIA (rbmk#462), first slice: a client-side detection runtime and
  the fake-token detector, relocated from the data-pipeline backend recipe.
  `cia detect fake-token --network <net> [--full|--since-checkpoint] [--watch]`
  scans the verified-token registry (facts_assets_view) for symbol-spoof
  contracts and emits a `chain-insights.detection-findings.v1` document with the
  reviewer deliberately unset — the curated-import gate stays the only path to a
  label. Incremental checkpoints (`.chain-insights/detectors/`) advance only
  after a findings file is durably written. The mixer hourglass classifier core
  ships (candidate-driven, mirrors exchange-likeness); its interactive tool and
  batch candidate-source wiring land next. Findings schema gains the four
  relocated detectors' tool names + classifications; the rbmk import gate maps
  them to curated labels. Backend recipes are untouched (operator-gated
  retirement).

## [0.10.11] - 2026-07-22

- Facts tier is transfers-only end-to-end: remove the two documented
  single-node `USE facts MATCH (a:Address)` recipes (`recipe_facts_03`,
  `recipe_facts_17`) — the serving layer now treats `Address` as an
  endpoint-only facts label (valid on TRANSFER endpoints; bare single-node
  facts MATCH refuses with a typed unsupported-shape error) after rbmk
  migration 0034 dropped `facts_addresses_view`. Query corpus regenerated
  (91 entries).

## [0.10.10] - 2026-07-22

- Retire the last facts `AddressFeature`/`HAS_FEATURE` references: the two
  documented recipes (`recipe_facts_01`, `recipe_facts_16`) are removed from
  `tests/fixtures/documented-recipes.json` (query corpus regenerated, 92
  entries), and `docs/graph-tools.md` / `docs/graph-query-compatibility.md`
  now point lifetime address metrics at `USE topology` node properties. In
  lockstep with rbmk migration 0033, which drops `facts_address_features_*`
  and adds `facts_addresses_view` (rbmk#447 P3/P5).

## [0.10.9] - 2026-07-22

- Federation compatibility for the AML trace tools: `aml_trace_victim_funds`
  and `aml_trace_suspect_funds` were refused end-to-end on the multi-shard
  topology (`cross_shard_scalar_projection`) because their fan-out queries
  projected `r.<prop>` scalars in the final RETURN (edge maps, reverse-lead
  `ORDER BY r.amount_usd_sum`). All trace builders now project EDGE OBJECTS
  and unwrap `properties` client-side (`edgeProperties`); `direct_edge_props`
  gains exact lifetime edge totals from the federated sum-merge; reverse
  leads order client-side. Golden trace snapshots updated under
  SPEC-2026-07-22-FED-PLANNER.
- `aml_address_risk` lifetime features (`address_feature`) read from
  federated `USE topology` node-metric projections (13 metrics incl. the
  activity window, oracle-verified exact via data-pipeline planner) instead
  of `facts_address_features_view` via `HAS_FEATURE` — the view's last
  reader is gone (rbmk#447 P3/P5). Prompt strings and the public cypher
  skills drop the facts `AddressFeature` surface accordingly.

## [0.10.8] - 2026-07-22

- `aml_exchange_likeness` reads the lifetime profile (degree_in,
  total_in_usd) from federated `USE topology` node-metric projections instead
  of `facts_address_features_view` via `HAS_FEATURE`. The federation
  typed-AST planner (rbmk#458) re-derives multi-shard node metrics exactly
  (additive props summed across disjoint shard windows, degrees as distinct
  counterparty set unions), oracle-verified — removing the tool's last facts
  feature-view dependency (rbmk#447 P3/P5) and fixing the 2026-07-09 ~10x
  window-vs-lifetime divergence at the $50M threshold.
- Security: dedupe `@hono/node-server` to the patched 2.0.11 line via an npm
  override (the MCP SDK's nested 1.19.x copy tripped GHSA-frvp-7c67-39w9);
  `npm audit` clean at all levels. `npm audit fix` refreshed `body-parser`
  and `fast-uri` advisories.

## [0.10.7] - 2026-07-21

- Adopt the open npm dependabot PRs in one batch (#193, #192, #182, #173):
  `hono` 4.12.27→4.12.31, `@hono/node-server` 2.0.8→2.0.11 (via `npm update`,
  supersedes the PR's 2.0.10 target), `@x402/evm` 2.17.0→2.19.0, `@x402/fetch`
  2.17.0→2.19.0, `viem` 2.53.x→2.55.4, `@types/node` 26.0.1→26.1.1, `tsdown`
  0.22.3→0.22.12, `tsx` 4.21.x→4.23.1, `vitest` 4.1.9→4.1.10, and `typescript`
  6.0.3→7.0.2 (major bump, `package.json` range updated; the other bumps
  already satisfied their existing `^` ranges so only `package-lock.json`
  moved). Full suite (typecheck, build, test, release:check) green after the
  bump.

## [0.10.6] - 2026-07-21

- Ship the capped `facts_transfers_view` devkit fixture (rbmk#447 P5 final
  leg, owner ruling 2026-07-21): a full 23-day slice is ~1.38M rows / 256MB
  raw, too heavy for a devkit fixture, so the rbmk exporter
  (`scripts/devops/chain-insights-devkit/export_queries.py`) now emits a
  capped, address-scoped `TRANSFER` export instead — rows touching the
  devkit's own `facts_address_features_view` address universe (either
  `from_address` or `to_address`), within the fixture window, ordered
  `block_timestamp DESC, tx_id, event_index, edge_index`, `LIMIT 50000`.
  Result: 50,000 rows / 1.63MB gz, well under the git-blob part-split
  threshold, so it ships as a single `devkit/data/starrocks/facts_transfers_view.tsv.gz`
  (no `.part-NNN.gz` split needed at this size — the existing parts
  machinery in `render-manifest.py` would kick in automatically past
  40MB). `devkit/data/manifest.json` gains the new object entry.
  `devkit/scripts/validate-manifest.py` moves `facts_transfers_view` from
  `ALLOWED_UNEXPORTED_TABLES` to `REQUIRED_TABLES`, and
  `devkit/scripts/smoke-memgql-objects.py` drops it from its own
  `ALLOWED_UNEXPORTED_TABLES` mirror (added in 0.10.5) — the `TRANSFER`
  edge coverage probe now runs for real instead of being skipped.

## [0.10.5] - 2026-07-21

- Fix Devkit Smoke CI failure on `c292b6e` ("MemGQL object coverage
  failed: 1 failure(s)"): `devkit/scripts/smoke-memgql-objects.py`
  asserts every mapped node/edge is queryable through the live devkit
  MCP endpoint, but `TRANSFER`→`facts_transfers_view` is mapped while
  its fixture is legitimately unexported (the capped TSV export is a
  separate, not-yet-shipped operator-side step) — the coverage probe was
  failing on a gap `validate-manifest.py` already tolerates via
  `ALLOWED_UNEXPORTED_TABLES`. `smoke-memgql-objects.py` gains its own
  `ALLOWED_UNEXPORTED_TABLES` (a duplicated 1-entry set with a
  KEPT-IN-SYNC comment pointing at `validate-manifest.py` — kept simple
  rather than a cross-script import, since these are standalone
  operator scripts with no existing shared-module pattern): checks
  against exempted tables are skipped with an explicit `"skipped
  (fixture not yet exported): <table>"` stderr line and excluded from
  the failure count, while coverage still fails for any mapped table
  that is absent/unreachable and NOT in the exemption set (the
  underlying `graph_query` call still executes and still raises for
  every non-exempted table, unchanged from before — verified locally
  with a monkeypatched `graph_query` since no pytest harness exists for
  devkit Python scripts). No other script in the smoke chain
  (`starrocks-ddl.py` also iterates the mapping, but only emits DDL
  driven off manifest presence, never asserts live queryability) needed
  the same fix.

## [0.10.4] - 2026-07-21

- Retire the facts-scope `NeuronEndpoint`/`Hotkey`/`IPAddress` mappings and
  their dead fixtures (rbmk#447 P4′-lite completion): `facts_neuron_endpoints_view`,
  `facts_neuron_hotkeys_view`, and `facts_neuron_ip_addresses_view` dropped
  from the warehouse (rbmk migration 0031) and stopped being exported by the
  rbmk fixture exporter tonight. Mirrors data-pipeline's mapping removal
  (`75ce9c96`/`67744b2f`): the devkit's vendored `mapping.json` drops the
  three node entries and the `HAS_NEURON_ENDPOINT`/`REGISTERED_NEURON`/
  `SERVED_FROM`/`OPERATED_FROM` edges (now byte-identical to
  data-pipeline's mapping.json), `compile_test.go` gains
  `TestNeuronShapesRejectedAsUnmapped` (all seven retired shapes reject as
  unmapped at compile time), and `testdata/facts-goldens.json` drops the
  seven neuron goldens (`recipe_facts_06..12`). `devkit/data/manifest.json`
  drops the three neuron fixture objects and their `tsv.gz` files are
  removed; `REQUIRED_TABLES` in `validate-manifest.py` shrinks to
  `{facts_address_features_view}` with a retirement comment — validated
  green: "validated 3 devkit fixture objects". No devkit import/smoke
  script hardcoded the three table names (manifest-driven), so none needed
  changes.
  `tests/fixtures/documented-recipes.json` drops `recipe_facts_06..12` (the
  corpus generator source, not just the fixture) and the regenerated
  `graph-query-corpus.json` shrinks 100 -> 93 entries. Reconciliation:
  the regenerated corpus's `documented-recipe` id set is now **exactly
  identical** to data-pipeline's `internal/graphmcp/testdata/
  chain_insights_query_corpus.json` mirror (both 93 entries, same ids) —
  the P5 Task 3 neuron/TRANSFER divergence is fully closed. The only
  remaining diff between the two files is pre-existing and unrelated to
  tonight's work: chain-insights's `addressProfileQuery` builder entries
  (params `{address: "corpus-address-a"}` and the quote-escaping variant,
  topology scope) project an extra `a.label_risk AS label_risk` field that
  data-pipeline's mirror lacks — a future dp-side sync should copy those 2
  entries verbatim to reach full byte-identity.
  `src/mcp/proxy.ts`, `src/workspace/init.ts`'s sibling skill
  (`chain-insights-bittensor-cypher/SKILL.md`), and
  `docs/graph-query-compatibility.md` drop the `NeuronEndpoint`/`Hotkey`/
  `IPAddress` facts mentions and `REGISTERED_NEURON`/`SERVED_FROM`/
  `HAS_NEURON_ENDPOINT`/`OPERATED_FROM` edge references, restating that
  neuron identity/hotkey-coldkey pairing/IP-axon-port observation live
  entirely on the topology `:Neuron` node and
  `MINES`/`VALIDATES`/`HOTKEY_OF`/`COLDKEY_OF` edges.
  `tests/skills-contract.test.ts` and `tests/mcp-proxy.test.ts` flip their
  `REGISTERED_NEURON`/`SERVED_FROM`/`NeuronEndpoint` assertions to
  `not.toContain` and add `toContain` coverage for the topology neuron
  edges, per the `c7c888c`/`1a57b80` retirement-assertion pattern.

## [0.10.3] - 2026-07-21

- Map the facts-scope `TRANSFER` edge onto `facts_transfers_view`
  (rbmk#447 P5 Task 3), mirroring data-pipeline's `cyphersql` mapping
  addition (`6f679c32`/`a5487cec`): the devkit's vendored
  `mapping.json`/`ast.go`/`parser.go`/`emit.go`/`errors.go` gain
  `(from:Address)-[t:TRANSFER]->(to:Address)`, `sum(variable.property)` as a
  supported facts aggregate (`COALESCE(SUM(...), 0)` for StarRocks
  empty-group NULL semantics), and a TRANSFER-specific indexed-predicate
  admission rule in `internal/cypheradmit/cypher.go` (address equality on
  either endpoint, or `tx_id` equality — required even with `LIMIT`, since
  `facts_transfers_view` is a full transfer-history table, not a small
  per-address dimension view); `compile_test.go` and
  `testdata/facts-goldens.json` gain the TRANSFER golden coverage.
  `tests/fixtures/documented-recipes.json` gains
  `recipe_facts_transfer_01..05` (3 admitted row-select/aggregate shapes, 2
  documented-rejected unbounded shapes), and the regenerated
  `graph-query-corpus.json` gains the 3 admitted entries (97 -> 100).
  `devkit/scripts/validate-manifest.py` tolerates `facts_transfers_view`'s
  absence from the manifest until the devkit fixture export leg ships
  (operator-side StarRocks export, separate from this change).
  `src/mcp/proxy.ts`, `src/workspace/init.ts`, the shipped
  `chain-insights-cypher`/`chain-insights-bittensor-cypher` skills, and
  `docs/graph-query-compatibility.md` document the TRANSFER edge shape,
  its properties (`amount`, `amount_usd`, `asset_symbol`, `asset_contract`,
  `tx_id`, `block_height`, `block_timestamp`, `event_index`, `edge_index`,
  `price_usd`, `price_missing`), and the mandatory indexed-predicate rule;
  the facts clause now reads "bounded individual transfer rows (TRANSFER
  edges) and, until P3, address features."

## [0.10.2] - 2026-07-21

- Remove the facts-tier `AddressLabel`/`HAS_LABEL` label surface everywhere
  it was still mapped or documented (rbmk#447 P2b′ Task 4b), mirroring the
  data-pipeline `cyphersql` mapping removal (`b1c3048c`): the devkit's
  vendored `mapping.json`/`compile_test.go`/`facts-goldens.json` drop the
  `AddressLabel` node and `HAS_LABEL` edge and gain
  `TestLabelEdgeRejectedAsUnmapped`; the devkit fixture manifest drops the
  `facts_address_labels_view` object and its `tsv.gz`, and
  `REQUIRED_TABLES` in `validate-manifest.py` no longer requires it.
  `tests/fixtures/documented-recipes.json` and the regenerated
  `graph-query-corpus.json` drop the three label-driven recipes.
  `src/mcp/proxy.ts`, `src/workspace/init.ts`, and the shipped
  `chain-insights-cypher`/`chain-insights-bittensor-cypher` skills and
  `docs/graph-query-compatibility.md` move the label mention to the
  topology clause: labels and per-label risk live on the address node
  (`labels` array + `label_risk` entries), and the facts clause now covers
  only address features and neuron endpoints.

## [0.10.1] - 2026-07-21

- Label risk read moves from the facts tier to the topology graph
  (`facts_address_labels_view` retirement, P2b′): `addressProfileQuery` now
  projects `a.label_risk` (per-label `{label, risk_level,
  updated_timestamp}` maps materialized on the `:Address` node by
  graphsync); the retired `addressLabelRiskQuery` (`USE facts`
  `[:HAS_LABEL]->(:AddressLabel)`) is removed. `aml_address_risk` derives
  the same deterministic `ORDER BY updated_timestamp DESC LIMIT 10` subset
  from the profile row instead of a separate query — verdict escalation,
  `ml_label_divergence`, and the label driver line are unchanged. The
  `label_risk` entry in `riskScoreSources` now reports
  `{layer: 'topology', source: 'address_node'}` in place of the retired
  `facts_address_labels_view` provenance; `trust_level`/`confidence_score`/
  `source` no longer appear in that output.

## [0.10.0] - 2026-07-16

- BREAKING (public MCP surface): migrated to the unified two-scope graph
  model — `USE topology` (Memgraph-native, unified recent + historical
  lifetime graph) and `USE facts` (StarRocks facts allowlist). The
  `topology_scope` tool argument is removed from `aml_address_risk`,
  `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and
  `aml_trace_deposit_sources`, along with the `--topology-scope` CLI flag;
  all emitted query text now uses `USE topology` instead of
  `USE live_topology`/`USE archive_topology`. Because topology is now
  unconditionally Memgraph-backed, `risk_score`/`risk_level` are always
  projected on path nodes, native `*BFS` route evidence always runs when a
  compare address is given, and the archive-retry hint
  (`retry with topology_scope=archive_topology`) is retired.
- Embedded devkit mirrors the new dispatch: `USE facts` routes to the
  StarRocks translator tier; everything else (including `USE topology`)
  runs natively on Memgraph. The vendored `cyphersql` translator is now
  facts-only (topology never compiles to SQL); the archive topology
  mapping (`Address`/`TopologySnapshot`/`FLOWS_TO` views), its cost bound,
  archive fixture TSVs, archive capability probes, and archive goldens are
  removed. The native capability probe surface is renamed to the
  `USE topology` capability matrix.
- Deleted 11 archive-only documented recipes (period-granular rollup
  shapes with `period_granularity`/`period_start_date`/`period_end_date`
  — retired StarRocks rollup schema with no equivalent in the lifetime
  FLOWS_TO contract) and the orphaned archive result goldens; renamed the
  17 live-topology recipes to `topology`; facts recipes unchanged.
- Added a repo-wide CI gate (`tests/no-legacy-topology-scope-text.test.ts`)
  asserting zero occurrences of `topology_scope`/`live_topology`/
  `archive_topology` outside changelog history.

## [0.9.4] - 2026-07-10

- Fixed `aml-scam-corridor-trace` reading the wrong label field: the gates
  now read the `labels(t)` node-label taxonomy (PascalCase
  `:Scam`/`:Exchange`/`:Validator`/`:Miner`/`:Subnet`/`:Mixer`/`:Bridge`/`:Victim`)
  that graphsync reconciles onto each `:Address`, matching the server-side
  original `gates.go`. The first port matched those constants against the
  free-text `t.labels` property array (entity names + lowercase tags such as
  `exchange`, `scam corridor hub`), where they never appear — so every label
  gate silently missed against real graph data and real exchanges/hubs were
  traced through as `propagated_scam`. The free-text array is still surfaced
  as `entity_labels` evidence. Added a regression test pinning the
  `labels(t)` gate source, and a live UAT harness
  (`scripts/devops/chain-insights-devkit/capture-scam-corridor-uat.sh` in
  the control-plane repo) asserting exchange/hub gate diversity end-to-end.

## [0.9.3] - 2026-07-09

- Added two read-only detection tools for AML investigators:
  `aml-scam-corridor-trace` (per-seed scam-corridor propagation with
  exchange/hub/boundary/mixer/shared-deposit gating and a bounded,
  three-valued complete/partial/inconclusive result) and
  `aml-exchange-likeness` (classifies an address as exchange-like from
  fan-in, reciprocity, and lifetime inbound value). Both are strictly
  read-only, emit reviewable findings artifacts, and stay off the public
  MCP tool surface.

## [0.9.2] - 2026-07-09

- Resynced the graph devkit's `cypheradmit`/`cyphersql` mirror of
  production data-pipeline's identity-grain removal: `hasStarRocksIndexedPredicate`
  no longer treats an inline `{identity_id: ...}` filter as a valid
  StarRocks cost-bound anchor (closes a StarRocks cost-gate bypass); the
  FLOWS_TO cost-bound error message and a doc-comment example now read
  `{address: ...}`/`:Address` instead of the retired `identity_id`/`:Identity`
  shape, matching canonical wording exactly.

## [0.9.1] - 2026-07-09

- Regenerated the devkit fixture against a dev stack with real
  `core_address_labels` data for the first time since the address-grain
  revert (the previous fixture snapshot was captured while that table was
  empty fleet-wide, a pre-existing gap unrelated to the revert itself).
  The devkit now carries real exchange/scam/validator labels, including a
  confirmed Kucoin exchange deposit — `aml_trace_victim_funds` and related
  tools now surface real exchange exposure instead of an empty result.
- Fixed a real bug this surfaced in the export tooling:
  `export-memgraph-fixture.py`'s node/relationship export queries had no
  pagination, so a single unbounded `ORDER BY` sort over the full graph
  (~478k nodes / ~1.3M edges) exceeded the dev Memgraph instance's
  query-execution timeout. Now paginated via keyset (id-cursor) batching.
- Re-recorded `trace-{victim,suspect,deposit}-devkit-golden.json` against
  the newly-labeled devkit (real path/exchange counts instead of the
  previous all-zero empty-label state).
- Documented a real interactive-dev trap in `CLAUDE.md`: `bin/cli.js`
  loads the compiled `dist/cli.mjs` bundle, not `src/` directly, and
  `dist/` does not auto-rebuild — a stale bundle silently ran pre-revert
  `:Identity`-based seed resolution against a graph with zero `:Identity`
  nodes, failing every trace as "unresolved" with no indication the
  build (not the data) was the problem.

## [0.9.0] - 2026-07-08

- **Breaking: Bittensor money graph reverted from an identity flatten back to
  address grain.** The `:Identity` money node (a canonical-address-links
  flatten of SS58 + H160 addresses into one merged identity) is retired. The
  graph node is now `:Address {address, network}` with
  `network ∈ {bittensor, bittensor_evm}` — one public Bittensor investigation
  network, with the SS58/EVM-pallet split expressed as a node property
  instead of two separate identity-scoped networks.
- New `LINKED` ownership overlay: an undirected `:Address-[:LINKED]-:Address`
  edge (`basis`, `confidence`, `source_event`, `declared_owner`) replaces the
  retired `HAS_ADDRESS` satellite hop and the identity-collapse join. Same-
  owner SS58/H160 pairs are discoverable via one `-[:LINKED]-` hop instead of
  being pre-merged into a single node — labels stay per-address (no rank-1
  owner-label collapse) and cross-space actor-exposure queries expand
  explicitly through `LINKED` rather than implicitly through the flatten.
- Cross-space and actor-exposure recipes: `crossSpaceLinkedQuery` and
  `linkedExposureQueries` (money-only totals vs. `LINKED`-expanded totals for
  a dual-space owner).
- The archive/facts money layer (StarRocks) stays money-only and
  address-grain throughout — `archive_topology_addresses_view` now carries
  `network`; `linked_addresses_view` replaces
  `archive_identity_address_links_view` as the LINKED source.
- cia CLI, devkit fixtures (StarRocks + Memgraph legs), and the Cypher→SQL
  archive translator (all three tree copies) are rebuilt for the address-
  grain contract; saved investigation corpora are re-keyed off `address`
  instead of `identity_id`.

## [0.8.28] - 2026-07-07

- MemGQL (Memgraph Zero) retired from the graph query surface. `graph_query` /
  `graph_query_batch` now route `USE live_topology` to Memgraph directly (native
  Cypher, bounded traversal) and `USE archive_topology` / `USE facts` to
  StarRocks via a corpus-scoped Cypher→SQL translator. `USE live_topology` gains
  native bounded traversal — `*1..5`, `*BFS`, `*WSHORTEST` (weight lambda),
  `*KSHORTEST`, `*ALLSHORTEST`, and per-hop filter lambdas — with depth ≤ 5,
  KSHORTEST k ≤ 16, and UNWIND ≤ 1000; unbounded/over-depth traversal is rejected.
- `aml_address_risk` route evidence migrated to native Cypher: the directed
  two-endpoint route now uses `*BFS 1..N` instead of the retired GQL
  `ANY SHORTEST … {1,N}` form (native Memgraph rejects the GQL form). Fixes
  route discovery on the post-retirement live surface.
- Devkit graph backend rewired to match: direct Memgraph + StarRocks (no memgql
  container), a faithful mirror of production admission (read-only + StarRocks
  cost-shape gate + traversal bounds), Neo4j driver v6.
- `docs/graph-query-compatibility.md` and the `chain-insights-cypher` skill
  rewritten for the native surface; the GQL parser-gate and MemGQL 0.7.0 hazard
  guidance are now historical.

## [0.8.27] - 2026-07-06

- `aml_address_risk` compare-address route evidence (additive): when a
  `compare_address` is given on the live topology scope, the structured
  `connection` object gains `route_evidence` — directed `ANY SHORTEST`
  route discovery in both directions (outbound/inbound, depth bound 4)
  with hop counts, route identities, USD totals, and **disclosed**
  exchange intermediates (paths through exchanges are reported, never
  silently filtered). Existing `connection.compare_address` and
  `connection.paths` fields are unchanged; archive scope keeps the
  legacy 1-hop probe only.
- MemGQL capability probe suite: `npm run probe:capability` (live lane,
  self-contained containers) and `npm run probe:capability:archive`
  (devkit-gated) pin the federation layer's real capability matrix per
  image version with result-set assertions. Known upstream defects are
  pinned as canaries (memgraph/memgraph#4343 quantifier-inner `WHERE`
  silently ignored, #4344 `SHORTEST k` mis-translation, #4345
  shortest+`WHERE` anchor drop) so an image bump that changes behavior
  fails tests loudly instead of shifting semantics silently.
- Trace query golden pins: snapshot tests freeze the exact emitted query
  text of all five fan-out trace builders at every depth and scope —
  trace tools are deliberately unchanged in this release.
- Graph query corpus contract: `npm run corpus:generate` exports every
  builder-emitted query in production shape
  (`tests/fixtures/graph-query-corpus.json`); the Chain Insights Graph
  backend validator proves admission of the full corpus in its own test
  suite.
- Added `docs/graph-query-compatibility.md`: a construct-by-construct
  GQL/Cypher support matrix for the three Chain Insights Graph layers
  (`live_topology`, `archive_topology`, `facts`), including
  rejected→accepted rewrite recipes (native Cypher `[:R*1..3]`/`*BFS`
  forms vs GQL `{m,n}`/`ANY SHORTEST` forms), spike-verified hazard
  rules, and traversal guidance.
- Extended the `chain-insights-cypher` skill with a
  `references/gql-translation-matrix.md` reference and sharpened its
  layer-choice guidance: the GQL parser rejects Memgraph-native syntax on
  every layer, bounded quantified paths `{m,n}` are the supported
  variable-length form (live, and archive with tight bounds), shortest
  paths are `ANY`/`ALL SHORTEST` on live only, and quantifier-inner
  `WHERE` must never be used.
- Devkit: upgraded the bundled Memgraph Zero/MemGQL federation image from
  0.6.3 to 0.7.0 (cross-backend join fixes and federation improvements).

## [0.8.26] - 2026-07-06

- Graph visualization now recognizes a `hub` entity type (dense
  infrastructure a scam trace routed through, distinct from a confirmed
  `mixer` classification) so hub-typed nodes render correctly instead of
  failing schema validation.

## [0.8.25] - 2026-07-05

- Regenerated the devkit fixture (data only, no source changes here) to
  pick up two upstream export fixes (RBMK-root `chainswarm/rbmk`): a
  label-window boundary-precision fix and a fix bounding
  `facts_address_labels_view`'s declared `exported_max` correctly by
  whichever window branch each row actually qualified through, instead of
  a blanket write-audit-column timestamp that could read "now" for
  properly historically-bounded data.

## [0.8.24] - 2026-07-05

- Fixed a false-clean AML result: `aml_address_risk`'s exchange-behavior
  search runs one query per hop depth, and a hop-depth query can fail
  independently (e.g. an archive-tier query-memory limit on a deep
  multi-hop search) while others succeed with zero rows. The response
  previously reported "No exchange inflow/outflow paths found in bounded
  search" identically whether the search genuinely found nothing or
  partially failed -- an analyst reading only the headline could not tell
  a clean result from an incomplete one. The response now says "Exchange
  search incomplete" when any hop-depth query fails, and adds a caveat
  even when some hops did return hits, since deeper ones may still be
  missing; `exchange_behavior.search_status` (`complete`/`incomplete`)
  and `failed_query_ids` are now in the structured response too.
- devkit fixture scripts: removed internal workstream-label references
  from code comments (product-facing wording only, no behavior change).

## [0.8.23] - 2026-07-04

- Fixed `aml_address_risk`'s ML risk-score enrichment query: it selected
  `risk.risk_level`, a column `facts_risk_scores_view` has never had (only
  a numeric `risk_score`), which hard-errored the whole query and silently
  discarded every downstream field including the real ML score. The field
  is now dropped from the query; the existing "unscored" abstention
  handling already treats a missing `ml_risk_level` as not-abstained, so
  ML scores are used normally.
- Regenerated the devkit fixture from a repaired dev warehouse: the six
  bittensor exchange labels (Binance, KuCoin, Gate.io, MEXC, HTX, Bitget)
  were fabricated placeholder addresses with zero on-chain history;
  they're replaced with a real taostats capture (11 real exchange
  wallets with genuine flow history). `is_exchange` now imports as a real
  typed `TINYINT NULL` instead of the varchar `"NULL"` string that made
  `IS NOT NULL` match every row. `smoke.sh` gained a check pinning this.
- `validate-manifest.py`: the fixture window's upper bound is now a live
  coverage watermark, not a fixed calendar date, so the manifest's
  consistency checks validate internal consistency (a valid, later-than-
  `from` timestamp) instead of an exact-match against a stale literal that
  would have rejected every fixture built after 2026-07-03. Added
  structural-consistency and symmetric cross-tier label-parity checks.
- `starrocks-ddl.py`: added a column-type override map so `is_exchange`
  types correctly instead of the blanket `VARCHAR(4096)` every other
  column gets.

## [0.8.22] - 2026-07-04

- `aml_address_risk` label reads are deterministic: the label subset feeding
  the risk level is now ordered by recency before the LIMIT, so the reported
  level no longer varies between runs for label-heavy identities.
- Risk precedence hardening: labels remain the leading signal, but a
  lower-severity label no longer suppresses a more severe usable ML band —
  the response reports the more severe band with an `ml_label_divergence`
  driver. An AML triage verdict never fails toward "looks safe".

## [0.8.21] - 2026-07-04

- Removed the dead legacy `mcpEndpoint` and `mcpAuthToken` config keys. They
  date from the pre-`graphMcpEndpoint` MCP server on `:4000`. `mcpEndpoint` was
  only ever read as an unreachable fallback — the `graphMcpEndpoint` default
  always wins — and `mcpAuthToken` only fed a never-called fetch helper plus a
  redundant `graphMcpAuthToken` fallback. Endpoint selection now reads
  `graphMcpEndpoint` directly, and the debug/test bearer token reads
  `graphMcpAuthToken` only. The installer now seeds the live `graphMcpEndpoint`
  instead of the retired `:4000` endpoint. All AML, debug, test-access, and
  normal (paid) flows are unaffected — they were already wired to the
  `graphMcp*` keys via `cia debug on`, `cia access-key set`, and
  `cia config set graphMcpEndpoint`.

## [0.8.20] - 2026-07-04

- Removed the legacy `--remote` flag from `cia mcp aml-address-risk` and
  `cia mcp aml-trace-victim-funds`. It dates from when the graph backend served
  the AML tools server-side; the tools are now composed client-side (the CLI
  recipe and the local `chain-insights-mcp-proxy`) and the backend serves only
  graph primitives (`graph_query`, `graph_query_batch`, `network_capabilities`,
  `usage_status`), so `--remote` called a tool no backend serves and always
  failed with `unknown tool`. The AML commands run the local recipe as before;
  this supersedes the 0.8.18 `--remote` argument-handling change, which tuned a
  path that no longer exists.

## [0.8.19] - 2026-07-04

- The Chain Insights Graph's ML verdict now includes an explicit abstention
  band: `risk_level = UNSCORED` means the model had too little labeled graph
  context to stand behind a severity. Chain Insights treats it as "no
  stance", never low risk: `aml_address_risk` stops deriving a severity from
  an abstained ML score (falls back to label/exchange-exposure signal, adds
  an `ml_abstained` driver and `ml_verdict: unscored`, and reports `level:
  unscored` when no other signal exists), and trace/report graph payloads
  normalize `risk_level` casing (`HIGH` -> `high`) so the graph app's risk
  borders fire regardless of backend casing while `unscored` renders with the
  neutral border.

## [0.8.18] - 2026-07-04

- `cia serve` and `cia viz` now bind the configured `serverPort` when `--port`
  is omitted, instead of always hardcoding 4321. `cia status` and persisted
  graph-report URLs advertise `config.serverPort`, so after `config set
  serverPort <n>` the advertised URL is now the one the server actually listens
  on. `--port` still overrides, and a non-numeric or out-of-range `--port` is
  now rejected with a clear message instead of letting `NaN` reach `listen()`.
- `cia mcp aml-trace-victim-funds --remote` now forwards `--incident-timestamp-ms`
  and `--max-hops` (both accepted by the remote tool contract) instead of
  silently dropping them, and rejects `--per-address-limit` / `--min-amount-sum`
  with a clear error since those tune the local recipe only and the remote tool
  does not accept them. Previously all four flags were silently ignored in
  `--remote` mode.

## [0.8.17] - 2026-07-03

- Corrected the LICENSE copyright holder to Chainswarm Technology (the legal
  entity; "Chain Swarm AML" was never the company name). No code changes.

## [0.8.16] - 2026-07-03

- `cia mcp call` now exits non-zero when the backend tool returns an error
  result (`isError`). Previously the error text was printed and the CLI still
  exited 0, so scripts and CI treated remote tool failures as success.
- `cia status`, `cia config get`, and `cia config set` now fail with a clean
  one-line error and a non-zero exit on a corrupt config (e.g. invalid
  `config.json`), instead of a raw Node stack trace. The CLI parses commands
  with `parseAsync` so any async action rejection is surfaced cleanly.

## [0.8.15] - 2026-07-03

- Fix stateless MCP proxy mode (`CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless`): the
  proxy exited cleanly before `server.connect()` ran, so every host call failed
  with `MCP error -32000: Connection closed`. A misplaced brace left the
  `if (workspaceArtifactsEnabled)` block wrapping the graph app resource, the
  `aml_*`/`graph_*` tool registration, and the stdio connect — all skipped when
  not in workspace mode. Scope the gate to the workspace-only `wallet_balance`
  tool so the shared surface and the transport attach in both modes. Stateless
  mode now completes the handshake and serves the four `aml_*` tools plus the
  graph primitives without writing workspace artifacts.

## [0.8.14] - 2026-07-03

- Installer safety: `cia --claude` / `--codex` / `--hermes` no longer delete
  every `ci-*` directory in the shared global skills folder before copying. A
  user's own unrelated `ci-*` skill was being removed on install; clean
  reinstall is now scoped to only the skill directories Chain Insights ships.
- `cia --claude --help` (and `--codex`/`--hermes` with `--help`/`--version`)
  now print help/version instead of running the global installer. A help or
  version request must never mutate the machine.

## [0.8.13] - 2026-07-03

- Wallet safety: the payment wallet no longer signs an unbounded token
  approval when a paid endpoint returns an `allowance_required` challenge.
  Endpoint-dictated auto-approvals are capped at 10 USDC (override with
  `CHAIN_INSIGHTS_MAX_AUTO_APPROVAL_USDC`); larger allowances must be approved
  deliberately with `chain-insights wallet ready --payment-usdc <amount>`.
- Wallet safety: `chain-insights wallet import` now refuses to overwrite an
  existing wallet unless `--force` is passed, and backs up the previous
  encrypted key next to `wallet.json` before replacing it. Setting
  `walletPrivateKey` via `config set` is create-only for the same reason.

## [0.8.12] - 2026-07-03

- Document devkit's persistent `cia debug on --token <token> --endpoint
  http://127.0.0.1:18012/mcp` config path in the top-level README, matching
  the pattern used for the local/staging endpoint examples.

## [0.8.11] - 2026-07-03

- Fix the Verify workflow's "Verify npm package contents" step: `npm pack`
  runs the `prepare` build hook, and that child process's build-tool stdout
  was getting captured into the tarball filename variable, causing `tar -tf`
  to fail with "Cannot open" on every push and PR since 0.8.8. Take the last
  line of `npm pack --silent` output instead of the whole capture.

## [0.8.10] - 2026-07-03

- Fix the devkit README's `cia mcp call` example: the sample address
  extraction referenced a retired `addresses.csv` fixture file. The devkit
  fixture format moved to `nodes.jsonl.gz`/`relationships.jsonl.gz`; the
  example now extracts a substrate address from `nodes.jsonl.gz`.
- Document `cia debug on --token <token> --endpoint <devkit-url>` as the
  persistent way to point `cia` at the devkit backend, as an alternative to
  the one-off `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` environment variable.

## [0.8.9] - 2026-07-03

- Devkit MemGQL bumped to 0.6.3 (latest), matching the dev compose stack and
  the staging chart.

## [0.8.8] - 2026-07-03

- Add a `prepare` script so installing Chain Insights as a git dependency
  builds `dist/` on install. Since 0.7.13 `dist/` is untracked, so GitHub
  tarball/git installs shipped a `chain-insights-mcp-proxy` whose bin shim
  could not resolve `../dist/mcp-proxy.mjs` and exited at spawn ("MCP error
  -32000: Connection closed" in consumers such as the aml-acp benchmark).
  Consumers must pin via the `github:` protocol (not archive tarball URLs)
  for `prepare` to run.

## [0.8.7] - 2026-07-03

- Add the `Devkit Smoke` workflow: on pushes to `main` touching `devkit/` or
  `src/` (and on manual dispatch), boot the devkit fixture stack on a trusted
  self-hosted runner and run the backend smoke plus the full `cia` parity
  smoke, uploading the evidence bundle as a workflow artifact. Pull requests
  intentionally stay off self-hosted runners.

## [0.8.6] - 2026-07-02

- Restore full devkit fixture parity inside the 2024-01-01 through 2026-07-02
  window by removing the rejected repeated-flow filter and shipping the largest
  StarRocks edge fixture as manifest-declared gzip parts.

## [0.8.5] - 2026-07-02

- Refresh the Bittensor devkit fixture to cover 2024-01-01 through
  2026-07-02, including updated StarRocks/Memgraph objects, hashes, coverage
  counts, and manifest validation bounds.
- Keep the devkit fixture in ordinary Git by chunking the largest StarRocks
  fixture object into Git-safe parts without dropping rows inside the fixture
  window.
- Return `graph_query` results in the Chain Insights result envelope with query
  tier, timeout, topology routing, and semantic database facts for parity with
  the production surface.
- Enforce the production `graph_query_batch` 20-query cap in the lite devkit
  backend.

## [0.8.4] - 2026-07-02

- Restore the devkit-only lite Chain Insights Graph backend (reverts the 0.8.3
  swap to the production binary). The lite backend exists so third-party
  developers can build and host the graph MCP from this repository alone,
  against locally served StarRocks and Memgraph, without production backend
  source or any payment/quota/telemetry surface.
- Contract-sync the lite backend to the current production surface instead:
  add the unmetered `usage_status` tool, two-tier query timeout ceilings
  (live 10s, archive/facts 30s) selected by the query's `USE` clause with
  caller overrides only lowering them, per-query `tier`/`timeout_seconds` and
  batch tier-ceiling facts in `graph_query_batch` results, and capability
  live/archive topology sublayers with tier timeouts.

## [0.8.3] - 2026-07-02

- Devkit now runs the real Chain Insights Graph backend binary (built from the sibling `data-pipeline` checkout) instead of the bespoke lite MCP, with x402 billing, telemetry, and dynamic capabilities disabled and production two-tier query timeouts (live 10s, archive/facts 30s). The bespoke Go module and `Dockerfile.mcp` are removed.
- Devkit smoke expects the backend's four tools (`network_capabilities`, `usage_status`, `graph_query`, `graph_query_batch`); the parity smoke accepts the backend-served usage status alongside the primitive fallback.
- Devkit parity smoke derives MemGQL object-coverage totals from the live mapping instead of pinning node/relationship counts (the pinned 12/13 counts predated the exposure-surface removal and failed against the current 10/9 mapping).

## [0.8.2] - 2026-07-01

- Add an explicit `topology_scope` parameter (`live_topology` default, `archive_topology` override) to `aml_address_risk`, `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and `aml_trace_deposit_sources`, with tool/parameter descriptions stating the archive cost/latency tradeoff.
- Fix seed resolution to use the `:Address` graph node (with an existence check for canonical hex-form inputs) instead of falling back to an unresolved raw address as a synthetic identity key; a fabricated address is now reported `unresolved` rather than silently traced.
- Add a best-effort archive-retry hint (bounded independent timeout) suggesting `archive_topology` when a `live_topology` trace finds nothing.
- Fix dual-layer (`live`/`archive`) topology capability reporting across both capability-cleaning code paths.
- Fix a StarRocks `<>` node-comparison incompatibility affecting `archive_topology` exchange-detection and deposit-source queries.
- Validate direct CLI `--topology-scope` flags against the same enum as the MCP proxy path.

## [0.8.1] - 2026-06-30

- Consolidated dependency and workflow bumps: `hono` 4.12.27, `@hono/node-server` 2.0.6, `github/codeql-action` v4.36.2, `actions/checkout` v7, plus the tooling and mcp-and-payments dependency groups.
- docs(architecture): federated docs subsystem (wrapper + context/containers/comp).
- ci(docs): thin docs caller wired to the RBMK docs subsystem.

## [0.8.0] - 2026-06-28

- Remove the public `exposure_*` MCP tools (`exposure_profile`, `exposure_quality`,
  `exposure_carry`, `exposure_crowding`, `exposure_exit_pressure`,
  `exposure_correlation`, `exposure_explain`) and their devkit fixtures, as part of
  the coordinated removal of the exposure subsystem across Chain Insights. The
  `aml_address_risk` exchange-exposure signal is unchanged.

## [0.7.13] - 2026-06-23

- Show dataset coverage (block range / date range) in `cia networks` output.
- List public Chain Insights investigation, graph, and wallet tools in
  `cia networks` alongside network-native tools, wrapping rows for
  readability.
- Remove the stale Claude Desktop setup path; align `cia setup` help
  with supported CLI installer targets (`cursor`, `codex`, `claude`).
- Stop tracking `dist/` build artifacts in git. Build artifacts are
  regenerated by CI and included in the npm package via `package.json`
  `files` field.

## [0.7.12] - 2026-06-23

- Show full addresses in the D3 graph canvas (removed truncation). Fall back
  to `node.id` when `address` is absent.
- Show full src/dst addresses in Mermaid flowchart report markdown (was 8-char
  truncation).
- Add `cursor.com` and `www.cursor.com` to `graph.html` trusted parent origins
  for MCP App iframe handshake in Cursor IDE.

## [0.7.11] - 2026-06-18

- Hardened the devkit Chain Insights Graph MCP record mapper so mismatched
  Neo4j/Memgraph record keys and values no longer panic during graph query
  result formatting.
- Added a regression test for mismatched devkit MCP records and made devkit
  Chain Insights smoke scripts more tolerant of CSV line endings.

## [0.7.10] - 2026-06-17

- Fixed devkit import scripts so Memgraph fixture objects are excluded from
  StarRocks DDL, stream-load, and count checks.
- Added semicolon-terminated Memgraph index DDL and pinned the Security
  workflow CodeQL job to an X64 self-hosted runner.

## [0.7.9] - 2026-06-16

- Replaced the devkit Memgraph live-topology fixture with a GraphRAG-synced
  JSONL export that preserves node labels, relationship types, properties,
  Bittensor structure, ML risk scores, and scam-topology relationships while
  excluding runtime `GlobalState` cursor data.
- Updated the devkit Memgraph importer to load the enriched JSONL graph instead
  of the earlier bare CSV topology.

## [0.7.8] - 2026-06-16

- Published the devkit fixture as a static real Bittensor semantic export for
  StarRocks and Memgraph, replacing synthetic placeholder rows with 2023-2025
  data generated from the RBMK-controlled semantic facade.
- Removed UAT-only seed-address metadata from the fixture manifest; smoke
  scripts now derive real graph addresses at runtime from the exported
  Memgraph CSVs.

## [0.7.7] - 2026-06-15

- Bumped dependency lockfiles for the latest maintenance updates from Dependabot:
  - `@modelcontextprotocol/ext-apps`, `@x402/evm`, `@x402/fetch`, and `viem`
  - tooling updates: `@types/node`, `tsdown`, `tsx`, and `vitest`
  - `hono` runtime dependency

## [0.7.6] - 2026-06-15

- Renamed the product-facing graph layer to Chain Insights Graph across README,
  docs, shipped skills, CLI output, wallet readiness text, and MCP proxy errors.
- Renamed the devkit lite graph backend and UAT skill to
  `chain-insights-graph-devkit` and `test-chain-insights-graph` so local
  devkit output no longer exposes retired graph-layer names.

## [0.7.5] - 2026-06-15

- Documented the Bittensor devkit as the deterministic local Chain Insights Graph
  backend for Chain Insights development, including clean compose startup,
  smoke scripts, CIA parity checks, and the primitive-only backend boundary.
- Clarified Chain Insights Graph docs so `graph_query` and `graph_query_batch` remain
  the portable graph primitives, while Chain Insights owns local metadata,
  usage-status fallback behavior, wallet state, and AML workflows.
- Fixed public trace summaries and Markdown reports so final artifact paths
  point at the Chain Insights workspace bundle instead of internal trace probe
  placeholders.

## [0.7.4] - 2026-06-14

- Refined the MCP Inspector-facing surface after review: canonical prompts now
  require `network` instead of silently defaulting it, graph prompts provide
  schema-discovery query guidance, and help/resource copy no longer exposes
  graph-app internals such as `_meta` URLs or iframe behavior.
- Made the CLI `mcp call` shortcut enforce the same public argument allow-list
  as the MCP proxy so removed trace controls such as `min_amount_sum` and
  `per_address_limit` are rejected instead of looking supported.

## [0.7.3] - 2026-06-14

- Removed free-text `network` inputs from MCP Inspector prompt cards. Prompts
  now generate instructions with the current supported investigation network,
  while tools continue to expose `network` as an enum/dropdown input.
- Stopped passing through remote canonical prompt definitions so upstream prompt
  metadata cannot reintroduce stale descriptions or free-text network fields.

## [0.7.2] - 2026-06-14

- Cleaned up the MCP Inspector tool surface: network inputs now use generic,
  short descriptions; `aml_address_risk` no longer hardcodes a network name in
  its description; timestamp fields say they expect Unix milliseconds rather
  than block heights; and trace depth is described as hops.
- Simplified the public Inspector trace schemas by hiding low-level
  `time_range`, `per_address_limit`, and `min_amount_sum` filters from the
  `aml_trace_*` tool cards while keeping product-facing controls available.
- Reworked `meta_help` into a short product guide instead of returning graph
  schema internals.

## [0.7.1] - 2026-06-14

- Improved the `wallet_balance` MCP Inspector result. The tool now returns
  structured wallet balance JSON in `structuredContent` while keeping a concise
  human-readable text summary. The visible text uses `Payment network: Base`
  instead of `Network: Base` so the Base payment rail is not confused with the
  Chain Insights semantic investigation network.

## [0.7.0] - 2026-06-14

- BREAKING: refactored the MCP Inspector-facing public surface to canonical
  prefix families. Metadata tools are now `meta_network_capabilities`,
  `meta_usage_status`, and `meta_help`; the payment wallet tool is now
  `wallet_balance`; AML tools remain under `aml_*`; graph primitives remain
  `graph_query` and `graph_query_batch`. The legacy `network_capabilities`,
  `usage_status`, `help`, `balance`, `address_risk`, `track_funds`, and
  unprefixed trace aliases are no longer exposed.
- Rebuilt the prompt catalogue around the same prefixes:
  `aml-address-risk`, `aml-trace-victim-funds`,
  `aml-trace-suspect-funds`, `aml-trace-deposit-sources`,
  `meta-network-capabilities`, `meta-usage-status`, `meta-help`,
  `wallet-balance`, `graph-query`, and `graph-query-batch`.
- Simplified `meta_network_capabilities` to the only current semantic
  workflow network, `bittensor`, and removed unsupported-network,
  retention-window, and aggregation fields from the public result.
- Tightened no-argument MCP schemas for metadata and wallet tools so MCP
  Inspector renders strict empty inputs, and aligned docs, runtime skills,
  Chain Insights Graph UAT guidance, and ACP-facing surface names with the prefixed
  contract.

## [0.6.2] - 2026-06-13

- Refreshed the MCP inspector-facing prompt and tool metadata: added the
  `network-capabilities` prompt, aligned graph prompt titles, and capitalized
  the local `Balance` and `Help` tool titles.
- Updated Chain Insights graph docs, shipped Cypher skills, and Chain Insights Graph UAT
  guidance for the current semantic identity graph: the only public Chain Insights Graph
  investigation network is `bittensor`, Bittensor SS58 and EVM-pallet member
  addresses share `network=bittensor`, and money-flow queries use
  `(:Identity)-[:FLOWS_TO]->(:Identity)` with `amount_usd_sum`.

## [0.6.1] - 2026-06-13

- Removed the exposure analysis/profile/report tool surfaces from the first
  public release package. The public tool set now keeps exposure data out of
  the initial CLI/MCP surface while the backend graph and risk tooling continue
  through the dedicated trace and address-risk tools.

## [0.6.0] - 2026-06-12

- BREAKING: removed the interactive `scam_topology` investigation tool. Scam
  topology is now derived automatically by a backend labeler daemon that
  traverses the identity graph from confirmed scam/victim seeds and writes
  `inferred` scam labels for serving and ML supervision, so the analyst no
  longer runs an interactive topology traversal and curates candidates by hand.
  Dropped the `scamTopology` public-tools export, the `src/investigation/scam-topology.ts`
  implementation, the `scam-topology` CLI dispatch entry, and the
  `scam_topology` hidden-remote-tool registration plus its
  `assertPublicMcpToolName` redirect branch. Use `aml_trace_suspect_funds` for
  on-demand suspect fund-flow tracing. Confirmed scam/victim seeds are managed
  through the data-pipeline seed corpus.

## [0.5.6] - 2026-06-12

- AML trace tools accept an activity window. `aml_trace_victim_funds` and
  `aml_trace_suspect_funds` take `time_range` (`from_ms` required, `to_ms`
  optional) or derive the window from `incident_timestamp_ms`; traced
  `FLOWS_TO` edges are filtered on `first_seen_timestamp`/`last_seen_timestamp`
  on every hop, and the effective window is echoed back as `time_filter`
  (`'none'` when unfiltered). `time_range` takes precedence over
  `incident_timestamp_ms`. Edge timestamps now ride along in trace projections,
  compact evidence, graph payloads, and the CSV/Markdown/HTML flow tables.
- Victim/suspect traces now run the bounded deposit traceback and expose a
  `deposit_funding` section: source-exchange paths covering roughly the first
  `floor(20/max_hops)` deposit candidates plus reverse 1-hop leads, with
  `source_exchange_paths[].path` in traversal order deposit-to-source (the
  reverse of money flow). Traceback query failures surface as result warnings
  instead of aborting the trace, and an exchange-funded deposit candidate adds
  a continuation note pointing at `aml_trace_deposit_sources`.
- `aml_trace_deposit_sources` gains noise controls: `min_amount_sum` drops
  reverse `FLOWS_TO` edges below the given USD amount (`amount_usd_sum`; dust
  control), `time_range` applies the same activity window (echoed as
  `time_filter`), and each reverse depth warns explicitly when it saturates
  the 500-row limit.
- `aml_address_risk` exchange-exposure rows include edge activity timestamps,
  and when no ML risk score exists the fallback score is structure-weighted
  instead of a flat 0.4: log-scaled USD exposure volume with shared/omnibus
  edges dampened, bounded in (0, 0.6] so a fallback can never impersonate a
  high ML score band.
- MCP proxy schemas and descriptions updated for the three trace tools:
  shared `time_range` fragment, `min_amount_sum` on deposit sources, and
  product-facing descriptions of the window semantics, the bounded
  `deposit_funding` traceback preview, and dust/truncation controls. All new
  filters and fields follow the USD-only value grain of the graph property
  contract (v0.5.5): every amount is `amount_usd_sum`.

## [0.5.5] - 2026-06-12

- Breaking graph-property contract alignment (identity/address property
  contract, spec 2026-06-11). Identity nodes carry `identity_id`, `labels`,
  `is_exchange` (sparse), the slim risk verdict (`risk_score`/`risk_level`),
  external-flow rollups (`degree_in`/`degree_out`/`degree_total`,
  `tx_in_count`/`tx_out_count`/`tx_total_count`,
  `total_in_usd`/`total_out_usd`/`total_volume_usd`, `net_flow_usd` = in minus
  out, `first_activity_timestamp`/`last_activity_timestamp`,
  `activity_span_days`), and sparse `internal_tx_count`/`internal_volume_usd`.
  Dropped everywhere: `address_type`, `lifetime_*`, and `active_days` reads.
- `FLOWS_TO` is USD-only at identity grain: the native `amount_sum` edge
  property no longer exists. All trace/risk/scam-topology queries, predicates,
  projections, CSV/Markdown/HTML tables, mermaid labels, compact evidence, and
  graph payloads now use `amount_usd_sum`. The `min_amount_sum` option keeps
  its name but filters on `amount_usd_sum`; its CLI/MCP descriptions say so.
- Scam topology scores candidate confidence from the USD grain only
  (`reliableScoringValue` takes a single USD argument); thresholds and
  promotion logic are unchanged and owned by the separate recalibration plan.
  The scam-typed (`address_type`) traversal carve-outs were removed with the
  property; the strict exchange-label matcher remains the protection against
  reading scam-output labels as exchanges.
- Address satellites carry `network`; contract docs (MCP proxy schema hints
  and the workspace runtime-skill prompt) document the full new contract,
  including the sparse idiom, `internal_*`, and the `FLOWS_TO` edge surface
  (`tx_count`, `amount_usd_sum`, `avg_tx_size_usd`, `first/last_seen_timestamp`,
  `first/last_tx_id`, `dominant_asset`, `price_coverage_ratio`).
- Viz: the synthesized display field formerly named `address_type` is now
  `node_kind` (wallet/exchange) across the HTML generator, graph template, and
  fixtures; the graph normalizer no longer special-cases `address_type`.

## [0.5.4] - 2026-06-11

- Breaking graph-model change: Identity nodes no longer carry the `addresses`
  list property. Member-address forms live exclusively on the
  `(:Address {address})` satellite nodes reached via
  `(:Identity)-[:HAS_ADDRESS]->(:Address)`; enumerate an identity's member
  forms with `MATCH (i:Identity {identity_id: $id})-[:HAS_ADDRESS]->(m:Address)
  RETURN m.address`. Removed every `addresses`-property read: the
  `aml_address_risk` profile now collects member addresses through a dedicated
  `HAS_ADDRESS` batch query, trace path-node maps no longer project
  `addresses`, the workspace runtime-skill prompt and MCP schema hints document
  the satellite traversal instead of the list property, and the Chain Insights Graph
  UAT asserts membership via `collect(m.address)` from the satellites.

## [0.5.3] - 2026-06-11

- Renamed the identity member-address edge from `(:Identity)-[:OF]->(:Address)`
  to `(:Identity)-[:HAS_ADDRESS]->(:Address)`. `OF` is a reserved word in the
  MemGQL grammar and required backtick escaping in every query; `HAS_ADDRESS`
  parses bare and matches the facts-graph `HAS_RISK_SCORE`/`HAS_LABEL`/
  `HAS_FEATURE` edge family. The member-address resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:HAS_ADDRESS]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Removed the backtick escaping and
  reserved-word notes from the resolution helper, workspace runtime-skill
  prompt, MCP schema hints, and the Chain Insights Graph UAT member-address
  resolution phase.

## [0.5.2] - 2026-06-11

- Fixed member-address resolution against MemGQL: `OF` is a reserved word in
  the GQL grammar, so the relationship type must be backtick-escaped. The
  resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:\`OF\`]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Updated the resolution helper, workspace
  runtime-skill prompt, MCP schema hints, and the Chain Insights Graph UAT
  member-address resolution phase. The graph model from 0.5.1 is unchanged.

## [0.5.1] - 2026-06-11

- Adopted the final member-address graph naming: the satellite label is
  `:Address` (not `:MemberAddress`) and the relationship is Identity-outward
  `(:Identity)-[:OF]->(:Address)` (not `(m)-[:ADDRESS_OF]->(i)`). The
  resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:OF]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Updated the resolution helper, workspace
  runtime-skill prompt, MCP schema hints, and the Chain Insights Graph UAT
  member-address resolution phase. Everything else from 0.5.0 stands.

## [0.5.0] - 2026-06-10

- **Breaking:** adopted the generic member-address graph model. Identity
  nodes no longer carry `evm_address`/`substrate_address` scalars; member
  addresses come from the `addresses` list property (canonical 0x form
  first, SS58 form second when present). Tool responses and graph nodes
  now expose `member_addresses` as a list instead of the two scalars.
- AML tool address inputs accept any member address form. Non-0x inputs
  (for example SS58) are resolved through the indexed
  `(:MemberAddress {address})-[:ADDRESS_OF]->(:Identity)` exact lookup;
  0x inputs are derived locally as `<network>:<lowercase 0x form>`.
  Unresolvable inputs pass through unchanged.
- Identity nodes regained investigator triage properties: a slim live
  risk verdict (`risk_score`, `risk_level`) and base activity rollups.
  `aml_address_risk` surfaces the live verdict as
  `facts.risk.live_node` and a `Live node triage` summary line; the
  facts-first detailed scoring (`facts_risk_scores_view` with
  provenance) remains the authoritative risk source. Path/graph nodes
  carry `risk_score`/`risk_level` quick-triage values when present.
- Workspace runtime-skill prompt and MCP schema hints teach the
  `addresses` list, the MemberAddress resolution pattern, the node
  triage/rollup properties, and the scores-detail-via-`USE facts` rule.
- Chain Insights Graph UAT asserts a non-empty `addresses` list on the UAT
  identity node and that MemberAddress resolution by the SS58 member
  form returns the identity; all existing identity/scope assertions are
  kept.

## [0.4.0] - 2026-06-10

- **Breaking:** rewrote every investigation tool to the slim identity-grain
  graph schema. Live and archive topology recipes now match
  `(:Identity {identity_id})` with `[:FLOWS_TO]` edges; tool inputs take
  canonical identity keys (`<network>:<canonical_address>`, for example
  `bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24`).
- **Breaking:** removed ghost node-property reads (`risk_score`,
  `risk_level`, `pattern_flags`, `confluence_score`, `ml_*`,
  `address_subtypes`, `lifetime_degree_*`, `total_volume_usd`) from all
  live-topology queries; the slim graph no longer carries score or rollup
  properties.
- `aml_address_risk` is now facts-first: `ml_risk_score` comes from the
  semantic `facts_risk_scores_view` (`HAS_RISK_SCORE`), label risk from
  `facts_address_labels_view` (`HAS_LABEL`), with per-family provenance in
  `facts.risk.sources`. Member addresses (`evm_address`,
  `substrate_address`) are surfaced from the Identity node in the summary,
  `facts.subject.member_addresses`, and graph nodes.
- Workspace runtime-skill prompt teaches the slim identity schema:
  identity key form, member-address properties, exposure shapes, and the
  scores-come-from-`USE facts` rule. `topology_scope` accepts only
  `identity`.
- Chain Insights Graph UAT now runs identity-only assertions (identity node lookup
  with member-address checks, identity exposure discovery) and asserts that
  `graph_query` with `topology_scope=address` fails with the
  unsupported-scope error.

## [0.3.24] - 2026-06-10

- Reordered the UAT so the CLI live-topology assertion runs before the
  proxy/exposure phase. Exposure scans abandoned at the MCP per-query
  timeout keep executing on the memgql proxy's serial session and can
  poison subsequent live reads for the remainder of the run; no assertion
  was weakened and every step still executes.

## [0.3.23] - 2026-06-10

- Switched the UAT CLI live-topology lookup to the inline property-map form
  (`MATCH (n:Address {address: …})`). The `WHERE`-clause form deterministically
  hangs in the memgql proxy when sent from the Chain Insights Graph Go client, while
  the inline form resolves in milliseconds through every client path.

## [0.3.22] - 2026-06-10

- Added a bounded retry (3 attempts, `GRAPH_QUERY_ATTEMPTS` override) to the
  UAT CLI live-topology lookup. A busy graph store can transiently queue
  point reads past the MCP per-query timeout (e.g. mid-resync); the
  assertion still requires the exact UAT address row.

## [0.3.21] - 2026-06-10

- Fixed the Chain Insights Graph UAT CLI live-topology lookup to use a labeled
  `MATCH (n:Address)` pattern. The unlabeled `MATCH (n)` form forced a full
  client-side proxy scan (~27s on a large graph) and broke under the MCP
  per-query timeout; labeled lookups resolve via the address index in
  under a second.

## [0.3.20] - 2026-06-09

- Cut the Chain Insights Graph UAT identity assertions to the public route:
  `graph_query` with `network=bittensor` plus `topology_scope=identity` now
  asserts live `Identity FLOWS_TO Identity` topology, resolved routing
  metadata (`facts.routing.starrocks_database=bittensor_semantic`),
  identity-keyed semantic facts, and unregressed address topology. The
  internal `bittensor_identity` network key is no longer a public tool input.
- Added the `usage_status` tool to the required proxy tool allow-list.

## [0.3.19] - 2026-06-09

- Removed the in-repo npm publish workflow. npm publishing now runs only from the
  private `chainswarm/chain-insights-publisher` repo via manual `workflow_dispatch`,
  so the npm token no longer lives in this public contribution repo.

## [0.3.18] - 2026-06-09

- Added secret egress pattern detection to the PR secret scan.
- Added a workflow smoke test to confirm `stdout` secrets are redacted by
  GitHub Actions logs.

## [0.3.13] - 2026-06-07

- Added generic `exposure_quality`, `exposure_carry`, `exposure_crowding`,
  `exposure_exit_pressure`, `exposure_correlation`, and `exposure_explain`
  MCP tools plus matching `cia mcp` commands over the shared exposure model.
- Extended Chain Insights Graph UAT to discover a seeded generic exposure
  account and smoke all exposure tools without exposing storage or graph
  relationship internals.

## [0.3.14] - 2026-06-08

- Removed the legacy non-public `stake_insights` implementation and remaining
  stake-topology Chain Insights Graph assumptions from the public Chain Insights source,
  skills, and UAT surface.
- Removed the deprecated case/vault/playbook product surface, including
  `cia case` export and vault scaffolding, shipped `ci-case` guidance, and
  runtime compatibility paths that recreated legacy case directories.
- Reframed the shipped docs, skills, and tests around workspace-only
  artifacts, reports, and graph outputs.

## [0.3.16] - 2026-06-09

- Made security workflows more reliable on PR by routing CodeQL and Scorecard to
  GitHub-hosted runners and making the self-hosted runner usage conditional.
- Hardened workflow secret scanning to include test files while excluding known
  synthetic secret fixtures only.
- Standardized CI `verify` and `security` runner selection by event type for
  consistent PR execution.

## [0.3.15] - 2026-06-08

- Reordered the README tool table so `aml_` tools come first, `exposure_`
  tools follow, `graph_query` sits below the investigative tools, and
  `usage_status` remains the final metadata tool.

## [0.3.12] - 2026-06-07

- Added the public `exposure_profile` MCP tool and `cia mcp exposure-profile`
  command for generic staking and trading exposure around an account, owner, or
  counterparty.
- Hid the old public `stake_insights` surface from proxy tool discovery and UAT
  contracts while preserving non-public implementation compatibility during the
  exposure topology migration.

## [0.3.11] - 2026-06-02

- Increased the packaged CLI init integration test timeout so npm publish CI can
  complete reliably on slower runners.

## [0.3.10] - 2026-06-02

- Allowed Chain Insights Graph endpoint configuration to use trusted Kubernetes
  `*.svc.cluster.local` HTTP service URLs for in-cluster proxy deployments while
  continuing to reject arbitrary remote HTTP endpoints.

## [0.3.9] - 2026-06-02

- Added `cia update` / `chain-insights update` to check the global npmjs
  registry for the newest Chain Insights CLI release and run the global npm
  update command.
- Added an interactive update prompt after `cia init` when a newer npm release
  is available, while keeping noninteractive workspace initialization quiet.

## [0.3.8] - 2026-06-01

- Sent invited tester access keys through the Chain Insights Graph debug, staging
  test-key, and bearer auth headers for both MCP tool calls and network
  capability metadata reads, so staging smoke tests can exercise graph-backed
  tools without falling through to x402 payment.
- Added stateless MCP proxy mode for ACP and hosted callers so graph-backed CIA
  tools can return summaries and structured results without requiring a local
  investigation workspace, case files, or graph report attachments.

## [0.3.7] - 2026-05-31

- Reworded public access guidance to the clearer "daily free tier": 10
  execution seconds per IP per UTC day for bounded `graph_query` reads, then
  wallet or approved access for sustained usage.

## [0.3.6] - 2026-05-31

- Clarified the public Chain Insights Graph free-tier path: 10 execution seconds per IP per
  UTC day should be spent on bounded single `graph_query` reads, prepared wallet
  users receive the daily free tier first, and batches are documented as
  paid-access usage.
- Added staging UAT notes for the public free tier and free-to-paid handoff.

## [0.3.5] - 2026-05-30

- Made fresh Chain Insights workspaces Obsidian-compatible investigation vaults
  by default, including root vault notes, starter `.obsidian` settings, canvas,
  entity, evidence, and published handoff directories.
- Added live case vault refresh files and CLI workflow so case notes, agent
  console notes, entity notes, evidence notes, and `Graph.canvas` can be
  reviewed in Obsidian during active investigations.
- Repositioned docs around the Obsidian-first local workflow while preserving
  `cia case export` and MCP `case_export` for public, partner, LLM Wiki, and
  agent handoff bundles.

## [0.3.4] - 2026-05-30

- Added `docs/knowledge-exports.md` with install and setup instructions for
  Obsidian, LLM Wiki, Codex, Claude Code, ChatGPT, and portable agent usage.
- Linked the knowledge export guide from README, investigation workspace docs,
  and MCP proxy docs so users can go from `cia case export` to an Obsidian
  vault or LLM Wiki ingestion flow without guessing the next step.

## [0.3.3] - 2026-05-30

- Added `cia case export` and MCP `case_export` to produce Obsidian,
  LLMWiki, Codex, Claude Code, and ChatGPT-friendly local case bundles.
- Added export artifacts including `manifest.chain-insights.json`,
  `graph.chain-insights.json`, `Graph.canvas`, Markdown entity/evidence notes,
  `LLMWIKI.md`, `llms.txt`, and agent prompt files.
- Added private, partner, and public redaction modes; public mode aliases
  addresses by default and all modes remove secrets from generated exports.

## [0.3.2] - 2026-05-30

- Added `AGENTS.md` as the Codex-facing twin of `CLAUDE.md` and documented
  that both agent entrypoints must stay byte-identical.

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
  covering staging-tested Chain Insights Graph reads, archive/facts examples, and
  fixed-hop traversal fallbacks for native Memgraph deep traversal syntax that
  the hosted endpoint currently rejects.
- Allowed skill-local `references/` bundles to be tracked and shipped while
  keeping root-level local investigation references ignored.
- Expanded Bittensor Cypher guidance with practical prefix search,
  address-family census, and combined SS58/EVM examples under
  `network=bittensor`.

## [0.2.31] - 2026-05-29

- Added shipped `chain-insights-cypher` and
  `chain-insights-bittensor-cypher` skills for schema-aware Chain Insights Graph
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

- Added `usage_status` documentation and client coverage for the Chain Insights Graph public free `graph_query` quota.
- Updated graph access guidance to call out the default 10 execution seconds per IP per UTC day, explicit query `LIMIT`/pagination, and paid fallback after quota exhaustion.
- Let paid-mode Chain Insights Graph clients make public free calls before wallet setup, while still surfacing wallet-ready guidance when the endpoint returns payment required.

## [0.2.28] - 2026-05-29

- Added `chain-insights wallet import <private-key>` as the user-facing way to configure a Base payment wallet.
- Removed raw `walletPrivateKey` and debug-bypass guidance from hosted missing-wallet errors; normal users are now pointed to `wallet ready`, `wallet topup`, or invited tester access keys.
- Updated wallet setup docs to keep payment setup protocol details out of the normal activation path.

## [0.2.27] - 2026-05-29

- Made `chain-insights wallet ready` default output fully user-facing: normal users now see one-time payment setup guidance instead of approval mechanics or transaction hashes, while `--json` keeps machine-readable readiness fields for operators.
- Added `wallet ready --check-only` and `--payment-usdc` as the user-facing flags, keeping the older approval-named flags as hidden compatibility aliases.
- Clarified staging activation docs: approved testers should use `https://staging-mcp.chain-insights.ai/mcp` only until production is live.

## [0.2.26] - 2026-05-29

- The MCP proxy now starts its local Chain Insights tool surface even when paid Chain Insights Graph fetch setup needs wallet or access-key configuration. Fresh MCP clients can list `help`, wallet/case tools, and the local AML workflows first, then receive user-facing `wallet ready` or `access-key` guidance when graph-backed calls need hosted access instead of seeing the proxy exit during `tools/list`.

## [0.2.25] - 2026-05-28

- `scam_topology` auto-promotion now uses a decay-calibrated confidence threshold (0.5) instead of 0.72. Because carried value is scored from native token amounts — whose magnitudes sit far below the USD-scale value saturation — even a hop-1 incident-scale edge decays to ~0.5-0.6, so the old 0.72 bar was unreachable on victim-anchored traces and nothing ever auto-promoted. Combined with the `hop <= 2` gate, the close-hop real-value core now promotes while dust and deeper edges stay review-only.


## [0.2.24] - 2026-05-28

- Added `chain-insights wallet ready` to check Base USDC, Base ETH gas, and one-time payment approval readiness in one user-facing command before paid Chain Insights Graph calls.
- Paid Chain Insights Graph calls now automatically prepare the local wallet and retry once when the x402 endpoint reports missing payment approval, so new users do not need to understand low-level approval mechanics.
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
- Cleaned public docs, shipped skills, and agent guidance so they use product-facing Chain Insights and Chain Insights Graph language.

## [0.2.19] - 2026-05-27

- Added the Chain Insights `stake_insights` recipe over Chain Insights Graph `STAKES_IN` live/archive topology queries, including MCP proxy and CLI exposure, graph report metadata, and explicit backend-unavailable failures.
- Removed the hardcoded hosted Chain Insights Graph default from runtime config and workspace scaffold paths; local defaults now point to loopback.
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
- Updated the npm-facing README to link the website, GitHub, and npm package, and to explain x402-paid Chain Insights Graph access without exposing backend infrastructure names.
- Removed backend infrastructure names from public package docs, shipped skills, MCP tool copy, and generated workspace runtime guidance.

## [0.2.16] - 2026-05-25

- Added GitHub Actions workflow for automated npm publishing on release or manual dispatch.

## [0.2.15] - 2026-05-24

- Fixed the Chain Insights MCP proxy so graph query timeout options survive runtime query logging and slow `graph_query_batch` calls do not fall back to the SDK default timeout.
- Made `address_risk` report partial enrichment query failures without failing the whole screening or graph report.
- Updated the Chain Insights Graph UAT skill to validate a local Chain Insights Graph endpoint on port 8012.

## [0.2.14] - 2026-05-24

- Reworked README into a product-first Chain Insights overview with a cleaner quick start, AML tool showcase, Chain Insights Graph layering, and live/archive/facts topology guidance.
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
- Raised `graph_query_batch` timeout metadata to 600 seconds so archive-scale graph reads can be requested through the Chain Insights proxy and Chain Insights Graph.
- Updated Chain Insights investigation docs/skills for the wider scam-topology graph report.

## [0.2.6] - 2026-05-22

- Switched Chain Insights graph recipes to MemGQL-native `live_topology`, `archive_topology`, and `facts` queries.
- Reworked `track_funds` to avoid MemGQL-unsupported BFS, variable-length paths, `labels()`, reserved aliases, and top-level `UNWIND`.
- Updated Chain Insights Graph UAT guidance for the primitive `graph_query` and `graph_query_batch` endpoint.

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
- Restored legacy Python graph-path semantics for local `track_funds` forward exchange discovery: Chain Insights now issues Memgraph `FLOWS_TO *BFS` through the Go graph primitive instead of replacing the probe with plain variable-length path enumeration.
- Restored legacy Python graph-path semantics for local `address_risk` exchange discovery: exchange outflow/inflow checks use Memgraph `FLOWS_TO *BFS` with Python-style result budgets instead of bounded `FLOWS_TO *1..N` recipes, and missing stored risk fields now produce deterministic risk facts instead of `unknown/null`.

## [0.2.2] - 2026-05-18

- Updated x402/viem dependencies and pinned `ws` override to clear production npm audit.

## [0.2.1] - 2026-05-18

- Added `chain-insights access-key set|clear|status` for simple invited tester setup without exposing x402 details.
- Documented Chain Insights Graph test access key mode for invited users who should bypass x402 payment.
- Documented server-side test key hash configuration and rotation guidance.

## [0.2.0] - 2026-05-18

- Added GitHub release discipline: PR release gate, semver bump enforcement, and changelog enforcement.
- Added repository security posture: Verify, Security, OpenSSF Scorecard, Dependabot, npm registry signature verification, CodeQL, and secret-pattern scanning.
- Added canonical graph report schema support and local graph report serving from workspace `reports/graphs`.
- Added workspace output-root handling so investigation outputs stay in initialized workspaces.
- Added wallet balance visibility for Base ETH gas alongside USDC.
- Updated the default Chain Insights Graph endpoint to staging.
