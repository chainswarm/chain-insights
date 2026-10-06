# Chain Insights for Claude

Chain Insights is an anti-money-laundering (AML) investigation toolkit for
blockchain addresses. This plugin starts the Chain Insights MCP (Model Context
Protocol) proxy on your computer and adds the skills Claude needs to write
correct graph queries.

## Where it runs

| Claude app                            | Works                |
| ------------------------------------- | -------------------- |
| Claude Desktop                        | yes                  |
| Cowork, in a session on your computer | yes                  |
| Claude Code                           | yes, answers as text |
| claude.ai on the web                  | no                   |
| Claude mobile apps                    | no                   |
| Cowork, in a cloud session            | no                   |

The plugin starts a program on your computer. Claude apps that run in the
cloud cannot start it.

## What it adds

- **The local Chain Insights proxy**: `chain-insights-mcp-proxy` from the
  `chain-insights` npm package, started over stdio with `npx`. It needs
  Node.js 22 or newer. It serves the Chain Insights tools and views on your
  computer and reads the Chain Insights Graph for the data.
- **`chain-insights-cypher`**: the graph query dialect and the rules every
  `graph_query` must follow.
- **`chain-insights-schema-evm`**: the map of the robinhood graph: address
  labels, links and their properties.

## Use it

1. Install the plugin from the Chain Insights marketplace.
2. Ask Claude about an address, for example: "Show the recent money flows of
   0x04911a118f11c75667e4d0dfb8e640af5a353550 on robinhood."
3. In Claude Desktop and Cowork, the answer comes with an interactive graph,
   chart or table, picked from the column names of the query Claude wrote. In
   Claude Code the same answer comes as text.

Every tool is read-only. The graph is never written.

## Payment wallet

The proxy pays for graph reads from a local payment wallet when your access
needs one. Create it with the `cia` command line tool from the same package
(`npm install -g chain-insights`, then `cia wallet create`). The wallet stays
on your computer.

## Licence

MIT. See `LICENSE`.
