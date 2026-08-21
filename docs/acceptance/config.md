# config acceptance

## Scenario: run

### Given

- Fresh Chain Insights installation with no existing ~/.chain-insights/config.json
- Node.js >=22.0.0 installed
- npm package installed globally or locally

### Run

```bash
# Test default config load (no file exists)
cia config get graphMcpEndpoint
# Expected: Returns default "http://127.0.0.1:8012/mcp"

# Test config write
cia config set graphMcpEndpoint https://mcp.chain-insights.ai/
# Expected: Writes ~/.chain-insights/config.json with graphMcpEndpoint field

# Test config read
cia config get graphMcpEndpoint
# Expected: Returns "https://mcp.chain-insights.ai/"

# Test env override
export CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=http://127.0.0.1:9999/mcp
cia config get graphMcpEndpoint
# Expected: Returns "http://127.0.0.1:9999/mcp" (overrides saved value)
# Note: http:// is accepted only for loopback hosts; remote hosts must use https://

# Test invalid config (corrupt JSON)
echo "{invalid json" > ~/.chain-insights/config.json
cia config get graphMcpEndpoint 2>&1 | grep -i "invalid json"
# Expected: Error message containing "Invalid JSON in ~/.chain-insights/config.json"

# Test invalid schema (wrong field type)
echo '{"graphMcpEndpoint":123}' > ~/.chain-insights/config.json
cia config get graphMcpEndpoint 2>&1 | grep -i "invalid configuration"
# Expected: Error message containing "Invalid configuration in ~/.chain-insights/config.json"

# Test file permissions
ls -la ~/.chain-insights/config.json
# Expected: -rw------- (0o600 permissions)
```

### Expected

- Default config returned when file absent (no error)
- Config write succeeds with valid values
- Env variable overrides saved value
- Invalid JSON throws human-readable error
- Invalid schema throws human-readable error
- File written with 0o600 permissions

---

See [components/config.md](../architecture/components/config.md) for component details.
