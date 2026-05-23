# Scam Topology Traversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scam_topology` an analyst-grade laundering traversal tool over the redesigned Memgraph Zero graph surface: `live_topology` for RAM topology, `archive_topology` for StarRocks pair-collapsed topology, and `facts` for labels/features/enrichment. Victim-mode must expand only outward from stolen funds, archive and live adjacent-edge quality must match, and final verification must run through CIA -> GraphRAG MCP Go -> MemGQL/StarRocks.

**Architecture:** Keep `graph_query` and `graph_query_batch` as the only universal graph-language primitives. Fix the StarRocks archive topology mapping so `archive_topology_edges_view` is only a stable MemGQL mapping name over the existing `core_money_flows_graphrag_view`; remove the active current/daily/monthly/yearly duplicate traversal path. Refactor Chain Insights `scam_topology` into a bounded breadth-first traversal that supports `history`, `incident`, and `compare` scopes, with `exchange` as the only hard-coded terminal class and all other labels treated as generic context.

**Tech Stack:** TypeScript, Vitest, MCP SDK, Chain Insights graph reports, GraphRAG Go MCP `graph_query_batch`, MemGQL/Memgraph Zero, StarRocks SQL views, Python/Pytest for core schema tests, RBMK dev docker compose.

---

## Definition Of Done

- `archive_topology` traversal uses one logical `FLOWS_TO` edge per `(from_address, to_address)` pair from `core_money_flows_graphrag_view`.
- `archive_topology_edges_view` remains as the MemGQL mapping name, but its SQL definition no longer `UNION ALL`s current/daily/monthly/yearly rollups.
- The legacy active archive traversal views `archive_topology_edges_current_view`, `archive_topology_edges_daily_view`, `archive_topology_edges_monthly_view`, and `archive_topology_edges_yearly_view` are not granted to `mcp_readonly` and are not used by the MemGQL mapping path.
- GraphRAG MemGQL docs and mapping tests describe `archive_topology` as pair-collapsed topology and `facts` as labels/features/enrichment.
- `scam_topology` no longer promotes victim inbound transfers as scam infrastructure.
- Victim-mode starts from victim outgoing `FLOWS_TO` edges, then expands outward level by level until exchange, generic context stop, dead end, row limit, or depth limit.
- Scammer-mode starts from known scammer outgoing `FLOWS_TO` edges; the scammer seed itself is a confirmed candidate, while reachable intermediaries/deposit candidates remain reviewable candidates.
- `scope=history` uses `USE archive_topology`.
- `scope=incident` uses `USE live_topology` by default and applies `r.last_seen_timestamp >= since_timestamp_ms` when provided; if the incident is outside the live window, use `archive_topology` with the same predicate.
- `scope=compare` runs history and incident traversals and marks elements as `history_only`, `incident_only`, or `overlap`.
- `exchange` is the only hard-coded terminal entity class. Miner, validator, subnet, hotkey, IP, or other labels are generic labels/hints only.
- MCP and CLI expose `scope` and `since_timestamp_ms`.
- Final UAT runs through CIA CLI and MCP proxy against local GraphRAG MCP, and verifies the known victim address does not return victim inbound as scam infrastructure.

## Non-Goals

- Do not create a new StarRocks source view for archive topology.
- Do not reintroduce `topology_query*` or `fact_query*`.
- Do not add Go-side local hash joins.
- Do not write labels directly to StarRocks from `scam_topology`.
- Do not make exact post-incident amount accounting block traversal. Exact period accounting can be added later as a separate facts/forensics enrichment over period rows.

## Cross-Repo Worktree Scope

- Core schema repo: `/home/aphex5/work/rbmk/repos/core`
- GraphRAG repo: `/home/aphex5/work/rbmk/repos/ml/graphrag`
- Chain Insights repo: `/home/aphex5/work/chain-insights`

Before editing each repo:

- [ ] Run `git status --short --branch` in that repo.
- [ ] Record whether it already has user or prior-agent changes.
- [ ] Do not revert unrelated dirty files.

## Task 1: Fix Core Archive Topology View Contract

**Repo:** `/home/aphex5/work/rbmk/repos/core`

**Files:**

