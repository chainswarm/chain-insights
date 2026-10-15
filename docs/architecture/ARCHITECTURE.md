# chain-insights Architecture

[Website](https://chain-insights.ai) | [npm](https://www.npmjs.com/package/chain-insights)

Chain Insights is one npm package with two entry points: the `cia` CLI and the
stdio MCP proxy. Both read the same local config and wallet, and both reach
the hosted Chain Insights Graph for data. Nothing in this package indexes a
chain, stores a graph or scores risk.

```mermaid
flowchart LR
  person(["Investigator or agent<br/>terminal, Claude, Codex, ChatGPT, Hermes"])
  subgraph pkg["npm package chain-insights"]
    cli["cia CLI<br/>bin/cli.js → src/cli.ts"]
    proxy["MCP proxy<br/>bin/mcp-proxy.cjs → src/mcp/proxy.ts"]
    config[("~/.chain-insights/config.json<br/>src/config")]
    wallet[("~/.chain-insights/wallet.json<br/>src/wallet")]
    view["view: graph, chart, table<br/>ui://chain-insights/view"]
  end
  endpoint["Chain Insights Graph<br/>https://mcp.chain-insights.ai/"]
  base["Base mainnet<br/>USDC payments"]
  person -->|"commands"| cli
  person -->|"MCP over stdio"| proxy
  cli --> config
  proxy --> config
  cli --> wallet
  proxy --> wallet
  proxy --> view
  cli -->|"graph_query, graph_query_batch"| endpoint
  proxy -->|"graph_query, graph_query_batch"| endpoint
  wallet -->|"x402"| base
```

Overview, config keys, local data and the security model:
[../architecture.md](../architecture.md). The contracts the code keeps (tool
surface, argument allowlists, endpoint precedence, the shared-graph model):
[../development.md](../development.md#contracts-the-code-keeps). Repository
rules and CI gotchas: [../contributing.md](../contributing.md#repository-rules).

## Containers

- [cia CLI](containers/cia-cli.md) — configuration, graph tool calls, wallet
  operations, agent setup.
- [MCP proxy](containers/mcp-proxy.md) — the stdio server agent clients
  connect to; serves the local tools and the view, proxies the graph tools.
- [npm package](containers/npm-package.md) — what ships: bins, `dist/`,
  `docs/*.md`, the `chain-insights-cypher` skill.

## Components

One doc per source module under `components/`. Human-authored.

| Module          | Entrypoint          | Component doc                                |
| --------------- | ------------------- | -------------------------------------------- |
| `config`        | `src/config`        | [config](components/config.md)               |
| `investigation` | `src/investigation` | [investigation](components/investigation.md) |
| `mcp`           | `src/mcp`           | [mcp](components/mcp.md)                     |
| `wallet`        | `src/wallet`        | [wallet](components/wallet.md)               |

Acceptance scenarios per component: [../acceptance/](../acceptance/config.md).

## Verification

- `npm test` — the suite, including `tests/docs-sync.test.ts`, which fails
  when these docs drift from the code.
- `npm run build`
