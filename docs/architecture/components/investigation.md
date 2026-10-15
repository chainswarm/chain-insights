Worker: investigation
Entrypoint: src/investigation
Package: investigation
Language: typescript
Tests: tests/mcp-proxy.test.ts, tests/cli-mcp.test.ts

# investigation

## Purpose

Holds the address screening recipes (`public-tools.ts`), the risk-level
normalisation the graph verdicts need (`risk-level.ts`), the graph row
normaliser, and the workflow catalogue. It composes read-only `graph_query`
and `graph_query_batch` calls. The MCP proxy does not offer the screening as
a tool: `aml_address_risk` is hidden until its verdict is fixed.

## Reads

- **Remote MCP client:** Chain Insights Graph tool responses
- **Investigation input:** address, network, and optional comparison address
- **Config:** Search and endpoint settings

## Flow

```text
addressRisk
  -> graph schema and profile queries
  -> risk and exchange-behavior facts
  -> summary and structured result
```

## Invariants

- Addresses remain full raw chain-native values.
- The public investigation network is `robinhood`.
- Graph reads use `topology` and `facts` explicitly.
- Exchange hot wallets are terminal endpoints in traversal guidance.
- Stateless calls do not write local investigation files.

## Run

No public command runs this module directly. The proxy composes its reads
behind the public graph tools, and the workflow catalogue it holds is not a
public surface.
