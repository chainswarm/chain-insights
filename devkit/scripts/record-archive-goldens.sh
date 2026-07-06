#!/usr/bin/env bash
# T0b — record archive/facts result baselines WHILE MemGQL still runs.
#
# Runs every real-value archive_topology / facts recipe (from
# tests/fixtures/documented-recipes.json) through the CURRENT (pre-removal)
# devkit lite MCP (MemGQL → StarRocks) and captures the result rows into
# tests/fixtures/archive-result-goldens.json.
#
# Each entry carries a `baseline` field:
#   "memgql"    — MemGQL's translation of this shape is trusted correct
#                 (single/fixed-hop reads + facts lookups, the shapes the
#                 trace goldens + probe result-assertions already proved).
#   "sql-truth" — MemGQL is NOT trusted for this shape; expected rows are
#                 hand-derived (tests/fixtures/archive-sql-truth.sql) and
#                 filled in by a reviewer, NOT by this script.
#
# The new StarRocks-direct translator (post-migration) must reproduce
# "memgql" entries byte-for-byte and "sql-truth" entries by definition of
# correctness. DECIMAL columns serialize as strings — preserved verbatim.
#
# Usage: bash devkit/scripts/record-archive-goldens.sh
# Prereq: devkit compose up (MemGQL 0.7.0 still present), lite MCP on :18012.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RECIPES="$REPO_ROOT/tests/fixtures/documented-recipes.json"
OUT="$REPO_ROOT/tests/fixtures/archive-result-goldens.json"
MCP="${DEVKIT_MCP_URL:-http://127.0.0.1:18012/mcp}"
NETWORK="${DEVKIT_NETWORK_NAME:-bittensor}"

test -f "$RECIPES" || { echo "missing $RECIPES — run the corpus-v2 harvest first" >&2; exit 1; }

# Shapes whose MemGQL translation we do NOT trust (default to sql-truth).
# These match the closed upstream defects: anything using quantified paths,
# collect(), or inner-WHERE on the archive/facts layers. Everything else
# (fixed-hop reads, facts lookups) is trusted memgql baseline.
is_sql_truth() {
  local q="$1"
  echo "$q" | grep -qiE '\{[0-9]+,[0-9]*\}|collect\(|-\[[^]]*\*|WHERE[^)]*\)[[:space:]]*\)\{' && return 0
  return 1
}

call_mcp() {
  local query="$1"
  curl -s -X POST "$MCP" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graph_query","arguments":{"network":sys.argv[1],"query":sys.argv[2]}}}))' "$NETWORK" "$query")"
}

python3 - "$RECIPES" "$OUT" "$MCP" "$NETWORK" <<'PY'
import json, subprocess, sys, re

recipes_path, out_path, mcp, network = sys.argv[1:5]
recipes = json.load(open(recipes_path))
entries = recipes if isinstance(recipes, list) else recipes.get("recipes", [])
archive = [r for r in entries if r.get("layer") in ("archive_topology", "facts")]

SQL_TRUTH_RE = re.compile(r"\{[0-9]+,[0-9]*\}|collect\(|-\[[^\]]*\*", re.IGNORECASE)

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

out = {"generated_by": "record-archive-goldens.sh",
       "note": "T0b archive/facts result baselines recorded from MemGQL-era devkit; baseline=memgql trusted, baseline=sql-truth needs reviewer-derived rows",
       "entries": []}
memgql_n = truth_n = err_n = 0
for r in archive:
    q = r["query"]
    baseline = "sql-truth" if SQL_TRUTH_RE.search(q) else "memgql"
    res = call(q)
    rows = None
    if "_error" not in res:
        rows = (((res.get("facts") or {}).get("query") or {}).get("results"))
    if res.get("_error") or rows is None:
        # MemGQL rejected/failed this shape → it is a NEGATIVE shape, not a
        # result baseline; record as rejected for the negative-parity set.
        out["entries"].append({"id": r.get("id"), "layer": r["layer"], "query": q,
            "baseline": "rejected", "rejected_reason": res.get("_error") or "no results object"})
        err_n += 1
        continue
    if baseline == "sql-truth":
        out["entries"].append({"id": r.get("id"), "layer": r["layer"], "query": q,
            "baseline": "sql-truth", "memgql_rows_untrusted": rows, "expected_rows": None,
            "reviewer_note": "derive expected_rows from archive-sql-truth.sql; MemGQL output not trusted for this shape"})
        truth_n += 1
    else:
        out["entries"].append({"id": r.get("id"), "layer": r["layer"], "query": q,
            "baseline": "memgql", "expected_rows": rows})
        memgql_n += 1

out["counts"] = {"memgql": memgql_n, "sql_truth": truth_n, "rejected": err_n, "total": len(archive)}
json.dump(out, open(out_path,"w"), indent=1, sort_keys=False)
print(f"recorded {len(archive)} archive/facts recipes → {out_path}")
print(f"  memgql-baseline (trusted): {memgql_n}")
print(f"  sql-truth (needs reviewer rows): {truth_n}")
print(f"  rejected (negative shapes): {err_n}")
PY
