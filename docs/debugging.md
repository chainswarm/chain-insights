# Debugging Chain Insights

This document covers local Chain Insights Graph debugging, auth bypasses,
Inspector checks, and UAT. Product quick starts belong in README; debugging
details live here.

## Check `dist/` First

Before debugging anything reached through `cia` or `bin/cli.js`, rebuild:

```bash
npm run build
```

`bin/cli.js` imports `dist/`, never `src/`. `dist/` is gitignored, does not
auto-rebuild, and is not rebuilt by `npm test`. A stale `dist/` therefore runs
old compiled logic against current data and returns a plausible wrong answer
with no error and no hint that the build is the cause — including symptoms that
look exactly like bad data or a broken endpoint. Rule out the build before
investigating the graph.

## Local Chain Insights Graph Debug

Start your local Chain Insights Graph development endpoint with debug bearer
auth enabled. The exact startup command depends on your Chain Insights Graph
checkout or deployment.

```bash
export CHAIN_INSIGHTS_GRAPH_ENDPOINT=http://localhost:8012/mcp
export CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN=chain-insights-dev-debug
```

Point Chain Insights at the local endpoint:

```bash
node bin/cli.js debug on \
  --token "${CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN}" \
  --endpoint "${CHAIN_INSIGHTS_GRAPH_ENDPOINT}"
node bin/cli.js mcp tools --refresh
```

## Inspector

Inspect the Chain Insights Graph endpoint directly:

```bash
npx @modelcontextprotocol/inspector \
  --cli "${CHAIN_INSIGHTS_GRAPH_ENDPOINT:-http://localhost:8012/mcp}" \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: ${CHAIN_INSIGHTS_GRAPH_DEBUG_TOKEN:-chain-insights-dev-debug}"
```

Inspect the Chain Insights proxy:

```bash
npx @modelcontextprotocol/inspector \
  --cli chain-insights-mcp-proxy \
  --method tools/list
```

## Environment Variables

| Variable         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CIA_ACTION_LOG` | Optional path to an append-only JSONL audit log of every MCP tool invocation (tool name, arguments, outcome, duration, and any `warnings`/`search_limits` surfaced by the result). Unset by default — no file is written. Intended for unattended runs where an operator or a later reviewing agent needs to see what ran and why a result looked the way it did. Never causes a tool call to fail: a write error (including an unwritable path) is swallowed silently. |

## Smoke Checks

```bash
node bin/cli.js mcp call graph_query_batch \
  network=robinhood \
  'queries=[{"id":"count","query":"USE topology MATCH (n) RETURN count(n) AS count LIMIT 1"}]'
node bin/cli.js wallet address
node bin/cli.js wallet balance
```

## UAT

Public Graph UAT is maintainer tooling. It is not a shipped agent skill.
