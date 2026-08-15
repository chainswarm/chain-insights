# Dependencies

<!-- Generated from the C4 workspace.dsl — edit the DSL (and repos.json), not this file. -->

## Systems

- Data Pipeline GraphRAG MCP — Public MCP endpoint serving graph queries, risk tools, quota, and report metadata.
- AML ACP — Marketplace bridge that calls Chain Insights workflows through the proxy.

## Contracts

- cia CLI → Data Pipeline GraphRAG MCP: Calls graph tools and AML primitives
- MCP Proxy → Data Pipeline GraphRAG MCP: Proxies configured tools

## Sibling Repositories

- `ml-pipeline` (ml) — https://github.com/chainswarm/ml-pipeline.git
- `data-pipeline` (ml) — https://github.com/chainswarm/data-pipeline.git
- `aml-acp` (ml) — https://github.com/chainswarm/aml-acp.git
- `pricing-oracle` (ml) — https://github.com/chainswarm/pricing-oracle.git
- `starrocks-exporter` (ml) — https://github.com/chainswarm/starrocks-exporter.git
- `indexer-evm` (indexers) — https://github.com/chainswarm/indexer-evm.git
- `indexer-substrate` (indexers) — https://github.com/chainswarm/indexer-substrate.git
- `devops` (infra) — https://github.com/chainswarm/devops.git
- `website` (infra) — https://github.com/chainswarm/website.git
- `chain-insights-publisher` (infra) — https://github.com/chainswarm/chain-insights-publisher.git
