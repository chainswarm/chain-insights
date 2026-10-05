# MCP Proxy

Stdio or local proxy surface that lets agent clients call Chain Insights tools.
**Technology:** TypeScript / MCP

## Purpose

Exposes Chain Insights investigation tools to AI agents through stdio MCP transport. Proxies configured local tools and remote graph tools to the Chain Insights Graph MCP endpoint. Logs structured tool and topology events to mcp-proxy.jsonl.

## Components

- **Local MCP Server:** Stdio transport, tool registration, and prompt registration
- **Remote MCP Client:** HTTP/SSE transport to Chain Insights Graph, tool listing, tool invocation with payment wrapping
- **Tool Orchestration:** Argument validation, normalization, and error translation (402 → guidance)
- **Money Flows:** `money_flows` and the view-only `graph_expand` (`src/mcp/flows.ts`), composed on the client PC from three anchored `graph_query` reads per page
- **View Resource:** `ui://chain-insights/view`, one HTML file shipped in the package and served by the proxy; the graph endpoint's own views are never forwarded
- **Schema Cache:** Remote tool catalog cached per endpoint, refreshed on cache miss
- **Logger:** Structured JSONL logging for tool.start/tool.end/topology.start/topology.end/cypher.throw

## Data Flow

-> graphMcp: Proxies configured tools (graph_query, graph_query_batch, aml_*, network_capabilities, usage_status)
-> mcp-proxy.jsonl: Writes runtime logs (tool calls, topology queries, errors, durations)

## Invariants

- Stdio purity: No stdout writes; all diagnostics go to stderr or structured log file
- Remote tool passthrough: Only tools advertised by remote endpoint are proxied; local fallbacks used when remote unavailable
- Stateless mode is the default first-release proxy mode.
- Schema cache hit prevents remote listTools call (optimization for cold-start latency)
- Proxy starts even when remote Graph endpoint is unreachable (local tools remain available)
- The proxy is the only source of MCP Apps views; the graph endpoint serves data only
- `money_flows` and `graph_expand` validate every argument before the first read
