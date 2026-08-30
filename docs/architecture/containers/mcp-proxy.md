# MCP Proxy

Stdio or local proxy surface that lets agent clients call Chain Insights tools.
**Technology:** TypeScript / MCP

## Purpose

Exposes Chain Insights investigation tools to AI agents (Claude Desktop, ChatGPT, Codex) via stdio MCP transport. Proxies configured local tools (wallet_balance, meta_help) and remote graph tools (aml__, graph_query_) to the Chain Insights Graph MCP endpoint. Supports workspace mode (artifact persistence) and stateless mode (proxy-only). Logs structured tool/topology events to mcp-proxy.jsonl.

## Components

- **Local MCP Server:** Stdio transport, tool registration, prompt registration, resource registration (graph app HTML)
- **Remote MCP Client:** HTTP/SSE transport to Chain Insights Graph, tool listing, tool invocation with payment wrapping
- **Tool Orchestration:** Argument validation, normalization (comma-separated address arrays), attachment inclusion (graph metadata), error translation (402 → guidance)
- **Schema Cache:** Remote tool catalog cached per endpoint, refreshed on cache miss
- **Logger:** Structured JSONL logging for tool.start/tool.end/topology.start/topology.end/cypher.throw

## Data Flow

-> graphMcp: Proxies configured tools (graph_query, graph_query_batch, aml_*, network_capabilities, usage_status)
-> workspaceStore: Uses local workspace configuration (dataDir, serverPort) for artifact paths
-> mcp-proxy.jsonl: Writes runtime logs (tool calls, topology queries, errors, durations)

## Invariants

- Stdio purity: No stdout writes; all diagnostics go to stderr or structured log file
- Remote tool passthrough: Only tools advertised by remote endpoint are proxied; local fallbacks used when remote unavailable
- Workspace mode (default): Enables wallet_balance, graph app artifacts, workspace file writes; stateless mode disables all three
- Schema cache hit prevents remote listTools call (optimization for cold-start latency)
- Graph app HTML resource served from ui://chain-insights/graph with CSP-restricted localhost origins
- Proxy starts even when remote Graph endpoint is unreachable (local tools remain available)
