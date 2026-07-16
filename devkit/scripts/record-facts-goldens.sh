#!/usr/bin/env bash
# Re-record the facts result baselines from a running devkit lite MCP.
#
# Runs every USE facts recipe (from tests/fixtures/documented-recipes.json)
# through the devkit lite MCP (StarRocks translator) and captures the result
# rows into the vendored compile-conformance fixture at
# chain-insights-graph-devkit/internal/cyphersql/testdata/facts-goldens.json.
#
# Topology scope never compiles to SQL and is out of this fixture — only the
# facts scope is recorded here.
#
# Each entry carries a `baseline` field:
#   "memgql"      — the recorded translation is trusted correct (single /
#                   fixed-hop facts reads + enrichment lookups). The vendored
#                   translator must reproduce these rows under -tags
#                   starrocks_it and compile them in CI.
#   "unsupported" — a documented shape outside the compiled facts subset
#                   (WITH/CASE/grouped aggregate). The translator must return
#                   ErrUnsupportedShape; these are reviewer-tagged, not
#                   auto-recorded.
#   "rejected"    — the live MCP rejected the shape while recording (kept for
#                   the negative-parity set; not exercised by the compile test).
#
# DECIMAL columns serialize as strings — preserved verbatim.
#
# Usage: bash devkit/scripts/record-facts-goldens.sh
# Prereq: devkit compose up, lite MCP on :18012.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RECIPES="$REPO_ROOT/tests/fixtures/documented-recipes.json"
OUT="$SCRIPT_DIR/../chain-insights-graph-devkit/internal/cyphersql/testdata/facts-goldens.json"
MCP="${DEVKIT_MCP_URL:-http://127.0.0.1:18012/mcp}"
NETWORK="${DEVKIT_NETWORK_NAME:-bittensor}"

test -f "$RECIPES" || { echo "missing $RECIPES — run the corpus harvest first" >&2; exit 1; }

python3 - "$RECIPES" "$OUT" "$MCP" "$NETWORK" <<'PY'
import json, subprocess, sys

recipes_path, out_path, mcp, network = sys.argv[1:5]
recipes = json.load(open(recipes_path))
entries = recipes if isinstance(recipes, list) else recipes.get("recipes", [])
facts = [r for r in entries if r.get("layer") == "facts"]

def call(query):
    payload = json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
        "params":{"name":"graph_query","arguments":{"network":network,"query":query}}})
    p = subprocess.run(["curl","-s","-X","POST",mcp,
        "-H","Content-Type: application/json",
        "-H","Accept: application/json, text/event-stream","-d",payload],
        capture_output=True, text=True, timeout=60)
    try:
        outer = json.loads(p.stdout)
        text = outer["result"]["content"][0]["text"]
        return json.loads(text)
    except Exception as e:
        return {"_error": str(e), "_raw": p.stdout[:300]}

out = {"generated_by": "record-facts-goldens.sh",
       "note": ("facts result baselines recorded from the devkit lite MCP; "
                "baseline=memgql trusted (compile + row parity under -tags starrocks_it), "
                "baseline=unsupported must return ErrUnsupportedShape. Topology scope never "
                "compiles to SQL and is out of this fixture."),
       "entries": []}
memgql_n = err_n = 0
for r in facts:
    q = r["query"]
    # Recipes explicitly marked out of the compiled facts subset
    # (WITH/CASE/grouped-aggregate) are negative shapes, not result baselines —
    # the translator must return ErrUnsupportedShape for them.
    if r.get("expect") == "unsupported":
        out["entries"].append({"id": r.get("id"), "layer": "facts", "query": q,
            "baseline": "unsupported",
            "reason": "documented shape outside the facts translator's compiled subset (WITH/CASE/grouped aggregate)"})
        err_n += 1
        continue
    res = call(q)
    rows = None
    if "_error" not in res:
        rows = (((res.get("facts") or {}).get("query") or {}).get("results"))
    if res.get("_error") or rows is None:
        out["entries"].append({"id": r.get("id"), "layer": "facts", "query": q,
            "baseline": "rejected", "rejected_reason": res.get("_error") or "no results object"})
        err_n += 1
        continue
    out["entries"].append({"id": r.get("id"), "layer": "facts", "query": q,
        "baseline": "memgql", "expected_rows": rows})
    memgql_n += 1

out["counts"] = {"memgql": memgql_n, "sql_truth": 0, "rejected": err_n, "total": len(facts)}
json.dump(out, open(out_path,"w"), indent=1, sort_keys=False)
print(f"recorded {len(facts)} facts recipes → {out_path}")
print(f"  memgql-baseline (trusted): {memgql_n}")
print(f"  unsupported/rejected (negative shapes): {err_n}")
PY
