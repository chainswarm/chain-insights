# Chain Insights Bittensor Devkit

The devkit is a local Chain Insights Graph backend for Chain Insights
development. It lets developers run Chain Insights AML workflows against a deterministic
Bittensor fixture without staging access, hosted credentials, x402 payment, or
live indexing.

The fixture serves the public semantic network `bittensor` from source genesis
through `2025-12-31` UTC. Chain Insights owns the AML tools and investigation
recipes; this devkit exposes only the graph backend primitives those tools use.

## What It Runs

`docker-compose.yml` starts:

- StarRocks with physical `bittensor_semantic` facade tables loaded from
  fixture files.
- Memgraph with live topology imported from fixture files.
- Memgraph Zero / MemGQL configured with the shared Chain Insights mapping.
- A devkit-only lite Chain Insights Graph backend.

The MCP endpoint is:

```text
http://127.0.0.1:18012/mcp
```

The devkit MCP tool list is intentionally small:

- `network_capabilities`
- `graph_query`
- `graph_query_batch`

It does not expose `aml_*`, wallet, x402, payment, quota, ACP, or telemetry
tools. Chain Insights provides AML workflows locally over the graph primitives.

## Start From A Clean State

From the Chain Insights checkout inside the standard multi-repo development
workspace:

```bash
docker compose -f devkit/docker-compose.yml down -v --remove-orphans
docker compose -f devkit/docker-compose.yml up -d --build
```

Check container state:

```bash
docker compose -f devkit/docker-compose.yml ps -a
```

The import/bootstrap one-shot services should exit `0`, and `starrocks`,
`memgraph`, `memgql`, and `chain-insights-graph-devkit` should stay running.

## Smoke Test

Run the backend smoke:

```bash
npm run devkit:smoke
```

Run Chain Insights against the devkit:

```bash
npm run devkit:smoke:parity
```

The parity smoke checks all current Chain Insights CLI MCP tools. Graph-backed
tools must succeed against the devkit backend. `wallet_balance` is checked as a
local-only unconfigured-wallet path because wallet state is owned by Chain
Insights, not the devkit backend.

Smoke evidence is written under the workspace root:

```text
workspace/devkit-smoke/
workspace/devkit-smoke/chain-insights-parity/
```

## Use It With `cia`

Point Chain Insights at the devkit endpoint:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:18012/mcp
```

From a clean investigation workspace:

```bash
mkdir -p /tmp/chain-insights-devkit-demo
cd /tmp/chain-insights-devkit-demo
cia init .
cia mcp networks
cia mcp tools --refresh
cia mcp call aml_address_risk \
  address=5DevkitSeedAddress111111111111111111111111111111 \
  network=bittensor
```

The devkit fixture is intentionally small, so it is best for contract testing,
tool development, docs examples, and local workflow checks. It is not a
representative production coverage sample.

## Data Boundary

StarRocks imports only the MemGQL mapped facade objects as physical tables. The
devkit does not import raw block streams, sync state, indexer checkpoints,
wallet/payment/quota metadata, or telemetry tables.

Memgraph starts empty and imports live topology directly from fixture files.
`USE live_topology` resolves to Memgraph; `USE archive_topology` and `USE
facts` resolve to StarRocks through Memgraph Zero.

The production Chain Insights Graph assembly is not used by this devkit package.
