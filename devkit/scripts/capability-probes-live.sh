#!/usr/bin/env bash
# Capability probe suite — live lane (post MemGQL retirement).
#
# Probes the NATIVE Memgraph live_topology surface THROUGH the running devkit
# graph MCP (:18012). The MCP enforces production admission (read-only) and the
# live traversal bounds (depth<=5, KSHORTEST k<=16, UNWIND<=1000, unbounded
# rejected). MemGQL is gone: there is no GQL parser gate and native traversal
# (*1..n / *BFS / *WSHORTEST / *KSHORTEST + filter lambdas) is the SUPPORTED
# surface, not a rejected one.
#
# Emits: workspace/capability-matrix.native.json
# Compared against: devkit/capability-probes/expected-live.json
# (tests/capability-matrix.test.ts, gated by CAPABILITY_PROBES=1).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
mkdir -p "$WORKSPACE"
OUT="$WORKSPACE/capability-matrix.native.json"
ENDPOINT="${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://127.0.0.1:18012/mcp}"
NETWORK="${CHAIN_INSIGHTS_DEVKIT_NETWORK:-bittensor}"

ROWS_TMP="$(mktemp)"
FAILED=0

# Run one graph_query through the MCP; classify the outcome and record the row.
# Args: probe_id expected_outcome query
probe() {
  local id="$1" expected_outcome="$2" query="$3"
  python3 - "$id" "$expected_outcome" "$query" "$ENDPOINT" "$NETWORK" "$ROWS_TMP" <<'PY'
import json, sys, urllib.request
probe_id, expected, query, endpoint, network, rows_tmp = sys.argv[1:7]
payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "graph_query", "arguments": {"network": network, "query": query}}}).encode()
req = urllib.request.Request(endpoint, data=payload,
    headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
try:
    body = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
except Exception as e:  # transport failure is its own outcome
    body = {"result": {"isError": True, "content": [{"type": "text", "text": f"transport: {e}"}]}}
result = body.get("result", {})
text = "\n".join(i.get("text", "") for i in result.get("content", []) if i.get("type") == "text")
is_error = bool(result.get("isError"))
error_code = None
if is_error:
    low = text.lower()
    if "unbounded traversal" in low or "exceeds the maximum" in low:
        outcome, error_code = "rejected-bounds", "traversal-bounds"
    elif "disallowed operation" in low or "write operations" in low:
        outcome, error_code = "rejected-write", "read-only"
    elif "aggregate" in low and "indexed predicate" in low:
        outcome, error_code = "rejected-cost", "cost-shape"
    else:
        outcome, error_code = "rejected", "other"
else:
    outcome = "supported"
verdict = "PASS" if outcome == expected else "FAIL"
print(f"{probe_id:<4} {outcome:<16} {verdict:<5} expected={expected} code={error_code or '-'}",
      file=sys.stderr)
with open(rows_tmp, "a") as fh:
    fh.write(json.dumps({"probe_id": probe_id, "layer": "live_topology", "query": query,
        "expected_outcome": expected, "actual_outcome": outcome, "error_code": error_code}) + "\n")
sys.exit(0 if verdict == "PASS" else 7)
PY
  [ $? -eq 0 ] || FAILED=1
}

echo "── capability probes: live lane (native Memgraph via $ENDPOINT) ──"

# --- supported: the expanded native surface ---
probe P01 supported "USE live_topology MATCH (n:Identity) RETURN n.identity_id AS id ORDER BY n.identity_id LIMIT 2;"
probe P02 supported "USE live_topology MATCH (i:Identity)-[:HAS_ADDRESS]->(a:Address) RETURN a.address AS addr LIMIT 1;"
probe P03 supported "USE live_topology MATCH (a:Identity)-[:FLOWS_TO*1..3]->(t:Identity) RETURN t.identity_id AS t LIMIT 5;"
probe P04 supported "USE live_topology MATCH p=(a:Identity)-[:FLOWS_TO *BFS 1..3]->(b:Identity) RETURN b.identity_id AS b LIMIT 5;"
probe P05 supported "USE live_topology MATCH p=(a:Identity)-[:FLOWS_TO *WSHORTEST 5 (r,n | coalesce(r.amount_usd_sum,1)) w]->(b:Identity) RETURN b.identity_id AS b LIMIT 3;"
# KSHORTEST requires both endpoints matched first (Memgraph contract) — anchor
# the pair via WITH, then expand. k (path count) is bounded by the MCP (see P11).
probe P06 supported "USE live_topology MATCH (a:Identity), (b:Identity) WITH a, b LIMIT 1 MATCH p=(a)-[:FLOWS_TO *KSHORTEST|3]->(b) RETURN b.identity_id AS b LIMIT 3;"
probe P07 supported "USE live_topology MATCH (a:Identity)-[:FLOWS_TO*1..3 (r,n | n.is_exchange IS NULL)]->(t:Identity) RETURN t.identity_id AS t LIMIT 5;"

# --- rejected: the live bounds + admission gate ---
probe P08 rejected-bounds "USE live_topology MATCH (a:Identity)-[:FLOWS_TO*]->(b:Identity) RETURN b.identity_id AS b LIMIT 5;"
probe P09 rejected-bounds "USE live_topology MATCH (a:Identity)-[:FLOWS_TO*1..9]->(b:Identity) RETURN b.identity_id AS b LIMIT 5;"
probe P10 rejected-bounds "USE live_topology MATCH p=(a:Identity)-[:FLOWS_TO *BFS]->(b:Identity) RETURN b.identity_id AS b LIMIT 5;"
probe P11 rejected-bounds "USE live_topology MATCH p=(a:Identity)-[:FLOWS_TO *KSHORTEST|50]->(b:Identity) RETURN b.identity_id AS b LIMIT 5;"
probe P12 rejected-write "USE live_topology MATCH (a:Identity {identity_id:'X'}) CREATE (a)-[:FLOWS_TO]->(:Identity) RETURN 1;"

python3 - "$OUT" "$ROWS_TMP" <<'PY'
import json, sys
out, rows_tmp = sys.argv[1:3]
rows = [json.loads(l) for l in open(rows_tmp) if l.strip()]
json.dump({
    "meta": {"description": "Native Memgraph live_topology capability matrix (post MemGQL retirement), probed through the devkit graph MCP. rejected-bounds rows pin the live traversal gate.",
             "surface": "native-memgraph-cypher"},
    "rows": rows,
}, open(out, "w"), indent=2)
open(out, "a").write("\n")
print(f"wrote {out} ({len(rows)} rows)", file=sys.stderr)
PY

[ "$FAILED" -eq 0 ] || { echo "capability probes (live): FAIL — outcome drift vs expected-live.json" >&2; exit 1; }
echo "capability probes (live): all rows match expected-live.json"
