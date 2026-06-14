# MCP Proxy

The Chain Insights stdio proxy lets AI agents consume Chain Insights tools as
an MCP server. It connects to the configured GraphRAG MCP endpoint and adds
local wallet and graph-report behavior.

Chain Insights workspaces are plain local folders. Use local workspace files
for normal review. Use published workspace outputs only when an agent needs a
handoff, rendered HTML, or a durable bundle inside the workspace.

## Basic Configuration

Use this MCP server configuration:

```json
{
  "mcpServers": {
    "chain-insights": {
      "command": "chain-insights-mcp-proxy"
    }
  }
}
```

The proxy reads the same local Chain Insights config as the CLI.

## GraphRAG MCP Endpoint Configuration

The endpoint lives in Chain Insights config, not in the MCP client registration.
The npm package default is the local development endpoint
`http://127.0.0.1:8012/mcp`; hosted endpoints must be set explicitly.

Set local development:

```bash
chain-insights config set graphMcpEndpoint http://127.0.0.1:8012/mcp
```

Set hosted staging for approved testers:

```bash
chain-insights config set graphMcpEndpoint https://staging-mcp.chain-insights.ai/mcp
```

For now, use staging only for tester activation. Production is not live yet.

Use a one-shot environment override:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://staging-mcp.chain-insights.ai/mcp
```

Configuration precedence:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT`
2. `GRAPH_MCP_ENDPOINT` legacy alias
3. saved `graphMcpEndpoint`
4. local default `http://127.0.0.1:8012/mcp`

Validation rules:

- local `http://` is accepted only for localhost and loopback addresses
- remote endpoints must use `https://`
- endpoint URLs with credentials, query strings, or fragments are rejected

Keep hosted endpoint values in operator config or environment variables. Do not
bake hosted endpoint URLs into MCP client JSON, source code, or workspace
templates.

## Behavior

The proxy:

- Connects to `graphMcpEndpoint`.
- Uses debug bearer auth, test access key auth, or x402 payment auth according
  to local config.
- Caches remote tool schemas per endpoint for 24 hours.
- Exposes graph tools returned by the endpoint.
- Adds local `meta_*` and `wallet_*` tools.
- Starts the local graph report server when graph report URLs are returned.
- Publishes instructions with required argument rules, workflow guidance, graph
  report behavior, and schema hints.

## Local Tools

| Tool | Purpose |
| --- | --- |
| `meta_network_capabilities` | Show the current Chain Insights network/tool support matrix |
| `meta_usage_status` | Check the caller's daily free-tier graph query allowance |
| `meta_help` | Show Chain Insights tool and workflow guidance |
| `wallet_balance` | Show the local payment wallet address, payment network, token, and amount |

For normal local review, inspect local workspace files directly and keep your
preferred editor or agent tooling open to the same workspace while you work.

`published/` contains the generated shareable artifacts. Use it after
workspace validation when an agent needs rendered HTML or handoff-ready files.

Remote graph tools are discovered from the configured GraphRAG MCP endpoint. The
Chain Insights proxy presents the current public graph surface as
`meta_usage_status`, `graph_query`, and `graph_query_batch`.
Chain Insights adds high-level local graph recipes such as `aml_address_risk`,
`aml_trace_victim_funds`, `aml_trace_deposit_sources`, and
`aml_trace_suspect_funds` when the remote endpoint only exposes primitives.

AML recipes accept full blockchain addresses and return blockchain addresses as
the public result surface. Chain Insights resolves those addresses to
identity-grain topology internally and includes identity resolution metadata in
tool results for audit/debug use.

The trace tools share `chain-insights.trace.v1` and are role-specific:

- `aml_trace_victim_funds` for victim/source forward tracing.
- `aml_trace_deposit_sources` for reverse traceback from suspected deposit
  endpoints.
- `aml_trace_suspect_funds` for suspect-controlled outbound laundering/cashout
  topology.

## Auth Modes

Local debug mode:

```bash
chain-insights debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
chain-insights mcp tools --refresh
```

Invited tester access key mode:

```bash
chain-insights access-key set ci_test_REDACTED --endpoint https://staging-mcp.chain-insights.ai/mcp
chain-insights access-key status
```

Daily free-tier graph usage:

```bash
chain-insights mcp call meta_usage_status
chain-insights mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"
```

Hosted GraphRAG MCP can allow anonymous `graph_query` calls before wallet
setup. The default public free tier is 10 execution seconds per IP per UTC day,
reset on the UTC calendar day. `meta_usage_status` returns only the current caller's
allowance status. Wallet users receive the same daily free tier first; after it
is exhausted, x402 payment continues automatically when `wallet ready` reports
ready.

The daily free tier is intended for bounded single `graph_query` calls. It does
not include `graph_query_batch`; use a tester access key or paid x402 mode for
regular usage and batches. Use explicit LIMIT and pagination in your query when
you want bounded result sets.

