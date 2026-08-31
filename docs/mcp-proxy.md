# MCP Proxy

The Chain Insights stdio proxy lets AI agents consume Chain Insights tools as
an MCP server. It connects to the configured Chain Insights Graph endpoint and
adds local wallet behavior.

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

## Chain Insights Graph Endpoint Configuration

The endpoint lives in Chain Insights config, not in the MCP client registration.
The npm package defaults to public production:
`https://mcp.chain-insights.ai/` (host root, no `/mcp` path). A fresh install
can use `cia networks` without endpoint setup. MCP client JSON does not carry
the endpoint; use Chain Insights config for the default or an override.

Set local development:

```bash
cia config set graphMcpEndpoint http://127.0.0.1:8012/mcp
```

Set public production:

```bash
cia config set graphMcpEndpoint https://mcp.chain-insights.ai/
```

Use a one-shot environment override:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://mcp.chain-insights.ai/
```

Configuration precedence:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT`
2. `GRAPH_MCP_ENDPOINT` legacy alias
3. saved `graphMcpEndpoint`
4. hosted production default `https://mcp.chain-insights.ai/`

Validation rules:

- local `http://` is accepted only for localhost and loopback addresses
- remote endpoints must use `https://`
- endpoint URLs with credentials, query strings, or fragments are rejected

Keep endpoint overrides in operator config or environment variables. Do not
put endpoint configuration in MCP client JSON.

## Behavior

The proxy:

- Connects to `graphMcpEndpoint`.
- Uses debug bearer auth, test access key auth, or x402 payment auth according
  to local config.
- Caches remote tool schemas per endpoint for 24 hours.
- Exposes graph tools returned by the endpoint.
- Adds local `meta_*` and `wallet_*` tools.
- Publishes instructions with required argument rules, workflow guidance, and
  schema hints.

## Local Tools

| Tool                        | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `meta_network_capabilities` | Show the current Chain Insights network/tool support matrix               |
| `meta_usage_status`         | Check the caller's daily free-tier graph query allowance                  |
| `meta_help`                 | Show Chain Insights tool and workflow guidance                            |
| `wallet_balance`            | Show the local payment wallet address, payment network, token, and amount |

Remote graph tools are discovered from the configured Chain Insights Graph endpoint.
The minimum graph primitive surface is `graph_query` and `graph_query_batch`;
backends can also expose capability metadata such as `network_capabilities`.
Chain Insights presents this as local, prefixed metadata through
`meta_network_capabilities`.

The CLI keeps these catalogs distinct: `cia workflows` lists high-level CIA
workflow tools, while `cia mcp tools` lists remote GraphRAG tools and caches
that schema for 24 hours. `cia networks` and `cia network <name>` report the
network list and each network's advertised remote tools. `cia mcp networks`
exposes the same full network capability matrix. Use `cia mcp tools --refresh`
after a backend tool change.

Run the address-risk workflow with `cia workflow aml-address-risk`. Use
`cia mcp call graph_query` or `cia mcp call graph_query_batch` for low-level
agent-authored graph reads.

`meta_usage_status` is a Chain Insights proxy tool. On hosted Chain Insights Graph
backends it can reflect remote quota telemetry. On backends without a quota
tool, it returns a local unmetered primitive-backend status.

Chain Insights adds the high-level local graph recipe `aml_address_risk`
when the remote endpoint only exposes primitives.

AML recipes accept full blockchain addresses directly and return blockchain
addresses as the public result surface — the graph is address-grain, so there
is no identity-resolution step.

## Auth Modes

Local debug mode:

```bash
cia debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
cia mcp tools --refresh
```

Invited tester access key mode:

```bash
cia access-key set ci_test_REDACTED --endpoint https://mcp.chain-insights.ai/
cia access-key status
```

Daily free-tier graph usage:

```bash
cia mcp call meta_usage_status
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (n) RETURN count(n) AS count LIMIT 1"
```

