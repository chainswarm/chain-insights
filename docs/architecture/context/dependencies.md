# Dependencies

## Systems

- **Chain Insights Graph (Data Pipeline GraphRAG MCP):** Primary upstream dependency for graph queries, AML primitives, network capabilities, and usage status. Required for all investigation tools except wallet_balance and meta_help. Accessed via configured HTTP MCP endpoint (default: http://127.0.0.1:8012/mcp).
- **RBMK Control Plane:** Development smoke tests, release orchestration, and CI/CD validation. Uses npm package checks, devkit parity workflows, and staging validation for Chain Insights releases.
- **x402 Payment Network:** Base Mainnet (eip155:8453) for USDC micropayments on paid graph tools. Wallet operations (import, ready, topup) require Base ETH for gas and USDC for payment settlement.
- **npm Registry:** Public package distribution at https://www.npmjs.com/package/chain-insights. Releases require package.json, package-lock.json, and CHANGELOG.md updates.

## Contracts

- **MCP Tool Contract:** Uses @modelcontextprotocol/sdk for stdio transport, tool registration, and remote HTTP client (StreamableHTTPClientTransport with SSE fallback). Exposes tools with inputSchema (Zod), annotations (readOnlyHint, idempotentHint), and structuredContent responses.
- **Graph Query Contract:** topology (unified recent + full historical FLOWS_TO topology, Address nodes with labels/risk/is_exchange, plus the LINKED ownership overlay), facts (labels, features, enrichment). The ML risk verdict is topology-only. Reads only; no CREATE/MERGE/SET/DELETE.
- **x402 Payment Contract:** HTTP 402 PaymentRequired responses with payment-required header containing JSON-encoded {error, accepts: [{scheme, network, amount, payTo}]}. Client wraps fetch with ExactEvmScheme and UptoEvmScheme from @x402/evm.
- **Workspace Schema Contract:** Compact evidence uses chain-insights.probe_evidence.v1, graph data uses chain-insights.graph.v1, runtime schema uses chain-insights.runtime_graph_schema.v1. All workspace JSON files include schema version field.
