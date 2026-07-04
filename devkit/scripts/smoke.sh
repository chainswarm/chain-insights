#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/repos/infra/chain-insights/devkit/docker-compose.yml"
EVIDENCE_DIR="$REPO_ROOT/workspace/devkit-smoke"
MCP_ENDPOINT="${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://127.0.0.1:${DEVKIT_MCP_PORT:-18012}/mcp}"
MCP_BASE="${MCP_ENDPOINT%/mcp}"

mkdir -p "$EVIDENCE_DIR"

python3 "$SCRIPT_DIR/validate-manifest.py"

# docker-compose.yml ps evidence is captured below.
docker compose -f "$COMPOSE_FILE" ps > "$EVIDENCE_DIR/compose-ps.txt"
curl -fsS "$MCP_BASE/health" > "$EVIDENCE_DIR/health.json"
curl -fsS "$MCP_BASE/metadata/networks" > "$EVIDENCE_DIR/networks.json"

mcp_post() {
  local method="$1"
  local params="$2"
  local output="$3"
  python3 - "$method" "$params" "$MCP_ENDPOINT" "$output" <<'PY'
import json
import sys
import urllib.request

method, params, endpoint, output = sys.argv[1:5]
payload = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": method,
    "params": json.loads(params),
}).encode("utf-8")
request = urllib.request.Request(
    endpoint,
    data=payload,
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    },
)
with urllib.request.urlopen(request, timeout=30) as response:
    body = response.read().decode("utf-8")
open(output, "w", encoding="utf-8").write(body)
PY
}

mcp_post "tools/list" '{}' "$EVIDENCE_DIR/mcp-tools.json"

python3 - "$EVIDENCE_DIR/mcp-tools.json" <<'PY'
import json
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
payload = json.loads(text)
tools = {tool["name"] for tool in payload.get("result", {}).get("tools", [])}
expected = {"network_capabilities", "usage_status", "graph_query", "graph_query_batch"}
if tools != expected:
    raise SystemExit(f"unexpected MCP tools: {sorted(tools)}")
for denied in ["aml_", "wallet", "x402", "ACP", "quota", "telemetry"]:
    if any(denied.lower() in tool.lower() for tool in tools):
        raise SystemExit(f"denied tool exposed: {denied}")
PY

mcp_post "tools/call" '{"name":"network_capabilities","arguments":{}}' "$EVIDENCE_DIR/network-capabilities.json"

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE live_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(a:Address) RETURN i.identity_id, a.address LIMIT 1"}}' "$EVIDENCE_DIR/live-topology.json"

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE archive_topology MATCH (i:Identity)-[r:FLOWS_TO]->(j:Identity) RETURN count(r) AS flow_count LIMIT 1"}}' "$EVIDENCE_DIR/archive-coverage.json"

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE facts MATCH (f:AddressFeature) RETURN count(f) AS features LIMIT 1"}}' "$EVIDENCE_DIR/facts.json"

mcp_post "tools/call" '{"name":"graph_query_batch","arguments":{"network":"bittensor","queries":[{"id":"live","query":"USE live_topology MATCH (i:Identity) RETURN count(i) AS identities LIMIT 1"},{"id":"facts","query":"USE facts MATCH (f:AddressFeature) RETURN count(f) AS features LIMIT 1"}]}}' "$EVIDENCE_DIR/graph-query-batch.json"

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE archive_topology MATCH (i:Identity) WHERE i.is_exchange IS NOT NULL RETURN count(i) AS not_null_count"}}' "$EVIDENCE_DIR/is-exchange-not-null-count.json"
mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE archive_topology MATCH (i:Identity) WHERE i.is_exchange = true RETURN count(i) AS true_count"}}' "$EVIDENCE_DIR/is-exchange-true-count.json"

python3 - "$EVIDENCE_DIR/is-exchange-not-null-count.json" "$EVIDENCE_DIR/is-exchange-true-count.json" <<'PY'
import json
import sys
from pathlib import Path

# is_exchange must be a real typed NULL, not the literal varchar string
# "NULL" -- the D3 corruption this check pins against forever. Before the
# fix, "IS NOT NULL" matched every row (480,381 in the devkit fixture)
# instead of just the 11 exchange-flagged identities; both counts must be
# identical (every non-NULL is_exchange value is true, never false/0).
def result_count(path, key):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    facts = payload["result"]["structuredContent"]["facts"]
    return facts["query"]["results"][0][key]

not_null_count = result_count(sys.argv[1], "not_null_count")
true_count = result_count(sys.argv[2], "true_count")
if not_null_count != true_count:
    raise SystemExit(
        f"is_exchange typed-NULL check FAILED: IS NOT NULL count ({not_null_count}) "
        f"!= = true count ({true_count}) -- is_exchange is not a real typed NULL"
    )
if not_null_count <= 0:
    raise SystemExit("is_exchange typed-NULL check FAILED: expected a positive exchange count, got 0")
print(f"is_exchange typed-NULL check OK: {not_null_count} exchange identities, no varchar-NULL corruption")
PY

"$SCRIPT_DIR/smoke-memgql-objects.py" > "$EVIDENCE_DIR/memgql-object-coverage.json"

printf '%s\n' "devkit smoke evidence written to workspace/devkit-smoke"
