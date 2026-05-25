# Chain Insights

[Website](https://chain-insights.ai) | [GitHub](https://github.com/chainswarm/chain-insights) | [npm](https://www.npmjs.com/package/chain-insights)

Chain Insights is an open-source AML investigation toolkit for AI agents and
analysts. Install it from npm to screen blockchain addresses, trace funds,
expand scam topologies, manage case evidence, and generate graph reports from
Chain Insights graph intelligence.

The hosted GraphRAG MCP access path is paid through x402. The CLI and MCP proxy
handle local wallet status, paid graph calls, approved test access, case files,
evidence pointers, dossiers, and reports.

## What You Can Do Today

| Tool | Use it for |
| --- | --- |
| `address_risk` | Screen one address for risk, behavior, neighborhood context, and exchange exposure |
| `track_funds` | Trace victim/source funds through intermediaries to exchange deposit candidates |
| `scam_topology` | Expand a known victim incident into reviewable scam infrastructure and label candidates |
| `graph_query` | Run one read-only GQL/Cypher query against a GraphRAG MCP graph layer |
| `graph_query_batch` | Run related read-only graph queries as one MCP call |

## Quick Start

Install from npm:

```bash
npm install -g chain-insights
```

Check the CLI:

```bash
cia --version
```

From a local checkout:

```bash
npm install
npm run build
npm install -g .
cia --version
```

Create an investigation workspace:

```bash
mkdir -p ./chain-insights-investigations
cd ./chain-insights-investigations
cia init .
```

Check the configured endpoint and current GraphRAG MCP capabilities:

```bash
cia config get graphMcpEndpoint
cia wallet balance
cia mcp networks
cia mcp tools --refresh
```

GraphRAG MCP calls use x402 paid mode by default unless you configure approved
test access or local debug access. If network or tool discovery fails, fix
endpoint/auth/payment first; the CLI can still initialize workspaces and manage
cases without a reachable GraphRAG MCP endpoint.

Open a case and run a small investigation:

```bash
cia case open "First Chain Insights investigation" \
  --tags aml,bittensor \
  --description "Screen and trace a known source address"

cia mcp track-funds \
  --network bittensor \
  --trusted-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --case 1
```

Then inspect:

```bash
cia case show 1
find reports cases -maxdepth 3 -type f | sort
```

## Demo

Run a direct live topology query:

```bash
cia mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 10"
```

Run a batch across graph layers:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"archive_flows","query":"USE archive_topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN f.period_granularity AS granularity, src.address AS source, dst.address AS target LIMIT 3"},{"id":"facts_sample","query":"USE facts MATCH (a:Address)-[:HAS_FEATURE]->(f:AddressFeature) RETURN a.address AS address, f.sent_count AS sent_count LIMIT 3"}]'
```

Run victim incident topology:

```bash
cia mcp scam-topology \
  --network bittensor \
  --victim-address 5... \
  --incident-timestamp-ms 1715532228001 \
  --max-hops 16 \
  --case 1
```

## How It Fits Together

```text
Agent or CLI user
  -> Chain Insights CLI / MCP proxy
  -> local config, wallet, workspace, cases, evidence, reports
  -> GraphRAG MCP
  -> graph intelligence for AML workflows
```

Chain Insights stores investigation outputs in initialized local workspaces.
GraphRAG MCP performs graph-language reads against network-specific graph
layers.

## Graph Access

Graph queries must choose the right read layer explicitly:

| Layer | Use it for |
| --- | --- |
| `live_topology` | Recent topology and fast traversal |
| `archive_topology` | Historical fund-flow context |
| `facts` | Labels, features, risk scores, assets, and enrichment |

Use `graph_query_batch` when related reads should share one call and one
result envelope. Paid hosted calls are settled through x402.

## AML Tools

The high-level AML tools are Chain Insights workflows built around graph access
and local case state:

- `address_risk` starts a single-address screen with risk, behavior,
  neighborhood context, and exchange exposure.
- `track_funds` traces trusted victim/source funds through intermediaries to
  exchange deposit candidates.
- `scam_topology` expands from a known victim incident into reviewable
  topology, safety decisions, and ML-ready label candidates.

When a case is provided, tools can save compact evidence pointers and graph
reports under the workspace instead of embedding large payloads in case notes.

## Docs Map

| Doc | Use it for |
| --- | --- |
| [Graph tools](docs/graph-tools.md) | GraphRAG MCP layers, `graph_query`, `graph_query_batch`, AML tool contracts, graph reports, evidence pointers |
| [Investigation workspaces](docs/investigation-workspaces.md) | `cia init`, case layout, evidence, dossiers, imports, templates, sessions, reports |
| [MCP proxy](docs/mcp-proxy.md) | Stdio proxy behavior, agent installers, local tools, auth modes, Inspector validation |
| [Architecture](docs/architecture.md) | Product layers, data flow, local storage, security model, config keys |
| [Development](docs/development.md) | Build, test, and local install commands |
| [Contributing](docs/contributing.md) | Development workflow, pull requests, release expectations |
| [Debugging](docs/debugging.md) | Local troubleshooting, diagnostics, debug workflows |

## What It Is Not

Chain Insights is not a custodial wallet, hosted case database, or replacement
for analyst review. It does not write risk labels automatically. Investigation
data stays in the local workspace unless the operator exports or shares it.
