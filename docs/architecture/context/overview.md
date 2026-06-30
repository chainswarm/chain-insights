# Overview

## Purpose

Chain Insights is a public AML investigation toolkit for AI agents and analysts. It screens blockchain addresses, traces role-specific fund flows, manages workspace evidence, and generates graph reports. The package provides a CLI (`cia`), an MCP proxy for agent integration, and local workspace management for investigation persistence.

## Bounded Context

Chain Insights operates as the investigation and agent integration layer above the Chain Insights Graph (GraphRAG MCP data pipeline). It resolves blockchain addresses to identity-grain topology, executes AML workflows (address risk screening, victim/suspect/deposit tracing), and stores investigation outputs in local workspaces. The toolkit does not perform risk labeling itself; it orchestrates graph queries, formats results, writes workspace artifacts, and presents tools through stdio MCP or CLI commands.

Key boundaries:
- **Upstream:** Consumes Chain Insights Graph MCP endpoint for graph queries, AML primitives, and metadata
- **Downstream:** Produces local workspace artifacts (reports, graphs, tables, evidence manifests) and MCP tool surfaces
- **Scope:** Investigation orchestration, workspace state management, x402 payment handling, graph visualization, and agent tool exposure
- **Out of scope:** Blockchain indexing, graph database storage, ML pipeline scoring, hosted case management, custodial wallet operations
