# Data Flow

## Reads

- **Chain Insights Graph MCP endpoint:** Topology queries (unified recent + full historical activity in one graph, plus the Address-node risk verdict), fact queries (labels, features), network capabilities, usage status
- **Local config:** ~/.chain-insights/config.json (graphMcpEndpoint, auth tokens, workspace paths, mode flags)
- **Local wallet:** ~/.chain-insights/wallet.json (encrypted EVM private key for x402 payments)
- **Workspace files:** Active workspace under initialized directory (existing cases, evidence manifests, session state)

## Sources

- **Chain Insights Graph MCP server:** Remote HTTP endpoint (staging-mcp.chain-insights.ai/mcp or configured local URL)
- **Environment variables:** CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT, CHAIN_INSIGHTS_MCP_PROXY_MODE
- **CLI commands:** User-initiated `cia` invocations (init, mcp call, wallet, trace, visualizations)
- **Agent clients:** MCP tool calls via stdio proxy from Claude Desktop, ChatGPT, Codex, or other MCP clients

## Writes

- **Workspace artifacts:** reports/, reports/graphs/, reports/tables/, artifacts/, entities/, sessions/, published/ (Markdown reports, graph JSON/HTML, table CSV/HTML, compact evidence JSON, schema captures)
- **Runtime logs:** .chain-insights/runtime/logs/mcp-proxy.jsonl (structured proxy logs, tool start/end, topology query durations)
- **Local config:** ~/.chain-insights/config.json (updated by `cia config set`, `cia access-key set`)
- **Local wallet:** ~/.chain-insights/wallet.json (created by `cia wallet import`, updated by one-time payment setup)

## Sinks

- **Agent tool responses:** MCP structuredContent/text content blocks returned to calling agent
- **CLI stdout:** Investigation summaries, file paths, continuation hints, wallet status
- **Local HTTP server:** 127.0.0.1:configuredPort serves graph HTML visualization and static assets
- **Published exports:** Optional handoff bundles for Obsidian, LLM Wiki, or partner sharing
