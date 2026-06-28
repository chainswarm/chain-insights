# mcp acceptance

## Scenario: run

### Given

- Chain Insights installed and configured with valid graphMcpEndpoint
- ~/.chain-insights/config.json exists with endpoint configuration
- Wallet configured (optional, for payment tools)

### Run

```bash
# Start MCP proxy in background
chain-insights-mcp-proxy &
PROXY_PID=$!
sleep 2

# Test tool listing via JSON-RPC
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | chain-insights-mcp-proxy | jq '.result.tools[].name'
# Expected: Returns tool names (meta_network_capabilities, meta_usage_status, aml_*, graph_query*, wallet_balance, meta_help)

# Test local tool (no Graph connection required)
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"meta_help","arguments":{}}}' | chain-insights-mcp-proxy | jq '.result.content[].text' | head -5
# Expected: Returns help text describing Chain Insights tools and workflow

# Test remote tool with Graph connection
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"meta_network_capabilities","arguments":{}}}' | chain-insights-mcp-proxy | jq '.result.structuredContent'
# Expected: Returns structured content with network capabilities (bittensor, tools, layers)

# Test payment-required scenario (if wallet not configured)
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"aml_trace_victim_funds","arguments":{"network":"bittensor","victim_addresses":"0xtest"}}}' | chain-insights-mcp-proxy 2>&1 | grep -i "payment"
# Expected: Error message mentioning "Payment required" and next steps (wallet ready, access-key set)

# Test structured logging
tail -f ~/.chain-insights/runtime/logs/mcp-proxy.jsonl | head -5
# Expected: JSONL lines with ts, level, event, pid fields

# Test proxy shutdown
kill $PROXY_PID
sleep 1
# Expected: Clean exit, proxy.log contains "proxy.shutdown" event
```

### Expected

- Proxy starts without errors
- Tools list includes local and remote tools
- Local tools work without Graph connection
- Remote tools call Graph MCP endpoint
- PaymentRequiredError returns actionable guidance
- Structured logs written to mcp-proxy.jsonl
- Clean shutdown on SIGTERM

---

See [components/mcp.md](../architecture/components/mcp.md) for component details.
