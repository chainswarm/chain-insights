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

| Tool                        | Purpose                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `meta_network_capabilities` | Show the current Chain Insights network/tool support matrix                          |
| `meta_schema`               | Show the live graph schema of a network: labels, link types, fields, indexes         |
| `meta_usage_status`         | Check the caller's daily free-tier graph query allowance                             |
| `meta_help`                 | Show Chain Insights tool and workflow guidance                                       |
| `wallet_balance`            | Show the local payment wallet address, payment network, token, and amount            |
| `wallet_topup`              | Show the local payment wallet address and its QR code, with a Claude view            |
| `graph_expand`              | Expand a node or list a link's transfers in an open picture; called by the view only |

`meta_schema` reads the live graph schema of one network: the labels, the link
types, every property key, the indexes, the fields of an address and of each
main link, the `USE facts` relationships with the `TRANSFER` columns, and the
`USE chain` lookups. It takes `network` (required) and `refresh` (optional).
The answer is cached on disk for 24 hours under `~/.chain-insights/cache/`, one
file for each network and endpoint. A build reads through the one remote
session of the proxy. A read that fails leaves its section empty and adds a
note, and such a schema is kept for 10 minutes, not 24 hours. In the terminal,
`cia network robinhood --schema` prints the same schema, with `--json` for the
structured form and `--refresh` to rebuild it.
`cia mcp call meta_schema network=robinhood` does the same.

## Views in Claude

Claude Desktop and Cowork sessions on your computer draw MCP Apps views next
to a tool answer. The local proxy serves every view itself. The Chain Insights
Graph endpoint serves data only:

- `ui://chain-insights/view` is one HTML file shipped in the package. It draws
  a `graph_query` answer from its column names: rows with `from_address` and
  `to_address` columns draw a graph (optional columns: `amount_usd_sum`,
  `tx_count`, `first_seen_timestamp`, `last_seen_timestamp`, `link_kind`,
  `from_labels`, `to_labels`), rows with a `day`, `date` or `*_timestamp` column
  and number columns draw a chart, and any other rows draw a table. It also
  draws the balance for `meta_usage_status` and `meta_subscription_status`.
  Nothing is fetched at run time. The proxy has no tool that composes a picture
  for the model: the model writes its own `graph_query`.
- `graph_expand` runs on your computer and answers the clicks in a picture. It
  takes `{network, address, in_offset?, out_offset?}` to load the newest senders
  and receivers of one address (three anchored topology `graph_query` reads), or
  `{network, from, to, day}` to list the transfers between two addresses on one
  UTC day, newest first, at most 50 (one `USE facts` `graph_query` read). Each
  read is billed as a graph query. A malformed address, a malformed day or an
  offset over 10,000 is refused before any read and costs nothing.
- `graph_expand` carries `_meta.ui.visibility` `["app"]`: the view calls it,
  and hosts keep it out of the model's tool list.
- The endpoint's own `ui://` resources and `_meta.ui` are not forwarded.
- The answers of `graph_query` and `graph_query_batch` keep their
  `structuredContent` exactly as the endpoint returned it.
- `wallet_topup` draws `ui://chain-insights/topup`: the wallet address, its QR
  code, Base Mainnet and USDC, in Claude's light or dark theme. The view signs
  nothing and sends nothing. Only the local proxy offers it.

Claude Code draws no views. Every tool answers in full as text.

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

Use `cia mcp call graph_query` or `cia mcp call graph_query_batch` for
agent-authored graph reads.

`meta_usage_status` is a Chain Insights proxy tool. On hosted Chain Insights Graph
backends it can reflect remote quota telemetry. On backends without a quota
tool, it returns a local unmetered primitive-backend status.

Graph queries take full blockchain addresses directly and return blockchain
addresses as the public result surface. The graph is address-grain, so there
is no identity-resolution step. Never shorten an address.

The proxy does not offer `aml_address_risk`. It is hidden until its verdict is
fixed: `tools/list` omits it, and a call to it is refused as an unknown tool.

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

UAT on 2026-05-31 showed the 10-second free tier was enough for exact
address checks, sample address reads, sample flow reads, and the
free-to-paid handoff, but bounded sample reads still returned topology data
inside the same daily allowance.

For graph reads, install `chain-insights-cypher`. It teaches ISO GQL, the
three read layers, one query for each kind of graph search, and how to find
the fields of the graph.

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

For graph-language work, agents use `chain-insights-cypher`.

## Supported Agent Setup

The supported setup targets are the same ones advertised by top-level installer
flags:

```bash
cia setup claude-code
cia setup claude-desktop
cia setup codex
cia setup hermes
```

`cia setup claude` is an alias for `cia setup
claude-code`. `cia setup claude-desktop` writes the proxy into Claude
Desktop's `claude_desktop_config.json`, keeps every other entry, saves a
`.bak` copy, and refuses a file that is not valid JSON. Restart Claude
Desktop afterwards.

Current MCP prompts exposed by the local proxy:

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
RETURN a.address AS address, a.network AS network, a.labels AS labels
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
