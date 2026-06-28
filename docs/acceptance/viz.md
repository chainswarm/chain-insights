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
cia mcp call trace-victim-funds --network bittensor --victim-addresses 0xtest...

# Extract graph ID from workspace
GRAPH_ID=$(ls reports/graphs/*.graph.json | head -1 | xargs -n1 basename | sed 's/\.graph\.json//')

# Generate visualization from workspace graph
cia viz generate --source-id "$GRAPH_ID"
# Expected: Returns "Visualization written: reports/$GRAPH_ID.html"

# Verify HTML file created
ls -la reports/*.html
# Expected: HTML file with base name matching GRAPH_ID

# Verify HTML content (self-contained)
cat reports/*.html | grep -o 'src=".*cytoscape.*\.js"' | head -1
# Expected: Embedded script reference (not CDN link)

# Verify graph data embedded
cat reports/*.html | grep -o '"nodes":\s*\[' | head -1
# Expected: Embedded graph data JSON

# Test ad-hoc visualization from external JSON
echo '[{"from":"0xaaa","to":"0xbbb","value":100},{"from":"0xbbb","to":"0xccc","value":50}]' > /tmp/tx.json
cia viz generate --data-file /tmp/tx.json
# Expected: Returns "Visualization written: reports/adhoc_<timestamp>.html"

# Verify ad-hoc graph structure
cat reports/adhoc_*.html | grep -o '"nodes":\s*\[' | head -1
# Expected: Embedded nodes array with 3 nodes (0xaaa, 0xbbb, 0xccc)

# Test invalid source ID (nonexistent graph)
cia viz generate --source-id nonexistent 2>&1 | grep -i "not found"
# Expected: Error message containing "Workspace graph not found"

# Test invalid source ID format (path traversal attempt)
cia viz generate --source-id "../../../etc/passwd" 2>&1 | grep -i "invalid"
# Expected: Error message containing "Invalid visualization source ID"
```

### Expected

- Visualization generated from workspace graph JSON
- HTML file is self-contained (no external CDN dependencies)
- Graph data embedded in HTML
- Ad-hoc mode generates visualization from external JSON
- Invalid source ID returns helpful error
- Path traversal attempts rejected with validation error

---

See [components/viz.md](../architecture/components/viz.md) for component details.
