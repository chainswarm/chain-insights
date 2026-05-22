# Spike Manifest

## Idea

Evaluate whether the graph-query MCP runtime should move from the current Python/FastMCP GraphRAG server to a TypeScript/Hono or Go server while GraphRAG sync remains Python.

## Requirements

- Keep GraphRAG sync in Python; the runtime decision is only about the MCP graph-query surface.
- Preserve the Chain Insights result envelope for `graph_query`: text content plus `structuredContent.schema`, `structuredContent.tool`, and compact `structuredContent.facts.query`.
- Benchmark against the real local Memgraph data and real MCP transport before deciding to port production code.
- Prefer one x402 payment per user-level Chain Insights operation, not one payment per internal Cypher query.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | graph-mcp-runtime-comparison | comparison | Given the current GraphRAG `graph_query` boundary, when Python/FastMCP, TS/Hono/MCP, and Go/MCP execute the same read-only Cypher workload against local Memgraph, then we can decide whether a runtime port is worth the maintenance cost. | VALIDATED | mcp, graphrag, hono, go, typescript, performance |
