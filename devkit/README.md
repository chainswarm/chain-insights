# Chain Insights Bittensor Devkit

The devkit is a local Chain Insights Graph backend for Chain Insights
development. It lets developers run Chain Insights AML workflows against a deterministic
Bittensor fixture without staging access, hosted credentials, x402 payment, or
live indexing.

The fixture serves the public semantic network `bittensor` from
`2024-01-01` through `2026-07-02` UTC. Chain Insights owns the AML tools and investigation
recipes; this devkit exposes only the graph backend primitives those tools use.

## What It Runs

`docker-compose.yml` starts:

- StarRocks with physical `bittensor_semantic` facade tables loaded from
  fixture files.
- Memgraph with live topology imported from fixture files.
- Memgraph Zero / MemGQL configured with the shared Chain Insights mapping.
- A devkit-only lite Chain Insights Graph backend, built entirely from this
  repository so third-party developers can host the graph MCP against local
  StarRocks and Memgraph without any production backend source, payment,
  quota, or telemetry surface. Its tool and tier contract tracks the
  production backend: two-tier query timeouts (live 10s, archive/facts 30s),
  capability live/archive sublayers, and an unmetered `usage_status`.

The MCP endpoint is:

```text
http://127.0.0.1:18012/mcp
```

Fixture data is generated from the RBMK-controlled StarRocks export path:

```bash
cd /path/to/rbmk
bash scripts/devops/chain-insights-devkit/build-fixture.sh
```

The largest topology fixture object is chunked into Git-safe parts so the
devkit data stays small enough for ordinary Git checkouts without dropping rows
inside the fixture window.

The devkit MCP tool list is intentionally small:

- `network_capabilities`
- `usage_status`
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
address="$(
  awk -F, 'NR > 1 && $2 == "substrate" { print $1; exit }' \
    /path/to/chain-insights/devkit/data/memgraph/addresses.csv
)"
cia mcp call aml_address_risk \
  "address=${address}" \
  network=bittensor
```

The devkit fixture is a static export of real Bittensor semantic data from
2024-01-01 through 2026-07-02. It is best for contract testing, tool development, docs
examples, and local workflow checks.

## Data Boundary

StarRocks imports only the MemGQL mapped facade objects as physical tables. The
devkit does not import raw block streams, sync state, indexer checkpoints,
wallet/payment/quota metadata, or telemetry tables.

Memgraph starts empty and imports live topology directly from fixture files.
`USE live_topology` resolves to Memgraph; `USE archive_topology` and `USE
facts` resolve to StarRocks through Memgraph Zero.

The production Chain Insights Graph assembly is not used by this devkit package.
