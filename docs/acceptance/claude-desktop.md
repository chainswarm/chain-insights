# claude-desktop acceptance

## Scenario: run

### Given

- Chain Insights installed globally (chain-insights-mcp-proxy in PATH)
- Claude Desktop installed and run at least once (config directory exists)
- macOS or Windows OS (Linux not supported for Claude Desktop)

### Run

```bash
# Test config path detection (macOS)
CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ -f "$CONFIG_PATH" ]; then
  echo "Claude Desktop config exists"
else
  echo "Claude Desktop config not found (skip if Claude Desktop never run)"
fi

# Install Chain Insights for Claude Desktop
cia claude install
# Expected: Success message, MCP server entry added to config

# Verify MCP server entry in config
cat "$CONFIG_PATH" | jq '.mcpServers.chain-insights'
# Expected: Returns object with "command": "chain-insights-mcp-proxy", "args": [], optional "env"

# Test command availability
which chain-insights-mcp-proxy
# Expected: Returns /usr/local/bin/chain-insights-mcp-proxy or similar PATH entry

# Test idempotent install (run twice)
cia claude install
# Expected: Success message, no duplicate entry created

# Verify config still valid (JSON parses)
cat "$CONFIG_PATH" | jq '.' > /dev/null
# Expected: No JSON parse errors

# Test custom configuration install
cia claude install --mode stateless --endpoint https://custom-endpoint/mcp
# Expected: MCP server entry with env vars (CHAIN_INSIGHTS_MCP_PROXY_MODE, CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT)

# Verify env vars in config
cat "$CONFIG_PATH" | jq '.mcpServers.chain-insights.env'
# Expected: Returns object with mode and endpoint env vars
```

### Expected

- Installer detects Claude Desktop config path
- MCP server entry added to config.json
- Command references chain-insights-mcp-proxy
- Install is idempotent (no duplicate entries)
- Custom configuration adds env vars to MCP server entry
- Config remains valid JSON after installation
- Command is available in PATH

---

See [components/claude-desktop.md](../architecture/components/claude-desktop.md) for component details.