- Modify `src/chainswarm_core/starrocks/schema.sql`
- Modify `src/chainswarm_core/starrocks/migrate.py`
- Modify `tests/test_starrocks/test_schema_views.py`
- Modify `tests/test_starrocks/test_migrate.py` if grant count expectations need updating

**Red tests first:**

- [ ] Update `VIEW_NAMES` in `tests/test_starrocks/test_schema_views.py` to remove the active legacy edge views:
  - `archive_topology_edges_current_view`
  - `archive_topology_edges_daily_view`
  - `archive_topology_edges_monthly_view`
  - `archive_topology_edges_yearly_view`
- [ ] Replace `test_archive_topology_views_expose_stable_vertex_and_edge_mapping` assertions so it expects:
  - `archive_topology_addresses_view` derives address identity from `core_money_flows_graphrag_view`.
  - `archive_topology_edges_view` contains `FROM core_money_flows_graphrag_view`.
  - `archive_topology_edges_view` does not contain `UNION ALL`.
  - `archive_topology_edges_view` does not contain `FROM archive_topology_edges_current_view`, `FROM archive_topology_edges_daily_view`, `FROM archive_topology_edges_monthly_view`, or `FROM archive_topology_edges_yearly_view`.
  - `edge_id`, `from_address`, `to_address`, `period_granularity`, `period_start_date`, `period_end_date`, `amount_sum`, `amount_usd_sum`, `tx_count`, `first_seen_timestamp`, `last_seen_timestamp`, `first_tx_id`, and `last_tx_id` remain projected for MemGQL mapping stability.
- [ ] Add a migration/grant test assertion that `MCP_READONLY_VIEW_NAMES` does not include the four legacy active archive edge views.
- [ ] Run `uv run pytest tests/test_starrocks/test_schema_views.py tests/test_starrocks/test_migrate.py -q` and confirm the new tests fail for the current duplicate-union contract.

**Implementation:**

- [ ] In `schema.sql`, keep `DROP VIEW IF EXISTS` statements for the old legacy edge views so bootstrap removes old definitions from local StarRocks.
- [ ] Remove the `CREATE VIEW IF NOT EXISTS archive_topology_edges_current_view`, `archive_topology_edges_daily_view`, `archive_topology_edges_monthly_view`, and `archive_topology_edges_yearly_view` statements.
- [ ] Change `archive_topology_addresses_view` to read addresses from `core_money_flows_graphrag_view`, not raw daily/monthly/yearly tables.
- [ ] Redefine `archive_topology_edges_view` as a direct projection over `core_money_flows_graphrag_view`. Preserve the mapping columns. Use the existing pair-collapsed fields:

```sql
SELECT
  CONCAT('pair:', from_address, ':', to_address) AS edge_id,
  from_address,
  to_address,
  granularity AS period_granularity,
  CAST(NULL AS DATE) AS period_start_date,
  day AS period_end_date,
  '' AS asset_contract,
  dominant_asset AS asset_symbol,
  tx_count,
  amount_sum,
  amount_usd_sum,
  first_seen_timestamp,
  last_seen_timestamp,
  first_tx_id,
  last_tx_id,
  price_coverage_ratio,
  has_missing_price
FROM core_money_flows_graphrag_view
```

- [ ] Keep `archive_topology_snapshot_view` over `archive_topology_edges_view`; it should still report `archive_topology`, `archive`, available granularities, and generated time.
- [ ] Remove the four legacy active archive edge views from `MCP_READONLY_VIEW_NAMES`.
- [ ] Run `uv run pytest tests/test_starrocks/test_schema_views.py tests/test_starrocks/test_migrate.py -q`.
- [ ] Commit the core repo changes with `git commit -m "fix: collapse archive topology traversal view"`.

## Task 2: Update GraphRAG MemGQL Mapping Contract

**Repo:** `/home/aphex5/work/rbmk/repos/ml/graphrag`

**Files:**

- Modify `ops/memgql/README.md`
- Modify `tests/unit/test_memgql_mapping.py`
- Inspect `ops/memgql/chain_insights_starrocks_mapping.json`; edit only if tests reveal the mapping is wrong

**Red tests first:**

