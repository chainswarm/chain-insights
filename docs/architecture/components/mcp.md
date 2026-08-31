Worker: mcp
Entrypoint: src/mcp
Package: mcp
Language: typescript
Tests: tests/mcp-proxy.test.ts, tests/mcp-client.test.ts, tests/mcp-capabilities.test.ts, tests/mcp-graph-client.test.ts, tests/mcp-print-result.test.ts, tests/mcp-schema-cache.test.ts

# mcp

## Purpose

Implements the stdio MCP proxy and the remote Chain Insights Graph client.
The proxy validates public tool arguments, handles endpoint authentication,
caches remote schemas, translates payment errors, and logs tool activity.

## Reads

- **Config:** `~/.chain-insights/config.json` for endpoint and auth settings
- **Wallet:** `~/.chain-insights/wallet.json` for x402 payment handling
- **Chain Insights Graph:** Remote tool catalogues and tool responses
- **stdin:** MCP requests from the connected agent client

## Writes

- **stdout:** MCP protocol responses only
- **stderr:** Connection, payment, and startup diagnostics
- **Runtime log:** Structured tool and topology events in the configured data directory

## Invariants

- Stdio purity: diagnostics never mix with MCP responses.
- Only public prefixed tools are exposed.
- Known tool arguments are validated before remote forwarding.
- Schema cache entries are scoped to the configured endpoint.
- The default proxy mode is stateless.
- The proxy starts when the remote endpoint is unavailable so local help remains available.

## Run

```bash
chain-insights-mcp-proxy
```

The proxy connects to the configured Chain Insights Graph endpoint and waits
for MCP requests on stdin.

## Verify

```bash
npx @modelcontextprotocol/inspector \
  --cli chain-insights-mcp-proxy \
  --method tools/list
```
