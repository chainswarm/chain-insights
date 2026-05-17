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
</quick_start>

<defaults>
- Chain Insights repo: `/home/aphex5/work/chain-insights`
- GraphRAG compose root: `/home/aphex5/work/rbmk/repos/ml`
- GraphRAG repo: `/home/aphex5/work/rbmk/repos/ml/graphrag`
- MCP endpoint: `http://localhost:8011/mcp`
- Debug bearer token: `chain-insights-dev-debug`
- Chain Insights local server port: `4321`
- UAT address: `5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6`
</defaults>

<environment_overrides>
Override defaults with environment variables:

```bash
CHAIN_INSIGHTS_DIR=/path/to/chain-insights \
GRAPHRAG_ML_DIR=/path/to/rbmk/repos/ml \
GRAPHRAG_DIR=/path/to/rbmk/repos/ml/graphrag \
GRAPHRAG_MCP_ENDPOINT=http://localhost:8011/mcp \
GRAPHRAG_DEBUG_TOKEN=chain-insights-dev-debug \
CHAIN_INSIGHTS_SERVER_PORT=4321 \
UAT_ADDRESS=5Ccmf1dJKzGtXX7h17eN72MVMRsFwvYjPVmkXPUaapczECf6 \
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

Set `SKIP_BUILD=1` only when deliberately reusing an existing Chain Insights `dist/`.
</environment_overrides>

<uat_contract>
The UAT must verify all of these facts:

- GraphRAG direct MCP `address_risk` succeeds through debug bearer auth.
- GraphRAG direct MCP returns `content` text and `structuredContent.schema = chain-insights.result.v1`.
- GraphRAG direct MCP does not expose `app_data`, `nodes`, `edges`, `flows`, `edge_anchors`, or `transfers` in `structuredContent`.
- GraphRAG direct MCP puts graph data only in `_meta.chainInsights.graph.data`.
- GraphRAG graph data has schema `chain-insights.graph.v1` and keys `schema`, `nodes`, `edges`, `flows`, `edge_anchors`; it must not include `transfers`.
- Chain Insights proxy `tools/list` exposes local `balance` and `help`, plus public proxied GraphRAG tools.
- Chain Insights proxy tool descriptions must not contain stale `app_data` wording after schema refresh.
- Chain Insights proxy `address_risk` returns only local graph report metadata in `_meta.chainInsights.graph = { schema, url }`.
- Chain Insights proxy response must not include `_meta.chainInsights.graph.data`.
- The local graph report URL must be served by the Chain Insights Hono server at `/graph-reports/<filename>.graph.json` and return `chain-insights.graph.v1` JSON without `transfers`.
- `chain-insights mcp call graph_query` must hit the real GraphRAG/Memgraph path and return the UAT address.
- No investigation output is created under `~/.chain-insights/reports` or `~/.chain-insights/cases`.
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
