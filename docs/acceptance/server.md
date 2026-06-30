# server acceptance

## Scenario: run

### Given

- Chain Insights installed and built (npm run build completed)
- Config serverPort set (optional, defaults to 4321)
- Workspace with artifacts (optional, for testing artifact serving)

### Run

```bash
# Start server in background
node dist/server.mjs &
SERVER_PID=$!
sleep 2

# Test server startup
curl -s http://127.0.0.1:4321/ | head -20
# Expected: HTML response with <!doctype html>, <title>, and Cytoscape.js script tags

# Test graph app rendering
curl -s http://127.0.0.1:4321/ | grep -o '<title>.*</title>'
# Expected: <title>Chain Insights Graph</title> or similar

# Test 404 for nonexistent path
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4321/nonexistent
# Expected: 404

# Test artifact serving (if workspace has artifacts)
curl -s http://127.0.0.1:4321/artifacts/nonexistent
# Expected: 404 or error message

# Test localhost-only binding (external connection rejected)
# This requires external network access; skip in automated tests

# Test port conflict (start second server)
node dist/server.mjs &
SERVER_PID_2=$!
sleep 1
# Expected: Second start fails with "Port already in use" message

# Cleanup
kill $SERVER_PID $SERVER_PID_2
# Expected: Clean shutdown, no orphan processes
```

### Expected

- Server starts on localhost only (127.0.0.1)
- Graph app HTML served with embedded Cytoscape.js
- 404 for nonexistent paths
- Port conflict fails with error message
- Clean shutdown on SIGTERM

---

See [components/server.md](../architecture/components/server.md) for component details.
