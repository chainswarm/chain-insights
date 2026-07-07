#!/usr/bin/env bash
# Capability probe suite — archive/facts lane (post MemGQL retirement).
#
# Probes the StarRocks archive_topology / facts surface THROUGH the running
# devkit graph MCP (:18012). These layers are a corpus-scoped Cypher subset
# compiled to SQL by the vendored translator (internal/cyphersql); shapes
# outside the grammar and predicate-less full-scan aggregates are rejected with
# a typed contract error before any SQL runs. MemGQL is gone — there is no GQL
# WITH-RECURSIVE translation and no MemGQL 0.7.0 hazard surface.
#
# Emits: workspace/capability-matrix-archive.native.json
# Compared against: devkit/capability-probes/expected-archive.json
# (tests/capability-matrix.test.ts, gated by CAPABILITY_PROBES_ARCHIVE=1).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
mkdir -p "$WORKSPACE"
OUT="$WORKSPACE/capability-matrix-archive.native.json"
ENDPOINT="${CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT:-http://127.0.0.1:18012/mcp}"
NETWORK="${CHAIN_INSIGHTS_DEVKIT_NETWORK:-bittensor}"

ROWS_TMP="$(mktemp)"
FAILED=0

# Resolve a real anchor identity that has archive outflows (indexed-predicate
# probes need one). Deterministic: lowest identity_id with a FLOWS_TO edge.
ANCHOR="$(python3 - "$ENDPOINT" "$NETWORK" <<'PY'
import json, sys, urllib.request
endpoint, network = sys.argv[1:3]
q = "USE archive_topology MATCH (i:Identity)-[f:FLOWS_TO]->(t:Identity) RETURN i.identity_id AS a ORDER BY i.identity_id LIMIT 1"
payload = json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graph_query","arguments":{"network":network,"query":q}}}).encode()
req = urllib.request.Request(endpoint, data=payload, headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream"})
body = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
text = "\n".join(i.get("text","") for i in body.get("result",{}).get("content",[]) if i.get("type")=="text")
print(json.loads(text)["facts"]["query"]["results"][0]["a"])
PY
)"
[ -n "$ANCHOR" ] || { echo "ERROR: could not resolve an archive anchor identity" >&2; exit 1; }
echo "── capability probes: archive/facts lane (StarRocks translator via $ENDPOINT; anchor=$ANCHOR) ──"

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
except Exception as e:
    body = {"result": {"isError": True, "content": [{"type": "text", "text": f"transport: {e}"}]}}
result = body.get("result", {})
text = "\n".join(i.get("text", "") for i in result.get("content", []) if i.get("type") == "text")
is_error = bool(result.get("isError"))
error_code = None
if is_error:
    low = text.lower()
    if ("indexed predicate" in low) or ("limit exceeds maximum" in low) or ("explicit limit" in low):
        outcome, error_code = "rejected-cost", "cost-shape"
    elif "offset" in low:
        outcome, error_code = "rejected-cost", "offset-forbidden"
    else:
        # translator ErrUnsupportedShape / ErrParse / unknown-identifier
        outcome, error_code = "rejected-translation", "unsupported-shape"
else:
    outcome = "supported"
verdict = "PASS" if outcome == expected else "FAIL"
print(f"{probe_id:<4} {outcome:<20} {verdict:<5} expected={expected} code={error_code or '-'}",
      file=sys.stderr)
with open(rows_tmp, "a") as fh:
    fh.write(json.dumps({"probe_id": probe_id, "layer": "archive", "query": query,
        "expected_outcome": expected, "actual_outcome": outcome, "error_code": error_code}) + "\n")
sys.exit(0 if verdict == "PASS" else 7)
PY
  [ $? -eq 0 ] || FAILED=1
}

# --- supported: the compiled subset ---
probe A01 supported "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) RETURN t.identity_id AS t LIMIT 5"
# The translator requires an explicit LIMIT on every archive query, even a
# single-row aggregate.
probe A02 supported "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) RETURN count(f) AS c LIMIT 1"
probe A03 supported "USE facts MATCH (i:Identity {identity_id:'$ANCHOR'})-[:HAS_LABEL]->(l:AddressLabel) RETURN l.label AS label LIMIT 5"
probe A04 supported "USE facts MATCH (i:Identity {identity_id:'$ANCHOR'})-[:HAS_FEATURE]->(f:AddressFeature) RETURN f.feature_scope AS fs LIMIT 5"

# --- rejected: cost-shape gate ---
probe A05 rejected-cost "USE archive_topology MATCH (i:Identity) RETURN count(i) AS c LIMIT 1"
probe A06 rejected-cost "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) RETURN t.identity_id AS t LIMIT 5000"

# --- rejected: outside the compiled grammar (contract error) ---
probe A07 rejected-translation "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[:FLOWS_TO*1..2]->(t:Identity) RETURN t.identity_id AS t LIMIT 5"
probe A08 rejected-translation "USE archive_topology MATCH (i:Identity {identity_id:'$ANCHOR'})-[f:FLOWS_TO]->(t:Identity) WITH t RETURN t.identity_id AS t LIMIT 5"

python3 - "$OUT" "$ROWS_TMP" <<'PY'
import json, sys
out, rows_tmp = sys.argv[1:3]
rows = [json.loads(l) for l in open(rows_tmp) if l.strip()]
json.dump({
    "meta": {"description": "StarRocks archive_topology/facts translator capability matrix (post MemGQL retirement), probed through the devkit graph MCP. rejected-cost = cost-shape gate; rejected-translation = outside the compiled Cypher subset.",
             "surface": "corpus-scoped-cyphersql"},
    "rows": rows,
}, open(out, "w"), indent=2)
open(out, "a").write("\n")
print(f"wrote {out} ({len(rows)} rows)", file=sys.stderr)
PY

[ "$FAILED" -eq 0 ] || { echo "capability probes (archive): FAIL — outcome drift vs expected-archive.json" >&2; exit 1; }
echo "capability probes (archive): all rows match expected-archive.json"
