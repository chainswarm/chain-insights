# Overview

## Purpose

Chain Insights is a public AML investigation toolkit for AI agents and analysts. It screens blockchain addresses and supports manual fund-flow traversal through graph queries. The package provides a CLI (`cia`) and an MCP proxy for agent integration.

## Bounded Context

Chain Insights operates as the investigation and agent integration layer above the Chain Insights Graph. It queries address-grain topology directly by blockchain address and executes AML workflows (address risk screening and `graph_query`-based manual fund-flow traversal). The toolkit does not perform risk labeling itself; it orchestrates graph queries, formats results, and presents tools through stdio MCP or CLI commands.

Key boundaries:

- **Upstream:** Consumes Chain Insights Graph MCP endpoint for graph queries, AML primitives, and metadata
- **Downstream:** Produces CLI and MCP tool results for analysts and agents
- **Scope:** Investigation orchestration, x402 payment handling, and agent tool exposure
- **Out of scope:** Blockchain indexing, graph database storage, ML pipeline scoring, hosted case management, custodial wallet operations