- [ ] Add a mapping test that finds the `FLOWS_TO` relationship and asserts:
  - `table == "archive_topology_edges_view"`
  - `source_label == "Address"`
  - `target_label == "Address"`
  - `source_column == "from_address"`
  - `target_column == "to_address"`
  - properties include `edge_id`, `period_granularity`, `amount_sum`, `amount_usd_sum`, `tx_count`, `first_seen_timestamp`, and `last_seen_timestamp`.
- [ ] Add a test or assertion that no mapping table name references `archive_topology_edges_current_view`, `archive_topology_edges_daily_view`, `archive_topology_edges_monthly_view`, or `archive_topology_edges_yearly_view`.
- [ ] Run `uv run pytest tests/unit/test_memgql_mapping.py -q`.

**Implementation:**

- [ ] Update `ops/memgql/README.md`:
  - `archive_topology` is StarRocks historical topology mapped through `archive_topology_edges_view`.
  - That mapped view is a stable MemGQL name over the existing pair-collapsed `core_money_flows_graphrag_view`.
  - Period-level daily/monthly/yearly rows are not the default traversal graph because they multiply paths.
  - `facts` remains labels/features/risk/neuron endpoint context.
- [ ] Keep the mapping JSON on `archive_topology_edges_view` unless it is currently wrong. Do not point MemGQL directly at `core_money_flows_graphrag_view` because the mapping file expects the normalized column names from `archive_topology_edges_view`.
- [ ] Run `uv run pytest tests/unit/test_memgql_mapping.py -q`.
- [ ] Commit GraphRAG repo changes with `git commit -m "docs: clarify archive topology mapping"`, or `test: assert archive topology mapping` if only tests changed.

## Task 3: Refactor Scam Topology Traversal Semantics

**Repo:** `/home/aphex5/work/chain-insights`

**Files:**

- Modify `src/investigation/scam-topology.ts`
- Modify `tests/scam-topology.test.ts`
- Create `src/investigation/scam-topology-traversal.ts` only if it keeps query building and traversal pure/testable

**Red tests first:**

- [ ] Replace the current test that expects `seed_in_1` for victim-mode. The new test must assert a victim-only run never sends a victim inbound query and never emits a `seed_funding_input`/funding-source infrastructure role.
- [ ] Add a victim traversal test that mocks `graph_query_batch` calls and asserts:
  - initial query is outgoing from the victim address.
  - query text starts with `USE live_topology` for default incident-style live traversal or `USE archive_topology` for explicit history scope.
  - next frontier expands from first-hop recipients, not from victim inbound senders.
  - result includes discovered intermediaries and edges.
- [ ] Add a test for `scope: "history"` that expects `USE archive_topology`.
- [ ] Add a test for `scope: "incident"` with `sinceTimestampMs` that expects `r.last_seen_timestamp >= <timestamp>`.
- [ ] Add a test for `scope: "compare"` that expects both history and incident traversals to run and result elements to carry `scope_membership` values.
- [ ] Add a generic stop test where a destination has labels but is not exchange; assert it becomes a context stop/hint, not a hard-coded miner/validator/subnet role.
- [ ] Add an exchange terminal test where `is_exchange` or label `exchange` stops expansion and creates a safety decision rather than a scam label.
- [ ] Run `npx vitest run tests/scam-topology.test.ts` and confirm failures.

**Implementation model:**

- [ ] Add option types:

```ts
export type ScamTopologyScope = 'history' | 'incident' | 'compare'

export interface ScamTopologyOptions {
  network: string
  victimAddresses?: string | string[]
  scammerAddresses?: string | string[]
  caseId?: string
  maxHops?: number
  perAddressLimit?: number
  minAmountSum?: number
  scope?: ScamTopologyScope
  sinceTimestampMs?: number
}
```

- [ ] Normalize CLI/MCP snake_case later, but keep internal TypeScript names camelCase.
- [ ] Clamp `maxHops` to `1..5` and `perAddressLimit` to `1..10`, preserving current safety limits.
- [ ] Validate:
  - at least one victim or scammer seed is required.
  - max five victim addresses and max five scammer addresses.
  - victim/scammer address sets must not overlap.
  - `scope=incident` and `scope=compare` require `sinceTimestampMs` unless the implementation intentionally treats missing timestamp as current-live-only and documents it. Prefer requiring the timestamp to avoid ambiguous incident semantics.
