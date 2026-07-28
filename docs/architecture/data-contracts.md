# Data Contracts

The contracts Chain Insights exposes and consumes. Migrated from the
retired repo knowledge skill during the 2026-07-28 docs-layer rework.
Every statement here was verified against the source files it names.

## Public MCP Tool Surface

- The canonical public tool surface is the prefixed set `aml_*` / `graph_*` /
  `meta_*` / `wallet_*`.
- `visibleRemoteTools()` in `src/mcp/tool-visibility.ts` hides unprefixed
  backend names (`address_risk`, `trace_victim_funds`, `trace_suspect_funds`,
  `trace_deposit_sources`, `trace_funds`, `track_funds`,
  `network_capabilities`, `usage_status`, `balance`, `topup`, `help`,
  `money_flows_between_exchanges`, `address_connection_risk`) via
  `HIDDEN_REMOTE_TOOL_NAMES`. They never surface publicly.
- Local tools live in `src/mcp/proxy.ts`: `meta_network_capabilities`,
  `meta_usage_status`, `meta_help`, `wallet_balance`.
- `meta_network_capabilities` collapses backend networks into one public
  `bittensor` entry (`BITTENSOR_SEMANTIC_NETWORKS` in
  `src/mcp/capabilities.ts`). There is no public `network=bittensor_evm`
  argument.
- The graph app UI resource `ui://chain-insights/graph` attaches to the four
  `aml_*` trace/screen tools (`GRAPH_APP_TOOL_NAMES` in `src/mcp/proxy.ts`).

### Tool Argument Contracts

- `PUBLIC_MCP_TOOL_REQUIRED_ARGS` / `PUBLIC_MCP_TOOL_ALLOWED_ARGS` in
  `src/mcp/tool-visibility.ts` define the public arg contract. Examples:
  `aml_address_risk` requires address + network; `graph_query_batch` allows
  `per_query_timeout_seconds`; `aml_trace_deposit_sources` allows
  `max_hops` / `row_limit`; `aml_trace_victim_funds` /
  `aml_trace_suspect_funds` allow `max_hops` / `per_address_limit`.
- An argument absent from the allowlist is silently stripped by
  `normalizeRemoteToolArguments`. Every new tunable arg must be added here
  and to the numeric-argument set in `src/mcp/call-args.ts` the moment it
  appears on a tool schema. `tests/configurable-limits.test.ts` covers this
  end to end.

## Search Limits Registry

Every search bound across investigation and detection tools resolves through
one shared registry: `LIMIT_SPECS` in `src/config/limits.ts`.

Precedence, highest layer first:

1. Per-call argument (MCP arg / CLI flag / detector `--param`).
2. `networkLimits.<network>.<key>` in `~/.chain-insights/config.json`.
3. `limits.<key>` (all networks).
4. Per-network default table (`NETWORK_LIMIT_DEFAULTS`, empty today).
5. Built-in default.

Rules:

- Every knob carries a hard `ceiling`. Only a code change to `limits.ts` may
  raise it. A per-network entry may only lower it.
- An out-of-range request throws `LimitRangeError`. It is never silently
  clamped.
- Hop-depth knobs (`HOP_LIMIT_KEYS`) carry the tightest ceilings. Cost grows
  exponentially with depth, not linearly.
- Results report `input.search_limits` (requested / used / default / ceiling
  per knob, via `limitsReport()`), so a bounded search is visible without
  reading warnings.
- Covered knobs include `trace_max_hops`, `trace_per_address_limit`,
  `deposit_sources_max_hops`, `deposit_sources_row_limit`,
  `corridor_max_hops`, `corridor_frontier_cap`, `corridor_query_row_limit`,
  `exchange_likeness_max_candidates`, `viz_max_nodes`, and the detection
  numeric caps.

Full table: [../search-limits.md](../search-limits.md).

## Deposit-Source Value Ordering

`aml_trace_deposit_sources` ranks upstream paths by their narrowest
(bottleneck) edge value before `deposit_sources_row_limit` truncates
(`reverseDepositSourceQueryAtDepth` in `src/investigation/public-tools.ts`).
A high-fan-in deposit loses its least value-bearing routes first, not an
arbitrary slice. The truncation warning names the weakest retained path's
value and the remaining `row_limit` ceiling headroom.

## Endpoint Configuration

Precedence for the Chain Insights Graph endpoint:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` environment variable.
2. Legacy `GRAPH_MCP_ENDPOINT` environment variable.
3. Saved `graphMcpEndpoint` config value.
4. Default `http://127.0.0.1:8012/mcp`.

Validation (`validateMcpEndpoint` in `src/config/mcp-endpoint.ts`):

- `http://` only for loopback or Kubernetes `*.svc.cluster.local` service DNS.
- Other remote hosts must use `https://`.
- No credentials, query string, or fragment in the URL.

Hosted staging: `https://staging-mcp.chain-insights.ai/mcp`. Production is
not live yet.

MCP proxy mode: `CHAIN_INSIGHTS_MCP_PROXY_MODE=workspace` (default) or
`stateless` (`resolveMcpProxyMode` in `src/mcp/proxy.ts`).

