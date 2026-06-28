# investigation acceptance

## Scenario: run

### Given

- Active workspace initialized (`cia init .`)
- Chain Insights Graph endpoint configured and reachable
- Network supported (bittensor)

### Run

```bash
# Initialize workspace
mkdir -p /tmp/ci-test && cd /tmp/ci-test
cia init .
# Expected: Creates .chain-insights/workspace-root marker

# Trace victim funds
cia mcp call trace-victim-funds \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --max-hops 2

# Expected artifacts written:
ls -la reports/
# Expected: <timestamp>_trace-report.md
ls -la reports/graphs/
# Expected: <timestamp>_graph.json, <timestamp>_graph.html
ls -la reports/tables/
# Expected: <timestamp>_flows.csv, <timestamp>_compact-evidence.json, <timestamp>_table.html
ls -la artifacts/
# Expected: <network>.graph-schema.json (runtime schema capture)

# Verify compact evidence structure
cat reports/tables/*.compact-evidence.json | jq '.schema, .source, .network, .address_map'
# Expected: chain-insights.probe_evidence.v1 schema, non-empty address_map, fund_flows array

# Verify graph payload
cat reports/graphs/*.graph.json | jq '.schema, .nodes | length, .edges | length'
# Expected: chain-insights.graph.v1 schema, nodes with labels/risk_score, edges with amount_usd_sum

# Verify report content
cat reports/*.trace-report.md | head -20
# Expected: Markdown with header, network, seed_address, probe summary, flow table

# Test bounded tracing (max hops respected)
cia mcp call trace-victim-funds --max-hops 1 --victim-addresses 0xtest...
# Expected: Trace limited to 1 hop, fewer flows generated

# Test min amount sum filter
cia mcp call trace-victim-funds --min-amount-sum 10000 --victim-addresses 0xtest...
# Expected: Only flows with amount_usd_sum >= 10000 included
```

### Expected

- Workspace artifacts created in correct directories
- Compact evidence contains alias mapping and flow paths
- Graph payload contains nodes with risk metadata and edges with amounts
- Report contains Markdown summary, Mermaid diagram, file references
- Bounded tracing respects max hops and min amount filters
- Schema files capture runtime topology structure

---

See [components/investigation.md](../architecture/components/investigation.md) for component details.
