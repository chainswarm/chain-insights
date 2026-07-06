# Chain Insights

[Website](https://chain-insights.ai) | [npm](https://www.npmjs.com/package/chain-insights)

Chain Insights is an open-source AML investigation toolkit for AI agents and
analysts. Install it from npm to screen blockchain addresses, trace role-specific
fund flows, manage workspace evidence, and generate graph reports.

Graph access is configuration-driven. The package defaults to a local Chain
Insights Graph endpoint for development; hosted endpoints are set explicitly with
`graphMcpEndpoint` or `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT`.

## What You Can Do Today

| Tool | Use it for |
| --- | --- |
| `aml_address_risk` | Screen one address for risk, behavior, neighborhood context, and exchange exposure |
| `aml_trace_victim_funds` | Trace victim/source funds forward to exchange deposit candidates |
| `aml_trace_deposit_sources` | Trace backward from suspected deposit/cashout addresses to upstream sources and convergence |
| `aml_trace_suspect_funds` | Trace suspected scammer, mule, operator, or laundering-ring funds forward to cashout topology |
| `graph_query` | Run one read-only GQL/Cypher query against a Chain Insights Graph layer |
| `graph_query_batch` | Run related read-only graph queries as one MCP call |
| `meta_network_capabilities` | Check supported Chain Insights networks and graph tools |
| `meta_usage_status` | Check the caller's daily free-tier graph query allowance |
| `wallet_balance` | Show the local payment wallet amount |

## Quick Start

Install from npm:

```bash
npm install -g chain-insights
```

Check the CLI:

```bash
cia --version
cia update --check
```

Run `cia update` to update a global npm install from the public npmjs registry.
`cia init` also checks for a newer npm release in interactive terminals and
prompts before updating.

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

Chain Insights workspaces are plain local folders. Use any editor or agent
tooling you want to inspect workspace files, graph reports, artifacts, and
published outputs.

## Configure Chain Insights Graph Endpoint

`cia` uses `graphMcpEndpoint` for all Chain Insights Graph calls. The npm
package does not hardcode a hosted endpoint. Configure the endpoint explicitly for the
environment you intend to use.

Local development endpoint (default):

```bash
cia config set graphMcpEndpoint http://127.0.0.1:8012/mcp
```

For a deterministic local Bittensor backend, use the RBMK-managed devkit
runbook and point Chain Insights at it persistently:

```bash
cia debug on --token <any-string> --endpoint http://127.0.0.1:18012/mcp
```

The devkit backend is unmetered and never issues a paid challenge, so
`cia config set graphMcpEndpoint http://127.0.0.1:18012/mcp` alone also works;
`debug on` just skips payment negotiation outright.

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

Check the configured endpoint and current Chain Insights Graph capabilities:

```bash
cia config get graphMcpEndpoint
cia mcp networks
cia mcp call meta_usage_status
cia mcp tools --refresh
```

If network or tool discovery fails, check the endpoint and access mode first.
The CLI can still initialize workspaces and continue investigation workflow
without a reachable Chain Insights Graph endpoint.

Hosted Chain Insights Graph includes a small public free tier for `graph_query`
before paid access is required. The default public free tier is 10 execution seconds
per IP per UTC day. Use `meta_usage_status` to see the current caller allowance.
Prepared wallet users receive the daily free tier first, then paid access
continues automatically after the allowance is exhausted.
If you do not have a prepared wallet yet, use bounded single `graph_query`
calls within the free tier, then prepare a wallet or use an invited tester
access key when the allowance is exhausted.

Run a focused investigation in the initialized workspace:

```bash
cia init .

cia mcp trace-victim-funds \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5
```

Then inspect:

```bash
find reports -maxdepth 3 -type f | sort
```

## Export Only When Sharing

Normal local work happens in the workspace. Export only when you need
to share, hand it off to a partner, ingest into LLM Wiki, or archive a
review checkpoint.

```bash
# Use your configured workspace export flow to produce the handoff package.
published/<workspace-slug>/
```

Workspace-generated reports, graph JSON, graph HTML, and published bundles live
under the initialized workspace. Treat those files as the durable handoff
surface.

## Examples

Run a direct live topology query:

```bash
cia mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (i:Identity) RETURN i.identity_id AS identity_id, i.labels AS labels, i.risk_level AS risk_level LIMIT 10"
```

Run a batch across graph views:

```bash
cia mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (i:Identity) RETURN count(i) AS count LIMIT 1"},{"id":"archive_flows","query":"USE archive_topology MATCH (src:Identity)-[f:FLOWS_TO]->(dst:Identity) RETURN f.period_granularity AS granularity, src.identity_id AS source, dst.identity_id AS target, f.amount_usd_sum AS amount_usd_sum LIMIT 3"},{"id":"archive_member_address","query":"USE archive_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(m:Address) RETURN i.identity_id AS identity_id, m.address AS member_address, m.network AS member_network LIMIT 3"},{"id":"facts_sample","query":"USE facts MATCH (i:Identity)-[:HAS_FEATURE]->(f:AddressFeature) RETURN i.identity_id AS identity_id, f.tx_out_count AS tx_out_count LIMIT 3"}]'
```

For no-wallet public free-tier usage, prefer the single-query example first.
Batch calls reserve worst-case execution time and can ask for paid access even
when a small free allowance remains.

Run suspect topology without requiring an incident timestamp:

```bash
cia mcp trace-suspect-funds \
  --network bittensor \
  --suspect-addresses 5... \
  --max-hops 16
```

## How It Fits Together

```text
Agent or CLI user
  -> Chain Insights CLI / MCP proxy
  -> local config, wallet, workspace, artifacts, reports
  -> Chain Insights Graph
  -> graph intelligence for AML workflows
```

Chain Insights stores investigation outputs in initialized local workspaces.
Chain Insights Graph performs graph-language reads against network-specific
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
and local workspace state:

- `aml_address_risk` starts a single-address screen with risk, behavior,
  neighborhood context, and exchange exposure.
- `aml_trace_victim_funds` traces victim/source funds forward through
  intermediaries to exchange deposit candidates.
- `aml_trace_deposit_sources` traces backward from suspected deposit/cashout
  addresses to upstream sources and shared-source convergence.
- `aml_trace_suspect_funds` traces suspected scammer, mule, operator, or
  laundering-ring funds forward to cashout topology.

AML tools accept full blockchain addresses and return blockchain addresses as
the public result surface. Chain Insights resolves those addresses to
identity-grain topology internally and includes identity resolution metadata for
audit/debug use.

The three trace tools share `chain-insights.trace.v1` and return compact,
chainable results. Full graph/table/report artifacts remain on disk under the
workspace, with pointers in the tool result and workspace evidence.

Trace traversal treats exchange hot wallets as terminal endpoints only. Tools do
not expand through exchange nodes or classify them as deposit, suspect, or
intermediate candidates.

When investigation output is large, tools can save compact evidence pointers and
graph reports under the workspace instead of embedding large payloads in human
notes.

## Docs Map

| Doc | Use it for |
| --- | --- |
| [Graph tools](docs/graph-tools.md) | Chain Insights Graph layers, `graph_query`, `graph_query_batch`, AML tool contracts, graph reports, evidence pointers |
| [Graph query compatibility](docs/graph-query-compatibility.md) | GQL/Cypher construct support per layer, rejected→accepted rewrite recipes, traversal guidance |
| Bittensor devkit parity workflow (RBMK) | Local Chain Insights Graph backend with deterministic Bittensor fixture data for Chain Insights development |
| [Investigation workspaces](docs/investigation-workspaces.md) | `cia init`, workspace layout, artifacts, imports, templates, sessions, reports, and visualization outputs |
| [MCP proxy](docs/mcp-proxy.md) | Stdio proxy behavior, endpoint configuration, agent installers, local tools, auth modes, Inspector validation |
| [Architecture](docs/architecture.md) | Product layers, data flow, local storage, security model, config keys |
| [Development](docs/development.md) | Build, test, and local install commands |
| [Contributing](docs/contributing.md) | Development workflow, pull requests, release expectations |
| [Debugging](docs/debugging.md) | Local troubleshooting, diagnostics, debug workflows |

## What It Is Not

Chain Insights is not a custodial wallet, hosted case database, or replacement
for analyst review. It does not write risk labels automatically. Investigation
data stays in the local workspace unless the operator exports or shares it.

## Workers

<!-- gsd: workers -->
| Worker | Entrypoint | Component doc |
|---|---|---|
| `claude-desktop` | `src/claude-desktop` | [components/claude-desktop.md](docs/architecture/components/claude-desktop.md) |
| `config` | `src/config` | [components/config.md](docs/architecture/components/config.md) |
| `investigation` | `src/investigation` | [components/investigation.md](docs/architecture/components/investigation.md) |
| `mcp` | `src/mcp` | [components/mcp.md](docs/architecture/components/mcp.md) |
| `server` | `src/server` | [components/server.md](docs/architecture/components/server.md) |
| `viz` | `src/viz` | [components/viz.md](docs/architecture/components/viz.md) |
| `wallet` | `src/wallet` | [components/wallet.md](docs/architecture/components/wallet.md) |
<!-- /gsd: workers -->
