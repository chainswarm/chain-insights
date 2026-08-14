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
  `robinhood` entry (`ROBINHOOD_SEMANTIC_NETWORKS` in
  `src/mcp/capabilities.ts`). The mirror exposes no other network and
  advertises no layer detail (`layers: {}`).
- The graph app UI resource `ui://chain-insights/graph` attaches to
  `aml_address_risk` (`GRAPH_APP_TOOL_NAMES` in `src/mcp/proxy.ts`).

### Tool Argument Contracts

- `PUBLIC_MCP_TOOL_REQUIRED_ARGS` / `PUBLIC_MCP_TOOL_ALLOWED_ARGS` in
  `src/mcp/tool-visibility.ts` define the public arg contract. Examples:
  `aml_address_risk` requires address + network; `graph_query_batch` allows
  `per_query_timeout_seconds`; `graph_query` allows `time_scope`.
- An argument absent from the allowlist is silently stripped by
  `normalizeRemoteToolArguments`. Every new tunable arg must be added here
  and to the numeric-argument set in `src/mcp/call-args.ts` the moment it
  appears on a tool schema.

## Search Limits Registry

Every remaining search bound resolves through one shared registry:
`LIMIT_SPECS` in `src/config/limits.ts`.

Precedence, highest layer first:

1. Per-call argument (MCP arg / CLI flag).
2. `networkLimits.<network>.<key>` in `~/.chain-insights/config.json`.
3. `limits.<key>` (all networks).
4. Per-network default table (`NETWORK_LIMIT_DEFAULTS`, empty today).
5. Built-in default.

Rules:

- Every knob carries a hard `ceiling`. Only a code change to `limits.ts` may
  raise it. A per-network entry may only lower it.
- An out-of-range request throws `LimitRangeError`. It is never silently
  clamped.
- Results report `input.search_limits` (requested / used / default / ceiling
  per knob, via `limitsReport()`), so a bounded search is visible without
  reading warnings.
- The covered knob is `viz_max_nodes` (nodes rendered in a generated graph
  view before truncation).

Full table: [../search-limits.md](../search-limits.md).

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

The public surface exposes **one network** (`robinhood`, see Public MCP
Tool Surface). Address space details are a chain property, not a separate
query network.

Consequences:

- The `network` argument to `graph_query` selects the graph, not the address
  subset. A `USE topology` match on `:Address` without an exact address must
  add a `<alias>.network = "<network>"` predicate. Address-anchored lookups
  stay unscoped on purpose: the address is a unique key.
- `USE facts` is the inverse. Each network gets its own backing database
  there, and the facts `Address` label has no mapped `network` property —
  projecting it hard-fails. Facts serves `Address` only as a `TRANSFER`
  endpoint, so a single-node `MATCH (a:Address)` is refused.

Getting this backwards caused a production regression and a wrong-network
sweep in the same day (2026-07). Verify against the live stack before
restating it. Query-side detail:
[../graph-query-compatibility.md](../graph-query-compatibility.md).

## Workspace Output Layout

Investigation output stays local in user workspace directories:

- `.chain-insights/` — monitor runtime state under
  `.chain-insights/monitor/` (config, render state, append-only run log).
- `cases/`, `reports/`, `artifacts/`.
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
