# Chain Insights

[Website](https://chain-insights.ai) | [GitHub](https://github.com/chainswarm/chain-insights) | [npm](https://www.npmjs.com/package/chain-insights)

Chain Insights is an open-source AML investigation toolkit for AI agents and
analysts. Install it from npm to screen blockchain addresses, trace role-specific
fund flows, manage case evidence, and generate graph reports.

Graph access is configuration-driven. The package defaults to a local GraphRAG
MCP endpoint for development; hosted endpoints are set explicitly with
`graphMcpEndpoint` or `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT`.

## What You Can Do Today

| Tool | Use it for |
| --- | --- |
| `address_risk` | Screen one address for risk, behavior, neighborhood context, and exchange exposure |
| `stake_insights` | Explain Bittensor staking relationships, net stake movement, and counterparties |
| `trace_victim_funds` | Trace victim/source funds forward to exchange deposit candidates |
| `trace_deposit_sources` | Trace backward from suspected deposit/cashout addresses to upstream sources and convergence |
| `trace_suspect_funds` | Trace suspected scammer, mule, operator, or laundering-ring funds forward to cashout topology |
| `usage_status` | Check the caller's public free graph query quota for today |
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

## Configure GraphRAG MCP Endpoint

`cia` uses `graphMcpEndpoint` for all GraphRAG MCP calls. The npm package does
not hardcode a hosted endpoint. Configure the endpoint explicitly for the
environment you intend to use.

Local development endpoint (default):

```bash
cia config set graphMcpEndpoint http://127.0.0.1:8012/mcp
```

Hosted staging endpoint for approved testers:

```bash
cia config set graphMcpEndpoint https://staging-mcp.chain-insights.ai/mcp
```

For now, use the staging endpoint only for tester activation. Production is not
live yet.

Hosted access also needs an access mode, such as an approved access key or a
prepared wallet. Keep those credentials out of README examples; setup commands
live in [MCP proxy](docs/mcp-proxy.md). For paid access, run
`cia wallet ready`; it checks funding and finishes one-time payment setup.

Optional one-shot override from the environment:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://staging-mcp.chain-insights.ai/mcp
```

Validation rules:

- `http://` is accepted only for `localhost` / loopback addresses.
- Remote hosts must use `https://`.
- Endpoint URLs with credentials, query strings, or fragments are rejected.

Configuration precedence for `graphMcpEndpoint`:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` env var (`GRAPH_MCP_ENDPOINT` legacy alias also supported)
2. `cia config set graphMcpEndpoint ...` saved value
3. Local default `http://127.0.0.1:8012/mcp`

Check the configured endpoint and current GraphRAG MCP capabilities:

```bash
cia config get graphMcpEndpoint
cia mcp networks
cia mcp call usage_status
cia mcp tools --refresh
```

If network or tool discovery fails, check the endpoint and access mode first.
The CLI can still initialize workspaces and manage cases without a reachable
GraphRAG MCP endpoint.

Hosted GraphRAG MCP lets new users try `graph_query` with a small public free
quota before setting up paid access. The default public free graph_query quota
is 10 execution seconds per IP per UTC day. Use `usage_status` to see the
current caller quota. When the free quota is exhausted, prepare a wallet or use
an invited tester access key and retry.

Open a case and run a small investigation:

```bash
cia case open "First Chain Insights investigation" \
  --tags aml,bittensor \
  --description "Screen and trace a known source address"

cia mcp trace-victim-funds \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --case 1
```

Then inspect:

```bash
cia case show 1
find reports cases -maxdepth 3 -type f | sort
```

## Export To Obsidian, LLMWiki, And Agents

After a case has evidence, export a local knowledge bundle:

```bash
cia case evidence verify 1
cia case export 1 --target obsidian-llmwiki --mode private
```

The export writes Markdown notes, `manifest.chain-insights.json`,
`graph.chain-insights.json`, `Graph.canvas`, LLMWiki entrypoints, and prompts
for Codex, Claude Code, and ChatGPT under `published/<case-slug>/`.

Private exports may include full addresses. Use `--mode public` only for
shareable demos; public mode aliases addresses and removes secrets by default.

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

Run suspect topology without requiring an incident timestamp:

```bash
cia mcp trace-suspect-funds \
  --network bittensor \
  --suspect-addresses 5... \
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
result envelope. Use explicit `LIMIT` and pagination in your query when you
want bounded result sets. Endpoint access and authentication are configured
separately; see [MCP proxy](docs/mcp-proxy.md).

Agent installs include `chain-insights-cypher` for generic layer-aware
GQL/Cypher work and `chain-insights-bittensor-cypher` for Bittensor-specific
schema notes and examples.

## AML Tools

The high-level AML tools are Chain Insights workflows built around graph access
and local case state:

- `address_risk` starts a single-address screen with risk, behavior,
  neighborhood context, and exchange exposure.
- `stake_insights` explains Bittensor coldkey-hotkey-netuid staking
  relationships, aggregate stake movement amounts, top counterparties, first
  and last activity, and source backend evidence.
- `trace_victim_funds` traces victim/source funds forward through
  intermediaries to exchange deposit candidates.
- `trace_deposit_sources` traces backward from suspected deposit/cashout
  addresses to upstream sources and shared-source convergence.
- `trace_suspect_funds` traces suspected scammer, mule, operator, or
  laundering-ring funds forward to cashout topology.

The three trace tools share `chain-insights.trace.v1` and return compact,
chainable results. Full graph/table/report artifacts remain on disk under the
workspace, with pointers in the tool result and case evidence.

Trace traversal treats exchange hot wallets as terminal endpoints only. Tools do
not expand through exchange nodes or classify them as deposit, suspect, or
intermediate candidates.

When a case is provided, tools can save compact evidence pointers and graph
reports under the workspace instead of embedding large payloads in case notes.

## Docs Map

| Doc | Use it for |
| --- | --- |
| [Graph tools](docs/graph-tools.md) | GraphRAG MCP layers, `graph_query`, `graph_query_batch`, AML tool contracts, graph reports, evidence pointers |
| [Investigation workspaces](docs/investigation-workspaces.md) | `cia init`, case layout, evidence, dossiers, imports, templates, sessions, reports |
| [MCP proxy](docs/mcp-proxy.md) | Stdio proxy behavior, endpoint configuration, agent installers, local tools, auth modes, Inspector validation |
| [Architecture](docs/architecture.md) | Product layers, data flow, local storage, security model, config keys |
| [Development](docs/development.md) | Build, test, and local install commands |
| [Contributing](docs/contributing.md) | Development workflow, pull requests, release expectations |
| [Debugging](docs/debugging.md) | Local troubleshooting, diagnostics, debug workflows |

## What It Is Not

Chain Insights is not a custodial wallet, hosted case database, or replacement
for analyst review. It does not write risk labels automatically. Investigation
data stays in the local workspace unless the operator exports or shares it.
