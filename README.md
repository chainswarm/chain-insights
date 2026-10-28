# Chain Insights

<div align="center">
  <img src=".github/assets/chain-insights-github-crime-scene.png" width="100%" alt="Chain Insights: the agency cast around a crime-scene table tracing a glowing fund-flow trail while the scammer flees with the coin" />

[![npm version](https://img.shields.io/npm/v/chain-insights)](https://www.npmjs.com/package/chain-insights)
[![CI](https://img.shields.io/github/actions/workflow/status/chainswarm/chain-insights/verify.yml?branch=main)](https://github.com/chainswarm/chain-insights/actions/workflows/verify.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/chainswarm/chain-insights)](https://securityscorecards.dev/viewer/?uri=github.com/chainswarm/chain-insights)
[![License](https://img.shields.io/npm/l/chain-insights)](https://github.com/chainswarm/chain-insights/blob/main/LICENSE)

_Follow the funds. Find the obvious._

[Website](https://chain-insights.ai) | [npm](https://www.npmjs.com/package/chain-insights) | [Quickstart](#quickstart)
</div>

Chain Insights is open-source AML and forensics infrastructure for AI agents
and analysts: a hosted Chain Insights Graph you reach over MCP, screened
through one CLI. It screens blockchain addresses for risk, explores fund flows
through read-only graph queries, and returns structured investigation facts.
The hosted graph has a free tier — 5,000 units a day per address,
no key and no payment setup — so you can run a first screen in minutes.

## Quickstart

All shell snippets in this documentation are for **Linux** (bash). They work
as-is on macOS; on Windows use WSL.

```bash
npx chain-insights@latest --help   # run without installing
npm install -g chain-insights      # or install the cia CLI globally
cia networks                       # network status + dataset overview
cia network robinhood              # how far one network is indexed
cia network robinhood --schema     # live graph schema, cached for 24 hours
cia mcp tools                      # list remote graph tools
```

Sixty seconds gets you the CLI, a network overview, and the available remote
graph tools for Robinhood.
To call the same tools from an agent, register the MCP proxy:
`cia setup claude-code` (or `claude-desktop` / `codex` / `chatgpt` / `hermes`).
The `chatgpt` target is for Codex chats inside the ChatGPT app: ask there,
not in a plain ChatGPT chat.

CLI results are human-readable by default. Add `--json` when another tool or
script needs indented JSON:

```bash
cia mcp call --json graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 10"
```

### Claude plugin

The `plugin/` folder is the Chain Insights plugin for Claude. It starts the
local Chain Insights MCP proxy on your computer over stdio
(`chain-insights-mcp-proxy` from the npm package, through `npx`), and brings the
`chain-insights-cypher` skill. The proxy serves the views itself (a graph, a
chart or a table, picked from the column names of a `graph_query` answer, and
the balance), and reaches the Chain Insights Graph for the data.

- **Runs in:** Claude Desktop, Cowork sessions on your computer, and Claude Code.
- **Cannot start it:** claude.ai on the web, the Claude mobile apps and Cowork
  cloud sessions. They run no program on your computer.

In Claude Code the plugin also ships a Stop hook that checks every answer
against the Chain Insights answer rules (full addresses, tokens are not
dollars) and sends the model back once when one is broken.

The plugin needs Node.js 22 or newer. Add this repository as a plugin
marketplace, then install the `chain-insights` plugin from it. Setup for
Claude Desktop without the plugin, and the plugin's own layout, are in
[plugin/README.md](plugin/README.md).

## Purpose And Ownership

One public npm package (`chain-insights`) providing the `cia` CLI and a
stdio MCP proxy over a Chain Insights Graph endpoint.

## What It Does

Owns:

- The `cia` / `chain-insights` CLI and the `chain-insights-mcp-proxy` MCP
  server (source under `src/`).
- The canonical public tool surface: prefixed `graph_*` / `meta_*` /
  `wallet_*` tools.
- Local wallet and payment on Base mainnet (payment chain only).
- Shipped product skills under `skills/` (`chain-insights-*`), packaged
  into the npm tarball.

Never touches:

- Blockchain indexing, graph database storage, or graph serving — those
  belong to the Chain Insights Graph backend.
- Automatic risk labeling. Address labels are served by the Chain Insights
  Graph backend and read through `graph_query`; the CLI never writes labels.
- Custodial wallets or hosted case databases. Investigation data stays with
  the caller.

### What You Can Do Today

| Tool                        | Use it for                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `graph_query`               | Run one read-only GQL/Cypher query against a Chain Insights Graph layer            |
| `graph_query_batch`         | Run related read-only graph queries as one MCP call                                |
| `meta_network_capabilities` | Check supported Chain Insights networks and graph tools                            |
| `meta_schema`               | Read the live graph schema of a network: labels, link types, fields, indexes       |
| `meta_dex_lookup`           | Turn an exchange name (Aero, Uniswap, Virtuals) into its contracts, pools, reads   |
| `meta_usage_status`         | Check the caller's daily free-tier graph query allowance                           |
| `meta_subscription_status`  | Check your wallet's subscription: days left, today's allowance, payments pending   |
| `meta_rules`                | Read the answer rules when the `chain-insights-cypher` skill is not loaded         |
| `meta_help`                 | Show Chain Insights tool and workflow guidance                                     |
| `wallet_balance`            | Show the local payment wallet amount                                               |
| `wallet_topup`              | Show the local payment wallet address and its QR code for a USDC top-up on Base    |
| `subscription_topup`        | Show the same wallet and its QR code for a $CIA and ETH top-up on Robinhood Chain  |

## Dependencies

Upstream:

- **Chain Insights Graph MCP endpoint** — all graph queries and AML
  primitives. Configured via `graphMcpEndpoint`; defaults to the public
  production endpoint `https://mcp.chain-insights.ai/`.
- **Base mainnet RPC** — wallet balance and payment only
  (`BASE_RPC_URL` override). Not a graph-support claim.
- **Robinhood Chain RPC** — the $CIA subscription top-up and buy only
  (`ROBINHOOD_RPC_URL` override).
- **CoinGecko** — the $CIA price of a subscription buy, and nothing else.

Downstream:

- Analysts and AI agents install the npm package and call the CLI or the
  MCP tools.

## Architecture

Chain Insights is the investigation layer above the Chain Insights Graph.
The CLI and MCP proxy call graph tools over one MCP endpoint and never write
to the graph.

```text
Agent or CLI user
  -> Chain Insights CLI / MCP proxy
  -> local config and wallet
  -> Chain Insights Graph
  -> graph intelligence for AML workflows
```

Source modules (hand-maintained):

| Module          | Entrypoint          | Component doc                                                                |
| --------------- | ------------------- | ---------------------------------------------------------------------------- |
| `config`        | `src/config`        | [components/config.md](docs/architecture/components/config.md)               |
| `investigation` | `src/investigation` | [components/investigation.md](docs/architecture/components/investigation.md) |
| `mcp`           | `src/mcp`           | [components/mcp.md](docs/architecture/components/mcp.md)                     |
| `wallet`        | `src/wallet`        | [components/wallet.md](docs/architecture/components/wallet.md)               |

Entry points:

- `bin/cli.js` → `src/cli.ts` (CLI bins: `cia`, `chain-insights`).
- `bin/mcp-proxy.cjs` → `src/mcp/proxy.ts` (bin:
  `chain-insights-mcp-proxy`).
- `src/index.ts` — library exports.

Full architecture docs: [docs/architecture/](docs/architecture/ARCHITECTURE.md),
the contracts the code keeps in [Development](docs/development.md#contracts-the-code-keeps),
and the repository rules in [Contributing](docs/contributing.md#repository-rules).

### Graph Access

Graph queries choose the read graph explicitly:

| Graph      | Use it for                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topology` | The unified address / FLOWS_TO / OPERATED_BY / LINKED graph — recent and full historical fund-flow traversal, and swap, liquidity-pool and bridge totals (see [Graph tools](docs/graph-tools.md#swaps-liquidity-pools-and-bridges)) |
| `facts`    | Bounded individual `TRANSFER` rows with amount, `amount_usd`, asset, transaction, and block facts, plus single `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING` rows                                                                                           |
| `chain`    | One keyed lookup on the chain node: a transaction by `tx_id`, a block by `block_height` or `block_hash`, an address at one block (balance, nonce, kind), or the head                                                                                                            |

One rule is worth reading before writing a query by hand: the `network`
argument selects the graph. `network` is also a property of every node and
relationship on every layer, and its value is the query's `network`. It is never
stored, except on a `:Chain` node, so a filter on it narrows nothing: anchor on
an address instead. A thing has one name on every layer: `address`, `tx_id`,
`block_height` and `block_hash`, with time in epoch milliseconds. See
[Graph query compatibility](docs/graph-query-compatibility.md).

Agent installs include `chain-insights-cypher` for graph-query dialect rules,
one query for each kind of graph search, and how to find the fields of the
EVM / Robinhood graph. Protocol skills sit beside it and load only when a
question names their protocol:

- `chain-insights-virtuals`: Virtuals Protocol agents on robinhood: who
  created an agent, who is behind a creator wallet, whether an agent was
  dumped, and whether its buyers form a cartel.

## Billing: Billable Units

Chain Insights Graph bills by **billable units**.

- A **billable unit** is one row, node, or edge in your returned payload.
- Bigger responses cost more. Narrow queries cost less.
- The server reports `billable_units` on every graph response.

| Door | Price | Limits |
| --- | --- | --- |
| Free tier | Free | 5,000 units a day per address, 30 requests a minute, resets at midnight UTC |
| Pay as you go (USDC per call, and the ACP offering) | One cent per 100 units, rounded up to the next cent, one cent minimum per call. A batch is one call. | No daily limit, no rate limit for paying agents |
| Subscription in $CIA (not yet live) | 4 USD a day, paid in $CIA ([how](#subscription-in-cia)) | 100,000 units (10 USD) a day, 60 requests a minute |

**Check your own count.** `src/lib/recount-units.ts` mirrors the server's
counting logic. Use it client-side to recount units in a response and
confirm the billed amount matches what you received.

**Watch for `truncated: true`.** A response can hit the row limit and get
cut off. When you see `truncated: true`:

- Narrow the query with `LIMIT` to ask for fewer rows.
- Page through results with `SKIP` to fetch the next batch.
- Add a tighter `WHERE` filter before raising the limit.

## Subscription in $CIA

The subscription is bought in a terminal, by you. An agent cannot buy it:
no MCP tool can pay.

1. Fund your wallet: `cia subscription topup`. It prints your own wallet
   address and its QR code, and opens a local page. Send $CIA and a little
   ETH, for gas, on Robinhood Chain.
2. Buy days: `cia subscription buy --days N`. One buy pays 1 to 90 days.
3. Check it: `cia subscription status`.

What a buy does:

- A day costs 4 USD (120 USD a month of 30 days), paid in $CIA at the
  CoinGecko price. The price must be at most 10 minutes old.
- A subscriber may spend 10 USD of queries a day, 100,000 units.
- It shows the days, the USD, the $CIA amount and the price, and waits for
  your typed `yes`. `--yes` skips the prompt for a run with no terminal.
- It signs up to two transactions on Robinhood Chain: an approval of the
  exact amount, only when needed, then the payment.
- It waits up to 2 minutes for the server to credit the payment. A payment
  not credited by then shows in `cia subscription status`. Do not pay again:
  `buy` refuses while a payment is pending.
- Never send $CIA by hand to any other address. It is not credited.

A wallet whose private key is public, such as the key `1` or a key of a
public test mnemonic, is refused: bots take anything sent to it within
seconds. Replace it with `cia wallet create --replace`.

## Prerequisites And Environment Setup

- **Linux** is the reference platform; shell snippets use bash (macOS works
  the same; on Windows use WSL).
- **Node.js 22 or newer** (`package.json` engines) and npm.

`.env.example` documents the supported overrides:

| Variable                            | Purpose                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BASE_RPC_URL`                      | Base RPC override for wallet balance and the local top-up page                                        |
| `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` | Chain Insights Graph endpoint override; local HTTP loopback allowed, remote hosts must use `https://` |
| `ROBINHOOD_RPC_URL`                 | Robinhood Chain RPC override for the $CIA top-up page, balances and `cia subscription buy`            |
| `CHAIN_INSIGHTS_COINGECKO_API_KEY`  | Optional CoinGecko demo API key for the $CIA price of `cia subscription buy`                          |

## Run

### Local (from a checkout)

```bash
npm install
npm run build
npm install -g .
cia --version
```

Or install the released package:

```bash
npm install -g chain-insights
cia --version
cia update --check
```

Run a first query from any directory:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address LIMIT 10"
```

Create a local payment wallet when paid access is needed:

```bash
cia wallet create
```

The command shows the private key once in a clearly marked warning panel.
Save it in a secure password manager or offline backup, then type `BACKED UP`
to finish. The encrypted local copy is stored at
`~/.chain-insights/wallet.json`. Continue with `cia wallet ready` when you are
ready to enable paid access.

Example queries. Direct topology:

```bash
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address) RETURN a.address AS address, a.network AS network, a.labels AS labels LIMIT 10"
```

Batch across graph views:

```bash
cia mcp call graph_query_batch \
  network=robinhood \
  'queries=[{"id":"count","query":"USE topology MATCH (a:Address) RETURN count(a) AS count LIMIT 1"},{"id":"flows","query":"USE topology MATCH (src:Address)-[f:FLOWS_TO]->(dst:Address) RETURN src.address AS source, dst.address AS target, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count LIMIT 3"},{"id":"linked","query":"USE topology MATCH (a:Address)-[l:LINKED]-(b:Address) RETURN a.address AS address, b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 3"},{"id":"node_metrics","query":"USE topology MATCH (a:Address {address:\"FULL_ADDRESS\"}) RETURN a.address AS address, a.tx_out_count AS tx_out_count, a.tx_in_count AS tx_in_count LIMIT 1"}]'
```

More query examples (manual fund-flow reads, pagination):
[Graph tools](docs/graph-tools.md).

## Configure

`cia` uses `graphMcpEndpoint` for all Chain Insights Graph calls. The npm
package uses the public production endpoint by default, so a fresh install can
run `cia networks` immediately.

For local development, override the default explicitly:

```bash
cia config set graphMcpEndpoint http://127.0.0.1:8012/mcp
```

The public production Graph is already the default. Use the host root. Do not
add `/mcp`.

```bash
cia config set graphMcpEndpoint https://mcp.chain-insights.ai/
```

To undo every local override at once, after an upgrade or a test setup:

```bash
cia config reset   # production endpoint, paid mode, no test key; wallet kept; old file in config.json.bak
```

Optional one-shot override from the environment:

```bash
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://mcp.chain-insights.ai/
```

Configuration precedence:

1. `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` env var (`GRAPH_MCP_ENDPOINT`
   legacy alias also supported).
2. `cia config set graphMcpEndpoint ...` saved value.
3. Public production default `https://mcp.chain-insights.ai/`.

Validation rules:

- `http://` is accepted only for localhost / loopback addresses.
- Remote hosts must use `https://`.
- Endpoint URLs with credentials, query strings, or fragments are rejected.

Hosted access also needs an access mode, such as an approved access key or
a prepared wallet. For paid access, run `cia wallet ready` — it checks
funding and finishes one-time payment setup. Setup commands live in
[MCP proxy](docs/mcp-proxy.md).

The hosted graph includes a free tier for `graph_query` and
`graph_query_batch`: 5,000 units a day per address (an IP address block),
no key, 30 requests a minute, reset at midnight UTC. Schema reads
(`meta_schema`) cost nothing on every door. Use `meta_usage_status` to see
the current caller allowance. Prepared wallet users receive the free tier
first, then paid access continues automatically.

## Test

The local gate, the CI install step and the workflows are in
[docs/development.md](docs/development.md).

## Debug

- Diagnostics and debug workflows: [docs/debugging.md](docs/debugging.md).
- MCP proxy structured logs: `~/.chain-insights/runtime/logs/mcp-proxy.jsonl`.

Health checks (each is runnable):

```bash
# Configured endpoint
cia config get graphMcpEndpoint

# User-facing network overview
cia networks

# Detailed Chain Insights capability matrix
cia mcp networks

# Caller allowance / metering status
cia mcp call meta_usage_status

# Fresh remote tool discovery
cia mcp tools --refresh

# Installed CLI sanity
cia --version && cia update --check

# Endpoint, wallet and access mode in one view
cia status

```

`cia network robinhood` shows how far that network is indexed:

```text
$ cia network robinhood
Network           Robinhood Chain
Identifier        robinhood
Status            live (default)
Blockchain head   87,642,448  (1 s old)

Indexing                      height      behind head
  receipts                    87,642,307          141
  traces                      87,641,751          697
  dex                         11,959,694   75,682,754
  bridge                      87,641,751          697
  smart accounts              87,641,751          697

Graph                         height      behind head
  flows                       87,641,751          697
  operated_by                 87,642,307          141
  dex_swaps                   87,312,173      330,275
  dex_liquidity               87,312,173      330,275
  bridged                     87,641,751          697
  approvals                   87,642,307          141
  sponsored                   87,641,703          745
  bundled                     87,641,751          697
  signers                     87,641,703          745
  owners                      87,641,751          697
  contracts                   87,641,751          697

Evidence                      height      behind head
  evidence                    not reported
```

- `Blockchain head` is the newest block the chain node holds, and how old that
  reading is. Every other number reads against it.
- `Indexing` is the raw chain data: receipts, traces, dex, bridge and smart
  accounts. `Graph` is each link kind of the topology graph. `Evidence` is the
  evidence index.
- `height` is the block each one has reached. `behind head` is the head minus
  that height.
- `not started` means that data has not begun. `not reported` means the
  network does not report it yet.
- `--json` prints the network's reply unchanged.

If network or tool discovery fails, check the endpoint and access mode
first. Confirm the endpoint with `cia config get graphMcpEndpoint` and retry
the command.

## Pre-staging / Release

Contributor rules, the version bump and the changelog entry every pull
request carries: [Release Discipline](docs/contributing.md#release-discipline).

## Documentation Links

Product docs:

| Doc                                                            | Use it for                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Graph tools](docs/graph-tools.md)                             | Graph layers, `graph_query`, `graph_query_batch`, and AML tool contracts   |
| [Graph query compatibility](docs/graph-query-compatibility.md) | GQL/Cypher support per layer, rewrite recipes, traversal guidance          |
| [MCP proxy](docs/mcp-proxy.md)                                 | Stdio proxy behavior, endpoint configuration, agent installers, auth modes |
| [Architecture overview](docs/architecture.md)                  | Product layers, data flow, security model, and config keys                 |
| [Development](docs/development.md)                             | Build, test, and local install commands                                    |
| [Contributing](docs/contributing.md)                           | Development workflow, pull requests, release expectations                  |
| [Stability policy](docs/stability.md)                          | Guaranteed surfaces, deprecation rules, and compatibility expectations     |
| [Debugging](docs/debugging.md)                                 | Local troubleshooting, diagnostics, debug workflows                        |

Architecture depth:

- [docs/architecture/](docs/architecture/ARCHITECTURE.md) — the component
  diagram, containers, one doc per source module.
- [Contracts the code keeps](docs/development.md#contracts-the-code-keeps) —
  tool surface, argument allowlists, endpoint rules, shared-graph model.
- [Repository rules](docs/contributing.md#repository-rules) — invariants,
  CI gotchas, documentation rules.
- [docs/acceptance/](docs/acceptance/) — per-component acceptance evidence.
