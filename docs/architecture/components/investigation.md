Worker: investigation
Entrypoint: src/investigation
Package: investigation
Language: typescript
Tests: tests/mcp-proxy.test.ts, tests/cli-mcp.test.ts

# investigation

## Purpose

Implements AML address screening and comparison. It composes read-only
`graph_query` and `graph_query_batch` calls, builds a risk profile, and returns
a text summary with structured facts.

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

```bash
cia mcp call aml_address_risk \
  network=robinhood \
  address=0x1234...
```
