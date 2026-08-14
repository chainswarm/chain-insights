---
name: test-chain-insights-graph
description: Run real local UAT for Chain Insights against the Chain Insights Graph server. Use when validating Chain Insights MCP proxy compatibility with Chain Insights Graph, debug bearer auth, graph report storage, TTL-safe graph payloads, local Hono graph report serving, CLI graph_query, public proxy tool registration, or before claiming Chain Insights and Chain Insights Graph are integrated.
---

<objective>
Validate Chain Insights against the real local Chain Insights Graph endpoint with commands, not invented playbooks or mocked output.
</objective>

<quick_start>
Run the bundled UAT script from the skill directory or by path:

```bash
skills/test-chain-insights-graph/scripts/run-uat.sh
```

The script writes raw MCP responses and a summary under `chain-insights/.tmp/uat/`.
It creates and uses a temporary initialized Chain Insights workspace for all
investigation-producing commands.

Before running it, start or configure a Chain Insights Graph endpoint that accepts the
debug bearer token used by the script.
</quick_start>

<defaults>
- Chain Insights repo: auto-detected from this package checkout
- MCP endpoint: `http://localhost:8012/mcp`
- Debug bearer token: `chain-insights-dev-debug`
- Chain Insights local server port: `4321`
- UAT address (H160 EVM, `robinhood`): `0x20d09f2881602eee806147ceee9275d33ff31df8`
- UAT LINKED address (H160, same `robinhood` network): `0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24`
</defaults>

<environment_overrides>
Override defaults with environment variables:

```bash
CHAIN_INSIGHTS_DIR=/path/to/chain-insights \
CHAIN_INSIGHTS_GRAPH_ENDPOINT=http://localhost:8012/mcp \
CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN=chain-insights-dev-debug \
CHAIN_INSIGHTS_SERVER_PORT=4321 \
UAT_ADDRESS=0x20d09f2881602eee806147ceee9275d33ff31df8 \
UAT_LINKED_ADDRESS=0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24 \
skills/test-chain-insights-graph/scripts/run-uat.sh
```

Set `SKIP_BUILD=1` only when deliberately reusing an existing Chain Insights `dist/`.
</environment_overrides>

<uat_contract>
The UAT must verify all of these facts:

- Direct Chain Insights Graph exposes `network_capabilities`, `graph_query`, and `graph_query_batch` through debug bearer auth.
- Direct Chain Insights Graph `network_capabilities` exposes ONE public Robinhood investigation network, `robinhood` (EVM H160 `0x...` addresses); it must not advertise alias/source databases or unsupported networks such as `base`, `ethereum`, or `tron`.
- Direct Chain Insights Graph `graph_query` with `network=robinhood` and `USE topology` returns topology (recent and full historical activity in one graph) as `Address FLOWS_TO Address` edges, and `USE facts` serves the transfers-only tier (rbmk#447 P3/P5: a single-node `(a:Address)` match is refused there — match through a `TRANSFER` pattern, or read address-grain properties on `USE topology`) with routing metadata `facts.routing.starrocks_database=robinhood`; no internal semantic-database alias or legacy per-call graph-scope tool argument is used as a public tool input.
- Address facts are keyed by the raw chain-native address directly (set `UAT_ADDRESS`, and `UAT_LINKED_ADDRESS` for the `robinhood`-network LINKED counterpart); labels for the default address are guaranteed by the RBMK verification harness seed or any real label on the address.
- Direct Chain Insights Graph `graph_query` defaults to address-grain topology for the single `robinhood` network: `(:Address)-[:FLOWS_TO]->(:Address)` plus the undirected `(:Address)-[:LINKED]-(:Address)` ownership-overlay edge. Public tools remain address-facing: they accept and return the raw address directly, with no identity-resolution step.
- If direct Chain Insights Graph also exposes high-level `aml_address_risk`, that direct tool succeeds, returns `content` text and `structuredContent.schema = chain-insights.result.v1`, does not expose `app_data`, `nodes`, `edges`, `flows`, `edge_anchors`, or `transfers` in `structuredContent`, and puts graph data only in `_meta.chainInsights.graph.data`.
- If direct Chain Insights Graph is primitive-only, Chain Insights proxy high-level tools are still mandatory and must build their graph reports from the primitive graph path.
- Chain Insights proxy `tools/list` exposes local `wallet_balance`, `meta_help`, `meta_network_capabilities`, `meta_usage_status`, `aml_address_risk`, plus public proxied Chain Insights Graph tools.
- `chain-insights mcp networks` reports each supported network with topology support, risk support, and available tools.
- Chain Insights proxy tool descriptions must not contain stale `app_data` wording after schema refresh.
- Chain Insights proxy `aml_address_risk` returns only local graph report metadata in `_meta.chainInsights.graph = { schema, url }`.
- Chain Insights proxy response must not include `_meta.chainInsights.graph.data`.
- The local graph report URL must be served by the Chain Insights Hono server at `/graph-reports/<filename>.graph.json` and return `chain-insights.graph.v1` JSON without `transfers`.
- Chain Insights proxy AML tools accept raw blockchain addresses directly, with no identity-resolution step, and return the same addresses as the primary address surface.
- `chain-insights mcp call graph_query` with `USE topology` must hit the real Chain Insights Graph path and return the UAT address.
- No investigation output is created under `~/.chain-insights/reports`.
</uat_contract>

<monitoring_uat>
The bundled script covers the investigation path. `cia monitor` is a separate
surface over the same workspace and is not exercised by it. When a change
touches monitor rendering or the case commands, add a manual pass from the
temporary workspace:

```bash
cia monitor run; echo "exit=$?"
cia monitor status
cia monitor render
```

What to assert, and what NOT to treat as a failure:

- Exit `0` is a clean pass; exit `2` is an **isolated case failure** — the
  run completed and every other case's dossier still rendered. Only exit `1`
  means the run could not start. A UAT that treats any non-zero exit as a
  failure will report a healthy partial pass as broken.
- An **unchanged case renders as skipped, not re-rendered**: the run document
  records `skipped_reason: 'unchanged'` (content-keyed rendering). Assert the
  run document exists and parses, not that it re-rendered every case.
- Monitor output must stay workspace-local (`cases/`,
  `.chain-insights/monitor/`, `published/cases/`) — the same rule as
  investigation output.

See `docs/monitoring.md` and the `chain-insights-monitoring` skill for the full
command surface.
</monitoring_uat>

<process>
1. Run the script. Do not replace it with hand-written equivalent commands unless the script itself is being fixed.
2. Read the summary path printed by the script.
3. Report pass/fail from the script output and include the raw response paths for reproducibility.
4. If a step fails because `x402 payment is temporarily unavailable`, verify the debug bearer token config and rerun with `CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN`.
5. If a port is already in use, the script reuses a healthy local server and only stops a server it started itself.
</process>

<success_criteria>
UAT is complete only when the script exits `0`, reports every assertion as passed, and the final answer states the report path and any residual unrelated repo health issues separately from UAT status.
</success_criteria>