- [ ] Implement graph selection:
  - history: `USE archive_topology`
  - incident: `USE live_topology` by default
  - compare: run both history and incident
- [ ] For incident queries, append `r.last_seen_timestamp >= sinceTimestampMs` when provided.
- [ ] Build directed breadth-first expansion:
  - Victim seeds: first query only `(victim)-[r:FLOWS_TO]->(dst)`.
  - Scammer seeds: first query only `(seed)-[r:FLOWS_TO]->(dst)`.
  - Later frontiers: query outgoing edges from current frontier addresses.
  - Deduplicate logical edges by `src`, `dst`, and graph scope.
  - Do not expand through an exchange terminal.
  - Do not expand through generic labeled/context nodes unless explicitly configured later; emit investigation hints instead.
  - Stop on dead end, row limit, and depth limit.
- [ ] Use generic result roles. Suggested role set:
  - `victim`
  - `scammer`
  - `laundering_intermediate`
  - `exchange_deposit_candidate`
  - `exchange_endpoint`
  - `context_boundary`
  - `continue_from_address`
- [ ] Replace old relation names:
  - remove `seed_funding_input`
  - remove victim inbound infrastructure semantics
  - prefer `seed_outflow`, `traversal_edge`, `terminal_exchange`, and `context_boundary` or similarly generic names
- [ ] Keep label candidate rules strict:
  - victim seed: no risky label candidate
  - scammer seed: confirmed scam seed candidate
  - intermediaries: review-required candidate
  - exchange endpoint: safety decision, no scam candidate
  - generic labeled context: safety/context hint, no automatic scam candidate unless it is also on a laundering path and not terminal
- [ ] Update `structuredContent.facts` to include traversal metadata:
  - `scope`
  - `since_timestamp_ms`
  - `topology_graphs`
  - `topology_edges`
  - `intermediaries`
  - `terminal_points`
  - `investigation_hints`
  - existing `label_candidates`, `case_roles`, `safety_decisions`
- [ ] Preserve canonical graph report output and case evidence append.
- [ ] Run `npx vitest run tests/scam-topology.test.ts`.
- [ ] Commit Chain Insights traversal changes with `git commit -m "fix: traverse scam topology outward from seeds"`.

## Task 4: Wire CLI And MCP API Options

**Repo:** `/home/aphex5/work/chain-insights`

**Files:**

- Modify `src/mcp/proxy.ts`
- Modify `src/cli.ts`
- Modify `tests/mcp-proxy.test.ts`
- Modify `tests/cli-mcp.test.ts`
- Modify `tests/cli.test.ts` if help text assertions cover command output

**Red tests first:**

- [ ] Update proxy tests to assert the local `scam_topology` schema exposes:
  - `scope` enum values `history`, `incident`, `compare`
  - `since_timestamp_ms` optional non-negative number
- [ ] Update CLI tests to assert `mcp scam-topology` accepts:
  - `--scope <history|incident|compare>`
  - `--since-timestamp-ms <milliseconds>`
- [ ] Update `mcp call scam_topology` routing tests to assert snake_case `since_timestamp_ms` becomes internal `sinceTimestampMs` and `scope` is passed through.
- [ ] Run:

```bash
npx vitest run tests/mcp-proxy.test.ts tests/cli-mcp.test.ts tests/cli.test.ts -t "scam|scam_topology|since|scope"
```

**Implementation:**

- [ ] Add `scope` and `since_timestamp_ms` to the MCP proxy Zod schema for `scam_topology`.
- [ ] Pass `scope` and `sinceTimestampMs` into `scamTopology()` in the proxy handler.
- [ ] Add CLI options to `cia mcp scam-topology`.
- [ ] Pass parsed CLI options into `scamTopology()`.
- [ ] Update direct `cia mcp call scam_topology ...` routing to parse `scope` and `since_timestamp_ms`.
- [ ] Update public tool description text so callers know:
  - victim addresses are trusted sources, not risky labels.
  - `history` queries archive topology.
  - `incident` queries live topology with timestamp filtering.
  - `compare` returns membership across both.
