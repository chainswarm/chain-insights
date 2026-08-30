# wallet acceptance

## Scenario: run

### Given

- Chain Insights installed
- No existing ~/.chain-insights/wallet.json

### Run

```bash
# Create a wallet and confirm the backup
printf 'BACKED UP\n' | cia wallet create
# Expected: Shows the private key in a warning panel, then creates wallet.json

# Verify the generated wallet file
ls -la ~/.chain-insights/wallet.json
# Expected: -rw------- (0o600 permissions)

# Test wallet ready (checks configuration and funding)
cia wallet ready
# Expected: Returns wallet address, network (Base), token (USDC), amount, or funding guidance

# Verify wallet structure
cat ~/.chain-insights/wallet.json | jq '.salt, .iv, .tag, .data'
# Expected: Hex-encoded salt (32 chars), iv (24 chars), tag (32 chars), data (variable)

# Test wallet balance (MCP tool)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wallet_balance","arguments":{}}}' | chain-insights-mcp-proxy | jq '.result.structuredContent'
# Expected: Returns address, network, token, amount fields

# Test decryption failure (simulate machine change)
# This test requires actual hostname/username change; skip in automated tests

# Test invalid private key format
cia wallet import invalid-key 2>&1 | grep -i "invalid"
# Expected: Error message containing "not a valid 0x-prefixed EVM private key"

# Test re-import refusal (existing wallet is protected)
cia wallet import 0x1234...cdef (example 64-hex private key) 2>&1 | grep -i "already exists"
# Expected: Refuses; the error names the existing wallet address and the --force path

# Test forced re-import
cia wallet import 0x1234...cdef (example 64-hex private key) --force
# Expected: Backs up the previous encrypted key next to wallet.json, overwrites, returns same address

# Test address derivation consistency
ADDR1=$(cia wallet import 0xaaaa... --force | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
ADDR2=$(cia wallet import 0xaaaa... --force | grep -o '0x[a-fA-F0-9]\{40\}' | head -1)
[ "$ADDR1" = "$ADDR2" ]
# Expected: Same address for same private key (deterministic derivation)
```

### Expected

- Wallet creation does not persist until `BACKED UP` is entered
- Wallet creation displays the private key only during creation and explains the encrypted storage path
- Wallet import creates encrypted wallet.json with 0o600 permissions
- Wallet structure contains salt, iv, tag, data fields
- Wallet ready returns address, network, token, amount
- Decryption succeeds on same machine
- Invalid private key format throws validation error
- Re-import without `--force` is refused; `--force` backs up and overwrites
- Address derivation is deterministic (viem privateKeyToAccount)

### Alternative: import an existing wallet

Run this setup instead of wallet creation, using a fresh home with no existing
`~/.chain-insights/wallet.json`:

```bash
cia wallet import 0x1234...cdef # example 64-hex private key
# Expected: Reminds the user to retain the original private-key backup
cia wallet ready
```

---

See [components/wallet.md](../architecture/components/wallet.md) for component details.
