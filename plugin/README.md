# Chain Insights for Claude

Chain Insights is an anti-money-laundering (AML) investigation toolkit for
blockchain addresses. This plugin connects Claude to the hosted Chain Insights
connector and adds the skills Claude needs to write correct graph queries.

## What it adds

- **The Chain Insights connector**: `https://mcp.chain-insights.ai/`, a remote
  MCP (Model Context Protocol) server. It needs no local program, so the plugin
  works on claude.ai, in Claude Desktop, in Cowork and in Claude Code.
- **`chain-insights-cypher`**: the graph query dialect and the rules every
  `graph_query` must follow.
- **`chain-insights-schema-evm`**: the map of the robinhood graph: address
  labels, links and their properties.

## Use it

1. Install the plugin from the Chain Insights marketplace.
2. Ask Claude about an address, for example: "Show the recent money flows of
   0x04911a118f11c75667e4d0dfb8e640af5a353550 on robinhood."
3. In Claude apps that draw views, the answer comes with an interactive graph
   or table. In Claude Code the same answer comes as text.

Every tool is read-only. The graph is never written.

## The local tool

The `cia` command line tool (`npm install -g chain-insights`) runs a local
proxy with a payment wallet and a top-up view. It is separate from this plugin.

## Licence

MIT. See `LICENSE`.
