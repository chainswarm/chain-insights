# investigation acceptance

## Scenario: run

### Given

- Active workspace initialized (`cia init .`)
- Chain Insights Graph endpoint configured and reachable
- Network supported (robinhood)

### Run

```bash
# Initialize workspace
mkdir -p /tmp/ci-test && cd /tmp/ci-test
cia init .
# Expected: Creates .chain-insights/workspace.json marker

# Screen an address
cia mcp call aml_address_risk \
  network=robinhood \
  address=0x1234... \
  include_attachments=true

# Expected artifacts written:
ls -la reports/
# Expected: <timestamp>_aml_address_risk_<network>_<address>
#           .aml-address-report.md, .table.html, .graph.html
ls -la reports/graphs/
# Expected: <timestamp>_aml_address_risk_<network>_<address>.graph.json
ls -la reports/tables/
# Expected: <timestamp>_aml_address_risk_<network>_<address>
#           .compact-evidence.json, .flows.csv
ls -la artifacts/
# Expected: <network>.graph-schema.json (runtime schema capture)

# Verify evidence structure
cat reports/tables/*.compact-evidence.json | jq '.schema, .tool, .network'
# Expected: signature schema, aml_address_risk tool, robinhood network

# Verify graph payload
cat reports/graphs/*.graph.json | jq '.schema, .nodes | length, .edges | length'
# Expected: graph schema, nodes with risk metadata, edges with amounts

# Verify report content
cat reports/*.aml-address-report.md | head -20
# Expected: Markdown with header, network, address, profile summary

# Direct public graph access
cia mcp call graph_query \
  network=robinhood \
  "query=USE topology MATCH (a:Address {address: '0x1234...'})-[f:FLOWS_TO]->(b:Address) RETURN a.address AS address, sum(f.amount_usd_sum) AS amount_usd_sum LIMIT 1"
# Expected: money-flow rows for the address from the public graph

# Compare two addresses
cia mcp call aml_address_risk \
  network=robinhood \
  address=0x1234... \
  compare_address=0xabcd...
# Expected: Comparison lane, results in the returned summary and report
```

### Expected

- Workspace artifacts created in correct directories
- Evidence JSON contains the screened address, profile, and exchange rows
- Graph payload contains nodes with risk metadata and edges with amounts
- Report contains Markdown summary and file references
- The public robinhood graph resolves raw addresses directly by key
- Comparison screening returns both addresses in the profile

---

See [components/investigation.md](../architecture/components/investigation.md) for component details.