## Shared-Graph Model

`bittensor` and `bittensor_evm` are **two views over one address-grain
topology graph**, not two graphs. EVM H160 addresses live inside the
bittensor Memgraph shards, separated from SS58 addresses only by the
`Address.network` node property.

Consequences:

- The `network` argument to `graph_query` selects the graph, not the address
  subset. A `USE topology` match on `:Address` without an exact address must
  add a `<alias>.network = "<network>"` predicate — that is what
  `networkPredicate()` in `src/detection/graph-client.ts` exists for.
  Address-anchored lookups stay unscoped on purpose: the address is a unique
  key, and scoping fails closed on an H160 screened under
  `network=bittensor`.
- `USE facts` is the inverse. Each network gets its own backing database
  there, and the facts `Address` label has no mapped `network` property —
  projecting it hard-fails. Facts serves `Address` only as a `TRANSFER`
  endpoint, so a single-node `MATCH (a:Address)` is refused.

Getting this backwards caused a production regression and a wrong-network
detector sweep in the same day (2026-07). Verify against the live stack
before restating it. Query-side detail:
[../graph-query-compatibility.md](../graph-query-compatibility.md).

## Detection Scanner Contract

The four `cia detect <detector>` scanners (`fake-token`, `mixer`,
`address-poisoning`, `attack-attribution`):

- Read only through the `graph_query` wrapper in
  `src/detection/graph-client.ts`. Never direct warehouse access.
- Are pure `scan(window, client, network, params) → findings[]` cores
  (`DetectorScan` in `src/detection/runtime.ts`).
- Each ships a per-network default table layered with operator
  `--param key=value` overrides. The effective config is echoed in the
  findings document's `threshold_provenance`.
- Numeric search-bound knobs resolve through the shared `limits.ts` registry
  via `limitFromParams` and reject an out-of-range `--param` with
  `LimitRangeError`. Non-bounded knobs use the coercion helpers in
  `src/detection/params.ts` (`numParam` / `strParam` / `listParam`).
- Per-network defaults: `MIXER_NETWORK_DEFAULTS` (hourglass floors),
  `POISONING_NETWORK_DEFAULTS` (dust floor), `ATTRIBUTION_NETWORK_DEFAULTS`
  (taxonomy overrides only; its numeric knobs are shared-registry).

Component detail: [components/detection.md](components/detection.md).

### CLI-Only Findings Tool IDs

The six `DETECTION_TOOL_NAMES` (`src/investigation/detection-findings.ts`) —
`aml_scam_corridor_trace`, `aml_exchange_likeness`, `aml_address_poisoning`,
`aml_fake_token`, `aml_attack_attribution`, `aml_mixer_likeness` — are
CLI-only findings-document tags. They are absent from the public contracts
in `tool-visibility.ts` (enforced by
`tests/detection-tools-visibility.test.ts`) and never set a finding's
reviewer or label directly. Do not confuse them with the canonical public
`aml_*` MCP surface.

## Workspace Output Layout

Investigation output stays local in user workspace directories:

- `.chain-insights/` — including per-detector-per-network scan checkpoints
  under `.chain-insights/detectors/` (`src/detection/checkpoint.ts`) and
  full-state emitted-findings key sets
  (`<detector>.<network>.emitted.json`, `src/detection/emitted-state.ts`).
- `cases/`, `reports/`, `artifacts/`, `detections/`.
- Findings from `aml_scam_corridor_trace` / `aml_exchange_likeness` land
  under `reports/tables/*.detection-findings.json` via `serializeFindings()`.
- The four `cia detect` scanners write findings JSON named
  `<generated_at_timestamp>-<detector>-<network>.findings.json`
  (`src/detection/emit.ts`) under `detections/`.
- Monitor case dossiers render under `published/cases/<case_id>/`
  (`src/monitor/render/`), for example `dossier.md`.

## Devkit Contract

The devkit backend (`devkit/chain-insights-graph-devkit/`) exposes only
`network_capabilities`, `usage_status`, `graph_query`, and
`graph_query_batch` at `http://127.0.0.1:18012/mcp`.

- It intentionally tracks the production contract: two-graph query timeouts
  (topology 10s, facts 30s), topology/facts capability sublayers, unmetered
  `usage_status`.
- `USE topology` goes to Memgraph directly (the unified graph serving all
  recent and historical topology). `USE facts` goes to StarRocks via the
  corpus translator.
- It never exposes `aml_*`, wallet, x402, payment, quota, ACP, or telemetry
  tools, and never imports raw block streams, sync state, indexer
  checkpoints, wallet/payment/quota metadata, or telemetry tables.
- The fixture is a static export of real Bittensor semantic data from
  2024-01-01 through 2026-07-02 UTC. The largest topology object is chunked
  into Git-safe parts.
- Devkit smoke evidence lands under `workspace/devkit-smoke/` and
  `workspace/devkit-smoke/chain-insights-parity/`.

Full procedures: [../../devkit/README.md](../../devkit/README.md).
