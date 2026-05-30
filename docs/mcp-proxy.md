# MCP Proxy

The Chain Insights stdio proxy lets AI agents consume Chain Insights tools as
an MCP server. It connects to the configured GraphRAG MCP endpoint and adds
local wallet, case, evidence, and graph-report behavior.

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
- Adds local `balance`, `help`, and case workflow tools.
- Starts the local graph report server when graph report URLs are returned.
- Publishes instructions with required argument rules, workflow guidance, graph
  report behavior, and schema hints.

## Local Tools

| Tool | Purpose |
| --- | --- |
| `balance` | Show the local Base USDC payment wallet balance |
| `help` | Show Chain Insights tool and workflow guidance |
| `case_open` | Create a local investigation case |
| `case_list` | List local investigation cases |
| `case_resume` | Load case context, evidence count, dossiers, and latest session |
| `case_add_evidence` | Append a report or note to the evidence manifest |
| `case_verify_evidence` | Verify saved evidence integrity |
| `case_export` | Export a case for Obsidian, LLMWiki, Codex, Claude Code, and ChatGPT |
| `case_update_dossier` | Add a durable finding to an address/entity dossier |
| `case_start_session` | Start an investigation session |
| `case_end_session` | End a session with findings and next steps |

`case_export` writes the same local bundle as `cia case export`. Use it after
`case_verify_evidence` when an agent needs Obsidian, LLMWiki, Codex, Claude
Code, or ChatGPT-ready files.

Remote graph tools are discovered from the configured GraphRAG MCP endpoint. The
expected primitive graph tools are `usage_status`, `graph_query`, and
`graph_query_batch`.
Chain Insights adds high-level local graph recipes such as `address_risk`,
`stake_insights`, `trace_victim_funds`, `trace_deposit_sources`, and
`trace_suspect_funds` when the remote endpoint only exposes primitives.

The trace tools share `chain-insights.trace.v1` and are role-specific:

- `trace_victim_funds` for victim/source forward tracing.
- `trace_deposit_sources` for reverse traceback from suspected deposit
  endpoints.
- `trace_suspect_funds` for suspect-controlled outbound laundering/cashout
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

Public free graph usage:

```bash
chain-insights mcp call usage_status
chain-insights mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"
```

Hosted GraphRAG MCP can allow anonymous `graph_query` calls before wallet
setup. The default public free graph_query quota is 10 execution seconds per IP
per UTC day, reset on the UTC calendar day. `usage_status` returns only the
current caller's quota status. Public free access does not include
`graph_query_batch`; use a tester access key or paid x402 mode for regular
usage and batches. Use explicit LIMIT and pagination in your query when you
want bounded result sets.

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

Useful MCP prompts:

```text
Use Chain Insights to show my payment wallet balance.
```

```text
Use Chain Insights graph_query on network bittensor with:
USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 10
```

```text
Use Chain Insights graph_query_batch on network bittensor with these read-only Cypher queries:
1. USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1
2. USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 3
```

```text
Use Chain Insights to open an investigation case named "Exchange deposit clustering" with tags aml,bittensor.
```

```text
Use Chain Insights to save the last graph_query_batch result as evidence in case <case-id>.
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

Graph-backed tools may return raw graph data in
`_meta.chainInsights.graph.data`. Chain Insights stores that graph data under
`reports/graphs/*.graph.json` in the active workspace and returns
`_meta.chainInsights.graph.url` pointing to
`/graph-reports/<filename>.graph.json`.

The local graph report server binds to localhost. Chain Insights does not
create duplicated `artifacts/` graph payloads; `reports/graphs/` is canonical.
