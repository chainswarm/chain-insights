# Development

This document is for engineers changing Chain Insights.

## Install And Build

```bash
npm install
npm run build
```

Run the CLI from source:

```bash
node bin/cli.js --help
```

Install globally from a local checkout:

```bash
npm run build
npm install -g .
cia --version
```

## Tests

Run the full local gate:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
```

Focused tests for MCP and wallet work:

```bash
npm test -- \
  tests/mcp-client.test.ts \
  tests/mcp-proxy.test.ts \
  tests/mcp-schema-cache.test.ts \
  tests/cli-mcp.test.ts \
  tests/wallet.test.ts \
  tests/wallet-tools.test.ts \
  tests/viz-html-generator.test.ts \
  tests/mcp-graph-reports.test.ts \
  tests/viz-server.test.ts
```

Focused tests for workspace scaffolding:

```bash
npm test -- tests/cli.test.ts
```

## Release Gate

Release discipline:

- Work on PR branches only.
- Every PR to `main` must bump `package.json` and `package-lock.json` with a
  higher semver version.
- Every PR to `main` must add a matching `CHANGELOG.md` entry.
- The release gate runs in Verify on pull requests and can be run locally with
  `npm run release:check`.

## Human UAT

Start Go Graph MCP with debug bypass:

```bash
cd /home/aphex5/work/rbmk/repos/ml
docker compose -f compose/shared.yml build graphrag-mcp-go
GRAPH_MCP_GO_DEBUG_BYPASS_ENABLED=true \
GRAPH_MCP_GO_DEBUG_BYPASS_TOKEN=chain-insights-dev-debug \
docker compose -f compose/shared.yml up -d graphrag-mcp-go
```

Run Chain Insights smoke checks:

```bash
cd /home/aphex5/work/chain-insights
npm run build
node bin/cli.js debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
node bin/cli.js mcp tools --refresh
node bin/cli.js mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"sample","query":"USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 3"}]'
node bin/cli.js wallet address
node bin/cli.js wallet balance
```

Expected results:

- `mcp tools --refresh` lists `graph_query` and `graph_query_batch`.
- `graph_query_batch` returns `structuredContent.facts.batch.billable_seconds`.
- No high-level AML tools are served by Go Graph MCP.
- `wallet balance` prints the local wallet and Base USDC balance.

GraphRAG/Chain Insights UAT skill:

```bash
skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh
```

The skill builds or reuses local build outputs, calls the real graph MCP
endpoint, runs the Chain Insights proxy, verifies graph reports served from
`/graph-reports/<filename>.graph.json`, and writes a timestamped report under
`.tmp/uat/`.

## Debug CLI Sketch

Implemented setup helpers:

```bash
chain-insights setup claude-desktop --dry-run
chain-insights setup claude-desktop
```

Proposed diagnostic surface:

```bash
chain-insights debug
chain-insights debug mcp
chain-insights debug clients
chain-insights debug graph-report <filename.graph.json>
chain-insights debug browser --graph-report <filename.graph.json>
```

Expected checks:

| Command | Checks |
| --- | --- |
| `debug` | Config path, data dir, wallet presence, schema cache age, local server URL |
| `debug mcp` | `graphMcpEndpoint`, auth mode, `tools/list`, proxy `tools/list`, proxy `resources/list` |
| `debug clients` | Known client config files, command paths, Inspector smoke tests |
| `debug graph-report <filename.graph.json>` | Report file exists, graph schema, node/edge/flow counts, local server fetch works |
| `debug browser --graph-report <filename.graph.json>` | Opens the graph app and verifies `_meta.chainInsights.graph.url` loading |

Rules:

- Redact tokens and never print wallet private keys.
- Do not perform paid production MCP calls unless `--live-call` is explicit.
- Default to human-readable output; add `--json` for CI.
- Prefer exact failure causes over broad health summaries.
