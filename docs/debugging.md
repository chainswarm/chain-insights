# Debugging Chain Insights

This document covers local GraphRAG MCP debugging, auth bypasses, Inspector
checks, and UAT. Product quick starts belong in README; debugging details live
here.

## Local GraphRAG MCP Debug

Start your local GraphRAG MCP development endpoint with debug bearer auth
enabled. The exact startup command depends on your GraphRAG MCP checkout or
deployment.

```bash
export GRAPHRAG_MCP_ENDPOINT=http://localhost:8012/mcp
export GRAPHRAG_DEBUG_TOKEN=chain-insights-dev-debug
```

Point Chain Insights at the local endpoint:

```bash
node bin/cli.js debug on \
  --token "${GRAPHRAG_DEBUG_TOKEN}" \
  --endpoint "${GRAPHRAG_MCP_ENDPOINT}"
node bin/cli.js mcp tools --refresh
```

## Inspector

Inspect the GraphRAG MCP endpoint directly:

```bash
npx @modelcontextprotocol/inspector \
  --cli "${GRAPHRAG_MCP_ENDPOINT:-http://localhost:8012/mcp}" \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: ${GRAPHRAG_DEBUG_TOKEN:-chain-insights-dev-debug}"
```

Inspect the Chain Insights proxy:

```bash
npx @modelcontextprotocol/inspector \
  --cli chain-insights-mcp-proxy \
  --method tools/list
```

## Smoke Checks

```bash
node bin/cli.js mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"}]'
node bin/cli.js wallet address
node bin/cli.js wallet balance
```

## UAT Script

```bash
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

The UAT script uses a temporary initialized workspace, calls the real GraphRAG
MCP endpoint, verifies proxy tools, and checks graph report serving.
