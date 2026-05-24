# Debugging Chain Insights

This document covers local GraphRAG MCP debugging, auth bypasses, Inspector
checks, and UAT. Product quick starts belong in README; debugging details live
here.

## Local GraphRAG MCP Debug

Start GraphRAG MCP with debug bypass from the RBMK ML repo:

```bash
cd /home/aphex5/work/rbmk/repos/ml
test -f .env || cp .env.example .env
set -a
. ./.env
set +a
docker compose -f compose/shared.yml build graphrag-mcp-go
MCP_DEBUG_BYPASS_ENABLED=true \
MCP_DEBUG_BYPASS_TOKEN=chain-insights-dev-debug \
docker compose -f compose/shared.yml up -d graphrag-mcp-go
```

Point Chain Insights at the local endpoint:

```bash
cd /home/aphex5/work/chain-insights
node bin/cli.js debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
node bin/cli.js mcp tools --refresh
```

## Inspector

Inspect the GraphRAG MCP endpoint directly:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"
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