Hosted Chain Insights Graph can allow anonymous `graph_query` calls before wallet
setup. The default public free tier is 10 execution seconds per IP per UTC day,
reset on the UTC calendar day. `meta_usage_status` returns only the current caller's
allowance status. Wallet users receive the same daily free tier first; after it
is exhausted, x402 payment continues automatically when `wallet ready` reports
ready.

The daily free tier is intended for bounded single `graph_query` calls. It does
not include `graph_query_batch`; use a tester access key or paid x402 mode for
regular usage and batches. Use explicit LIMIT and pagination in your query when
you want bounded result sets.

### CLI Output And Tool Versions

The CLI renders JSON graph results as a readable summary and table by default.
Use `--json` for indented machine-readable output:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 10"

cia mcp call --json graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 10"
```

The CIA address-risk workflow also supports JSON output and version selection:

```bash
cia workflow aml-address-risk --json \
  --address 0xYourAddressHere --network robinhood

cia workflow aml-address-risk --version v1 \
  --address 0xYourAddressHere --network robinhood
```

Omit the version to route to the latest supported AML contract. The package
version shown by `cia --version` is separate from tool contract versions.

UAT on 2026-05-31 showed the 10-second free tier was enough for exact
address checks, sample address reads, sample flow reads, and the
free-to-paid handoff, but bounded sample reads still returned topology data
inside the same daily allowance.

For a one-address screen, install `chain-insights-address-risk`. For custom
graph reads, install `chain-insights-cypher` plus `chain-insights-schema-evm`
or `chain-insights-schema-bittensor`. Cypher is Memgraph dialect only.
Schema skills hold the GraphRAG map.

Paid x402 mode:

```bash
cia config set graphMcpEndpoint https://mcp.chain-insights.ai/
cia debug off
cia wallet create
# Save the private key, then type BACKED UP when prompted.
cia wallet topup
cia wallet ready
```

To use an existing wallet instead:

```bash
cia wallet import 0xYOUR_EVM_PRIVATE_KEY
cia wallet ready
```

If `graphMcpAuthToken` is set, Chain Insights sends both
`X-MCP-Debug-Token` and `Authorization: Bearer <token>`. If it is empty,
Chain Insights uses the encrypted wallet private key with x402 payment
handling. `wallet ready` is the user-facing preflight: it checks Base USDC,
Base ETH gas, and one-time payment setup. A normal user does not need payment
protocol details; run `cia wallet ready` and retry the paid tool
after it reports ready.

## Agent Installers

Install skills and MCP registration:

```bash
cia --claude
cia --codex
cia --hermes
```

The Hermes installer writes Chain Insights skills under the Hermes skills
directory and registers the stdio MCP proxy in the Hermes config.

For a one-address screen, agents should use `chain-insights-address-risk`.
For manual graph-language work, use `chain-insights-cypher` plus
`chain-insights-schema-evm` or `chain-insights-schema-bittensor`.

## Supported Agent Setup

The supported setup targets are the same ones advertised by top-level installer
flags:

```bash
cia setup claude-code
cia setup codex
cia setup hermes
```

`cia setup claude` is an alias for `cia setup
claude-code`. Claude Desktop configuration is not exposed by the CLI setup
surface.

Current MCP prompts exposed by the local proxy:

- `aml-address-risk`
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
Use Chain Insights graph_query on network robinhood with:
USE topology MATCH (a:Address)
RETURN a.address AS address, a.network AS network, a.labels AS labels, a.risk_level AS risk_level
LIMIT 10
```

```text
Use Chain Insights graph_query_batch on network robinhood with these read-only Cypher queries:
1. USE topology MATCH (a:Address) RETURN count(a) AS count LIMIT 1
2. USE topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN src.address AS source, dst.address AS target, f.amount_usd_sum AS amount_usd_sum LIMIT 3
```

```text
Use Chain Insights `wallet_balance`. Show the wallet address, payment network,
token, and amount exactly as returned.
```

## Inspector Validation

Inspect a local Chain Insights Graph endpoint directly:

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
