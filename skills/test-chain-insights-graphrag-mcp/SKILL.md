---
name: test-chain-insights-graphrag-mcp
description: Run real local UAT for Chain Insights against the GraphRAG MCP server. Use when validating Chain Insights MCP proxy compatibility with GraphRAG MCP, debug bearer auth, graph report storage, TTL-safe graph payloads, local Hono graph report serving, CLI graph_query, public proxy tool registration, or before claiming Chain Insights and GraphRAG MCP are integrated.
---

<objective>
Validate Chain Insights against the real local GraphRAG MCP endpoint with commands, not invented playbooks or mocked output.
</objective>

<quick_start>
Run the bundled UAT script from the skill directory or by path:

```bash
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

The script writes raw MCP responses and a summary under `chain-insights/.tmp/uat/`.
It creates and uses a temporary initialized Chain Insights workspace for all
investigation-producing commands.

Before running it, start or configure a GraphRAG MCP endpoint that accepts the
debug bearer token used by the script.
</quick_start>

<defaults>
- Chain Insights repo: auto-detected from this package checkout
- MCP endpoint: `http://localhost:8012/mcp`
- Debug bearer token: `chain-insights-dev-debug`
- Chain Insights local server port: `4321`
- UAT address: `5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6`
- UAT member network: `substrate`
</defaults>

<environment_overrides>
Override defaults with environment variables:

```bash
CHAIN_INSIGHTS_DIR=/path/to/chain-insights \
GRAPHRAG_MCP_ENDPOINT=http://localhost:8012/mcp \
GRAPHRAG_DEBUG_TOKEN=chain-insights-dev-debug \
CHAIN_INSIGHTS_SERVER_PORT=4321 \
UAT_ADDRESS=5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6 \
UAT_MEMBER_NETWORK=substrate \
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

Set `SKIP_BUILD=1` only when deliberately reusing an existing Chain Insights `dist/`.
</environment_overrides>

<uat_contract>
The UAT must verify all of these facts:

- GraphRAG direct MCP exposes `network_capabilities`, `graph_query`, and `graph_query_batch` through debug bearer auth.
- GraphRAG direct `network_capabilities` exposes only the public `bittensor` semantic investigation network; it must not advertise alias/source databases or unsupported networks such as `bittensor_evm`, `base`, `ethereum`, or `tron`.
- GraphRAG direct `graph_query` with `network=bittensor` and `USE live_topology` returns live topology as `Identity FLOWS_TO Identity` edges, and `USE facts` returns semantic identity facts with routing metadata `facts.routing.starrocks_database=bittensor_semantic`; no internal identity network key or legacy `topology_scope` argument is used as a public tool input.
- Identity-route facts are keyed by the public identity key form `bittensor:<canonical_evm_address>` (set `UAT_IDENTITY_KEY` together with `UAT_ADDRESS`); labels for the default key are guaranteed by the RBMK identity verification harness seed or any real label on the address.
- GraphRAG direct `graph_query` defaults to identity-grain topology for the same network: `(:Identity)-[:FLOWS_TO]->(:Identity)` plus `(:Identity)-[:HAS_ADDRESS]->(:Address)` satellites. Public tools remain address-facing by resolving supplied member addresses to identities internally and returning member addresses as the primary public surface.
- If GraphRAG direct MCP also exposes high-level `aml_address_risk`, that direct tool succeeds, returns `content` text and `structuredContent.schema = chain-insights.result.v1`, does not expose `app_data`, `nodes`, `edges`, `flows`, `edge_anchors`, or `transfers` in `structuredContent`, and puts graph data only in `_meta.chainInsights.graph.data`.
- If GraphRAG direct MCP is primitive-only, Chain Insights proxy high-level tools are still mandatory and must build their graph reports from the primitive graph path.
- Chain Insights proxy `tools/list` exposes local `balance`, `help`, `aml_address_risk`, `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and `aml_trace_deposit_sources`, plus public proxied GraphRAG tools.
- `chain-insights mcp networks` reports each supported network with topology support, risk support, available tools, and dataset height/date coverage when the GraphRAG endpoint exposes it.
- Chain Insights proxy tool descriptions must not contain stale `app_data` wording after schema refresh.
- Chain Insights proxy `aml_address_risk` returns only local graph report metadata in `_meta.chainInsights.graph = { schema, url }`.
- Chain Insights proxy response must not include `_meta.chainInsights.graph.data`.
- The local graph report URL must be served by the Chain Insights Hono server at `/graph-reports/<filename>.graph.json` and return `chain-insights.graph.v1` JSON without `transfers`.
- Chain Insights proxy AML tools accept public blockchain/member addresses, resolve identity-grain topology internally, return public addresses as the primary address surface, and include identity resolution metadata for audit/debug use.
- `chain-insights mcp call graph_query` with `USE live_topology` must hit the real GraphRAG path and return the UAT address.
- No investigation output is created under `~/.chain-insights/reports`.
</uat_contract>

<process>
1. Run the script. Do not replace it with hand-written equivalent commands unless the script itself is being fixed.
2. Read the summary path printed by the script.
3. Report pass/fail from the script output and include the raw response paths for reproducibility.
4. If a step fails because `x402 payment is temporarily unavailable`, verify the debug bearer token config and rerun with `GRAPHRAG_DEBUG_TOKEN`.
5. If a port is already in use, the script reuses a healthy local server and only stops a server it started itself.
</process>

<success_criteria>
UAT is complete only when the script exits `0`, reports every assertion as passed, and the final answer states the report path and any residual unrelated repo health issues separately from UAT status.
</success_criteria>
