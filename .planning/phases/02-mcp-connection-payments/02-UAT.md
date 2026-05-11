---
phase: 02-mcp-connection-payments
status: complete
verified_at: 2026-05-11T20:00:22Z
verified_by: Codex
---

# Phase 02 UAT: MCP Connection and Payments

## Result

PASS.

The live-environment checks from `02-VERIFICATION.md` were re-run against the current local Chain Insights configuration and the real GraphRAG MCP endpoint. The local test endpoint uses the configured debug bearer path rather than requiring a production funded Base wallet spend.

## Checks

| Check | Evidence | Result |
|-------|----------|--------|
| Wallet material is stored outside config | `~/.chain-insights/wallet.json` exists with mode `600`; `~/.chain-insights/config.json` has mode `600`, no `walletPrivateKey` property, and no raw `0x...64` private-key literal | PASS |
| Proxy stdout purity | `node dist/mcp-proxy.mjs 1>/tmp/ci-proxy-stdout.txt 2>/tmp/ci-proxy-stderr.txt` exited cleanly with `stdout_bytes=0` and `stderr_bytes=0` using the configured local MCP setup | PASS |
| Live MCP tool discovery | `chain-insights mcp tools` listed `address_risk`, `track_funds`, `money_flows_between_exchanges`, `address_connection_risk`, and `graph_query` | PASS |
| Live MCP call | `chain-insights mcp call graph_query network=bittensor "query=MATCH (n) WHERE n.address IS NOT NULL RETURN labels(n) AS labels, n.address AS address LIMIT 1"` returned one real Memgraph address row | PASS |

## Notes

Production x402 balance debit was not asserted in this local UAT. The project-supported live test path for this milestone is the GraphRAG debug bearer path, which exercises the real MCP tool surface without spending production funds.
