# Chain Insights Bittensor Devkit

Local GraphRAG serving bundle for Chain Insights development.

The devkit serves the public semantic network `bittensor` from deterministic
fixture files covering source genesis through `2025-12-31` UTC. Chain Insights
owns the AML tools and investigation recipes; this devkit provides only the
local graph backend those tools can call.

Runtime package ownership:

- Chain Insights: Compose stack, fixture data, import scripts, smoke scripts,
  and the lite GraphRAG MCP backend under this directory.
- RBMK: offline warehouse export/build scripts under
  `scripts/devops/chain-insights-devkit/`.

The production GraphRAG MCP assembly in
`repos/ml/data-pipeline/cmd/graphrag-mcp` is not used by this package.

