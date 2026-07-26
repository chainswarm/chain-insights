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

## Monitoring Runs

`cia monitor run` signals a pass through its exit code, so read the code before
reading the logs:

```bash
cia monitor run; echo "exit=$?"
```

- `0` — clean pass.
- `2` — **isolated cell failure**: the pass completed, at least one cell did
  not. The failing cells are printed as `[monitor] <cell> FAILED: …`; every
  other cell's findings and alerts landed. This is a partial success.
- `1` — the run could not start (unreadable workspace, invalid monitor config).
  Nothing was scanned.

Under pm2, exit `2` shows the process as `errored` in `pm2 list`. That is the
intended visibility for a partial pass, not a broken deployment.

An empty findings document is also not a bug: full-state detectors emit only
findings not already emitted for that network, so unchanged data yields zero
new findings. Force a full re-emit with
`cia detect <detector> --network <network> --full`. See
[Continuous monitoring](monitoring.md).

## Bittensor Devkit Backend

Use the bundled devkit when you need a deterministic local Chain Insights Graph
backend for Chain Insights workflows:

```bash
docker compose -f devkit/docker-compose.yml down -v --remove-orphans
docker compose -f devkit/docker-compose.yml up -d --build
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp
npm run devkit:smoke
npm run devkit:smoke:parity
```

The devkit backend exposes graph primitives only. It does not need a debug
token, wallet, x402 payment, quota state, or hosted tester access key.

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

## Smoke Checks

```bash
node bin/cli.js mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE topology MATCH (n) RETURN count(n) AS count LIMIT 1"}]'
node bin/cli.js wallet address
node bin/cli.js wallet balance
```

## UAT Script

```bash
skills/test-chain-insights-graph/scripts/run-uat.sh
```

The UAT script uses a temporary initialized workspace, calls the real Chain
Insights Graph endpoint, verifies proxy tools, and checks graph report serving.
