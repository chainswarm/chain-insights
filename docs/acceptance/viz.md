# viz acceptance

## Scenario: run

### Given

- Active workspace with investigation results
- Graph JSON artifacts present in reports/graphs/
- Chain Insights built (npm run build completed)

### Run

```bash
# Initialize workspace and generate investigation artifacts
mkdir -p /tmp/ci-viz-test && cd /tmp/ci-viz-test
cia init .
cia mcp call aml_address_risk \
  network=robinhood \
  address=0x1234... \
  include_attachments=true

# Extract graph ID from workspace
GRAPH_ID=$(ls reports/graphs/*.graph.json | head -1 | xargs -n1 basename | sed 's/\.graph\.json//')

# Generate visualization from workspace graph
cia viz "$GRAPH_ID"
# Expected: Prints "Visualization: http://127.0.0.1:4321/viz/$GRAPH_ID",
# starts the local server, and opens the URL in a browser

# Verify HTML file created
ls -la published/viz/*.html
# Expected: HTML file named $GRAPH_ID.html

# Verify HTML content (self-contained)
cat published/viz/$GRAPH_ID.html | grep -o 'src=".*cytoscape.*\.js"' | head -1
# Expected: Embedded script reference (not CDN link)

# Verify graph data embedded
cat published/viz/$GRAPH_ID.html | grep -o '"nodes":\s*\[' | head -1
# Expected: Embedded graph data JSON

# Test ad-hoc visualization from external JSON
echo '[{"from":"0xaaa","to":"0xbbb","value":100},{"from":"0xbbb","to":"0xccc","value":50}]' > /tmp/tx.json
cia viz --data /tmp/tx.json
# Expected: Prints "Visualization: http://127.0.0.1:4321/viz/adhoc_<timestamp>"

# Verify ad-hoc graph structure
cat published/viz/adhoc_*.html | grep -o '"nodes":\s*\[' | head -1
# Expected: Embedded nodes array with 3 nodes (0xaaa, 0xbbb, 0xccc)

# Test missing source ID (nonexistent graph)
cia viz nonexistent 2>&1 | grep -i "no such file"
# Expected: Error for the missing reports/graphs/nonexistent.graph.json file

# Test invalid source ID format (path traversal attempt)
cia viz "../../../etc/passwd" 2>&1 | grep -i "invalid"
# Expected: Error message containing "Invalid visualization source ID"
```

### Expected

- Visualization generated from workspace graph JSON
- Command prints the served URL, starts the local server, and opens a browser
- HTML file is self-contained (no external CDN dependencies)
- Graph data embedded in HTML
- Ad-hoc mode generates visualization from external JSON
- Missing source ID returns a file-not-found error
- Path traversal attempts rejected with validation error

---

See [components/viz.md](../architecture/components/viz.md) for component details.
