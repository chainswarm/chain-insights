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

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE live_topology MATCH (a:Address)-[:LINKED]-(b:Address) RETURN a.address, b.address LIMIT 1"}}' "$EVIDENCE_DIR/live-topology.json"

# Bounded projections (not predicate-less aggregates): the devkit graph MCP now
# enforces the production StarRocks cost-shape admission gate, which refuses
# global count()/sum() over archive/facts without an indexed predicate. Coverage
# is proven by an admitted bounded read that returns real rows.
mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE archive_topology MATCH (i:Address)-[r:FLOWS_TO]->(j:Address) RETURN i.address AS from_address, j.address AS to_address LIMIT 1"}}' "$EVIDENCE_DIR/archive-coverage.json"

mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE facts MATCH (f:AddressFeature) RETURN f.feature_scope AS feature_scope LIMIT 1"}}' "$EVIDENCE_DIR/facts.json"

mcp_post "tools/call" '{"name":"graph_query_batch","arguments":{"network":"bittensor","queries":[{"id":"live","query":"USE live_topology MATCH (i:Address) RETURN count(i) AS addresses LIMIT 1"},{"id":"facts","query":"USE facts MATCH (f:AddressFeature) RETURN f.feature_scope AS feature_scope LIMIT 1"}]}}' "$EVIDENCE_DIR/graph-query-batch.json"

# is_exchange typed-NULL integrity (D3 pin), now expressed as an admitted
# bounded projection. Before the D3 fix, is_exchange loaded as the literal
# varchar string "NULL"; then "IS NOT NULL" matched every row and projected the
# string "NULL" back. A real typed NULL means IS NOT NULL returns only the
# exchange-flagged addresses, each with is_exchange truthy (1/true) — never the
# string "NULL", never 0/false.
mcp_post "tools/call" '{"name":"graph_query","arguments":{"network":"bittensor","query":"USE archive_topology MATCH (i:Address) WHERE i.is_exchange IS NOT NULL RETURN i.address AS address, i.is_exchange AS is_exchange LIMIT 25"}}' "$EVIDENCE_DIR/is-exchange-not-null-projection.json"

python3 - "$EVIDENCE_DIR/is-exchange-not-null-projection.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = payload["result"]["structuredContent"]["facts"]["query"]["results"]
if not rows:
    raise SystemExit("is_exchange typed-NULL check FAILED: IS NOT NULL returned no rows (expected exchange-flagged addresses)")
truthy = {1, "1", True, "true", "True"}
for row in rows:
    value = row.get("is_exchange")
    if value in {"NULL", "null", None}:
        raise SystemExit(
            f"is_exchange typed-NULL check FAILED: IS NOT NULL projected value {value!r} "
            "-- is_exchange is a varchar 'NULL', not a real typed NULL"
        )
    if value not in truthy:
        raise SystemExit(
            f"is_exchange typed-NULL check FAILED: non-truthy is_exchange {value!r} matched "
            "IS NOT NULL (every non-NULL is_exchange must be true, never false/0)"
        )
print(f"is_exchange typed-NULL check OK: {len(rows)} exchange-flagged rows, all truthy, no varchar-NULL corruption")
PY

"$SCRIPT_DIR/smoke-memgql-objects.py" > "$EVIDENCE_DIR/memgql-object-coverage.json"

printf '%s\n' "devkit smoke evidence written to workspace/devkit-smoke"
