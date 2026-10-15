# Development

This document is for engineers changing Chain Insights.

## Install And Build

```bash
npm install
npm run build
node bin/cli.js --help
```

## The `dist/` Trap

`bin/cli.js` is a shim that dynamically imports `dist/`. It never reads `src/`.
And `dist/` is gitignored, does not auto-rebuild, and **`npm test` does not
rebuild it** — vitest runs against `src/`.

So a stale `dist/` passes the entire test suite and still ships broken
behavior to anyone using the CLI. There is no error to notice: the CLI runs
old compiled logic against current data and returns a plausible wrong answer.

After ANY change under `src/`, before exercising it through `cia` or
`bin/cli.js`:

```bash
npm run build
```

`npm run build` is more than compilation — it also copies wallet assets into
`dist/`, so skipping it stales packaged assets as well as logic.

## Concurrent Work

When more than one change is in flight, use a git worktree rather than
switching branches in a shared checkout:

```bash
git fetch origin
git worktree add ../chain-insights-<topic> -b <branch> origin/main
cd ../chain-insights-<topic>
npm ci
```

Each worktree gets its own `node_modules/` and its own `dist/`, so one branch's
build cannot leak into another's CLI run — which, given the `dist/` trap above,
is exactly the failure that is hardest to diagnose. Branch switching in place
also churns tracked files under another agent's or editor's feet.

## Tests

Run the full local gate:

```bash
npm run typecheck
npm test
npm run build
npm run release:check
git diff --check
```

Focused documentation and CLI tests:

```bash
npm test -- tests/skills-contract.test.ts tests/cli.test.ts
```

## Global Install From Checkout

```bash
npm run build
npm install -g .
cia --version
```

## Contracts the code keeps
The contracts Chain Insights exposes and consumes. Every statement here
names the source file it was verified against.

### Public MCP Tool Surface

- The canonical public tool surface is the prefixed set `graph_*` /
  `meta_*` / `wallet_*`.
- `visibleRemoteTools()` in `src/mcp/tool-visibility.ts` hides unprefixed
  backend names (`address_risk`, `trace_victim_funds`, `trace_suspect_funds`,
  `trace_deposit_sources`, `trace_funds`, `track_funds`,
  `network_capabilities`, `usage_status`, `balance`, `topup`, `help`,
  `address_connection_risk` and the retired exchange-flows tool) via
  `HIDDEN_REMOTE_TOOL_NAMES`. They never surface publicly. So does
  `aml_address_risk`, hidden until its verdict is fixed.
- Local tools live in `src/mcp/proxy.ts` (`LOCAL_TOOL_NAMES`):
  `meta_network_capabilities`, `meta_schema`, `meta_rules`, `meta_help`,
  `meta_usage_status`, `meta_subscription_status`, `wallet_balance`,
  `wallet_topup`, and `graph_expand`, which only the view calls
  (`APP_ONLY_LOCAL_TOOL_NAMES`).
- `meta_schema` (`src/mcp/graph-schema.ts`) builds the live graph schema of one
  network from the catalog statements of the graph endpoint (`CALL db.labels()`,
  `CALL db.relationshipTypes()`, `CALL db.propertyKeys()`, `SHOW INDEXES`), a
  sample of the main kinds and the published capabilities. It returns
  `chain-insights.graph-schema.v1`, and keeps it on disk for 24 hours
  (`src/mcp/graph-schema-cache.ts`).
- `meta_network_capabilities` repeats GraphRAG's advertised networks
  (`mirrorGraphNetworkCapabilities` in `src/mcp/capabilities.ts`). CIA
  preserves the tool status advertised for each network. It does not add
  tools that the network did not advertise. It also repeats the blocks a
  network publishes about its layers exactly as sent: `layers`,
  `chain_admission`, `topology_admission` and `facts_admission`. A block the
  server did not send stays absent, never empty. The limits of a layer are read
  from these blocks, never written into a skill.

#### Tool Argument Contracts

- `PUBLIC_MCP_TOOL_REQUIRED_ARGS` / `PUBLIC_MCP_TOOL_ALLOWED_ARGS` in
  `src/mcp/tool-visibility.ts` define the public arg contract. Examples:
  `graph_query` requires query + network; `graph_query_batch` alone allows
  `per_query_timeout_seconds`; both allow `time_scope`.
- An argument absent from the allowlist is silently stripped by
  `normalizeRemoteToolArguments`. Every new tunable arg must be added here
  and to the numeric-argument set in `src/mcp/call-args.ts` the moment it
  appears on a tool schema.

### Endpoint Configuration

Precedence for the Chain Insights Graph endpoint:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` environment variable.
2. Legacy `GRAPH_MCP_ENDPOINT` environment variable.
3. Saved `graphMcpEndpoint` config value.
4. Default `https://mcp.chain-insights.ai/`.

Validation (`validateMcpEndpoint` in `src/config/mcp-endpoint.ts`):

- `http://` only for loopback or Kubernetes `*.svc.cluster.local` service DNS.
- Other remote hosts must use `https://`.
- No credentials, query string, or fragment in the URL.

The MCP proxy uses stateless operation by default. It returns tool results to
the caller and does not create local investigation files.

### Shared-Graph Model

The public surface exposes **one network** (`robinhood`, see Public MCP
Tool Surface). Address space details are a chain property, not a separate
query network.

Consequences:

- The `network` argument to `graph_query` selects the graph, not the address
  subset. `network` is also a property of every node and relationship on
  `USE topology`, `USE facts` and `USE chain`. Its value is the query's
  `network`, it is computed and never stored, and only a `:Chain` node (the far
  side of a bridge) stores its own, which names the remote chain. A filter on
  `network` narrows nothing. Anchor a query on an address instead.
- `USE facts` carries `network` on its rows and endpoints too, with no view
  column behind it. Facts serves `Address` only as a `TRANSFER` endpoint, so a
  single-node `MATCH (a:Address)` is refused. Facts serves no kind label.

Verify against the live stack before restating it. Query-side detail:
[graph-query-compatibility.md](graph-query-compatibility.md).

## More Developer Docs

- Contributor workflow: `docs/contributing.md`
- Debugging and UAT: `docs/debugging.md`
- Graph tool contracts: `docs/graph-tools.md`
- Architecture index: `docs/architecture/ARCHITECTURE.md`