- [ ] Run targeted Vitest command above.
- [ ] Commit Chain Insights API wiring with `git commit -m "feat: expose scam topology scopes"`.

## Task 5: Update Docs, Skills, And Playbooks

**Repo:** `/home/aphex5/work/chain-insights`

**Files:**

- Modify `README.md`
- Modify `skills/chain-insights-trace-funds/SKILL.md`
- Modify `skills/chain-insights-investigation/SKILL.md` if it references `scam_topology`
- Modify `src/playbooks/builtins.ts` if playbook arguments should include scope guidance
- Modify `tests/skills-contract.test.ts`
- Modify `tests/playbook-builtins.test.ts` if playbook assertions need updating

**Red tests first:**

- [ ] Add contract assertions that skill/docs mention:
  - `scam_topology`
  - victim-only traversal is outward from victim/source funds
  - `scope=history|incident|compare`
  - `exchange` terminal safety
  - label candidates are reviewable, not automatic writes
- [ ] Run `npx vitest run tests/skills-contract.test.ts tests/playbook-builtins.test.ts -t "scam|scope|history|incident"`.

**Implementation:**

- [ ] Update README and skills with the new semantics.
- [ ] Keep wording generic. Do not hard-code miner/validator/subnet behavior.
- [ ] Include one example CIA command for history and one for incident:

```bash
cia mcp scam-topology --network bittensor --victim-addresses 5... --scope history --max-hops 5
cia mcp scam-topology --network bittensor --victim-addresses 5... --scope incident --since-timestamp-ms 1715532228001 --max-hops 5
```

- [ ] Run targeted docs/playbook tests.
- [ ] Commit Chain Insights docs with `git commit -m "docs: document scam topology traversal scopes"`.

## Task 6: Apply Schema Locally And Rebuild Dev Services

**Repos:** core, GraphRAG, Chain Insights

**Preflight:**

- [ ] Confirm local StarRocks/MemGQL/GraphRAG services are running:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose ps starrocks-fe starrocks-be memgql-bittensor graphrag-mcp-go
```

- [ ] Inspect service names if the compose file uses different names:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose config --services | rg 'starrocks|memgql|graphrag'
```

**Apply core schema to local Bittensor StarRocks:**

- [ ] From `/home/aphex5/work/rbmk/repos/core`, run schema bootstrap against the local `bittensor` database using the existing helper:

```bash
STARROCKS_HOST=127.0.0.1 \
STARROCKS_PORT=19030 \
STARROCKS_HTTP_PORT=18030 \
STARROCKS_USER=root \
STARROCKS_PASSWORD="$STARROCKS_PASSWORD" \
STARROCKS_DATABASE=bittensor \
uv run python - <<'PY'
from chainswarm_core.starrocks.config import StarRocksConfig
from chainswarm_core.starrocks.client import StarRocksClient
from chainswarm_core.starrocks.migrate import run_starrocks_schema

client = StarRocksClient(StarRocksConfig.from_env())
print(run_starrocks_schema(client))
PY
```

- [ ] If the local root password is empty by design, rerun with `STARROCKS_ALLOW_EMPTY_PASSWORD=true` and `STARROCKS_PASSWORD=""`.
- [ ] Verify the active StarRocks definition:

```bash
mysql -h 127.0.0.1 -P 19030 -u root -p"$STARROCKS_PASSWORD" bittensor \
  -e 'SHOW CREATE VIEW archive_topology_edges_view\G'
```

Expected: it references `core_money_flows_graphrag_view` and does not reference `UNION ALL` or the four legacy archive edge views.

**Rebuild/restart graph services:**

- [ ] From `/home/aphex5/work/rbmk/repos/ml`, rebuild GraphRAG MCP if graph service inputs or container build context changed:

```bash
docker compose build graphrag-mcp-go
```

- [ ] Restart GraphRAG MCP and MemGQL sidecar:

```bash
docker compose up -d --no-deps --force-recreate memgql-bittensor graphrag-mcp-go
```

- [ ] Observe logs:

```bash
docker compose logs --tail=200 memgql-bittensor graphrag-mcp-go
```

Do not proceed if MemGQL mapping registration fails.

## Task 7: Top-To-Bottom Verification

