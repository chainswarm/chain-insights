# cia CLI

Command-line interface for configuration, graph tool calls, and wallet operations.
**Technology:** TypeScript CLI

## Purpose

Provides the primary user-facing interface for Chain Insights investigations. Exposes commands for configuration management, MCP tool invocation, wallet operations, and investigation workflows. Delegates to workers (config, MCP client, and investigation tools) for domain logic.

## Components

- **Config Resolver** (Resolves graphMcpEndpoint, auth token, and hosted/local endpoint precedence.)
- **Graph MCP Client** (Calls GraphRAG MCP tools and refreshes tool catalogues.)
- **AML Workflow Commands** (Runs address risk and graph query workflows.)
- **Agent Installer** (Installs MCP proxy configuration for local agent clients.)

## Data Flow

-> graphMcp: Calls graph tools and AML primitives

## Invariants

- Config resolution follows precedence: CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT env var -> saved graphMcpEndpoint -> hosted production default https://mcp.chain-insights.ai/
- Remote HTTP URLs must use https://; localhost/loopback may use http://
- Exit codes: 0 for success, 1 for errors (config validation, MCP connection failure, wallet issues)
- File permissions: config.json 0o600 and wallet.json 0o600
