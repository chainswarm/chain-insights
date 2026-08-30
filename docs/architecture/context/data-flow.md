# Data Flow

<!-- Generated from the C4 workspace.dsl — edit the DSL (and repos.json), not this file. -->

## Entry Points

- Investigator / Agent → cia CLI: Runs investigation and setup commands
- Investigator / Agent → MCP Proxy: Calls tools from agent clients

## Internal Flows

- cia CLI → Local config: Reads endpoint and payment configuration
- MCP Proxy → Local config: Reads endpoint and payment configuration
- NPM Package → cia CLI: Packages CLI entrypoint
- NPM Package → MCP Proxy: Packages proxy entrypoint

## External Calls

- cia CLI → Data Pipeline GraphRAG MCP: Calls graph tools and AML primitives
- MCP Proxy → Data Pipeline GraphRAG MCP: Proxies configured tools
