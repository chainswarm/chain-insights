# Chain Insights

Local-first AML investigation tooling for AI agents and human operators. Chain
Insights gives Codex, Claude Code, Claude Desktop, Hermes, and CLI users a
workspace for graph access, wallet status, case files, evidence, dossiers,
sessions, and browser visualizations.

Chain Insights has two product layers: a CLI and workspace framework for local
investigations, plus an MCP proxy that lets AI agents call tools through the
same local framework.

The Go Graph MCP endpoint remains the graph execution backend. Chain Insights
adds investigation workflow, payment/debug auth, report files, graph rendering,
and case evidence around that backend.

## Documentation

| Doc | Use it for |
| --- | --- |
| [Graph tools](docs/graph-tools.md) | `graph_query`, `graph_query_batch`, `address_risk`, `track_funds`, `scam_topology`, schemas, result contracts, evidence pointer behavior |
| [Investigation workspaces](docs/investigation-workspaces.md) | `cia init`, case layout, `cases/`, `evidence/`, `dossiers/`, `imports/`, `templates/`, reports, sessions |
| [MCP proxy](docs/mcp-proxy.md) | Codex, Claude Code, Hermes, Claude Desktop, local stdio proxy, graph report server |
| [Development](docs/development.md) | Install, build, test, release gate, UAT, global install |
| [Architecture](docs/architecture.md) | Product layers, data flow, local storage, security model, config keys |

## Current Capabilities

| Area | Entry points |
| --- | --- |
| CLI and local server | `chain-insights --help`, `chain-insights serve` |
| Graph MCP client | `chain-insights mcp tools`, `chain-insights mcp call` |
| Debug-token MCP auth | `chain-insights debug on` |
| Test access keys | `chain-insights access-key set` |
| x402 client fetch | encrypted local payment wallet |
| Wallet status | `chain-insights wallet address`, `chain-insights wallet balance`, MCP `balance` |
| Case lifecycle | `chain-insights case open/list/activate/suspend/close` |
| Evidence and dossiers | `chain-insights case evidence`, `chain-insights case dossier` |
| Session resume context | `chain-insights case session`, `chain-insights case resume` |
| Graph visualization | `chain-insights viz`, local graph report server |
| Agent installers | `chain-insights --claude`, `chain-insights --codex`, `chain-insights --hermes` |
| Claude Desktop setup | `chain-insights setup claude-desktop` |

Expected Go Graph MCP primitive tools:

| Tool | Purpose |
| --- | --- |
| `graph_query` | Run one read-only GQL/Cypher query through the universal graph endpoint |
| `graph_query_batch` | Run related read-only graph-language queries as one MCP call |

High-level AML tools such as `address_risk`, `track_funds`, and
`scam_topology` are Chain Insights recipes over `graph_query_batch`. Do not
assume they exist on the Go Graph MCP endpoint.

## Quick Start

From this repository:

```bash
npm install
npm run build
node bin/cli.js --help
```

Installed package usage:

```bash
chain-insights --help
chain-insights status
```

By default Chain Insights uses the staging production Graph MCP:

```bash
chain-insights config get graphMcpEndpoint
chain-insights mcp tools --refresh
```

Switch to a local Go Graph MCP for debug UAT:

```bash
chain-insights debug on --token chain-insights-dev-debug --endpoint http://localhost:8012/mcp
chain-insights mcp tools --refresh
```

Switch back to staging:

```bash
chain-insights config set graphMcpEndpoint https://staging-mcp.chain-insights.ai/mcp
chain-insights debug off
chain-insights mcp tools --refresh
```

Run a live topology query:

```bash
chain-insights mcp call graph_query \
  network=bittensor \
  "query=USE live_topology MATCH (n) WHERE n.address IS NOT NULL RETURN n.labels AS labels, n.address AS address LIMIT 10"
```

Run a batch query:

```bash
chain-insights mcp call graph_query_batch \
  network=bittensor \
  'queries=[{"id":"count","query":"USE live_topology MATCH (n) RETURN count(n) AS count LIMIT 1"},{"id":"archive_flows","query":"USE archive_topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN f.period_granularity AS granularity, src.address AS source, dst.address AS target LIMIT 3"}]'
```

## Investigation Workspace

Create a workspace before producing investigation outputs:

```bash
mkdir -p ~/work/chain-insights-investigations
cd ~/work/chain-insights-investigations
cia init .
```

Open a case:

```bash
cia case open "Exchange deposit clustering" \
  --tags aml,bittensor \
  --description "Trace high-risk source funds into exchange entities"
```

Run a high-level trace and attach evidence to a case:

```bash
cia mcp track-funds \
  --network bittensor \
  --trusted-addresses 5... \
  --case 1
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

`scam_topology` performs victim-only traversal outward from victim/source funds.
Its detailed contract, activity policies, exchange terminal safety rules, and
reviewable label outputs are documented in [Graph tools](docs/graph-tools.md).

## MCP Proxy

Use `chain-insights-mcp-proxy` when an AI agent should consume Chain Insights
as an MCP server.

Install agent skills and MCP registration:

```bash
chain-insights --claude
chain-insights --codex
chain-insights --hermes
```

Claude Desktop setup:

```bash
chain-insights setup claude-desktop --dry-run
chain-insights setup claude-desktop
```

See [MCP proxy](docs/mcp-proxy.md) for the config JSON, local tools,
Inspector validation, and client-specific notes.

## Development

Common local checks:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run release:check
```

Release rules:

- Work on PR branches.
- Every PR to `main` bumps `package.json` and `package-lock.json`.
- Every PR to `main` adds a matching `CHANGELOG.md` entry.
- Run the release gate locally with `npm run release:check`.

See [Development](docs/development.md) for focused test sets, UAT, and global
install commands.

## Troubleshooting

Refresh stale graph tool schemas:

```bash
chain-insights mcp tools --refresh
```

Check current endpoint and auth mode:

```bash
chain-insights config get graphMcpEndpoint
chain-insights access-key status
chain-insights debug status
```

If `wallet balance` cannot reach Base RPC:

```bash
BASE_RPC_URL=https://mainnet.base.org chain-insights wallet balance
```

If a graph report URL fails, rerun the graph-backed tool so Chain Insights can
recreate the local report and start the report server.