Run verification after implementation and local schema apply.

**Core repo:**

- [ ] Run:

```bash
cd /home/aphex5/work/rbmk/repos/core
uv run pytest tests/test_starrocks/test_schema_views.py tests/test_starrocks/test_migrate.py -q
```

**GraphRAG repo:**

- [ ] Run:

```bash
cd /home/aphex5/work/rbmk/repos/ml/graphrag
uv run pytest tests/unit/test_memgql_mapping.py -q
```

**Chain Insights repo:**

- [ ] Run:

```bash
cd /home/aphex5/work/chain-insights
npm run typecheck
npm test
npm run build
npm run release:check
```

**Archive/live duplicate quality UAT:**

- [ ] Use the known victim address:

```text
5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5
```

- [ ] Run `cia mcp call graph_query_batch` through the local Chain Insights CLI with a batch containing both `USE live_topology` and `USE archive_topology` adjacent-edge queries:

```bash
cd /home/aphex5/work/chain-insights
cia mcp call graph_query_batch \
  network=bittensor \
  per_query_timeout_seconds=600 \
  'queries=[
    {
      "id":"live_out_unique",
      "query":"USE live_topology MATCH (src:Address {address:\"5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5\"})-[r:FLOWS_TO]->(dst:Address) RETURN COUNT(r) AS raw_edge_count, COUNT(DISTINCT dst.address) AS unique_counterparty_count"
    },
    {
      "id":"live_in_unique",
      "query":"USE live_topology MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address:\"5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5\"}) RETURN COUNT(r) AS raw_edge_count, COUNT(DISTINCT src.address) AS unique_counterparty_count"
    },
    {
      "id":"archive_out_unique",
      "query":"USE archive_topology MATCH (src:Address {address:\"5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5\"})-[r:FLOWS_TO]->(dst:Address) RETURN COUNT(r) AS raw_edge_count, COUNT(DISTINCT dst.address) AS unique_counterparty_count"
    },
    {
      "id":"archive_in_unique",
      "query":"USE archive_topology MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address {address:\"5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5\"}) RETURN COUNT(r) AS raw_edge_count, COUNT(DISTINCT src.address) AS unique_counterparty_count"
    }
  ]'
```

- [ ] The live and archive unique adjacent-edge counts should match for the victim after the archive view fix. The previous bad archive shape was approximately 4x due current/daily/monthly/yearly duplicates.
- [ ] Keep the raw output in the final implementation notes.

**Scam topology CLI UAT:**

- [ ] Run history scope:

```bash
cd /home/aphex5/work/chain-insights
cia mcp scam-topology \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --scope history \
  --max-hops 5 \
  --per-address-limit 10
```

- [ ] Run incident scope with the known earliest scam timestamp once confirmed:

```bash
cia mcp scam-topology \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --scope incident \
  --since-timestamp-ms 1715532228001 \
  --max-hops 5 \
  --per-address-limit 10
```

- [ ] Verify:
  - victim inbound edges are absent from `infrastructure_flows`/`topology_edges` as scam infrastructure.
  - victim address appears only as a protected case role.
  - exchange endpoints are safety/context endpoints, not scam candidates.
  - non-exchange labels appear as generic labels/hints only.
  - discovered intermediaries and deposit candidates are review-required label candidates.

**MCP proxy UAT:**

- [ ] Start or reuse the Chain Insights MCP proxy configured against local GraphRAG MCP.
- [ ] Call `scam_topology` through MCP with `include_attachments=true`.
- [ ] Verify the response includes `_meta.chainInsights.graph.url` and canonical graph JSON metadata.

## Completion Audit

Before claiming completion:

- [ ] List every repo changed and its commit hash.
- [ ] Include the final `git status --short --branch` for core, GraphRAG, and Chain Insights.
- [ ] Include the exact verification commands that passed.
- [ ] Include CIA CLI UAT output summary for live/archive count parity and scam topology victim-mode behavior.
- [ ] Explicitly document any remaining MemGQL limitation. Current known limitation: StarRocks/MySQL `DATE` edge properties may still project as `null`; this plan avoids relying on period dates for traversal.
- [ ] Do not mark done if top-to-bottom CIA CLI UAT was skipped or failed.
