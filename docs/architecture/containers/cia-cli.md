# cia CLI
Command-line interface for workspace setup, case workflows, exports, and graph tool calls.
**Technology:** TypeScript CLI

## Purpose
Provides the primary user-facing interface for Chain Insights investigations. Exposes commands for workspace initialization, configuration management, MCP tool invocation, wallet operations, and investigation workflows. Delegates to workers (config, mcp client, investigation tools, case manager, export builder) for domain logic.

## Components
- **Config Resolver** (Resolves graphMcpEndpoint, auth token, workspace paths, and hosted/local endpoint precedence.)
- **Graph MCP Client** (Calls GraphRAG MCP tools and refreshes tool catalogues.)
- **AML Workflow Commands** (Runs address risk, staking, trace, and graph query workflows.)
- **Case Manager** (Creates, resumes, verifies, and updates local case evidence manifests.)
- **Export Builder** (Builds Obsidian, LLM Wiki, Codex, Claude Code, and ChatGPT handoff bundles.)
- **Agent Installer** (Installs MCP proxy configuration for local agent clients.)

## Data Flow
-> graphMcp: Calls graph tools and AML primitives
-> workspaceStore: Writes local cases, evidence, config, and exports
-> obsidian: Opens or exports curated investigation bundles

## Invariants
- All workspace writes go through active workspace detection (`.chain-insights/workspace-root` marker or `cia init` current directory)
- Config resolution follows precedence: CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT env var -> saved graphMcpEndpoint -> default http://127.0.0.1:8012/mcp
- Remote HTTP URLs must use https://; localhost/loopback may use http://
- Exit codes: 0 for success, 1 for errors (config validation, MCP connection failure, wallet issues)
- File permissions: config.json 0o600, wallet.json 0o600, workspace artifacts 0o600 for sensitive files
