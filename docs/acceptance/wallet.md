# wallet acceptance

## Scenario: run

### Given

- Chain Insights installed
- Valid EVM private key (0x-prefixed 64-character hex string)
- No existing ~/.chain-insights/wallet.json

### Run

```bash
# Import wallet
cia wallet import 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
# Expected: Returns "Wallet imported. Address: 0x..." and creates wallet.json

# Verify wallet file created
ls -la ~/.chain-insights/wallet.json
# Expected: -rw------- (0o600 permissions)

# Verify wallet structure
cat ~/.chain-insights/wallet.json | jq '.salt, .iv, .tag, .data'
# Expected: Hex-encoded salt (32 chars), iv (24 chars), tag (32 chars), data (variable)

# Test wallet ready (checks configuration and funding)
cia wallet ready
# Expected: Returns wallet address, network (Base), token (USDC), amount, or funding guidance

# Test wallet balance (MCP tool)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wallet_balance","arguments":{}}}' | chain-insights-mcp-proxy | jq '.result.structuredContent'
# Expected: Returns address, network, token, amount fields

# Test decryption failure (simulate machine change)
# This test requires actual hostname/username change; skip in automated tests

# Test invalid private key format
cia wallet import invalid-key 2>&1 | grep -i "invalid"
# Expected: Error message containing "not a valid 0x-prefixed EVM private key"

# Test re-import (idempotent)
cia wallet import 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
# Expected: Overwrites existing wallet.json, returns same address

# Test address derivation consistency
ADDR1=$(cia wallet import 0xaaaa... | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
ADDR2=$(cia wallet import 0xaaaa... | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
[ "$ADDR1" = "$ADDR2" ]
# Expected: Same address for same private key (deterministic derivation)
```

### Expected

- Wallet import creates encrypted wallet.json with 0o600 permissions
- Wallet structure contains salt, iv, tag, data fields
- Wallet ready returns address, network, token, amount
- Decryption succeeds on same machine
- Invalid private key format throws validation error
- Re-import is idempotent (same address for same key)
- Address derivation is deterministic (viem privateKeyToAccount)

---

See [components/wallet.md](../architecture/components/wallet.md) for component details.