Staging UAT on 2026-05-31 showed the 10-second free tier was enough for exact
address checks, sample address reads, sample flow reads, and the
free-to-paid handoff. The tested address
`5EkTMF1noWnWupGxQqtPczW2FFB7ktdVwjaZ22Cam54U93Xx` returned no indexed live or
archive rows on staging, but bounded sample reads still returned Bittensor
topology data inside the same daily allowance.

For custom graph reads, install the shipped `chain-insights-cypher` skill. Its
Memgraph examples reference distinguishes staging-tested GraphRAG MCP query
patterns from direct Memgraph deep traversal syntax that needs a fixed-hop
`graph_query_batch` fallback through the hosted endpoint.

Paid x402 mode:

```bash
chain-insights config set graphMcpEndpoint https://staging-mcp.chain-insights.ai/mcp
chain-insights debug off
chain-insights wallet import 0xYOUR_EVM_PRIVATE_KEY
chain-insights wallet ready
```

If `graphMcpAuthToken` is set, Chain Insights sends both
`X-MCP-Debug-Token` and `Authorization: Bearer <token>`. If it is empty,
Chain Insights uses the encrypted wallet private key with x402 payment
handling. `wallet ready` is the user-facing preflight: it checks Base USDC,
Base ETH gas, and one-time payment setup. A normal user does not need payment
protocol details; run `chain-insights wallet ready` and retry the paid tool
after it reports ready.

## Agent Installers

Install skills and MCP registration:

```bash
chain-insights --claude
chain-insights --codex
chain-insights --hermes
```

The Hermes installer writes Chain Insights skills under the Hermes skills
directory and registers the stdio MCP proxy in the Hermes config.

After installing, open an initialized investigation workspace in the agent and
operate over the workspace files.

For manual graph-language work, agents should use the shipped
`chain-insights-cypher` skill. For Bittensor queries, load
`chain-insights-bittensor-cypher` after the generic skill so SS58 and
EVM-pallet addresses stay under `network=bittensor`.

## Claude Desktop

Claude Desktop is supported for basic MCP calls. It is not the primary
framework UI.

Configure it:

```bash
chain-insights setup claude-desktop --dry-run
chain-insights setup claude-desktop
```

Validate without opening Claude:

```bash
npx @modelcontextprotocol/inspector \
  --cli \
  --config ~/.config/Claude/claude_desktop_config.json \
  --server chain-insights \
  --method tools/list
```

Claude Desktop does not hot-reload its MCP config. Fully quit and reopen it
after setup.

Current MCP prompts exposed by the local proxy:

- `aml-address-risk`
- `aml-trace-victim-funds`
- `aml-trace-suspect-funds`
- `aml-trace-deposit-sources`
- `meta-network-capabilities`
- `meta-usage-status`
- `graph-query`
- `graph-query-batch`
- `wallet-balance`
- `meta-help`

Prompts use the current supported investigation network internally so Inspector
does not render a free-text network field. Tool calls still expose `network` as
an enum input where the Inspector can render a dropdown.

Useful prompt text:

```text
Use Chain Insights `meta_network_capabilities`. Report the supported networks and
available tools exactly as returned.
```

```text
Use Chain Insights graph_query on network bittensor with:
USE live_topology MATCH (i:Identity)
RETURN i.identity_id AS identity_id, i.labels AS labels, i.risk_level AS risk_level
LIMIT 10
```

```text
Use Chain Insights graph_query_batch on network bittensor with these read-only Cypher queries:
1. USE live_topology MATCH (i:Identity) RETURN count(i) AS count LIMIT 1
2. USE live_topology MATCH (src:Identity)-[f:FLOWS_TO]->(dst:Identity) RETURN src.identity_id AS source, dst.identity_id AS target, f.amount_usd_sum AS amount_usd_sum LIMIT 3
```

```text
Use Chain Insights `wallet_balance`. Show the wallet address, payment network,
token, and amount exactly as returned.
```

## Inspector Validation

Inspect a local Graph MCP endpoint directly:

```bash
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8012/mcp \
  --transport http \
  --method tools/list \
  --header "X-MCP-Debug-Token: chain-insights-dev-debug"
```

Inspect the local Chain Insights proxy:

```bash
npx @modelcontextprotocol/inspector \
  --cli chain-insights-mcp-proxy \
  --method tools/list
```

## Graph Reports

Graph-backed tools can prepare a local graph view for the report. Chain
Insights stores graph report files under `reports/graphs/*.graph.json` in the
active workspace and exposes them to compatible MCP clients through app
metadata.

The local graph report server binds to localhost. Chain Insights does not
create duplicated `artifacts/` graph payloads; `reports/graphs/` is canonical.
